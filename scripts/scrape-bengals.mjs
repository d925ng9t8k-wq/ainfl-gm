/**
 * BengalOracle GM — Live Data Scraper
 * Uses Playwright headless Chromium to pull from OTC, Spotrac, ESPN, Wikipedia
 * Run: node scripts/scrape-bengals.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../src/data');

// Stealth-ish headers to avoid bot detection
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function withPage(browser, fn) {
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

// ─── 1. Over The Cap — Bengals cap table ─────────────────────────────────────
async function scrapeOTC(browser) {
  console.log('\n[OTC] Scraping overthecap.com/roster/cincinnati-bengals...');
  return withPage(browser, async (page) => {
    await page.goto('https://overthecap.com/roster/cincinnati-bengals', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        return cells;
      }).filter(r => r.length > 3);
    });

    console.log(`[OTC] Got ${data.length} rows`);
    return data;
  });
}

// ─── 2. Spotrac — Bengals cap page ───────────────────────────────────────────
async function scrapeSpotrac(browser) {
  console.log('\n[Spotrac] Scraping spotrac.com cap table...');
  return withPage(browser, async (page) => {
    await page.goto('https://www.spotrac.com/nfl/cincinnati-bengals/cap/', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr, .team-table tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th')).map(td => td.innerText.trim());
        return cells;
      }).filter(r => r.length > 2 && r[0]);
    });

    const capInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/Cap Space[:\s]*([\$\d,\.]+)/i);
      return match ? match[0] : 'not found';
    });

    console.log(`[Spotrac] Got ${data.length} rows. Cap info: ${capInfo}`);
    return { rows: data, capInfo };
  });
}

// ─── 3. ESPN — Bengals roster ─────────────────────────────────────────────────
async function scrapeESPN(browser) {
  console.log('\n[ESPN] Scraping espn.com Bengals roster...');
  return withPage(browser, async (page) => {
    await page.goto('https://www.espn.com/nfl/team/roster/_/name/cin/cincinnati-bengals', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);

    const players = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table.Table tbody tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        return cells;
      }).filter(r => r.length >= 4);
    });

    console.log(`[ESPN] Got ${players.length} players`);
    return players;
  });
}

// ─── 4. Wikipedia — 2025 NFL Draft (Bengals picks) ───────────────────────────
async function scrapeWikiDraft(browser) {
  console.log('\n[Wiki] Scraping 2025 NFL Draft results for CIN picks...');
  return withPage(browser, async (page) => {
    await page.goto('https://en.wikipedia.org/wiki/2025_NFL_draft', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);

    const picks = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table.wikitable'));
      const cinPicks = [];
      tables.forEach(table => {
        const rows = Array.from(table.querySelectorAll('tr'));
        rows.forEach(row => {
          const text = row.innerText;
          if (text.includes('Cincinnati') || text.includes('CIN')) {
            const cells = Array.from(row.querySelectorAll('td, th')).map(c => c.innerText.trim());
            if (cells.length > 2) cinPicks.push(cells);
          }
        });
      });
      return cinPicks;
    });

    console.log(`[Wiki] Found ${picks.length} CIN draft picks`);
    return picks;
  });
}

// ─── 5. Pro Football Reference — Bengals roster + contracts ──────────────────
async function scrapePFR(browser) {
  console.log('\n[PFR] Scraping pro-football-reference.com...');
  return withPage(browser, async (page) => {
    await page.goto('https://www.pro-football-reference.com/teams/cin/2025_roster.htm', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#roster tbody tr:not(.thead)'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th')).map(td => td.innerText.trim());
        return cells;
      }).filter(r => r.length > 3 && !r[0].startsWith('Rk'));
    });

    console.log(`[PFR] Got ${data.length} roster rows`);
    return data;
  });
}

// ─── 6. Spotrac — 2025 Free Agent Signings ───────────────────────────────────
async function scrapeFASignings(browser) {
  console.log('\n[Spotrac FA] Scraping 2025 FA signings...');
  return withPage(browser, async (page) => {
    await page.goto('https://www.spotrac.com/nfl/free-agents/signed/2025/', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr, .team-table tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th')).map(td => td.innerText.trim());
        return cells;
      }).filter(r => r.length > 3);
    });

    console.log(`[Spotrac FA] Got ${data.length} FA signings rows`);
    return data;
  });
}

// ─── 7. OTC — Bengals free agent tracker ─────────────────────────────────────
async function scrapeOTCFreeAgents(browser) {
  console.log('\n[OTC FA] Scraping OTC free agents...');
  return withPage(browser, async (page) => {
    await page.goto('https://overthecap.com/free-agents?team=Cincinnati+Bengals', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        return cells;
      }).filter(r => r.length > 2);
    });

    console.log(`[OTC FA] Got ${data.length} free agent rows`);
    return data;
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BengalOracle GM Live Data Scraper ===');
  const browser = await chromium.launch({ headless: true });

  const results = {};

  try {
    // Run scrapes in parallel where possible
    const [otcData, espnData, wikiDraft, pfrData] = await Promise.allSettled([
      scrapeOTC(browser),
      scrapeESPN(browser),
      scrapeWikiDraft(browser),
      scrapePFR(browser),
    ]);

    results.otc      = otcData.status === 'fulfilled'      ? otcData.value      : { error: otcData.reason?.message };
    results.espn     = espnData.status === 'fulfilled'     ? espnData.value     : { error: espnData.reason?.message };
    results.wikiDraft= wikiDraft.status === 'fulfilled'    ? wikiDraft.value    : { error: wikiDraft.reason?.message };
    results.pfr      = pfrData.status === 'fulfilled'      ? pfrData.value      : { error: pfrData.reason?.message };

    // Sequential scrapes (Spotrac can be picky)
    try { results.spotrac = await scrapeSpotrac(browser); } catch(e) { results.spotrac = { error: e.message }; }
    try { results.faSignings = await scrapeFASignings(browser); } catch(e) { results.faSignings = { error: e.message }; }
    try { results.otcFA = await scrapeOTCFreeAgents(browser); } catch(e) { results.otcFA = { error: e.message }; }

  } finally {
    await browser.close();
  }

  // Write raw results to JSON for inspection
  const outFile = join(__dirname, 'scraped-raw.json');
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n✅ Raw data written to scripts/scraped-raw.json`);

  // Print summary
  console.log('\n=== SCRAPE SUMMARY ===');
  for (const [src, val] of Object.entries(results)) {
    if (val?.error) {
      console.log(`❌ ${src}: ${val.error}`);
    } else if (Array.isArray(val)) {
      console.log(`✅ ${src}: ${val.length} rows`);
    } else if (val?.rows) {
      console.log(`✅ ${src}: ${val.rows.length} rows`);
    } else {
      console.log(`✅ ${src}: data retrieved`);
    }
  }

  return results;
}

main().catch(console.error);
