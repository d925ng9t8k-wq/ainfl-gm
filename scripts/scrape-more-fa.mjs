import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Get ALL available FAs (set to 100 per page)
await page.goto('https://www.spotrac.com/nfl/free-agents/_/year/2026/status/available/perpage/100', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(6000);
const text = await page.evaluate(() => document.body.innerText);
const start = text.indexOf('PLAYER');
const end = text.indexOf('TRENDING PLAYERS');
console.log('=== AVAILABLE FAs (100 per page) ===');
console.log(text.substring(start > 0 ? start : 0, end > 0 ? end : start + 10000));

// Also get signed FAs to see who else is available
await page.goto('https://www.spotrac.com/nfl/free-agents/_/year/2026/status/available/perpage/all', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(6000);
const text2 = await page.evaluate(() => document.body.innerText);
const start2 = text2.indexOf('PLAYER');
const end2 = text2.indexOf('TRENDING PLAYERS');
console.log('\n=== ALL AVAILABLE FAs ===');
console.log(text2.substring(start2 > 0 ? start2 : 0, end2 > 0 ? end2 : start2 + 15000));

await browser.close();
