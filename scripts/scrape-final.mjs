import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function scrape(browser, url, label) {
  console.log(`\n=== ${label} ===`);
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Intercept JSON API responses
  const jsonResponses = [];
  page.on('response', async (resp) => {
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json') && resp.url().includes('api')) {
      try {
        const body = await resp.json();
        jsonResponses.push({ url: resp.url(), data: body });
      } catch {}
    }
  });

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(6000);
    const text = await page.evaluate(() => document.body.innerText);
    console.log(text.substring(0, 8000));
    if (jsonResponses.length > 0) {
      console.log(`\n--- ${jsonResponses.length} API responses intercepted ---`);
      for (const r of jsonResponses) {
        console.log(`URL: ${r.url}`);
        console.log(JSON.stringify(r.data).substring(0, 2000));
      }
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
  await ctx.close();
}

const browser = await chromium.launch({ headless: true });

// 1. OTC Bengals salary cap - get real cap hits
await scrape(browser, 'https://overthecap.com/salary-cap/cincinnati-bengals', 'OTC BENGALS CAP');

// 2. OTC cap space for all teams
await scrape(browser, 'https://overthecap.com/salary-cap-space', 'OTC ALL TEAMS CAP SPACE');

// 3. Spotrac 2026 free agents - available players
await scrape(browser, 'https://www.spotrac.com/nfl/free-agents/_/year/2026/status/available', 'SPOTRAC AVAILABLE FAs');

// 4. Spotrac 2026 free agents - all signed
await scrape(browser, 'https://www.spotrac.com/nfl/free-agents/_/year/2026/status/signed', 'SPOTRAC SIGNED FAs');

await browser.close();
