import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Get signed FAs
await page.goto('https://www.spotrac.com/nfl/free-agents/_/year/2026/status/signed', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(6000);
const text = await page.evaluate(() => document.body.innerText);

// Extract player names and teams from the signed list
const lines = text.split('\n').filter(l => l.trim());
let inTable = false;
for (const line of lines) {
  if (line.includes('PLAYER') && line.includes('POS')) { inTable = true; continue; }
  if (inTable && /^[A-Z]/.test(line.trim()) && !line.includes('TRENDING') && !line.includes('THE SPOTRAC')) {
    console.log(line.trim().substring(0, 120));
  }
  if (line.includes('TRENDING PLAYERS')) break;
}
await browser.close();
