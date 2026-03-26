/**
 * Bengals roster refresh — runs in GitHub Actions daily
 * Lightweight version: scrapes OTC Bengals cap table and updates GameContext.jsx
 * Full scrape (scrape-bengals.mjs) is for local/manual use only.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function scrapeBengalsOTC() {
  console.log('Starting Bengals OTC cap scrape...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  await page.goto('https://overthecap.com/roster/cincinnati-bengals', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(4000);

  const data = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      return cells;
    }).filter(r => r.length > 3);
  });

  // Grab cap summary from page text
  const pageText = await page.evaluate(() => document.body.innerText);
  await browser.close();

  console.log(`Got ${data.length} Bengals roster rows`);

  // Parse cap space from page text
  const capMatch = pageText.match(/Cap Space\s*[\n\r]+\s*([\$\-\(][\d,]+)/i);
  const capSpace = capMatch ? parseFloat(capMatch[1].replace(/[\$,]/g, '')) / 1000000 : null;

  if (capSpace !== null) {
    console.log(`Bengals cap space: $${capSpace.toFixed(1)}M`);
  } else {
    console.log('Could not parse Bengals cap space from page — skipping GameContext update');
  }

  return { rows: data, capSpace };
}

async function updateGameContext(capSpace) {
  if (capSpace === null) return;

  let ctx;
  try {
    ctx = readFileSync('src/context/GameContext.jsx', 'utf8');
  } catch (e) {
    console.log('GameContext.jsx not found — skipping');
    return;
  }

  const updated = ctx.replace(
    /const bengalsCapSpace = [\d.]+;/,
    `const bengalsCapSpace = ${Math.round(capSpace * 100) / 100};`
  );

  if (updated === ctx) {
    console.log('bengalsCapSpace constant not found in GameContext.jsx — no update needed');
    return;
  }

  writeFileSync('src/context/GameContext.jsx', updated);
  console.log('Updated bengalsCapSpace in GameContext.jsx');
}

const result = await scrapeBengalsOTC();
await updateGameContext(result.capSpace);
console.log('Bengals refresh complete!');
