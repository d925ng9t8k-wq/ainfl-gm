import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function main() {
  console.log('=== PFF Big Board API Scraper ===\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  let bigBoardData = null;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('big_board')) {
      try {
        const body = await response.json();
        bigBoardData = body;
        console.log('Captured big_board API response!');
        console.log('Keys:', Object.keys(body));
        if (body.players) console.log('Players count:', body.players.length);
        if (body.groups) console.log('Groups count:', body.groups.length);
      } catch (e) {
        console.log('Failed to parse big_board response:', e.message);
      }
    }
  });

  console.log('Loading PFF Big Board page...');
  await page.goto('https://www.pff.com/draft/big-board', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  // If we didn't catch the API, try to call it directly
  if (!bigBoardData) {
    console.log('Trying direct API call...');
    try {
      const resp = await page.evaluate(async () => {
        const r = await fetch('/api/college/big_board?season=2026&version=4');
        return await r.json();
      });
      bigBoardData = resp;
      console.log('Direct API call succeeded!');
    } catch (e) {
      console.log('Direct API call failed:', e.message);
    }
  }

  // Also try to get table data from the page
  console.log('\nExtracting table data...');
  const tableData = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      return Array.from(cells).map(c => c.innerText.trim());
    });
  });
  console.log(`Found ${tableData.length} table rows`);
  if (tableData.length > 0) {
    console.log('First 5 rows:');
    tableData.slice(0, 5).forEach((row, i) => console.log(`  Row ${i}:`, row));
  }

  // Try to get header
  const headerData = await page.evaluate(() => {
    const headers = document.querySelectorAll('table thead th');
    return Array.from(headers).map(h => h.innerText.trim());
  });
  console.log('Headers:', headerData);

  // Save everything
  const output = {
    bigBoardAPI: bigBoardData,
    tableRows: tableData,
    headers: headerData
  };

  const outputPath = join(__dirname, 'pff-raw.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to ${outputPath}`);

  // Also try Tankathon
  console.log('\n=== Now trying Tankathon ===');
  const page2 = await context.newPage();

  let tankathonApi = [];
  page2.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') && (url.includes('tankathon') || url.includes('big_board') || url.includes('prospect'))) {
      try {
        const body = await response.json();
        if (JSON.stringify(body).length > 500) {
          tankathonApi.push({ url, data: body });
        }
      } catch (e) {}
    }
  });

  await page2.goto('https://www.tankathon.com/nfl/big_board', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.waitForTimeout(8000);

  // Extract Tankathon data
  const tankathonData = await page2.evaluate(() => {
    // Try to find player entries
    const players = [];
    // Tankathon uses .player-wrapper or similar
    const allText = document.body.innerText;
    return { text: allText, html: document.body.innerHTML.substring(0, 20000) };
  });

  console.log('Tankathon text length:', tankathonData.text.length);
  console.log('Tankathon text preview (first 3000):');
  console.log(tankathonData.text.substring(0, 3000));

  // Save updated data
  output.tankathonText = tankathonData.text;
  output.tankathonHtml = tankathonData.html;
  output.tankathonApi = tankathonApi;
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  await browser.close();
  console.log('\nDone!');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
