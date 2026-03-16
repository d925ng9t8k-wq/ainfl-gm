import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, 'fa-2026-raw.json');

const results = {};

async function scrapePage(browser, name, url) {
  const page = await browser.newPage();
  const xhrResponses = [];

  // Intercept XHR/fetch responses
  page.on('response', async (response) => {
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') && response.url() !== url) {
      try {
        const body = await response.text();
        xhrResponses.push({ url: response.url(), body: body.substring(0, 5000) });
      } catch (e) {}
    }
  });

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SCRAPING: ${name}`);
    console.log(`URL: ${url}`);
    console.log('='.repeat(80));

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(8000);

    // Get full body text
    const text = await page.evaluate(() => document.body.innerText);

    // Get links
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).map(a => a.textContent.trim() + ' | ' + a.href).join('\n')
    );

    // Try to get embedded JS data
    let jsData = '{}';
    try {
      jsData = await page.evaluate(() =>
        JSON.stringify(window.__NEXT_DATA__ || window.__nuxt || window.__INITIAL_STATE__ || {})
      );
    } catch (e) {}

    // Get truncated HTML
    const html = await page.content();

    const result = {
      url,
      text: text.substring(0, 15000),
      links: links.substring(0, 10000),
      jsData: jsData.substring(0, 10000),
      htmlSnippet: html.substring(0, 5000),
      xhrResponses: xhrResponses.slice(0, 10),
      textLength: text.length,
    };

    // Print first 5000 chars of text
    console.log(`\n--- TEXT CONTENT (first 5000 chars) ---`);
    console.log(text.substring(0, 5000));
    console.log(`\n--- END TEXT (total ${text.length} chars) ---`);

    if (xhrResponses.length > 0) {
      console.log(`\n--- XHR RESPONSES (${xhrResponses.length} captured) ---`);
      for (const xhr of xhrResponses.slice(0, 3)) {
        console.log(`URL: ${xhr.url}`);
        console.log(xhr.body.substring(0, 1000));
      }
    }

    return result;
  } catch (err) {
    console.log(`ERROR scraping ${name}: ${err.message}`);
    return { url, error: err.message };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const sites = [
    ['OTC Free Agents', 'https://overthecap.com/free-agents'],
    ['Spotrac Free Agents', 'https://www.spotrac.com/nfl/free-agents/2026/'],
    ['Spotrac Free Agents Alt', 'https://www.spotrac.com/nfl/free-agents/'],
    ['ESPN FA Tracker', 'https://www.espn.com/nfl/story/_/id/43587432/nfl-free-agency-2026-signings-tracker-grades-analysis'],
    ['NFL Transactions', 'https://www.nfl.com/transactions/'],
    ['OTC Bengals Cap', 'https://overthecap.com/salary-cap/cincinnati-bengals'],
  ];

  for (const [name, url] of sites) {
    results[name] = await scrapePage(browser, name, url);
  }

  await browser.close();

  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n\nResults saved to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
