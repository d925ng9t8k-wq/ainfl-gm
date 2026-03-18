/**
 * BengalOracle GM — Dead Money Scraper for All 32 NFL Teams
 * Scrapes the "Dead Money" section from Over The Cap salary-cap pages.
 * Uses Playwright headless Chromium, processes in batches of 4.
 * Run: node ~/Projects/BengalOracle/scripts/scrape-dead-caps.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = join(__dirname, 'dead-caps.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TEAM_SLUGS = [
  'arizona-cardinals', 'atlanta-falcons', 'baltimore-ravens', 'buffalo-bills',
  'carolina-panthers', 'chicago-bears', 'cincinnati-bengals', 'cleveland-browns',
  'dallas-cowboys', 'denver-broncos', 'detroit-lions', 'green-bay-packers',
  'houston-texans', 'indianapolis-colts', 'jacksonville-jaguars', 'kansas-city-chiefs',
  'las-vegas-raiders', 'los-angeles-chargers', 'los-angeles-rams', 'miami-dolphins',
  'minnesota-vikings', 'new-england-patriots', 'new-orleans-saints', 'new-york-giants',
  'new-york-jets', 'philadelphia-eagles', 'pittsburgh-steelers', 'san-francisco-49ers',
  'seattle-seahawks', 'tampa-bay-buccaneers', 'tennessee-titans', 'washington-commanders',
];

const SLUG_TO_ABBR = {
  'arizona-cardinals': 'ARI', 'atlanta-falcons': 'ATL', 'baltimore-ravens': 'BAL',
  'buffalo-bills': 'BUF', 'carolina-panthers': 'CAR', 'chicago-bears': 'CHI',
  'cincinnati-bengals': 'CIN', 'cleveland-browns': 'CLE', 'dallas-cowboys': 'DAL',
  'denver-broncos': 'DEN', 'detroit-lions': 'DET', 'green-bay-packers': 'GB',
  'houston-texans': 'HOU', 'indianapolis-colts': 'IND', 'jacksonville-jaguars': 'JAX',
  'kansas-city-chiefs': 'KC', 'las-vegas-raiders': 'LV', 'los-angeles-chargers': 'LAC',
  'los-angeles-rams': 'LAR', 'miami-dolphins': 'MIA', 'minnesota-vikings': 'MIN',
  'new-england-patriots': 'NE', 'new-orleans-saints': 'NO', 'new-york-giants': 'NYG',
  'new-york-jets': 'NYJ', 'philadelphia-eagles': 'PHI', 'pittsburgh-steelers': 'PIT',
  'san-francisco-49ers': 'SF', 'seattle-seahawks': 'SEA', 'tampa-bay-buccaneers': 'TB',
  'tennessee-titans': 'TEN', 'washington-commanders': 'WSH',
};

/**
 * Parse the Dead Money section from OTC body text.
 * The section appears after "Dead Money" heading and before "TOTAL".
 * Format:
 *   Dead Money
 *   Name\tCap Number
 *   PlayerName\n\t$X,XXX,XXX
 *   ...
 *   TOTAL\t$XX,XXX,XXX
 */
function parseDeadMoney(bodyText) {
  const lines = bodyText.split('\n');

  // Find the "Dead Money" section start
  let deadMoneyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Look for "Dead Money" as a section header (standalone line)
    if (trimmed === 'Dead Money') {
      // Verify it's the section header, not some other mention
      // It should appear after "Non-Active Roster Cap Charges" or similar
      deadMoneyStart = i;
      // Keep searching — we want the LAST occurrence (the actual section, not nav)
    }
  }

  if (deadMoneyStart === -1) {
    console.log('    Could not find "Dead Money" section header');
    return [];
  }

  const entries = [];

  // Skip past the header line(s) — look for "Name" or "Cap Number" header row
  let i = deadMoneyStart + 1;
  // Skip the column header line (e.g., "Name\tCap Number")
  if (i < lines.length && /Name/i.test(lines[i])) {
    i++;
  }

  // Now parse player entries until we hit TOTAL or another section
  while (i < lines.length) {
    const line = lines[i].trim();

    // Stop at TOTAL line
    if (/^TOTAL/i.test(line)) break;

    // Stop if we hit another section
    if (/^(Active Roster|Injured Reserve|Practice Squad|Franchise|Offense|Defense)/i.test(line)) break;

    // Skip empty lines
    if (!line) { i++; continue; }

    // A player name line: no $ sign, reasonable length, starts with a letter
    if (!line.includes('$') && line.length >= 3 && line.length <= 50 && /^[A-Z]/i.test(line)) {
      const playerName = line;

      // Look ahead for the dollar amount on the next non-empty line
      let amount = 0;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        const dollarMatch = nextLine.match(/\$([\d,]+)/);
        if (dollarMatch) {
          amount = parseInt(dollarMatch[1].replace(/,/g, ''), 10);
          i = j; // advance past the amount line
          break;
        }
        // If next non-empty line has no dollar sign, it might be another name
        break;
      }

      if (amount > 0) {
        entries.push({ name: playerName, amount });
      }
    }

    i++;
  }

  return entries;
}

async function scrapeTeam(browser, slug) {
  const url = `https://overthecap.com/salary-cap/${slug}`;
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(6000);
    const bodyText = await page.evaluate(() => document.body.innerText);
    return { slug, bodyText, error: null };
  } catch (err) {
    console.error(`  ERROR scraping ${slug}: ${err.message}`);
    return { slug, bodyText: '', error: err.message };
  } finally {
    await ctx.close();
  }
}

async function processBatches(browser, slugs, batchSize = 4) {
  const results = {};

  for (let i = 0; i < slugs.length; i += batchSize) {
    const batch = slugs.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(slugs.length / batchSize);
    console.log(`\n--- Batch ${batchNum}/${totalBatches}: ${batch.map(s => SLUG_TO_ABBR[s]).join(', ')} ---`);

    const batchResults = await Promise.allSettled(
      batch.map(slug => scrapeTeam(browser, slug))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const { slug, bodyText, error } = result.value;
        const abbr = SLUG_TO_ABBR[slug];
        if (error) {
          console.log(`  ${abbr}: FAILED - ${error}`);
          results[abbr] = [];
        } else {
          const entries = parseDeadMoney(bodyText);
          console.log(`  ${abbr}: ${entries.length} dead money entries`);
          if (entries.length > 0) {
            entries.slice(0, 3).forEach(e =>
              console.log(`    - ${e.name}: $${e.amount.toLocaleString()}`)
            );
            if (entries.length > 3) console.log(`    ... and ${entries.length - 3} more`);
          }
          results[abbr] = entries;
        }
      } else {
        console.log(`  BATCH ERROR: ${result.reason}`);
      }
    }

    // 2s delay between batches
    if (i + batchSize < slugs.length) {
      console.log('  (waiting 2s before next batch...)');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

async function main() {
  console.log('=== BengalOracle GM — Dead Money Scraper ===');
  console.log(`Started: ${new Date().toISOString()}`);

  const browser = await chromium.launch({ headless: true });

  try {
    // Calibration: scrape Bengals first
    console.log('\n[CALIBRATION] Scraping Bengals to validate dead money parser...');
    const cal = await scrapeTeam(browser, 'cincinnati-bengals');
    if (!cal.error) {
      const entries = parseDeadMoney(cal.bodyText);
      console.log(`  Found ${entries.length} dead money entries for CIN:`);
      entries.forEach(e => console.log(`    ${e.name}: $${e.amount.toLocaleString()}`));
    }

    // Scrape all 32 teams
    console.log('\n\n=== SCRAPING ALL 32 TEAMS ===');
    const allResults = await processBatches(browser, TEAM_SLUGS, 4);

    // Save JSON
    writeFileSync(OUT_JSON, JSON.stringify(allResults, null, 2));
    console.log(`\nSaved to ${OUT_JSON}`);

    // Summary
    console.log('\n=== SUMMARY ===');
    let totalEntries = 0;
    let teamsWithDead = 0;
    for (const [abbr, entries] of Object.entries(allResults)) {
      if (entries.length > 0) {
        teamsWithDead++;
        totalEntries += entries.length;
        const totalAmt = entries.reduce((s, e) => s + e.amount, 0);
        console.log(`  ${abbr}: ${entries.length} entries, total $${(totalAmt / 1_000_000).toFixed(1)}M`);
      } else {
        console.log(`  ${abbr}: 0 entries`);
      }
    }
    console.log(`\nTeams with dead money: ${teamsWithDead}/32`);
    console.log(`Total entries: ${totalEntries}`);
  } finally {
    await browser.close();
  }

  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main().catch(console.error);
