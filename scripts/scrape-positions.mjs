// scrape-positions.mjs — Scrape ESPN roster pages for all 31 non-CIN NFL teams
// Uses Playwright to get player name, position, age from each team's roster page

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEAMS = [
  { abbr: 'ari', slug: 'arizona-cardinals', key: 'ARI' },
  { abbr: 'atl', slug: 'atlanta-falcons', key: 'ATL' },
  { abbr: 'bal', slug: 'baltimore-ravens', key: 'BAL' },
  { abbr: 'buf', slug: 'buffalo-bills', key: 'BUF' },
  { abbr: 'car', slug: 'carolina-panthers', key: 'CAR' },
  { abbr: 'chi', slug: 'chicago-bears', key: 'CHI' },
  { abbr: 'cle', slug: 'cleveland-browns', key: 'CLE' },
  { abbr: 'dal', slug: 'dallas-cowboys', key: 'DAL' },
  { abbr: 'den', slug: 'denver-broncos', key: 'DEN' },
  { abbr: 'det', slug: 'detroit-lions', key: 'DET' },
  { abbr: 'gb', slug: 'green-bay-packers', key: 'GB' },
  { abbr: 'hou', slug: 'houston-texans', key: 'HOU' },
  { abbr: 'ind', slug: 'indianapolis-colts', key: 'IND' },
  { abbr: 'jax', slug: 'jacksonville-jaguars', key: 'JAX' },
  { abbr: 'kc', slug: 'kansas-city-chiefs', key: 'KC' },
  { abbr: 'lv', slug: 'las-vegas-raiders', key: 'LV' },
  { abbr: 'lac', slug: 'los-angeles-chargers', key: 'LAC' },
  { abbr: 'lar', slug: 'los-angeles-rams', key: 'LAR' },
  { abbr: 'mia', slug: 'miami-dolphins', key: 'MIA' },
  { abbr: 'min', slug: 'minnesota-vikings', key: 'MIN' },
  { abbr: 'ne', slug: 'new-england-patriots', key: 'NE' },
  { abbr: 'no', slug: 'new-orleans-saints', key: 'NO' },
  { abbr: 'nyg', slug: 'new-york-giants', key: 'NYG' },
  { abbr: 'nyj', slug: 'new-york-jets', key: 'NYJ' },
  { abbr: 'phi', slug: 'philadelphia-eagles', key: 'PHI' },
  { abbr: 'pit', slug: 'pittsburgh-steelers', key: 'PIT' },
  { abbr: 'sf', slug: 'san-francisco-49ers', key: 'SF' },
  { abbr: 'sea', slug: 'seattle-seahawks', key: 'SEA' },
  { abbr: 'tb', slug: 'tampa-bay-buccaneers', key: 'TB' },
  { abbr: 'ten', slug: 'tennessee-titans', key: 'TEN' },
  { abbr: 'wsh', slug: 'washington-commanders', key: 'WSH' },
];

async function scrapeTeam(browser, team) {
  const url = `https://www.espn.com/nfl/team/roster/_/name/${team.abbr}/${team.slug}`;
  const page = await browser.newPage();

  try {
    console.log(`  Scraping ${team.key}...`);
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Extract player data from table rows using DOM queries
    const players = await page.evaluate(() => {
      const results = [];
      const rows = document.querySelectorAll('.Table__TBODY tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) continue;

        // Cell 0: headshot image
        // Cell 1: name + jersey number (combined text)
        // Cell 2: position
        // Cell 3: age
        const nameCell = cells[1];
        const posCell = cells[2];
        const ageCell = cells[3];

        // Name cell contains player name followed by jersey number
        // The link text has just the name
        const nameLink = nameCell.querySelector('a');
        let name = nameLink ? nameLink.textContent.trim() : nameCell.textContent.trim();
        // Remove trailing jersey number if present
        name = name.replace(/\d+$/, '').trim();

        const position = posCell.textContent.trim();
        const age = parseInt(ageCell.textContent.trim());

        if (name && position && !isNaN(age)) {
          results.push({ name, position, age });
        }
      }
      return results;
    });

    console.log(`  ${team.key}: found ${players.length} players`);
    return { key: team.key, players };
  } catch (err) {
    console.error(`  ERROR scraping ${team.key}: ${err.message}`);
    return { key: team.key, players: [] };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('Starting ESPN roster scrape for 31 teams...\n');

  const browser = await chromium.launch({ headless: true });
  const result = {};

  // Process in batches of 4
  const BATCH_SIZE = 4;
  for (let i = 0; i < TEAMS.length; i += BATCH_SIZE) {
    const batch = TEAMS.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(TEAMS.length/BATCH_SIZE)}: ${batch.map(t => t.key).join(', ')}`);

    const results = await Promise.all(batch.map(team => scrapeTeam(browser, team)));

    for (const r of results) {
      result[r.key] = r.players;
    }

    // 2s delay between batches (except after last batch)
    if (i + BATCH_SIZE < TEAMS.length) {
      console.log('  Waiting 2s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  await browser.close();

  // Summary
  let totalPlayers = 0;
  for (const [key, players] of Object.entries(result)) {
    totalPlayers += players.length;
  }
  console.log(`\nTotal: ${totalPlayers} players across ${Object.keys(result).length} teams`);

  // Save to file
  const outPath = join(__dirname, 'espn-rosters.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Saved to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
