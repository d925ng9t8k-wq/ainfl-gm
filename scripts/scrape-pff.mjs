import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const results = {
  sources: {},
  apiData: [],
  errors: []
};

async function scrapePage(browser, url, label) {
  console.log(`\n--- Trying ${label}: ${url} ---`);
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  // Intercept API responses
  const apiResponses = [];
  page.on('response', async (response) => {
    const resUrl = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') && !resUrl.includes('analytics') && !resUrl.includes('google') && !resUrl.includes('facebook')) {
      try {
        const body = await response.json();
        if (JSON.stringify(body).length > 200) {
          apiResponses.push({ url: resUrl, data: body });
        }
      } catch (e) {}
    }
  });

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = resp?.status();
    console.log(`  Status: ${status}`);

    if (status === 403 || status === 401 || status === 429) {
      console.log(`  Blocked (${status})`);
      results.errors.push({ url, status, label });
      await context.close();
      return null;
    }

    // Wait for JS rendering
    await page.waitForTimeout(5000);

    // Get page text
    const bodyText = await page.evaluate(() => document.body.innerText);
    const title = await page.title();
    console.log(`  Title: ${title}`);
    console.log(`  Body text length: ${bodyText.length}`);

    // Try to find player cards/rows via selectors
    let playerElements = [];
    const selectors = [
      // Tankathon
      '.player-wrapper', '.big-board-player', '.prospect-row',
      'table tbody tr', '.player-name', '.prospect',
      // PFF
      '[class*="player"]', '[class*="prospect"]', '[class*="draft"]',
      // CBS
      '.prospect-list li', '.rankings-page-list li',
      // NFL
      '.d3-o-player-fullname', '.nfl-c-prospect',
      // Generic table rows
      '.ranking-table tr', '.board-row'
    ];

    for (const sel of selectors) {
      try {
        const count = await page.locator(sel).count();
        if (count > 3) {
          console.log(`  Found ${count} elements matching: ${sel}`);
          const items = await page.locator(sel).allTextContents();
          playerElements.push({ selector: sel, count, items: items.slice(0, 100) });
        }
      } catch (e) {}
    }

    // Store results
    const data = {
      url,
      label,
      status,
      title,
      bodyTextPreview: bodyText.substring(0, 5000),
      bodyTextFull: bodyText,
      playerElements,
      apiResponses: apiResponses.slice(0, 10)
    };

    results.sources[label] = data;

    if (apiResponses.length > 0) {
      console.log(`  Captured ${apiResponses.length} API responses`);
      results.apiData.push(...apiResponses);
    }

    await context.close();
    return data;
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    results.errors.push({ url, error: e.message, label });
    await context.close();
    return null;
  }
}

function parsePlayersFromText(text, source) {
  const players = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Tankathon format: lines like "1\nArvel Reese\nLB\nOhio State" or "1. Name - Position - School"
  // Try pattern: number followed by name, position, school
  const positions = ['QB','RB','WR','TE','OT','OL','IOL','OG','C','EDGE','DE','DT','DL','LB','ILB','OLB','CB','S','FS','SS','K','P','LS','ATH','FLEX','NT','IDL'];

  for (let i = 0; i < lines.length; i++) {
    // Check if this line is just a number (rank)
    const rankMatch = lines[i].match(/^(\d{1,3})\.?$/);
    if (rankMatch && i + 1 < lines.length) {
      const rank = parseInt(rankMatch[1]);
      if (rank >= 1 && rank <= 300) {
        // Look ahead for name, position, school
        let name = '', position = '', school = '';
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const line = lines[j];
          if (!name && !line.match(/^\d+$/) && !positions.includes(line.toUpperCase()) && line.length > 2 && line.length < 50) {
            name = line;
          } else if (!position && positions.includes(line.toUpperCase())) {
            position = line.toUpperCase();
          } else if (name && !school && !positions.includes(line.toUpperCase()) && !line.match(/^\d+$/) && line.length > 2 && line.length < 50) {
            school = line;
          }
        }
        if (name && position) {
          players.push({ rank, name, position, school, source });
        }
      }
    }

    // Also try inline format: "1. Name - Position - School" or "1. Name, Position, School"
    const inlineMatch = lines[i].match(/^(\d{1,3})\.\s+(.+?)[\s\-,]+\b(QB|RB|WR|TE|OT|OL|IOL|OG|C|EDGE|DE|DT|DL|LB|ILB|OLB|CB|S|FS|SS|K|P|LS|NT|IDL)\b[\s\-,]+(.+)/i);
    if (inlineMatch) {
      players.push({
        rank: parseInt(inlineMatch[1]),
        name: inlineMatch[2].trim(),
        position: inlineMatch[3].toUpperCase(),
        school: inlineMatch[4].trim(),
        source
      });
    }
  }

  return players;
}

async function main() {
  console.log('=== PFF / Draft Prospect Scraper ===\n');

  const browser = await chromium.launch({ headless: true });

  // PFF URLs
  const pffUrls = [
    ['https://www.pff.com/draft/big-board', 'PFF Big Board'],
    ['https://www.pff.com/draft/2026-nfl-mock-draft-simulator', 'PFF Mock Draft'],
    ['https://www.pff.com/news/draft-2026-nfl-mock-draft', 'PFF Mock Draft News'],
  ];

  // Backup URLs
  const backupUrls = [
    ['https://www.tankathon.com/nfl/big_board', 'Tankathon Big Board'],
    ['https://www.nfl.com/draft/tracker/prospects', 'NFL Prospects'],
    ['https://www.cbssports.com/nfl/draft/prospect-rankings/', 'CBS Prospect Rankings'],
  ];

  // Try PFF first
  let foundData = false;
  for (const [url, label] of pffUrls) {
    const data = await scrapePage(browser, url, label);
    if (data && data.bodyTextFull.length > 500) {
      const players = parsePlayersFromText(data.bodyTextFull, label);
      if (players.length > 5) {
        console.log(`  >> Parsed ${players.length} players from ${label}!`);
        data.parsedPlayers = players;
        foundData = true;
      }
    }
  }

  // Try backup sources
  for (const [url, label] of backupUrls) {
    const data = await scrapePage(browser, url, label);
    if (data && data.bodyTextFull.length > 500) {
      const players = parsePlayersFromText(data.bodyTextFull, label);
      if (players.length > 5) {
        console.log(`  >> Parsed ${players.length} players from ${label}!`);
        data.parsedPlayers = players;
        foundData = true;
      }
    }
  }

  await browser.close();

  // Save raw data
  const outputPath = join(__dirname, 'pff-raw.json');
  // Don't save full body text to keep file manageable
  const saveData = {};
  for (const [key, val] of Object.entries(results.sources)) {
    saveData[key] = {
      url: val.url,
      label: val.label,
      status: val.status,
      title: val.title,
      bodyTextPreview: val.bodyTextPreview,
      playerElements: val.playerElements,
      parsedPlayers: val.parsedPlayers || [],
      apiResponseCount: val.apiResponses?.length || 0,
      apiData: val.apiResponses || []
    };
  }
  saveData._errors = results.errors;
  saveData._apiData = results.apiData.slice(0, 5);

  writeFileSync(outputPath, JSON.stringify(saveData, null, 2));
  console.log(`\nSaved raw data to ${outputPath}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  let totalParsed = 0;
  for (const [key, val] of Object.entries(results.sources)) {
    const parsed = val.parsedPlayers?.length || 0;
    totalParsed += parsed;
    console.log(`  ${key}: status=${val.status}, textLen=${val.bodyTextFull.length}, parsed=${parsed} players`);
  }
  console.log(`  Errors: ${results.errors.length}`);
  console.log(`  Total parsed players: ${totalParsed}`);
  console.log(`  API responses captured: ${results.apiData.length}`);

  // Print top players if found
  for (const [key, val] of Object.entries(results.sources)) {
    if (val.parsedPlayers && val.parsedPlayers.length > 0) {
      console.log(`\n  Top 10 from ${key}:`);
      val.parsedPlayers.slice(0, 10).forEach(p => {
        console.log(`    ${p.rank}. ${p.name} - ${p.position} - ${p.school}`);
      });
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
