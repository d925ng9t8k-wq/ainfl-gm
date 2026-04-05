#!/usr/bin/env node
/**
 * Trader9 — Multi-Asset Trading Bot for Alpaca Markets
 *
 * Asset Universe:
 *   Stocks:  AAPL, MSFT, NVDA, TSLA, AMZN, META, GOOGL
 *   ETFs:    SPY, QQQ, IWM, DIA
 *   Crypto:  BTC/USD (24/7)
 *
 * Strategies (8/10 aggression):
 *   1. EMA Crossover (9/21) — momentum
 *   2. Bollinger Band Mean Reversion — 1.5 std dev (aggressive)
 *   3. Micro-Spike Momentum — price action proxy for news sentiment
 *   4. RSI — oversold/overbought + reversals
 *   5. MACD — crossover signals
 *   6. VWAP — price vs volume-weighted average
 *
 * Position: 20% of portfolio per trade (one position at a time)
 * Stop Loss: 3%
 * Cycle: 5 minutes
 * Market Hours: stocks/ETFs 9:30 AM–4:00 PM ET only, crypto 24/7
 */

import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Asset Universe ───────────────────────────────────────────────────────────
const STOCK_SYMBOLS  = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL'];
const ETF_SYMBOLS    = ['SPY', 'QQQ', 'IWM', 'DIA'];
const CRYPTO_SYMBOLS = ['BTC/USD'];
const ALL_SYMBOLS    = [...STOCK_SYMBOLS, ...ETF_SYMBOLS, ...CRYPTO_SYMBOLS];

function isCrypto(symbol) {
  return symbol.includes('/');
}

// ─── Config ───────────────────────────────────────────────────────────────────
const PROJECT_ROOT    = '/Users/jassonfishback/Projects/BengalOracle';
const ENV_PATH        = join(PROJECT_ROOT, '.env');
const LOG_PATH        = join(PROJECT_ROOT, 'logs/trader9.log');
const STATUS_PATH     = '/tmp/trader9-status.txt';
const HALT_PATH       = join(PROJECT_ROOT, 'data/trader9-halt-until.txt');

// Alpaca endpoints — stocks and crypto use different data hosts
const TRADE_BASE      = 'https://api.alpaca.markets';       // orders + account (both asset types)
const PAPER_BASE      = 'https://paper-api.alpaca.markets'; // paper orders
const STOCK_DATA_URL  = 'https://data.alpaca.markets';      // stock/ETF market data
const CRYPTO_DATA_URL = 'https://data.alpaca.markets';      // crypto market data (same host, different path)

const CYCLE_MS             = 5 * 60 * 1000; // 5 minutes
const POSITION_PCT         = 0.20;           // 20% of portfolio
const STOP_LOSS_PCT        = 0.03;           // 3%
const TAKE_PROFIT_PCT      = 0.015;          // 1.5%
const TRAIL_ACTIVATE_PCT   = 0.01;           // activate trailing stop at 1% gain
const TRAIL_DISTANCE_PCT   = 0.015;          // trail 1.5% below peak
const TIME_EXIT_CYCLES     = 6;              // 30 minutes (6 x 5min)
const TIME_EXIT_MIN_GAIN   = 0.005;          // 0.5% minimum gain to hold past time limit
const MIN_CONFIRMING_SIGNALS = 1;            // 8/10 aggression: single strong signal can trigger
const EMA_FAST             = 9;
const EMA_SLOW             = 21;
const BB_PERIOD            = 20;
const BB_STD               = 1.5;            // aggressive: 1.5 instead of 2
const SPIKE_THRESHOLD      = 0.008;          // 0.8% move in 5 bars = micro-spike
const BARS_NEEDED          = 25;             // ideal bars for strategies
const BARS_MIN             = 8;              // absolute minimum to attempt trading

// ─── Load API Keys ────────────────────────────────────────────────────────────
// (defined here so MAX_DAILY_LOSS_PCT can read env before the full env load below)
function loadEnvEarly() {
  try {
    const raw = readFileSync(ENV_PATH, 'utf-8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}
const _earlyEnv = loadEnvEarly();
const MAX_DAILY_LOSS_PCT = parseFloat(_earlyEnv.MAX_DAILY_LOSS_PCT ?? '3.0') / 100; // default 3%

// Market hours (Eastern Time) — stocks + ETFs only
const MARKET_OPEN_HOUR   = 9;
const MARKET_OPEN_MIN    = 30;
const MARKET_CLOSE_HOUR  = 16;
const MARKET_CLOSE_MIN   = 0;

// ─── Load API Keys ────────────────────────────────────────────────────────────
const env = loadEnvEarly(); // reuse the early-load function defined above
// FORT C-04: Live trading requires BOTH the live API keys AND an explicit opt-in flag.
// Presence of ALPACA_LIVE_API_KEY alone is NOT sufficient — this prevents accidental
// live trading when keys are rotated in or pasted into .env during dev/testing.
// To enable live trading: set ALPACA_LIVE_ENABLED=true in .env in addition to the keys.
const LIVE_KEY_PRESENT = !!env.ALPACA_LIVE_API_KEY;
const LIVE_FLAG_SET    = env.ALPACA_LIVE_ENABLED === 'true';
const USE_LIVE   = LIVE_KEY_PRESENT && LIVE_FLAG_SET;
if (LIVE_KEY_PRESENT && !LIVE_FLAG_SET) {
  console.log('[Trader9] FORT C-04: ALPACA_LIVE_API_KEY is present but ALPACA_LIVE_ENABLED is not "true" — forcing paper mode.');
}
const BASE_URL   = USE_LIVE ? TRADE_BASE : PAPER_BASE;
const API_KEY    = USE_LIVE ? env.ALPACA_LIVE_API_KEY    : env.ALPACA_API_KEY;
const SECRET_KEY = USE_LIVE ? env.ALPACA_LIVE_SECRET_KEY : env.ALPACA_SECRET_KEY;

if (!API_KEY || !SECRET_KEY) {
  console.error('Missing ALPACA_API_KEY or ALPACA_SECRET_KEY in .env');
  process.exit(1);
}

const headers = {
  'APCA-API-KEY-ID':     API_KEY,
  'APCA-API-SECRET-KEY': SECRET_KEY,
  'Content-Type':        'application/json',
};

// ─── State ────────────────────────────────────────────────────────────────────
let tradeLog     = [];
let cycleCount   = 0;
let startEquity  = null;
// activePosition: { symbol, side, qty, entryPrice, stopPrice, entryTime, cyclesHeld, peakPrice }
let activePosition = null;

// ─── Daily Drawdown Circuit Breaker ──────────────────────────────────────────
// Tracks realized P&L since midnight ET each trading day.
// If realized loss exceeds MAX_DAILY_LOSS_PCT * dayStartEquity, halt new trades.
let dayStartEquity    = null;   // equity captured at start of current trading day
let dayStartDate      = null;   // "YYYY-MM-DD" in ET — reset trigger
let realizedDayPnl    = 0;      // running realized P&L in dollars for today
let haltedUntilMidnight = false; // true once circuit breaker trips today

function etDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // "YYYY-MM-DD"
}

function etMidnightMs() {
  // Returns ms until midnight ET
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etNow = new Date(etStr);
  const nextMidnight = new Date(etNow);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight - etNow;
}

// Persist halt state so a process restart doesn't bypass the circuit breaker.
function persistHalt() {
  const tomorrow = new Date(Date.now() + etMidnightMs() + 1000).toISOString();
  try { writeFileSync(HALT_PATH, tomorrow); } catch (e) { log(`WARN: could not write halt file: ${e.message}`); }
}

function clearHalt() {
  try { writeFileSync(HALT_PATH, ''); } catch { /* ignore */ }
  haltedUntilMidnight = false;
}

function isHalted() {
  if (haltedUntilMidnight) return true;
  // Check persisted halt file (survives restarts)
  try {
    if (!existsSync(HALT_PATH)) return false;
    const raw = readFileSync(HALT_PATH, 'utf-8').trim();
    if (!raw) return false;
    const haltUntil = new Date(raw);
    if (isNaN(haltUntil.getTime())) return false;
    if (Date.now() < haltUntil.getTime()) {
      haltedUntilMidnight = true;
      return true;
    }
    // Past midnight — clear stale halt
    clearHalt();
    return false;
  } catch { return false; }
}

// Reset day tracking when ET date rolls over.
function checkDayReset(currentEquity) {
  const today = etDateString();
  if (dayStartDate !== today) {
    if (dayStartDate !== null) {
      log(`NEW TRADING DAY (ET): ${today}. Resetting day P&L. Previous day realized P&L: $${realizedDayPnl.toFixed(2)}`);
    }
    dayStartDate   = today;
    dayStartEquity = currentEquity;
    realizedDayPnl = 0;
    clearHalt();
    log(`Day start equity set: $${dayStartEquity.toFixed(2)} | Max daily loss: ${(MAX_DAILY_LOSS_PCT * 100).toFixed(1)}% = $${(dayStartEquity * MAX_DAILY_LOSS_PCT).toFixed(2)}`);
  }
}

// Call this whenever a trade closes with a realized P&L percentage (signed).
function recordRealizedPnl(pnlPct, entryPrice, qty) {
  const dollarPnl = pnlPct * entryPrice * qty;
  realizedDayPnl += dollarPnl;
  log(`REALIZED P&L: $${dollarPnl.toFixed(2)} | Day total: $${realizedDayPnl.toFixed(2)}`);
}

async function sendTelegramAlert(message) {
  try {
    const body = JSON.stringify({ channel: 'telegram', message });
    const req = await fetch('http://localhost:3457/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!req.ok) log(`WARN: Telegram alert HTTP ${req.status}`);
  } catch (e) {
    log(`WARN: Telegram alert failed: ${e.message}`);
  }
}

function checkDrawdownCircuitBreaker() {
  if (!dayStartEquity || isHalted()) return false;
  const maxLossDollar = dayStartEquity * MAX_DAILY_LOSS_PCT;
  if (realizedDayPnl <= -maxLossDollar) {
    const pctLost = (Math.abs(realizedDayPnl) / dayStartEquity * 100).toFixed(2);
    const msg = `TRADER9 DAILY DRAWDOWN TRIPPED: lost ${pctLost}% today ($${Math.abs(realizedDayPnl).toFixed(2)}), trading halted until midnight ET.`;
    log(`CIRCUIT BREAKER: ${msg}`);
    haltedUntilMidnight = true;
    persistHalt();
    sendTelegramAlert(msg).catch(() => {});
    return true;
  }
  return false;
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + '\n'); } catch { /* ignore */ }
}

function logTrade(action, details) {
  const entry = { time: new Date().toISOString(), action, ...details };
  tradeLog.push(entry);
  log(`TRADE: ${action} | ${JSON.stringify(details)}`);
}

// ─── Market Hours ─────────────────────────────────────────────────────────────
/**
 * Returns true if US equity markets are currently open (9:30–16:00 ET, Mon–Fri).
 * Does NOT account for holidays — Alpaca will reject orders if closed.
 */
function isMarketHours() {
  const now = new Date();
  // Convert to Eastern Time
  const etStr  = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etStr);
  const day    = etDate.getDay(); // 0=Sun, 6=Sat
  const hour   = etDate.getHours();
  const min    = etDate.getMinutes();

  if (day === 0 || day === 6) return false; // weekend

  const openMinutes  = MARKET_OPEN_HOUR  * 60 + MARKET_OPEN_MIN;
  const closeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN;
  const nowMinutes   = hour * 60 + min;

  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

/**
 * Returns the list of symbols eligible to trade right now.
 * Crypto is always eligible. Stocks/ETFs only during market hours.
 */
function eligibleSymbols() {
  const market = isMarketHours();
  if (market) {
    log(`Market is OPEN — scanning all ${ALL_SYMBOLS.length} symbols`);
    return ALL_SYMBOLS;
  }
  log(`Market is CLOSED — scanning crypto only`);
  return CRYPTO_SYMBOLS;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const res = await fetch(url, { headers, ...opts });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function getAccount() {
  return api(`${BASE_URL}/v2/account`);
}

async function getPosition(symbol) {
  try {
    // Alpaca stores positions by clean symbol: BTCUSD (no slash), AAPL
    const posSymbol = symbol.replace('/', '');
    return await api(`${BASE_URL}/v2/positions/${posSymbol}`);
  } catch (e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

// ─── Market Data — Bars ───────────────────────────────────────────────────────
async function getStockBars(symbol, limit = 200) {
  // Start far enough back to cover requested bars at 5Min timeframe
  const hoursBack = Math.ceil((limit * 5) / 60) + 48; // extra buffer for weekends/holidays
  const start = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  let allBars = [];
  let url = `${STOCK_DATA_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=${limit}&start=${start}&adjustment=raw&feed=iex`;

  while (url) {
    const data = await api(url);
    const pageBars = data.bars || [];
    allBars = allBars.concat(pageBars);
    if (data.next_page_token && allBars.length < limit * 3) {
      url = `${STOCK_DATA_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=${limit}&start=${start}&adjustment=raw&feed=iex&page_token=${data.next_page_token}`;
    } else {
      url = null;
    }
  }

  if (allBars.length > limit) allBars = allBars.slice(-limit);
  return allBars;
}

async function getCryptoBars(symbol, limit = 200) {
  const encoded   = encodeURIComponent(symbol);
  const hoursBack = Math.ceil((limit * 5) / 60) + 1;
  const start     = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  let allBars = [];
  let url = `${CRYPTO_DATA_URL}/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=5Min&limit=${limit}&start=${start}`;

  while (url) {
    const data    = await api(url);
    const pageBars = data.bars?.[symbol] || [];
    allBars = allBars.concat(pageBars);
    if (data.next_page_token && allBars.length < limit * 3) {
      url = `${CRYPTO_DATA_URL}/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=5Min&limit=${limit}&start=${start}&page_token=${data.next_page_token}`;
    } else {
      url = null;
    }
  }

  if (allBars.length > limit) allBars = allBars.slice(-limit);

  if (allBars.length >= BARS_MIN) return allBars;

  // Not enough 5Min bars — try 1Min and aggregate
  log(`${symbol}: only ${allBars.length} 5Min bars, trying 1Min aggregation...`);
  const minStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  let minUrl = `${CRYPTO_DATA_URL}/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=1Min&limit=${limit * 5}&start=${minStart}`;
  let minBars = [];

  while (minUrl) {
    const data    = await api(minUrl);
    const pageBars = data.bars?.[symbol] || [];
    minBars = minBars.concat(pageBars);
    if (data.next_page_token && minBars.length < limit * 10) {
      minUrl = `${CRYPTO_DATA_URL}/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=1Min&limit=${limit * 5}&start=${minStart}&page_token=${data.next_page_token}`;
    } else {
      minUrl = null;
    }
  }

  if (minBars.length > allBars.length) {
    const aggregated = [];
    for (let i = 0; i < minBars.length; i += 5) {
      const chunk = minBars.slice(i, i + 5);
      if (chunk.length < 3) break;
      aggregated.push({
        o: chunk[0].o,
        h: Math.max(...chunk.map(b => b.h)),
        l: Math.min(...chunk.map(b => b.l)),
        c: chunk[chunk.length - 1].c,
        v: chunk.reduce((s, b) => s + b.v, 0),
        t: chunk[0].t,
      });
    }
    log(`${symbol}: aggregated ${minBars.length} 1Min → ${aggregated.length} 5Min bars`);
    if (aggregated.length > allBars.length) return aggregated.slice(-limit);
  }

  return allBars;
}

async function getBars(symbol, limit = 200) {
  return isCrypto(symbol) ? getCryptoBars(symbol, limit) : getStockBars(symbol, limit);
}

// ─── Market Data — Latest Price ───────────────────────────────────────────────
async function getLatestPrice(symbol) {
  if (isCrypto(symbol)) {
    const encoded = encodeURIComponent(symbol);
    const url     = `${CRYPTO_DATA_URL}/v1beta3/crypto/us/latest/trades?symbols=${encoded}`;
    const data    = await api(url);
    return data.trades?.[symbol]?.p ?? null;
  } else {
    const url  = `${STOCK_DATA_URL}/v2/stocks/${symbol}/trades/latest?feed=iex`;
    const data = await api(url);
    return data.trade?.p ?? null;
  }
}

// ─── Order Submission ─────────────────────────────────────────────────────────
async function submitOrder(symbol, qty, side) {
  // Stocks: use integer shares, day TIF, plain symbol
  // Crypto: use fractional qty, gtc TIF, symbol without slash
  const isC = isCrypto(symbol);
  const body = {
    symbol:        isC ? symbol.replace('/', '') : symbol,
    qty:           isC ? String(qty) : String(Math.floor(qty)), // whole shares for stocks
    side,
    type:          'market',
    time_in_force: isC ? 'gtc' : 'day',
  };
  log(`ORDER: ${side} ${body.qty} ${symbol} (market, ${body.time_in_force})`);
  return api(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}

async function closePosition(symbol) {
  const posSymbol = symbol.replace('/', '');
  try {
    return await api(`${BASE_URL}/v2/positions/${posSymbol}`, { method: 'DELETE' });
  } catch (e) {
    log(`Close position failed for ${symbol}: ${e.message}`);
    return null;
  }
}

// ─── Technical Indicators ─────────────────────────────────────────────────────
function calcEMA(data, period) {
  const k   = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcBollingerBands(closes, period = BB_PERIOD, stdMult = BB_STD) {
  const bands = { upper: [], middle: [], lower: [] };
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      bands.upper.push(null);
      bands.middle.push(null);
      bands.lower.push(null);
      continue;
    }
    const slice    = closes.slice(i - period + 1, i + 1);
    const mean     = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std      = Math.sqrt(variance);
    bands.upper.push(mean + stdMult * std);
    bands.middle.push(mean);
    bands.lower.push(mean - stdMult * std);
  }
  return bands;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const rsi = new Array(period).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast   = calcEMA(closes, fast);
  const emaSlow   = calcEMA(closes, slow);
  const macdLine  = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calcEMA(macdLine, signal);
  const histogram  = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

function calcVWAP(bars) {
  let cumVolPrice = 0, cumVol = 0;
  return bars.map(b => {
    const tp     = (b.h + b.l + b.c) / 3;
    cumVolPrice += tp * (b.v || 0.0001);
    cumVol      += (b.v || 0.0001);
    return cumVolPrice / cumVol;
  });
}

// ─── Strategy Engine ──────────────────────────────────────────────────────────
function analyzeStrategies(closes, bars) {
  const signals = [];
  const len     = closes.length;
  if (len < BARS_MIN) return signals;

  // 1. EMA Crossover (9/21)
  const ema9    = calcEMA(closes, EMA_FAST);
  const ema21   = calcEMA(closes, EMA_SLOW);
  const prevFast = ema9[len - 2],  currFast = ema9[len - 1];
  const prevSlow = ema21[len - 2], currSlow = ema21[len - 1];

  if (prevFast <= prevSlow && currFast > currSlow) {
    signals.push({ strategy: 'EMA_CROSS', signal: 'BUY',  strength: 0.8, reason: `EMA9 crossed above EMA21 (${currFast.toFixed(2)} > ${currSlow.toFixed(2)})` });
  } else if (prevFast >= prevSlow && currFast < currSlow) {
    signals.push({ strategy: 'EMA_CROSS', signal: 'SELL', strength: 0.8, reason: `EMA9 crossed below EMA21 (${currFast.toFixed(2)} < ${currSlow.toFixed(2)})` });
  }

  // 2. Bollinger Band Mean Reversion
  const bb        = calcBollingerBands(closes);
  const lastClose = closes[len - 1];
  const bbUpper   = bb.upper[len - 1];
  const bbLower   = bb.lower[len - 1];

  if (bbLower !== null) {
    if (lastClose <= bbLower) {
      signals.push({ strategy: 'BB_REVERT', signal: 'BUY',  strength: 0.7, reason: `Price $${lastClose.toFixed(2)} hit lower BB $${bbLower.toFixed(2)}` });
    } else if (lastClose >= bbUpper) {
      signals.push({ strategy: 'BB_REVERT', signal: 'SELL', strength: 0.7, reason: `Price $${lastClose.toFixed(2)} hit upper BB $${bbUpper.toFixed(2)}` });
    }
  }

  // 3. Micro-Spike Momentum
  const recentCloses = closes.slice(-5);
  const pctChange    = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0];

  if (pctChange > SPIKE_THRESHOLD) {
    signals.push({ strategy: 'MICRO_SPIKE', signal: 'BUY',  strength: 0.6, reason: `+${(pctChange * 100).toFixed(2)}% spike in 5 bars` });
  } else if (pctChange < -SPIKE_THRESHOLD) {
    signals.push({ strategy: 'MICRO_SPIKE', signal: 'SELL', strength: 0.6, reason: `${(pctChange * 100).toFixed(2)}% drop in 5 bars` });
  }

  // 4. RSI
  const rsi     = calcRSI(closes, 14);
  const lastRSI = rsi[rsi.length - 1];
  const prevRSI = rsi[rsi.length - 2];
  if (lastRSI !== null && prevRSI !== null) {
    if (lastRSI < 35) {
      signals.push({ strategy: 'RSI', signal: 'BUY',  strength: lastRSI < 25 ? 0.9 : 0.7, reason: `RSI ${lastRSI.toFixed(1)} (oversold)` });
    } else if (lastRSI > 65) {
      signals.push({ strategy: 'RSI', signal: 'SELL', strength: lastRSI > 75 ? 0.9 : 0.7, reason: `RSI ${lastRSI.toFixed(1)} (overbought)` });
    }
    if (prevRSI < 30 && lastRSI > 30) {
      signals.push({ strategy: 'RSI_REVERSAL', signal: 'BUY',  strength: 0.85, reason: `RSI crossed above 30 (${prevRSI.toFixed(1)} → ${lastRSI.toFixed(1)})` });
    } else if (prevRSI > 70 && lastRSI < 70) {
      signals.push({ strategy: 'RSI_REVERSAL', signal: 'SELL', strength: 0.85, reason: `RSI crossed below 70 (${prevRSI.toFixed(1)} → ${lastRSI.toFixed(1)})` });
    }
  }

  // 5. MACD Crossover
  const macd    = calcMACD(closes);
  const macdLen = macd.macdLine.length;
  if (macdLen >= 2) {
    const currMACD   = macd.macdLine[macdLen - 1];
    const currSignal = macd.signalLine[macdLen - 1];
    const prevMACD   = macd.macdLine[macdLen - 2];
    const prevSignal = macd.signalLine[macdLen - 2];
    const currHist   = macd.histogram[macdLen - 1];

    if (prevMACD <= prevSignal && currMACD > currSignal) {
      signals.push({ strategy: 'MACD_CROSS', signal: 'BUY',  strength: 0.8, reason: `MACD crossed above signal (hist: ${currHist.toFixed(4)})` });
    } else if (prevMACD >= prevSignal && currMACD < currSignal) {
      signals.push({ strategy: 'MACD_CROSS', signal: 'SELL', strength: 0.8, reason: `MACD crossed below signal (hist: ${currHist.toFixed(4)})` });
    }
  }

  // 6. VWAP
  if (bars && bars.length > 10) {
    const vwap     = calcVWAP(bars);
    const lastVWAP = vwap[vwap.length - 1];
    const vwapDev  = (lastClose - lastVWAP) / lastVWAP;

    if (vwapDev < -0.005) {
      signals.push({ strategy: 'VWAP', signal: 'BUY',  strength: 0.65, reason: `Price ${(vwapDev * 100).toFixed(2)}% below VWAP ($${lastVWAP.toFixed(2)})` });
    } else if (vwapDev > 0.005) {
      signals.push({ strategy: 'VWAP', signal: 'SELL', strength: 0.65, reason: `Price ${(vwapDev * 100).toFixed(2)}% above VWAP ($${lastVWAP.toFixed(2)})` });
    }
  }

  return signals;
}

function resolveSignals(signals) {
  if (signals.length === 0) return null;

  let buyCount = 0, sellCount = 0;
  let buyScore = 0, sellScore = 0;
  for (const s of signals) {
    if (s.signal === 'BUY')  { buyCount++;  buyScore  += s.strength; }
    else if (s.signal === 'SELL') { sellCount++; sellScore += s.strength; }
  }

  if (buyCount  >= MIN_CONFIRMING_SIGNALS && buyScore  > sellScore) return 'BUY';
  if (sellCount >= MIN_CONFIRMING_SIGNALS && sellScore > buyScore)  return 'SELL';

  if (buyCount  < MIN_CONFIRMING_SIGNALS && buyCount  > 0) log(`BUY signal insufficient: ${buyCount}/${MIN_CONFIRMING_SIGNALS} needed`);
  if (sellCount < MIN_CONFIRMING_SIGNALS && sellCount > 0) log(`SELL signal insufficient: ${sellCount}/${MIN_CONFIRMING_SIGNALS} needed`);

  return null;
}

/**
 * Scores a symbol's signals to compare opportunity strength across assets.
 * Returns { decision, score, signals }.
 */
function scoreOpportunity(signals) {
  let buyScore = 0, sellScore = 0;
  let buyCount = 0, sellCount = 0;
  for (const s of signals) {
    if (s.signal === 'BUY')  { buyScore  += s.strength; buyCount++;  }
    else if (s.signal === 'SELL') { sellScore += s.strength; sellCount++; }
  }
  const decision = resolveSignals(signals);
  const score    = decision === 'BUY' ? buyScore : decision === 'SELL' ? sellScore : 0;
  return { decision, score, signals, buyCount, sellCount };
}

// ─── Symbol Scanner ───────────────────────────────────────────────────────────
/**
 * Scans all eligible symbols and returns the best opportunity:
 * { symbol, decision, score, signals, bars, closes, currentPrice }
 */
async function scanSymbols(symbols) {
  log(`Scanning ${symbols.length} symbols: ${symbols.join(', ')}`);
  const results = [];

  for (const symbol of symbols) {
    try {
      const bars = await getBars(symbol, BARS_NEEDED + 5);
      if (bars.length < BARS_MIN) {
        log(`${symbol}: only ${bars.length} bars (min ${BARS_MIN}), skipping`);
        continue;
      }

      const closes  = bars.map(b => b.c);
      let currentPrice = closes[closes.length - 1];

      // Cross-check with latest trade to catch stale bar data
      try {
        const latestPrice = await getLatestPrice(symbol);
        if (latestPrice && Math.abs(latestPrice - currentPrice) / currentPrice > 0.005) {
          log(`${symbol}: stale bar $${currentPrice.toFixed(2)} vs trade $${latestPrice.toFixed(2)} — using trade`);
          currentPrice = latestPrice;
          closes[closes.length - 1] = currentPrice;
        }
      } catch (e) {
        log(`${symbol}: latest price check failed — ${e.message}`);
      }

      const signals = analyzeStrategies(closes, bars);
      const opp     = scoreOpportunity(signals);

      log(`${symbol}: price=$${currentPrice.toFixed(2)} bars=${bars.length} decision=${opp.decision || 'HOLD'} score=${opp.score.toFixed(2)} (${signals.length} signals)`);
      for (const s of signals) {
        log(`  ${symbol} Signal: ${s.strategy} → ${s.signal} (${s.strength}) — ${s.reason}`);
      }

      results.push({ symbol, ...opp, bars, closes, currentPrice });
    } catch (e) {
      log(`${symbol}: scan error — ${e.message}`);
    }
  }

  // Pick the symbol with the highest actionable score
  const actionable = results.filter(r => r.decision !== null && r.score > 0);
  if (actionable.length === 0) return null;

  actionable.sort((a, b) => b.score - a.score);
  const best = actionable[0];
  log(`Best opportunity: ${best.symbol} (${best.decision}, score ${best.score.toFixed(2)})`);
  return best;
}

// ─── Position Management ─────────────────────────────────────────────────────
async function managePosition(currentPrice) {
  if (!activePosition) return false;

  activePosition.cyclesHeld = (activePosition.cyclesHeld || 0) + 1;

  const symbol  = activePosition.symbol;
  const entry   = activePosition.entryPrice;
  const isLong  = activePosition.side === 'long';
  const gainPct = isLong
    ? (currentPrice - entry) / entry
    : (entry - currentPrice) / entry;

  // Update peak price
  if (isLong) {
    activePosition.peakPrice = Math.max(activePosition.peakPrice || entry, currentPrice);
  } else {
    activePosition.peakPrice = Math.min(activePosition.peakPrice || entry, currentPrice);
  }

  log(`[${symbol}] Position mgmt — gain: ${(gainPct * 100).toFixed(3)}% | cycles: ${activePosition.cyclesHeld} | peak: $${activePosition.peakPrice.toFixed(2)} | stop: $${activePosition.stopPrice.toFixed(2)}`);

  // 1. TAKE PROFIT
  if (gainPct >= TAKE_PROFIT_PCT) {
    log(`[${symbol}] TAKE PROFIT: ${(gainPct * 100).toFixed(2)}% >= ${TAKE_PROFIT_PCT * 100}% target`);
    await closePosition(symbol);
    logTrade('TAKE_PROFIT', { symbol, side: isLong ? 'sell' : 'buy', price: currentPrice, entryPrice: entry, pnl: (gainPct * 100).toFixed(2) + '%', cyclesHeld: activePosition.cyclesHeld });
    recordRealizedPnl(gainPct, entry, activePosition.qty);
    checkDrawdownCircuitBreaker();
    activePosition = null;
    return true;
  }

  // 2. TRAILING STOP — once up 1%, trail at 1.5% below peak
  if (gainPct >= TRAIL_ACTIVATE_PCT) {
    let newStop;
    if (isLong) {
      newStop = Math.max(entry, activePosition.peakPrice * (1 - TRAIL_DISTANCE_PCT));
    } else {
      newStop = Math.min(entry, activePosition.peakPrice * (1 + TRAIL_DISTANCE_PCT));
    }

    if ((isLong && newStop > activePosition.stopPrice) || (!isLong && newStop < activePosition.stopPrice)) {
      log(`[${symbol}] TRAILING STOP: $${activePosition.stopPrice.toFixed(2)} → $${newStop.toFixed(2)}`);
      activePosition.stopPrice = newStop;
    }
  }

  // 3. STOP LOSS CHECK (includes trailing stop)
  if (isLong && currentPrice <= activePosition.stopPrice) {
    const action = activePosition.stopPrice >= entry ? 'TRAILING_STOP_CLOSE' : 'STOP_LOSS_CLOSE';
    log(`[${symbol}] ${action}: price $${currentPrice} <= stop $${activePosition.stopPrice.toFixed(2)}`);
    await closePosition(symbol);
    logTrade(action, { symbol, side: 'sell', price: currentPrice, entryPrice: entry, pnl: (gainPct * 100).toFixed(2) + '%', cyclesHeld: activePosition.cyclesHeld });
    recordRealizedPnl(gainPct, entry, activePosition.qty);
    checkDrawdownCircuitBreaker();
    activePosition = null;
    return true;
  }

  if (!isLong && currentPrice >= activePosition.stopPrice) {
    const action = activePosition.stopPrice <= entry ? 'TRAILING_STOP_CLOSE' : 'STOP_LOSS_CLOSE';
    log(`[${symbol}] ${action}: price $${currentPrice} >= stop $${activePosition.stopPrice.toFixed(2)}`);
    await closePosition(symbol);
    logTrade(action, { symbol, side: 'buy', price: currentPrice, entryPrice: entry, pnl: (gainPct * 100).toFixed(2) + '%', cyclesHeld: activePosition.cyclesHeld });
    recordRealizedPnl(gainPct, entry, activePosition.qty);
    checkDrawdownCircuitBreaker();
    activePosition = null;
    return true;
  }

  // 4. TIME-BASED EXIT — 30 minutes with < 0.5% gain
  if (activePosition.cyclesHeld >= TIME_EXIT_CYCLES && gainPct < TIME_EXIT_MIN_GAIN) {
    log(`[${symbol}] TIME EXIT: ${activePosition.cyclesHeld} cycles with ${(gainPct * 100).toFixed(2)}% gain (< ${TIME_EXIT_MIN_GAIN * 100}%)`);
    await closePosition(symbol);
    logTrade('TIME_EXIT', { symbol, side: isLong ? 'sell' : 'buy', price: currentPrice, entryPrice: entry, pnl: (gainPct * 100).toFixed(2) + '%', cyclesHeld: activePosition.cyclesHeld });
    recordRealizedPnl(gainPct, entry, activePosition.qty);
    checkDrawdownCircuitBreaker();
    activePosition = null;
    return true;
  }

  return false;
}

// ─── Status Writer ────────────────────────────────────────────────────────────
function writeStatus(equity, cash) {
  const now        = new Date().toISOString();
  const pnl        = startEquity ? ((equity - startEquity) / startEquity * 100).toFixed(4) : '0.0000';
  const pnlDollar  = startEquity ? (equity - startEquity).toFixed(2) : '0.00';
  const marketOpen = isMarketHours();

  const posLine = activePosition
    ? `${activePosition.side} ${activePosition.qty} ${activePosition.symbol} @ $${activePosition.entryPrice.toFixed(2)} | stop: $${activePosition.stopPrice.toFixed(2)} | cycles: ${activePosition.cyclesHeld || 0}/${TIME_EXIT_CYCLES} | peak: $${(activePosition.peakPrice || activePosition.entryPrice).toFixed(2)}`
    : 'None';

  const status = [
    `Trader9 Status — ${now}`,
    `${'─'.repeat(60)}`,
    `Mode:           ${USE_LIVE ? 'LIVE TRADING' : 'PAPER TRADING'}`,
    `Market:         ${marketOpen ? 'OPEN' : 'CLOSED'} (equities gated to 9:30–16:00 ET)`,
    `Cycles:         ${cycleCount}`,
    `Start Equity:   $${startEquity?.toFixed(2) || 'N/A'}`,
    `Current Equity: $${equity.toFixed(2)}`,
    `Cash:           $${cash.toFixed(2)}`,
    `P&L:            $${pnlDollar} (${pnl}%)`,
    `Day P&L:        $${realizedDayPnl.toFixed(2)} | Limit: -$${dayStartEquity ? (dayStartEquity * MAX_DAILY_LOSS_PCT).toFixed(2) : 'N/A'} | ${haltedUntilMidnight ? 'HALTED' : 'TRADING'}`,
    `Position:       ${posLine}`,
    `Trades:         ${tradeLog.length}`,
    `${'─'.repeat(60)}`,
    `Universe:       ${ALL_SYMBOLS.join(', ')}`,
    `Strategy:       EMA9/21 + BB(1.5σ) + RSI(14) + MACD(12/26/9) + VWAP + MicroSpike`,
    `Risk:           20% position | 3% stop | 1.5% TP | 1%→1.5% trail | 30min time exit`,
    `${'─'.repeat(60)}`,
    `Last 5 Trades:`,
    ...tradeLog.slice(-5).map(t => `  ${t.time} | ${t.action} | ${JSON.stringify(t)}`),
  ].join('\n');

  try { writeFileSync(STATUS_PATH, status + '\n'); } catch { /* ignore */ }
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────
async function cycle() {
  cycleCount++;
  log(`\n${'='.repeat(60)}`);
  log(`CYCLE ${cycleCount} START — ${new Date().toISOString()}`);

  try {
    // Account snapshot
    const account    = await getAccount();
    const equity     = parseFloat(account.equity);
    const cash       = parseFloat(account.cash);
    const buyingPower = parseFloat(account.buying_power);

    if (!startEquity) startEquity = equity;

    // ── Daily drawdown tracking — reset at ET midnight ──
    checkDayReset(equity);

    log(`Account — Equity: $${equity.toFixed(2)} | Cash: $${cash.toFixed(2)} | Buying Power: $${buyingPower.toFixed(2)}`);

    // Sync active position from Alpaca (handles state loss after restart)
    // Note: even when halted, we continue managing open positions (exits only).
    if (activePosition) {
      const pos = await getPosition(activePosition.symbol);
      if (!pos) {
        log(`[${activePosition.symbol}] Position closed externally. Clearing state.`);
        activePosition = null;
      } else {
        // Update current price and run position management
        const currentPrice = parseFloat(pos.current_price) || activePosition.entryPrice;
        const exited = await managePosition(currentPrice);
        if (exited) {
          writeStatus(equity, cash);
          return;
        }
        // Still holding — skip scanning for a new position this cycle
        log(`Holding ${activePosition.symbol}. Skipping symbol scan.`);
        writeStatus(equity, cash);
        return;
      }
    }

    // ── Circuit breaker gate — block new entries only ──
    if (isHalted()) {
      log(`CIRCUIT BREAKER ACTIVE — no new entries today. Day realized P&L: $${realizedDayPnl.toFixed(2)} | Limit: -$${(dayStartEquity * MAX_DAILY_LOSS_PCT).toFixed(2)}`);
      writeStatus(equity, cash);
      return;
    }

    // No active position — scan eligible symbols for best opportunity
    const symbols = eligibleSymbols();
    if (symbols.length === 0) {
      log('No eligible symbols (market closed, no crypto). Skipping.');
      writeStatus(equity, cash);
      return;
    }

    const best = await scanSymbols(symbols);

    if (!best) {
      log('No actionable signals this cycle. HOLD.');
      writeStatus(equity, cash);
      return;
    }

    const { symbol, decision, score, signals, currentPrice } = best;
    log(`Decision: ${decision} on ${symbol} (score: ${score.toFixed(2)})`);

    // Execute entry
    if (decision === 'BUY') {
      const allocAmount = equity * POSITION_PCT;
      // Stocks: whole shares only
      const rawQty = allocAmount / currentPrice;
      const qty    = isCrypto(symbol) ? parseFloat(rawQty.toFixed(6)) : Math.floor(rawQty);

      if (qty <= 0) {
        log(`${symbol}: calculated qty ${qty} <= 0 (price $${currentPrice}, alloc $${allocAmount.toFixed(2)}). Skipping.`);
      } else if (allocAmount > buyingPower) {
        log(`${symbol}: Insufficient buying power ($${buyingPower.toFixed(2)}) for $${allocAmount.toFixed(2)} allocation.`);
      } else {
        const order = await submitOrder(symbol, qty, 'buy');
        activePosition = {
          symbol,
          side:        'long',
          qty,
          entryPrice:  currentPrice,
          stopPrice:   currentPrice * (1 - STOP_LOSS_PCT),
          entryTime:   Date.now(),
          cyclesHeld:  0,
          peakPrice:   currentPrice,
        };
        logTrade('BUY', {
          symbol,
          qty,
          price:     currentPrice,
          alloc:     allocAmount.toFixed(2),
          stopPrice: activePosition.stopPrice.toFixed(2),
          orderId:   order.id,
          score:     score.toFixed(2),
          triggers:  signals.filter(s => s.signal === 'BUY').map(s => s.strategy),
        });
      }
    } else if (decision === 'SELL') {
      // No existing position to sell — log and skip (no shorting on paper stocks)
      log(`${symbol}: SELL signal with no position — skipping (no shorting on paper).`);
    }

    writeStatus(equity, cash);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    log(err.stack || '');
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function main() {
  // Ensure log directory exists
  try { mkdirSync(join(PROJECT_ROOT, 'logs'), { recursive: true }); } catch { /* already exists */ }

  log(`Trader9 starting — ${USE_LIVE ? 'LIVE MODE' : 'PAPER MODE'}`);
  log(`Asset universe: ${ALL_SYMBOLS.join(', ')}`);
  log(`Config: 5min cycles | 20% position | 3% stop | 1.5% TP | trail 1%→1.5% | 30min time exit | 1-signal confirm | 8/10 aggression`);
  log(`Strategies: EMA(${EMA_FAST}/${EMA_SLOW}) + BB(${BB_PERIOD}, ${BB_STD}σ) + RSI(14) + MACD(12/26/9) + VWAP + MicroSpike(${SPIKE_THRESHOLD * 100}%)`);

  // Verify connection
  try {
    const account = await getAccount();
    log(`Connected to Alpaca ${USE_LIVE ? 'LIVE' : 'Paper'} — Account: ${account.account_number}`);
    log(`Equity: $${parseFloat(account.equity).toFixed(2)} | Status: ${account.status}`);

    if (account.status !== 'ACTIVE') {
      log(`WARNING: Account status is ${account.status}, not ACTIVE.`);
    }

    startEquity = parseFloat(account.equity);
  } catch (err) {
    log(`FATAL: Cannot connect to Alpaca — ${err.message}`);
    process.exit(1);
  }

  // Run first cycle immediately, then every 5 minutes
  await cycle();
  setInterval(cycle, CYCLE_MS);
  log(`Trader9 running. Next cycle in ${CYCLE_MS / 1000}s.`);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
