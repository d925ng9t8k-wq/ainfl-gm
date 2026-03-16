/**
 * BengalOracle GM — Live Data Scraper (scrape-live.mjs)
 * Scrapes: OTC Bengals roster, OTC all-team cap space, 2026 draft prospects
 * Run: node ~/Projects/BengalOracle/scripts/scrape-live.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function makePage(browser) {
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 900 },
  });
  return ctx.newPage();
}

// ─── 1. OTC Bengals Roster ────────────────────────────────────────────────────
async function scrapeOTCRoster(browser) {
  console.log('\n=== [A] OTC Bengals Roster ===');
  const page = await makePage(browser);
  try {
    await page.goto('https://overthecap.com/roster/cincinnati-bengals', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(5000);

    let tableFound = false;
    try {
      await page.waitForSelector('table', { timeout: 15000 });
      tableFound = true;
    } catch { /* no table */ }

    console.log(`  Table found: ${tableFound}`);

    const info = await page.evaluate(() => {
      const title = document.title;
      const tables = document.querySelectorAll('table');
      let headers = [];
      let rows = [];

      if (tables.length > 0) {
        // Find biggest table
        let bestTable = tables[0];
        let maxR = 0;
        tables.forEach(t => {
          const c = t.querySelectorAll('tr').length;
          if (c > maxR) { maxR = c; bestTable = t; }
        });

        headers = Array.from(bestTable.querySelectorAll('thead th, thead td'))
          .map(h => h.innerText.trim());

        rows = Array.from(bestTable.querySelectorAll('tbody tr'))
          .map(row => Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim()))
          .filter(r => r.length >= 3);
      }

      const bodyText = document.body.innerText;
      return { title, tableCount: tables.length, headers, rows, bodyText };
    });

    console.log(`  Title: ${info.title}`);
    console.log(`  Tables: ${info.tableCount}, Rows: ${info.rows.length}`);
    if (info.headers.length) console.log(`  Headers: ${JSON.stringify(info.headers)}`);
    if (info.rows.length > 0) console.log(`  Sample row: ${JSON.stringify(info.rows[0])}`);
    if (info.rows.length === 0) {
      console.log(`  Body text (first 800):\n${info.bodyText.substring(0, 800)}`);
    }

    return {
      success: info.rows.length > 0,
      headers: info.headers,
      rows: info.rows,
      bodyText: info.bodyText,
    };
  } finally {
    await page.context().close();
  }
}

// ─── 2. OTC All Teams Cap Space ───────────────────────────────────────────────
async function scrapeOTCCapSpace(browser) {
  console.log('\n=== [B] OTC Salary Cap / All Teams ===');
  const page = await makePage(browser);
  try {
    await page.goto('https://overthecap.com/salary-cap', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(5000);

    let tableFound = false;
    try {
      await page.waitForSelector('table', { timeout: 15000 });
      tableFound = true;
    } catch { /* no table */ }

    console.log(`  Table found: ${tableFound}`);

    const info = await page.evaluate(() => {
      const title = document.title;
      const tables = document.querySelectorAll('table');
      let headers = [];
      let rows = [];

      if (tables.length > 0) {
        let bestTable = tables[0];
        let maxR = 0;
        tables.forEach(t => {
          const c = t.querySelectorAll('tr').length;
          if (c > maxR) { maxR = c; bestTable = t; }
        });

        headers = Array.from(bestTable.querySelectorAll('thead th, thead td'))
          .map(h => h.innerText.trim());

        rows = Array.from(bestTable.querySelectorAll('tbody tr'))
          .map(row => Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim()))
          .filter(r => r.length >= 2);
      }

      const bodyText = document.body.innerText;
      return { title, tableCount: tables.length, headers, rows, bodyText };
    });

    console.log(`  Title: ${info.title}`);
    console.log(`  Tables: ${info.tableCount}, Rows: ${info.rows.length}`);
    if (info.headers.length) console.log(`  Headers: ${JSON.stringify(info.headers)}`);
    if (info.rows.length > 0) {
      console.log(`  Sample rows:`);
      info.rows.slice(0, 3).forEach(r => console.log(`    ${JSON.stringify(r)}`));
    }
    if (info.rows.length === 0) {
      console.log(`  Body text (first 800):\n${info.bodyText.substring(0, 800)}`);
    }

    return {
      success: info.rows.length > 0,
      headers: info.headers,
      rows: info.rows,
      bodyText: info.bodyText,
    };
  } finally {
    await page.context().close();
  }
}

// ─── 3. Draft Big Board ──────────────────────────────────────────────────────
async function scrapeDraftBoard(browser) {
  const sources = [
    { url: 'https://www.nflmockdraftdatabase.com/big-boards/2026/community-big-board', name: 'NFLMockDraftDB' },
    { url: 'https://www.tankathon.com/big_board', name: 'Tankathon' },
    { url: 'https://www.draftnetwork.com/2026-nfl-draft-big-board-prospect-rankings', name: 'DraftNetwork' },
    { url: 'https://www.pff.com/draft/big-board', name: 'PFF' },
  ];

  for (const src of sources) {
    console.log(`\n=== [C] Draft Board: ${src.name} ===`);
    const page = await makePage(browser);
    try {
      await page.goto(src.url, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await page.waitForTimeout(5000);

      let tableFound = false;
      try {
        await page.waitForSelector('table', { timeout: 10000 });
        tableFound = true;
      } catch { /* no table */ }

      const info = await page.evaluate(() => {
        const title = document.title;
        const tables = document.querySelectorAll('table');
        let headers = [];
        let rows = [];

        if (tables.length > 0) {
          let bestTable = tables[0];
          let maxR = 0;
          tables.forEach(t => {
            const c = t.querySelectorAll('tr').length;
            if (c > maxR) { maxR = c; bestTable = t; }
          });

          headers = Array.from(bestTable.querySelectorAll('thead th, thead td'))
            .map(h => h.innerText.trim());

          rows = Array.from(bestTable.querySelectorAll('tbody tr'))
            .map(row => Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim()))
            .filter(r => r.length >= 2);
        }

        // Also try div-based layouts
        const divProspects = [];
        const selectors = [
          '.player-card', '.prospect', '.big-board-row', '.player-row',
          '[class*="prospect"]', '[class*="player-card"]', '[class*="ranking"]',
          'li[class*="rank"]', '.board-player',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 5) {
            for (const el of els) {
              divProspects.push(el.innerText.trim().substring(0, 200));
            }
            break;
          }
        }

        const bodyText = document.body.innerText;
        return { title, tableCount: tables.length, headers, rows, divProspects, bodyText };
      });

      console.log(`  Title: ${info.title}`);
      console.log(`  Tables: ${info.tableCount}, Table rows: ${info.rows.length}, Div prospects: ${info.divProspects.length}`);

      if (info.rows.length > 5) {
        console.log(`  Headers: ${JSON.stringify(info.headers)}`);
        info.rows.slice(0, 3).forEach(r => console.log(`    ${JSON.stringify(r)}`));
        return { success: true, source: src.name, headers: info.headers, rows: info.rows };
      }

      if (info.divProspects.length > 5) {
        console.log(`  Div prospect samples:`);
        info.divProspects.slice(0, 3).forEach(p => console.log(`    ${p}`));
        return { success: true, source: src.name, divProspects: info.divProspects, rows: [] };
      }

      // Try text parsing
      const textLines = info.bodyText.split('\n').map(l => l.trim()).filter(Boolean);
      const prospectLines = textLines.filter(l => {
        return /^\d+[\.\)]\s/.test(l) ||
          (/\b(QB|RB|WR|TE|OT|OG|C|DE|DT|LB|CB|S|EDGE|IOL|IDL)\b/.test(l) && l.length > 10 && l.length < 200);
      });

      console.log(`  Text lines: ${textLines.length}, Prospect-like lines: ${prospectLines.length}`);
      if (prospectLines.length > 5) {
        prospectLines.slice(0, 5).forEach(l => console.log(`    ${l}`));
        return { success: true, source: src.name, textProspects: prospectLines, rows: [] };
      }

      // Print some body text for debugging
      console.log(`  Body text (first 600):\n${info.bodyText.substring(0, 600)}`);

    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    } finally {
      await page.context().close();
    }
  }

  return { success: false, source: 'none', rows: [] };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BengalOracle GM Live Scraper ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = {};

  try {
    results.roster = await scrapeOTCRoster(browser).catch(e => ({ success: false, error: e.message }));
    results.capSpace = await scrapeOTCCapSpace(browser).catch(e => ({ success: false, error: e.message }));
    results.draftBoard = await scrapeDraftBoard(browser).catch(e => ({ success: false, error: e.message }));
  } finally {
    await browser.close();
  }

  // Save (strip huge bodyText for JSON file but keep rows)
  const saveResults = JSON.parse(JSON.stringify(results));
  if (saveResults.roster?.bodyText?.length > 5000)
    saveResults.roster.bodyText = saveResults.roster.bodyText.substring(0, 5000) + '...(truncated)';
  if (saveResults.capSpace?.bodyText?.length > 5000)
    saveResults.capSpace.bodyText = saveResults.capSpace.bodyText.substring(0, 5000) + '...(truncated)';
  if (saveResults.draftBoard?.bodyText?.length > 5000)
    saveResults.draftBoard.bodyText = saveResults.draftBoard.bodyText.substring(0, 5000) + '...(truncated)';

  const outFile = join(__dirname, 'live-data.json');
  writeFileSync(outFile, JSON.stringify(saveResults, null, 2));
  console.log(`\nResults saved to ${outFile}`);

  console.log('\n=== SUMMARY ===');
  console.log(`Roster:  ${results.roster?.success ? 'OK' : 'FAIL'} — ${results.roster?.rows?.length ?? 0} rows`);
  console.log(`Cap:     ${results.capSpace?.success ? 'OK' : 'FAIL'} — ${results.capSpace?.rows?.length ?? 0} rows`);
  console.log(`Draft:   ${results.draftBoard?.success ? 'OK' : 'FAIL'} — source: ${results.draftBoard?.source ?? 'none'}`);
}

main().catch(console.error);
