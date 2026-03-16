import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://www.spotrac.com/nfl/free-agents/_/year/2026/status/signed', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(6000);
const text = await page.evaluate(() => document.body.innerText);
// Print everything between SIGNED header and TRENDING
const start = text.indexOf('SIGNED');
const end = text.indexOf('TRENDING PLAYERS');
console.log(text.substring(start > 0 ? start : 0, end > 0 ? end : start + 8000));
await browser.close();
