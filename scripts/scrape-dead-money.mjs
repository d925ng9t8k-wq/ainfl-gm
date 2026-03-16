/**
 * BengalOracle GM — All 32 NFL Teams Dead Money Scraper
 * Scrapes Over The Cap salary-cap pages for all teams,
 * extracting cap hit, dead money, and cap savings per player.
 * Uses Playwright headless Chromium, processes in batches of 4.
 * Run: node ~/Projects/BengalOracle/scripts/scrape-dead-money.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = join(__dirname, 'all-teams-deadmoney.json');
const OUT_JS = join(__dirname, '..', 'src', 'data', 'allRosters.js');

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

// Parse a dollar string like "$48,000,000" or "($15,415,000)" into millions
function parseDollars(str) {
  if (!str) return 0;
  const isNeg = str.includes('(') || str.startsWith('-');
  const cleaned = str.replace(/[\$,\s\(\)]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  const millions = Math.abs(num) > 1000 ? Math.round((num / 1_000_000) * 100) / 100 : num;
  return isNeg ? -millions : millions;
}

/**
 * Parse the raw body text from an OTC salary-cap team page.
 *
 * Format per player:
 *   PlayerName
 *   \t$base\t$prorated\t...\t$capNumber\t\t
 *   $deadMoney
 *   \t
 *   $capSavings (or ($capSavings) if negative)
 */
function parseOTCText(bodyText, slug) {
  const lines = bodyText.split('\n');

  // Extract cap summary
  let capSpace = 0, totalCap = 0, top51 = 0;

  for (const line of lines) {
    const tcl = line.match(/Total Cap Liabilities:\s*\$?([\d,]+)/i);
    if (tcl) totalCap = parseDollars('$' + tcl[1]);

    const t51 = line.match(/Top 51:\s*\$?([\d,]+)/i);
    if (t51) top51 = parseDollars('$' + t51[1]);

    const cs = line.match(/(?:Team )?Cap Space:\s*[\(\-]*\$?([\d,]+)/i);
    if (cs) {
      capSpace = parseDollars('$' + cs[1]);
      if (/Cap Space:\s*[\(\-]/i.test(line)) capSpace = -capSpace;
    }
  }

  // Parse players with dead money and cap savings
  const players = [];
  const skipPatterns = /^(Player|Name|Pos|Position|Total|Dead Money|Cap$|Active|Injured|FRANCHISE|Practice|Salary|Team|NFL|©|Navigation|Search|Trending|FREE|CONTRACTS|DRAFT|HISTORY|TRENDS|LOGIN|CALCULATOR|TEAMS|POSITIONS|INTERACTIVE|Top Executive|2026|2027|2028|2029|2030|2031|2032|Offense|Defense|Special|Active Roster|Non-Active|Dead Money|TOTAL|Discover|Email|Technical|Twitter|Facebook|Copyright|Terms|This website|Top 51 Cutoff|Signing|Option|Regular|Per Game|Cut|Trade|Restructure|Extension|Number)/i;

  for (let i = 0; i < lines.length; i++) {
    const nameLine = lines[i].trim();

    // Skip empty lines, short lines, lines with $, header/nav lines
    if (!nameLine || nameLine.length < 3 || nameLine.length > 50) continue;
    if (nameLine.includes('$')) continue;
    if (skipPatterns.test(nameLine)) continue;
    if (/^[\d\(\)\+\-\/\\#\t]/.test(nameLine)) continue;
    if (/^\t/.test(lines[i])) continue; // indented lines are data, not names

    // The next non-empty line should have dollar amounts (the salary breakdown)
    let salaryLine = '';
    let salaryLineIdx = -1;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      if (lines[j].trim() && lines[j].includes('$')) {
        salaryLine = lines[j];
        salaryLineIdx = j;
        break;
      }
    }

    if (!salaryLine) continue;

    // Extract all dollar amounts from the salary line
    const dollarMatches = salaryLine.match(/\$[\d,]+/g);
    if (!dollarMatches || dollarMatches.length < 2) continue;

    // The Cap Number is the last dollar value on the salary line
    const capHit = parseDollars(dollarMatches[dollarMatches.length - 1]);

    // Now look for dead money and cap savings on subsequent lines
    // Dead money: first dollar amount (or parenthesized) found after the salary line
    // Cap savings: the next dollar amount after dead money
    let deadMoney = 0;
    let capSavings = capHit; // default: if cut, you save the full cap hit
    let foundDead = false;
    let foundSavings = false;

    for (let j = salaryLineIdx + 1; j < Math.min(salaryLineIdx + 6, lines.length); j++) {
      const line = lines[j].trim();
      if (!line) continue;

      // Look for dollar amounts (including negative in parens)
      const dollarMatch = line.match(/[\(\-]*\$[\d,]+\)?/);
      if (!dollarMatch) continue;

      if (!foundDead) {
        deadMoney = parseDollars(dollarMatch[0]);
        foundDead = true;
      } else if (!foundSavings) {
        capSavings = parseDollars(dollarMatch[0]);
        foundSavings = true;
        break;
      }
    }

    players.push({
      name: nameLine,
      capHit,
      deadMoney,
      capSavings,
    });
  }

  return { capSpace, totalCap, top51, players };
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
        if (error) {
          console.log(`  ${SLUG_TO_ABBR[slug]}: FAILED - ${error}`);
          results[slug] = { error, capSpace: 0, totalCap: 0, players: [] };
        } else {
          const parsed = parseOTCText(bodyText, slug);
          const withDead = parsed.players.filter(p => p.deadMoney !== 0).length;
          console.log(`  ${SLUG_TO_ABBR[slug]}: ${parsed.players.length} players (${withDead} with dead money), cap space: ${parsed.capSpace}M`);
          results[slug] = parsed;
        }
      } else {
        console.log(`  BATCH ERROR: ${result.reason}`);
      }
    }

    if (i + batchSize < slugs.length) {
      console.log('  (waiting 2s before next batch...)');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

function generateRostersFile(allResults) {
  console.log('\n=== GENERATING allRosters.js ===');

  const rosters = {};
  let grandTotal = 0;
  let deadMoneyCount = 0;

  for (const [slug, data] of Object.entries(allResults)) {
    const abbr = SLUG_TO_ABBR[slug];
    if (!abbr) continue;

    // Skip CIN - already in bengalsRoster.js
    if (abbr === 'CIN') {
      console.log(`  ${abbr}: Skipped (use bengalsRoster.js)`);
      continue;
    }

    const allPlayers = (data.players || [])
      .sort((a, b) => b.capHit - a.capHit)
      .map((p, idx) => ({
        id: idx + 1,
        name: p.name,
        position: 'UNK',
        age: 27,
        capHit: p.capHit,
        deadMoney: p.deadMoney || 0,
        capSavings: p.capSavings || p.capHit,
        baseSalary: p.capHit,
        contractYears: 4,
        contractTotal: Math.round(p.capHit * 4 * 100) / 100,
        yearsRemaining: 2,
        isFranchise: false,
      }));

    const totalCapUsed = (data.players || []).reduce((sum, p) => sum + p.capHit, 0);
    const totalDeadCap = (data.players || []).reduce((sum, p) => sum + (p.deadMoney || 0), 0);

    rosters[abbr] = {
      players: allPlayers,
      capSummary: {
        totalCap: data.totalCap || 301.2,
        capUsed: Math.round(totalCapUsed * 100) / 100,
        deadCap: Math.round(totalDeadCap * 100) / 100,
        capSpace: data.capSpace || 0,
      },
    };

    const teamDead = allPlayers.filter(p => p.deadMoney !== 0).length;
    grandTotal += allPlayers.length;
    deadMoneyCount += teamDead;
    console.log(`  ${abbr}: ${allPlayers.length} players (${teamDead} with dead money), cap space: ${data.capSpace || 0}M`);
  }

  const js = `// Auto-generated by scrape-dead-money.mjs on ${new Date().toISOString()}
// Source: Over The Cap (overthecap.com) 2026 salary cap data
// ALL players for each team (except CIN which uses bengalsRoster.js)
// Includes dead money and cap savings scraped from OTC
export const allRosters = ${JSON.stringify(rosters, null, 2)};
`;

  writeFileSync(OUT_JS, js);
  console.log(`\nGenerated ${OUT_JS}`);
  console.log(`  Teams: ${Object.keys(rosters).length}`);
  console.log(`  Total players: ${grandTotal}`);
  console.log(`  Players with dead money data: ${deadMoneyCount}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BengalOracle GM — Dead Money Scraper ===');
  console.log(`Started: ${new Date().toISOString()}`);

  const browser = await chromium.launch({ headless: true });

  try {
    // Calibrate with Bengals first (we have the sample to compare)
    console.log('\n[CALIBRATION] Scraping Bengals to validate parser...');
    const calibration = await scrapeTeam(browser, 'cincinnati-bengals');
    if (!calibration.error) {
      const parsed = parseOTCText(calibration.bodyText, 'cincinnati-bengals');
      console.log(`  Parsed: ${parsed.players.length} players, capSpace=${parsed.capSpace}M`);

      // Verify known values from sample
      const burrow = parsed.players.find(p => p.name === 'Joe Burrow');
      if (burrow) {
        console.log(`  Joe Burrow: cap=$${burrow.capHit}M, dead=$${burrow.deadMoney}M, savings=$${burrow.capSavings}M`);
        // Expected: cap=48M, dead=91.75M, savings=-43.75M
        if (burrow.deadMoney > 80 && burrow.capSavings < 0) {
          console.log('  ✓ Parser validated - dead money and cap savings look correct!');
        } else {
          console.log('  ⚠ Parser may have issues - expected dead ~91.75M, savings ~-43.75M');
        }
      }

      if (parsed.players.length > 0) {
        console.log(`  Top 5 by cap hit:`);
        parsed.players
          .sort((a, b) => b.capHit - a.capHit)
          .slice(0, 5)
          .forEach(p => console.log(`    ${p.name}: cap=$${p.capHit}M, dead=$${p.deadMoney}M, savings=$${p.capSavings}M`));
      }

      if (parsed.players.length < 10) {
        console.log('\n  WARNING: Parser found fewer than 10 players.');
        console.log('  First 3000 chars of page text:');
        console.log(calibration.bodyText.substring(0, 3000));
      }
    }

    // Scrape all 32 teams
    console.log('\n\n=== SCRAPING ALL 32 TEAMS ===');
    const allResults = await processBatches(browser, TEAM_SLUGS, 4);

    // Save raw JSON
    writeFileSync(OUT_JSON, JSON.stringify(allResults, null, 2));
    console.log(`\nRaw data saved to ${OUT_JSON}`);

    // Summary
    console.log('\n=== SUMMARY ===');
    let totalPlayers = 0;
    let totalWithDead = 0;
    let failedTeams = 0;
    for (const [slug, data] of Object.entries(allResults)) {
      const abbr = SLUG_TO_ABBR[slug];
      if (data.error || data.players.length === 0) {
        console.log(`  ${abbr}: FAILED or 0 players`);
        failedTeams++;
      } else {
        totalPlayers += data.players.length;
        totalWithDead += data.players.filter(p => p.deadMoney !== 0).length;
      }
    }
    console.log(`\nTotal: ${totalPlayers} players across ${32 - failedTeams} teams (${failedTeams} failures)`);
    console.log(`Players with dead money data: ${totalWithDead}`);

    // Generate allRosters.js
    generateRostersFile(allResults);

  } finally {
    await browser.close();
  }

  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main().catch(console.error);
