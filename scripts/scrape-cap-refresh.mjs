/**
 * Automated cap data refresh — runs in GitHub Actions weekly
 * Scrapes OTC salary cap space page for all 32 teams
 * Updates allRosters.js capSummary and GameContext.jsx Bengals cap
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function scrapeCapSpace() {
  console.log('Starting OTC cap space scrape...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('https://overthecap.com/salary-cap-space', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(6000);
  const text = await page.evaluate(() => document.body.innerText);
  await browser.close();

  // Parse the cap space table
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const teamMap = {
    'Titans': 'TEN', 'Chargers': 'LAC', 'Commanders': 'WSH', 'Cardinals': 'ARI',
    'Jets': 'NYJ', '49ers': 'SF', 'Seahawks': 'SEA', 'Eagles': 'PHI',
    'Patriots': 'NE', 'Colts': 'IND', 'Ravens': 'BAL', 'Lions': 'DET',
    'Steelers': 'PIT', 'Rams': 'LAR', 'Raiders': 'LV', 'Packers': 'GB',
    'Browns': 'CLE', 'Bengals': 'CIN', 'Texans': 'HOU', 'Buccaneers': 'TB',
    'Falcons': 'ATL', 'Giants': 'NYG', 'Broncos': 'DEN', 'Cowboys': 'DAL',
    'Saints': 'NO', 'Bills': 'BUF', 'Chiefs': 'KC', 'Jaguars': 'JAX',
    'Vikings': 'MIN', 'Panthers': 'CAR', 'Bears': 'CHI', 'Dolphins': 'MIA',
  };

  const results = {};
  for (let i = 0; i < lines.length; i++) {
    const teamName = Object.keys(teamMap).find(t => lines[i] === t);
    if (!teamName) continue;

    // Next line has the data: capSpace, effectiveCapSpace, #players, activeSpending, deadMoney
    const dataLine = lines[i + 1] || '';
    const dollars = dataLine.match(/[\$\-\(][\d,]+/g);
    if (!dollars || dollars.length < 3) continue;

    const parseDollar = (s) => {
      const neg = s.includes('(') || s.includes('-');
      const num = parseFloat(s.replace(/[\$,\(\)]/g, '')) / 1000000;
      return neg ? -num : num;
    };

    const abbr = teamMap[teamName];
    const capSpace = parseDollar(dollars[0]);
    const activeSpending = parseDollar(dollars[dollars.length - 2] || dollars[2]);
    const deadMoney = parseDollar(dollars[dollars.length - 1] || dollars[3]);
    const totalCap = capSpace + activeSpending + deadMoney;

    results[abbr] = { capSpace: Math.round(capSpace * 100) / 100, totalCap: Math.round(totalCap * 100) / 100, capUsed: Math.round(activeSpending * 100) / 100, deadCap: Math.round(deadMoney * 100) / 100 };
    console.log(`${abbr}: capSpace=$${capSpace.toFixed(1)}M totalCap=$${totalCap.toFixed(1)}M`);
  }

  return results;
}

async function updateFiles(data) {
  // Update allRosters.js capSummary for each non-CIN team
  let allRosters = readFileSync('src/data/allRosters.js', 'utf8');
  let updated = 0;

  for (const [abbr, capData] of Object.entries(data)) {
    if (abbr === 'CIN') continue;

    const teamIdx = allRosters.indexOf(`"${abbr}"`);
    if (teamIdx < 0) continue;

    const csIdx = allRosters.indexOf('"capSummary"', teamIdx);
    if (csIdx < 0 || csIdx > teamIdx + 50000) continue;

    const braceStart = allRosters.indexOf('{', csIdx + 12);
    const braceEnd = allRosters.indexOf('}', braceStart);

    const newSummary = `"totalCap": ${capData.totalCap}, "capUsed": ${capData.capUsed}, "deadCap": ${capData.deadCap}, "capSpace": ${capData.capSpace}`;
    allRosters = allRosters.slice(0, braceStart + 1) + newSummary + allRosters.slice(braceEnd);
    updated++;
  }

  writeFileSync('src/data/allRosters.js', allRosters);
  console.log(`Updated ${updated} teams in allRosters.js`);

  // Update Bengals cap in GameContext.jsx
  if (data.CIN) {
    let ctx = readFileSync('src/context/GameContext.jsx', 'utf8');
    ctx = ctx.replace(/const bengalsCapSpace = [\d.]+;/, `const bengalsCapSpace = ${data.CIN.capSpace};`);
    ctx = ctx.replace(/const bengalsCapTotal = [\d.]+;/, `const bengalsCapTotal = ${data.CIN.totalCap};`);
    writeFileSync('src/context/GameContext.jsx', ctx);
    console.log(`Updated Bengals cap: space=$${data.CIN.capSpace}M total=$${data.CIN.totalCap}M`);
  }
}

const data = await scrapeCapSpace();
if (Object.keys(data).length >= 28) {
  await updateFiles(data);
  console.log('Cap refresh complete!');
} else {
  console.error('Only found ' + Object.keys(data).length + ' teams — scrape may have failed');
  process.exit(1);
}
