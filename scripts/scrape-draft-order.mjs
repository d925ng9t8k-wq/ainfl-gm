import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://www.tankathon.com/nfl/full_draft', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(5000);
const text = await page.evaluate(() => document.body.innerText);
// Print first 10000 chars to get all rounds
console.log(text.substring(0, 12000));
await browser.close();
