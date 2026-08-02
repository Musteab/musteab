import { mkdir, rename, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USERNAME;

if (!username) {
  throw new Error("GITHUB_USERNAME is required");
}

const endpoint = `https://github.com/users/${encodeURIComponent(username)}/contributions`;

async function fetchContributionPage() {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(endpoint, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": `${username}-profile-contribution-card`,
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function contributionCountFromTooltip(tooltip) {
  const text = tooltip
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^No contributions\b/i.test(text)) {
    return 0;
  }

  const match = text.match(/^([\d,]+) contributions?\b/i);

  if (!match) {
    throw new Error(`Unexpected contribution tooltip: ${text}`);
  }

  return Number(match[1].replaceAll(",", ""));
}

function readCurrentYearContributionTotal(html, now = new Date()) {
  const year = now.getUTCFullYear();
  const today = now.toISOString().slice(0, 10);
  const dayPattern = /<td\b[^>]*data-date=["'](\d{4}-\d{2}-\d{2})["'][^>]*>[\s\S]*?<\/td>\s*<tool-tip\b[^>]*>([\s\S]*?)<\/tool-tip>/gi;
  const seenDates = new Set();
  let total = 0;

  for (const match of html.matchAll(dayPattern)) {
    const date = match[1];

    if (!date.startsWith(`${year}-`) || date > today) {
      continue;
    }

    if (seenDates.has(date)) {
      throw new Error(`Duplicate contribution date: ${date}`);
    }

    const count = contributionCountFromTooltip(match[2]);

    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid contribution count for ${date}`);
    }

    seenDates.add(date);
    total += count;
  }

  const expectedDays = Math.floor(
    (Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) - Date.UTC(year, 0, 1)) /
      86_400_000,
  ) + 1;

  if (seenDates.size < expectedDays - 1 || seenDates.size > expectedDays) {
    throw new Error(
      `Expected about ${expectedDays} contribution days for ${year}, parsed ${seenDates.size}`,
    );
  }

  return { total, year };
}

function renderCard(total, year) {
  const formattedTotal = new Intl.NumberFormat("en-US").format(total);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="180" viewBox="0 0 900 180" role="img" aria-labelledby="title description">
  <title id="title">${formattedTotal} GitHub contributions so far in ${year}</title>
  <desc id="description">Mustafe's current-year contribution total, refreshed from his public GitHub contribution graph.</desc>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0D1117" />
      <stop offset="1" stop-color="#101C2B" />
    </linearGradient>
    <linearGradient id="signal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2D74B2" />
      <stop offset="0.58" stop-color="#58A6FF" />
      <stop offset="0.82" stop-color="#E63946" />
      <stop offset="1" stop-color="#F4D35E" />
    </linearGradient>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#58A6FF" stroke-opacity="0.055" />
    </pattern>
  </defs>

  <rect x="1" y="1" width="898" height="178" rx="16" fill="url(#background)" stroke="#30363D" stroke-width="2" />
  <rect x="2" y="2" width="896" height="176" rx="15" fill="url(#grid)" />
  <rect x="0" y="174" width="900" height="6" rx="3" fill="url(#signal)" />

  <g font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">
    <text x="38" y="105" fill="#F4D35E" font-size="66" font-weight="800" letter-spacing="-3">${formattedTotal}</text>
    <text x="40" y="140" fill="#8B949E" font-size="15" letter-spacing="1.8">SO FAR THIS YEAR</text>

    <text x="472" y="73" fill="#C9D1D9" font-size="25" font-weight="700" letter-spacing="1.8">CONTRIBUTIONS</text>
    <text x="473" y="99" fill="#8B949E" font-size="13" letter-spacing="1.1">PUBLIC + PRIVATE AGGREGATE</text>
  </g>

  <g transform="translate(715 33)">
    <circle cx="89" cy="27" r="22" fill="#F4D35E" opacity="0.92" />
    <path d="M0 137V88h27v49zm34 0V62h31v75zm38 0V79h23v58zm30 0V42h36v95zm43 0V72h28v65z" fill="#1F4068" />
    <path d="M34 137V93h31v44zm68 0V83h36v54z" fill="#2D74B2" />
    <path d="M75 137v-31h19v31zm97 0v-42h13v42z" fill="#E63946" />
    <g fill="#F4D35E" opacity="0.9">
      <rect x="43" y="72" width="6" height="6" />
      <rect x="53" y="72" width="6" height="6" />
      <rect x="112" y="56" width="6" height="6" />
      <rect x="122" y="56" width="6" height="6" />
      <rect x="112" y="68" width="6" height="6" />
      <rect x="122" y="68" width="6" height="6" />
    </g>
  </g>
</svg>
`;
}

const html = await fetchContributionPage();
const { total, year } = readCurrentYearContributionTotal(html);
const outputDirectory = "profile";
const outputPath = `${outputDirectory}/contribution-signal.svg`;
const temporaryPath = `${outputPath}.tmp`;

await mkdir(outputDirectory, { recursive: true });
await writeFile(temporaryPath, renderCard(total, year), "utf8");
await rename(temporaryPath, outputPath);

console.log(
  `Rendered ${outputPath} with ${total.toLocaleString("en-US")} contributions in ${year}.`,
);
