/**
 * BengalOracle — Scrape Contract End Years from OTC
 *
 * For each of the 32 teams, visits the OTC salary-cap page and checks
 * year tabs 2026-2029 to determine the last year each player appears.
 * That last year = contract end year.
 *
 * Run: node ~/Projects/BengalOracle/scripts/scrape-contract-end-years.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = join(__dirname, 'contract-end-years.json');

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

const YEARS_TO_CHECK = ['2026', '2027', '2028', '2029'];

// Skip patterns for non-player lines
const skipPatterns = /^(Player|Name|Pos|Position|Total|Dead Money|Cap$|Active|Injured|FRANCHISE|Practice|Salary|Team|NFL|©|Navigation|Search|Trending|FREE|CONTRACTS|DRAFT|HISTORY|TRENDS|LOGIN|CALCULATOR|TEAMS|POSITIONS|INTERACTIVE|Top Executive|2026|2027|2028|2029|2030|2031|2032|Offense|Defense|Special|Active Roster|Non-Active|Dead Money|TOTAL|Discover|Email|Technical|Twitter|Facebook|Copyright|Terms|This website|Top 51 Cutoff|Signing|Option|Regular|Per Game|Cut|Trade|Restructure|Extension|Number)/i;

/**
 * Extract player names from the Active Roster section of body text
 */
function extractPlayerNames(bodyText) {
  const lines = bodyText.split('\n');
  const names = [];

  // Find the Active Roster section
  // The section starts with "Active Roster (N total)" and ends with "Non-Active Roster"
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^Active Roster/i.test(line) && startIdx === -1) {
      startIdx = i + 1;
    }
    if (/^Non-Active Roster/i.test(line) && startIdx !== -1) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) return names;

  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i].trim();

    // Skip empty, short, or header lines
    if (!line || line.length < 3 || line.length > 50) continue;
    if (line.includes('$')) continue;
    if (line.includes('\t')) continue;
    if (skipPatterns.test(line)) continue;
    if (/^[\d\(\)\+\-\/\\#]/.test(line)) continue;

    // Must look like a name: starts with uppercase letter
    if (/^[A-Z]/.test(line)) {
      // Check if a nearby line has dollar amounts (confirms this is a player row)
      let hasDollarLine = false;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (lines[j].includes('$')) {
          hasDollarLine = true;
          break;
        }
      }
      if (hasDollarLine) {
        names.push(line);
      }
    }
  }

  return names;
}

/**
 * Scrape one team across all year tabs
 */
async function scrapeTeamYears(browser, slug) {
  const abbr = SLUG_TO_ABBR[slug];
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
    console.log(`  ${abbr}: Loading page...`);
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    // playersByYear: { '2026': Set(['Name1', 'Name2']), '2027': Set([...]), ... }
    const playersByYear = {};

    for (const year of YEARS_TO_CHECK) {
      if (year !== '2026') {
        // Click the year tab
        await page.evaluate((yr) => {
          const links = Array.from(document.querySelectorAll('a'));
          const tab = links.find(l => l.textContent.trim() === yr);
          if (tab) tab.click();
        }, year);
        await page.waitForTimeout(4000);
      }

      const bodyText = await page.evaluate(() => document.body.innerText);
      const names = extractPlayerNames(bodyText);
      playersByYear[year] = new Set(names);
      console.log(`  ${abbr} ${year}: ${names.length} players`);
    }

    // Determine contract end year for each player
    // A player's end year = last year they appear on
    const endYears = {};
    const allPlayers = new Set();
    for (const year of YEARS_TO_CHECK) {
      for (const name of playersByYear[year]) {
        allPlayers.add(name);
      }
    }

    for (const name of allPlayers) {
      let endYear = 2026; // minimum
      for (const year of YEARS_TO_CHECK) {
        if (playersByYear[year].has(name)) {
          endYear = parseInt(year);
        }
      }
      endYears[name] = endYear;
    }

    console.log(`  ${abbr}: ${Object.keys(endYears).length} players mapped`);
    return { abbr, endYears, error: null };

  } catch (err) {
    console.error(`  ERROR ${abbr}: ${err.message}`);
    return { abbr, endYears: {}, error: err.message };
  } finally {
    await ctx.close();
  }
}

async function main() {
  console.log('=== Scraping Contract End Years from OTC ===\n');
  console.log(`Checking years: ${YEARS_TO_CHECK.join(', ')}`);
  console.log(`Teams: ${TEAM_SLUGS.length}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = {};
  const BATCH_SIZE = 4;

  for (let i = 0; i < TEAM_SLUGS.length; i += BATCH_SIZE) {
    const batch = TEAM_SLUGS.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(TEAM_SLUGS.length / BATCH_SIZE);
    console.log(`\n--- Batch ${batchNum}/${totalBatches}: ${batch.map(s => SLUG_TO_ABBR[s]).join(', ')} ---`);

    const batchResults = await Promise.allSettled(
      batch.map(slug => scrapeTeamYears(browser, slug))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && !result.value.error) {
        results[result.value.abbr] = result.value.endYears;
      } else if (result.status === 'fulfilled') {
        console.log(`  FAILED: ${result.value.abbr} - ${result.value.error}`);
      } else {
        console.log(`  BATCH ERROR: ${result.reason}`);
      }
    }

    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < TEAM_SLUGS.length) {
      console.log('  Waiting 3s before next batch...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await browser.close();

  // Write results
  writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  console.log(`\n=== Done! Saved to ${OUT_JSON} ===`);

  // Summary
  let totalPlayers = 0;
  for (const abbr of Object.keys(results)) {
    totalPlayers += Object.keys(results[abbr]).length;
  }
  console.log(`Total teams: ${Object.keys(results).length}`);
  console.log(`Total players mapped: ${totalPlayers}`);

  // Spot checks
  if (results['LAR'] && results['LAR']['Jared Verse']) {
    console.log(`\nSpot check — Jared Verse (LAR): contract ends ${results['LAR']['Jared Verse']}`);
  }
  if (results['CIN'] && results['CIN']['Tee Higgins']) {
    console.log(`Spot check — Tee Higgins (CIN): contract ends ${results['CIN']['Tee Higgins']}`);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
