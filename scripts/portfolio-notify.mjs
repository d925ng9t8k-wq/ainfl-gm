#!/usr/bin/env node
/**
 * Portfolio & Market Hourly Notification
 * Fetches live prices, calculates portfolio value, sends via Telegram
 *
 * Baseline: March 30, 2026 portfolio snapshot
 */

import { readFileSync } from 'fs';

const HUB = 'http://localhost:3457';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

function log(msg) { console.log(`[portfolio ${new Date().toISOString()}] ${msg}`); }

// ── Baseline portfolio from March 30, 2026 ──────────────────────────
// Chase Brokerage positions (ticker → { qty, baseValue, baseCost })
const CHASE_POSITIONS = {
  IBIT:  { qty: 3895,   baseValue: 146763.60 },
  TSLA:  { qty: null,   baseValue: 128966.64, basePrice: null },  // qty unknown, track by %
  IAU:   { qty: 703,    baseValue: 59705.79 },
  SLV:   { qty: 900,    baseValue: 57168.00 },
  CPER:  { qty: 1607,   baseValue: 53979.13 },
  NVDA:  { qty: 138,    baseValue: 22793.46 },
  ORCL:  { qty: 125,    baseValue: 17350.00 },
  INTC:  { qty: 420,    baseValue: 17299.80 },
  PLTR:  { qty: 77,     baseValue: 10591.35 },
  MSFT:  { qty: 24.05,  baseValue: 8634.40 },
  TSM:   { qty: 24,     baseValue: 7596.00 },
  AAPL:  { qty: 24,     baseValue: 5919.12 },
  META:  { qty: 10,     baseValue: 5363.63 },
  AVGO:  { qty: null,   baseValue: 4401.15 },
  GOOGL: { qty: null,   baseValue: 4195.33 },
  MP:    { qty: 90,     baseValue: 4103.10 },
  HIMS:  { qty: 195,    baseValue: 3662.10 },
  AMZN:  { qty: 11,     baseValue: 2210.45 },
  BE:    { qty: 30,     baseValue: 3585.30 },
  USAR:  { qty: 54,     baseValue: 768.42 },
};
const CHASE_CASH = 57.45;
const CHASE_JPMPD = 100000.00; // Premium Deposit (fixed)
const CHASE_BASELINE = 665029.22;

// Fidelity positions
const FIDELITY_POSITIONS = {
  AMZN: { qty: 36, baseValue: 7234.20 },
  GOOG: { qty: 24.017, baseValue: 6560.00 },
  AAPL: { qty: 21, baseValue: 5179.23 },
  META: { qty: 9.008, baseValue: 4831.71 },
};
const FIDELITY_BASELINE = 23805.14;

// 401k
const K401_BASELINE = 259293.66;
const K401_SHARES = 9317.055742;
const K401_TICKER = null; // No public ticker for Fidelity Freedom Index 2040

// Crypto
const CRYPTO_BASELINE = 32813.64;

// Market indexes to track
const INDEXES = ['^GSPC', '^IXIC', 'BTC-USD'];

// Compute base prices from qty + value for positions that have qty
for (const positions of [CHASE_POSITIONS, FIDELITY_POSITIONS]) {
  for (const [ticker, pos] of Object.entries(positions)) {
    if (pos.qty && !pos.basePrice) {
      pos.basePrice = pos.baseValue / pos.qty;
    }
  }
}

// ── Yahoo Finance fetch ─────────────────────────────────────────────
async function fetchPrice(ticker) {
  try {
    const encoded = encodeURIComponent(ticker);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=1d`,
      { headers: { 'User-Agent': UA } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      price: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose,
      dayChangePct: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100),
    };
  } catch (e) {
    log(`Fetch failed for ${ticker}: ${e.message}`);
    return null;
  }
}

async function fetchAllPrices(tickers) {
  const results = {};
  // Batch in groups of 8 to avoid rate limits
  const batches = [];
  for (let i = 0; i < tickers.length; i += 8) {
    batches.push(tickers.slice(i, i + 8));
  }
  for (const batch of batches) {
    const promises = batch.map(async t => {
      results[t] = await fetchPrice(t);
    });
    await Promise.all(promises);
    if (batches.indexOf(batch) < batches.length - 1) {
      await new Promise(r => setTimeout(r, 500)); // small delay between batches
    }
  }
  return results;
}

// ── Trader 9 status ─────────────────────────────────────────────────
function getTrader9Status() {
  try {
    const data = readFileSync('/tmp/trader9-status.txt', 'utf8');
    const lines = data.split('\n');
    const cycles = lines.find(l => l.includes('Cycles:'))?.split(':')[1]?.trim() || '?';
    const pnl = lines.find(l => l.includes('P&L:'))?.match(/\$[\-\d,.]+/)?.[0] || '?';
    const pct = lines.find(l => l.includes('P&L:'))?.match(/\([\-\d.]+%\)/)?.[0] || '';
    return `Cycle ${cycles} | ${pnl} (${pct})`;
  } catch { return null; }
}

// ── Format helpers ──────────────────────────────────────────────────
function fmtK(n) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtDelta(n) {
  const sign = n >= 0 ? '+' : '';
  if (Math.abs(n) >= 1000) return `${sign}$${(n / 1000).toFixed(1)}K`;
  return `${sign}$${n.toFixed(0)}`;
}
function fmtPct(n) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}
function fmtBTC(n) {
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ── Main notification ───────────────────────────────────────────────
async function sendNotification() {
  log('Fetching prices...');

  // Collect all tickers we need
  const allTickers = [
    ...new Set([
      ...Object.keys(CHASE_POSITIONS),
      ...Object.keys(FIDELITY_POSITIONS),
      ...INDEXES,
    ])
  ];

  const prices = await fetchAllPrices(allTickers);

  // ── Market indexes ──
  const sp = prices['^GSPC'];
  const nq = prices['^IXIC'];
  const btc = prices['BTC-USD'];

  const marketLine = [
    sp ? `S&P ${fmtPct(sp.dayChangePct)}` : 'S&P ?',
    nq ? `NASDAQ ${fmtPct(nq.dayChangePct)}` : 'NASDAQ ?',
    btc ? `BTC ${fmtBTC(btc.price)}` : 'BTC ?',
  ].join(' | ');

  // ── Chase Brokerage value ──
  let chaseTotal = CHASE_CASH + CHASE_JPMPD;
  const movers = []; // { ticker, dayPct }

  for (const [ticker, pos] of Object.entries(CHASE_POSITIONS)) {
    const p = prices[ticker];
    if (!p) {
      chaseTotal += pos.baseValue; // fallback to baseline
      continue;
    }
    let currentValue;
    if (pos.qty) {
      currentValue = pos.qty * p.price;
    } else {
      // No qty — estimate from % change since baseline
      const changeSinceBase = (p.price - (pos.basePrice || p.prevClose)) / (pos.basePrice || p.prevClose);
      currentValue = pos.baseValue * (1 + changeSinceBase);
      // Fallback: if we don't have basePrice, just use baseValue
      if (!pos.basePrice) currentValue = pos.baseValue;
    }
    chaseTotal += currentValue;
    movers.push({ ticker, dayPct: p.dayChangePct });
  }

  const chaseDelta = chaseTotal - CHASE_BASELINE;

  // ── Fidelity value ──
  let fidelityTotal = 0;
  for (const [ticker, pos] of Object.entries(FIDELITY_POSITIONS)) {
    const p = prices[ticker];
    if (!p || !pos.qty) {
      fidelityTotal += pos.baseValue;
      continue;
    }
    fidelityTotal += pos.qty * p.price;
  }
  const fidelityDelta = fidelityTotal - FIDELITY_BASELINE;

  // ── Top movers (by absolute day change %) ──
  movers.sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct));
  const topMovers = movers.slice(0, 3)
    .map(m => `${m.ticker} ${fmtPct(m.dayPct)}`)
    .join(', ');

  // ── Estimated total ──
  const estTotal = K401_BASELINE + chaseTotal + CRYPTO_BASELINE + fidelityTotal + 333;

  // ── Time ──
  const time = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // ── Build message ──
  let msg = `Portfolio Snapshot \u2014 ${time} ET\n\n`;
  msg += `Market: ${marketLine}\n\n`;
  msg += `Chase Brokerage: ~${fmtK(chaseTotal)} (${fmtDelta(chaseDelta)} vs baseline)\n`;
  msg += `Top movers: ${topMovers}\n`;
  msg += `Fidelity: ~${fmtK(fidelityTotal)} (${fmtDelta(fidelityDelta)})\n`;
  msg += `401k + Crypto: ~${fmtK(K401_BASELINE + CRYPTO_BASELINE)} (baseline)\n`;
  msg += `Est. Total: ~${fmtK(estTotal)}\n`;

  const t9 = getTrader9Status();
  if (t9) {
    msg += `\nTrader 9 (paper): ${t9}\n`;
  }

  msg += `\nNext update in 1 hour.`;

  try {
    await fetch(`${HUB}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message: msg }),
    });
    log('Notification sent');
  } catch (e) {
    log(`Send failed: ${e.message}`);
  }
}

// ── Run ─────────────────────────────────────────────────────────────
await sendNotification();
setInterval(sendNotification, 60 * 60 * 1000);
log('Portfolio notifications running (hourly)');
