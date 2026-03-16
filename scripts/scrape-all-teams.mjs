/**
 * BengalOracle GM — All 32 NFL Teams Cap Scraper
 * Scrapes Over The Cap salary-cap pages for all teams.
 * Uses Playwright headless Chromium, processes in batches of 4.
 * Run: node ~/Projects/BengalOracle/scripts/scrape-all-teams.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = join(__dirname, 'all-teams-raw.json');
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

// Parse a dollar string like "$48,000,000" or "$1,234" into millions
function parseDollars(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[\$,\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  // If the number is > 1000, it's likely in raw dollars, convert to millions
  if (Math.abs(num) > 1000) return Math.round((num / 1_000_000) * 100) / 100;
  return num;
}

// Parse the raw body text from an OTC salary-cap team page
// Format: each player is on its own line (no $ signs), followed by a line with
// tab-separated dollar amounts. The Cap Number is the LAST $ value on the salary line.
// Then dead money and cap savings follow on subsequent lines.
function parseOTCText(bodyText, slug) {
  const lines = bodyText.split('\n');

  // Find cap summary values from the combined summary line
  // e.g. "Total Cap Liabilities: $299,795,893Top 51: $274,429,338Team Cap Space: $31,302,153"
  let capSpace = 0;
  let totalCap = 0;
  let top51 = 0;

  for (const line of lines) {
    const tcl = line.match(/Total Cap Liabilities:\s*\$?([\d,]+)/i);
    if (tcl) totalCap = parseDollars('$' + tcl[1]);

    const t51 = line.match(/Top 51:\s*\$?([\d,]+)/i);
    if (t51) top51 = parseDollars('$' + t51[1]);

    // Handle both "Cap Space: $31,302,153" and "Cap Space: -$6,400,000" and "Cap Space: ($6,400,000)"
    const cs = line.match(/(?:Team )?Cap Space:\s*[\(\-]*\$?([\d,]+)/i);
    if (cs) {
      capSpace = parseDollars('$' + cs[1]);
      // Check for negative: either -$ or ($...)
      if (/Cap Space:\s*[\(\-]/i.test(line)) capSpace = -capSpace;
    }
  }

  // Parse players: look for name lines (no $ sign) followed by a salary line (has multiple $ values)
  // A name line: no $, not a header/nav line, 3-40 chars, starts with a letter
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
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      if (lines[j].trim() && lines[j].includes('$')) {
        salaryLine = lines[j];
        break;
      }
    }

    if (!salaryLine) continue;

    // Extract all dollar amounts from the salary line
    const dollarMatches = salaryLine.match(/\$[\d,]+/g);
    if (!dollarMatches || dollarMatches.length < 2) continue;

    // The Cap Number is the last dollar value on the salary line
    const capHit = parseDollars(dollarMatches[dollarMatches.length - 1]);

    players.push({
      name: nameLine,
      capHit,
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

// Process in batches of N
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
          console.log(`  ${SLUG_TO_ABBR[slug]}: ${parsed.players.length} players, cap space: ${parsed.capSpace}M`);
          results[slug] = parsed;
        }
      } else {
        console.log(`  BATCH ERROR: ${result.reason}`);
      }
    }

    // Small delay between batches to be polite
    if (i + batchSize < slugs.length) {
      console.log('  (waiting 2s before next batch...)');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BengalOracle GM — All 32 Teams Cap Scraper ===');
  console.log(`Started: ${new Date().toISOString()}`);

  const browser = await chromium.launch({ headless: true });

  try {
    // First, scrape just 1 team to calibrate the parser
    console.log('\n[CALIBRATION] Scraping Bengals first to validate parser...');
    const calibration = await scrapeTeam(browser, 'cincinnati-bengals');
    if (!calibration.error) {
      // Save raw text for debugging
      writeFileSync(join(__dirname, 'otc-bengals-sample.txt'), calibration.bodyText);
      console.log(`  Raw text saved to otc-bengals-sample.txt (${calibration.bodyText.length} chars)`);

      const parsed = parseOTCText(calibration.bodyText, 'cincinnati-bengals');
      console.log(`  Parsed: ${parsed.players.length} players, capSpace=${parsed.capSpace}M, totalCap=${parsed.totalCap}M`);
      if (parsed.players.length > 0) {
        console.log(`  Top 5 players:`);
        parsed.players
          .sort((a, b) => b.capHit - a.capHit)
          .slice(0, 5)
          .forEach(p => console.log(`    ${p.name}: $${p.capHit}M`));
      }

      if (parsed.players.length < 10) {
        console.log('\n  WARNING: Parser found fewer than 10 players. Dumping first 3000 chars of text:');
        console.log(calibration.bodyText.substring(0, 3000));
        console.log('\n  Will attempt full scrape anyway...');
      }
    }

    // Now scrape all 32 teams
    console.log('\n\n=== SCRAPING ALL 32 TEAMS ===');
    const allResults = await processBatches(browser, TEAM_SLUGS, 4);

    // Save raw JSON
    writeFileSync(OUT_JSON, JSON.stringify(allResults, null, 2));
    console.log(`\nRaw data saved to ${OUT_JSON}`);

    // Generate summary
    console.log('\n=== SUMMARY ===');
    let totalPlayers = 0;
    let failedTeams = 0;
    for (const [slug, data] of Object.entries(allResults)) {
      const abbr = SLUG_TO_ABBR[slug];
      if (data.error || data.players.length === 0) {
        console.log(`  ${abbr}: FAILED or 0 players`);
        failedTeams++;
      } else {
        totalPlayers += data.players.length;
      }
    }
    console.log(`\nTotal: ${totalPlayers} players across ${32 - failedTeams} teams (${failedTeams} failures)`);

    // Generate allRosters.js
    generateRostersFile(allResults);

  } finally {
    await browser.close();
  }

  console.log(`\nFinished: ${new Date().toISOString()}`);
}

function generateRostersFile(allResults) {
  console.log('\n=== GENERATING allRosters.js ===');

  const rosters = {};

  for (const [slug, data] of Object.entries(allResults)) {
    const abbr = SLUG_TO_ABBR[slug];
    if (!abbr) continue;

    // Skip CIN - already in bengalsRoster.js
    if (abbr === 'CIN') {
      console.log(`  ${abbr}: Skipped (use bengalsRoster.js)`);
      continue;
    }

    // Top 15 players by cap hit
    const topPlayers = (data.players || [])
      .sort((a, b) => b.capHit - a.capHit)
      .slice(0, 15)
      .map((p, idx) => ({
        id: idx + 1,
        name: p.name,
        position: 'UNK',
        age: 27,
        capHit: p.capHit,
        deadMoney: 0,
        capSavings: p.capHit,
        baseSalary: p.capHit,
        contractYears: 4,
        contractTotal: p.capHit * 4,
        yearsRemaining: 2,
        isFranchise: false,
      }));

    const totalCapUsed = (data.players || []).reduce((sum, p) => sum + p.capHit, 0);

    rosters[abbr] = {
      players: topPlayers,
      capSummary: {
        totalCap: data.totalCap || 301.2,
        capUsed: Math.round(totalCapUsed * 100) / 100,
        deadCap: 0,
        capSpace: data.capSpace || 0,
      },
    };

    console.log(`  ${abbr}: ${topPlayers.length} players, cap space: ${data.capSpace || 0}M`);
  }

  // Build the JS file
  let js = `// Auto-generated by scrape-all-teams.mjs on ${new Date().toISOString()}
// Source: Over The Cap (overthecap.com) 2026 salary cap data
// Top 15 players by cap hit for each team (except CIN which uses bengalsRoster.js)
// Position set to 'UNK' and age to 27 as defaults — cap hits are the critical data
export const allRosters = ${JSON.stringify(rosters, null, 2)};
`;

  writeFileSync(OUT_JS, js);
  console.log(`\nGenerated ${OUT_JS}`);
  console.log(`  Teams: ${Object.keys(rosters).length}`);
}

main().catch(console.error);
