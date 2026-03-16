// Check which of our free agents have signed with teams
// Uses Playwright to check Spotrac's available FA list, with fallback to known signings

import { chromium } from 'playwright';
import { readFileSync } from 'fs';

// Extract FA names from our freeAgents.js file
const faContent = readFileSync(new URL('../src/data/freeAgents.js', import.meta.url), 'utf8');
const faNames = [...faContent.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
console.log(`Our FA list has ${faNames.length} players.\n`);

// Known signed players (confirmed via Spotrac, NFL transactions, ESPN)
const confirmedSigned = {
  'Justin Fields': 'KC',
  'Trey Hendrickson': 'BAL',
  'Mike Evans': 'SF',
  'Boye Mafe': 'CIN',
  'Odafe Oweh': 'WSH',
  'Tyler Linderbaum': 'LV',
  'Jaelan Phillips': 'CAR',
  'Alec Pierce': 'IND',
  'Joseph Ossai': 'NYJ',
  'Darius Slay': 'BUF',
  'Kyler Murray': 'MIN',
  'Geno Smith': 'NYJ',
  'Zaire Franklin': 'GB',
  'Isaiah Likely': 'NYG',
  'Travis Etienne': 'NO',
  'Kenneth Walker III': 'KC',
  'DJ Moore': 'BUF',
  'David Montgomery': 'HOU',
  'Minkah Fitzpatrick': 'NYJ',
  'Rashan Gary': 'DAL',
  'Jonathan Allen': 'CIN (on roster)',
  'Bryan Cook': 'CIN (on roster)',
  'Kendrick Bourne': 'ARI (on roster)',
  'Tyler Allgeier': 'ARI (on roster)',
};

async function main() {
  let spotracAvailable = new Set();
  let spotracWorked = false;

  try {
    console.log('Attempting to scrape Spotrac available FA list...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://www.spotrac.com/nfl/free-agents/_/year/2026/status/available/perpage/100', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(6000);
    const text = await page.innerText('body');
    await browser.close();

    // Try to extract player names from the table
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      // Spotrac tables typically have player names as standalone lines
      if (line.length > 3 && line.length < 40 && !line.includes('$') && !line.includes('Year')) {
        spotracAvailable.add(line);
      }
    }
    if (spotracAvailable.size > 20) {
      spotracWorked = true;
      console.log(`Spotrac returned ${spotracAvailable.size} potential player entries.\n`);
    } else {
      console.log('Spotrac did not render enough data. Using fallback.\n');
    }
  } catch (e) {
    console.log('Spotrac scrape failed:', e.message, '\nUsing fallback.\n');
  }

  // Check our FAs against confirmed signings
  const stillInList = [];
  const shouldRemove = [];

  for (const name of faNames) {
    if (confirmedSigned[name]) {
      shouldRemove.push({ name, team: confirmedSigned[name] });
    } else if (spotracWorked && !spotracAvailable.has(name)) {
      // If Spotrac worked but player isn't on available list, flag them
      shouldRemove.push({ name, team: 'NOT on Spotrac available list' });
    } else {
      stillInList.push(name);
    }
  }

  if (shouldRemove.length > 0) {
    console.log('Players to REMOVE from freeAgents.js (confirmed signed):');
    for (const { name, team } of shouldRemove) {
      console.log(`  - ${name} -> ${team}`);
    }
  }

  console.log(`\n${stillInList.length} players remain as available free agents.`);
}

main().catch(console.error);
