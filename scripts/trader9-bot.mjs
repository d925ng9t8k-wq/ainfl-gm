#!/usr/bin/env node
/**
 * Trader9 v2 — Multi-Strategy Trading Bot
 *
 * Architecture per MONEY retraining plan (April 5, 2026):
 *
 *   FeeModel     — hard gate on every order. Every strategy passes through it.
 *   RiskManager  — account-level 15% drawdown halt, strategy-level 5% session pause.
 *   MarketClock  — determines active strategies based on current time / market hours.
 *
 * Strategies (Phase 1 build order per MONEY Section 3):
 *   1. StatArbEquity    — ETF pairs mean reversion. Alpaca equities. Market hours only.
 *                         Pairs: SPY/IVV, QQQ/QQQM, XLK/VGT. $0 commissions.
 *   2. FundingRateCarry — BTC spot (Alpaca) + perp short (Hyperliquid). 24/7.
 *                         SCAFFOLD ONLY — execution blocked until Hyperliquid account live.
 *   3. PredictionMarketArb — Kalshi + Polymarket cross-platform arb. 24/7.
 *                         SCAFFOLD ONLY — execution blocked until accounts live.
 *
 * Aggression: 8/10 (15–25% position sizing, fractional Kelly)
 * Mode: PAPER ONLY — live requires ALPACA_LIVE_ENABLED=true AND 9 sign-off
 *
 * --dry-run flag: runs one cycle, logs everything, places no orders.
 */

// ─── Sentry (must be first) ───────────────────────────────────────────────────
import * as Sentry from '@sentry/node';

import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Config (all thresholds here — never hardcoded below) ────────────────────
const CFG = {
  // Aggression 8/10: 15–25% position size per MONEY Section 6
  POSITION_PCT:           0.20,   // 20% of account per position
  KELLY_FRACTION:         0.5,    // half-Kelly on prediction markets

  // Risk thresholds
  MAX_DAILY_LOSS_PCT:     0.03,   // 3% daily drawdown → halt day (existing circuit breaker)
  HWM_DRAWDOWN_PCT:       0.15,   // 15% from high-water mark → halt ALL strategies + alert
  STRATEGY_SESSION_LOSS:  0.05,   // 5% session loss on one strategy → pause that strategy only

  // Stat-arb pairs
  ZSCORE_ENTRY:           2.0,    // enter when z-score >= 2.0 (mean-reversion trigger)
  ZSCORE_EXIT:            0.5,    // exit when z-score reverts to 0.5
  ZSCORE_STOP:            3.5,    // stop-loss if spread diverges to 3.5 sigma
  LOOKBACK_BARS:          60,     // bars for cointegration rolling window
  STAT_ARB_STOP_PCT:      0.04,   // 4% position stop on stat-arb

  // Funding rate carry thresholds
  FUNDING_ENTRY_APR:      0.15,   // enter carry when annualized funding rate >= 15%
  FUNDING_EXIT_APR:       0.05,   // exit when funding rate drops below 5%
  FUNDING_STOP_APR:      -0.02,   // hard exit if funding goes negative (rate < -2%)

  // Fee model — verified April 2026 (MONEY Section 1)
  ALPACA_EQUITY_MAKER:    0.0,    // $0 commissions on equities
  ALPACA_EQUITY_TAKER:    0.0,
  ALPACA_CRYPTO_MAKER:    0.0015, // 0.15%
  ALPACA_CRYPTO_TAKER:    0.0025, // 0.25%
  HYPERLIQUID_TAKER:      0.00045,// 0.045%
  HYPERLIQUID_MAKER:     -0.00015,// -0.015% (rebate)
  KALSHI_FEE_RATE:        0.02,   // up to 2% of profit on mid-range contracts
  POLYMARKET_TAKER:       0.003,  // 0.30% US taker

  // Slippage estimates (MONEY Section 1)
  SLIPPAGE_EQUITY:        0.0001, // ~0.01% on liquid ETFs
  SLIPPAGE_CRYPTO_ALPACA: 0.0035, // 0.35% adverse selection included
  SLIPPAGE_HYPERLIQUID:   0.001,  // 0.10%

  // Minimum net expected value before any trade (in dollar terms)
  MIN_NET_EV_DOLLARS:     2.00,   // $2.00 minimum net edge per trade

  // Cycles
  CYCLE_MS:               5 * 60 * 1000, // 5 min main loop
  FUNDING_POLL_MS:        60 * 1000,     // funding rate checked every 60s

  // Bars
  BARS_NEEDED:            65,
  BARS_MIN:               20,
};

// ─── Asset Universe ───────────────────────────────────────────────────────────
// ETF stat-arb pairs: [leg A, leg B] — we trade the spread
const STAT_ARB_PAIRS = [
  { a: 'SPY',  b: 'IVV',  name: 'SPY/IVV'   },  // S&P 500 ETF pair
  { a: 'QQQ',  b: 'QQQM', name: 'QQQ/QQQM'  },  // Nasdaq ETF pair
  { a: 'XLK',  b: 'VGT',  name: 'XLK/VGT'   },  // Tech sector ETF pair
];

const CRYPTO_CARRY_SYMBOL = 'BTC/USD';  // Alpaca spot leg

function isCrypto(symbol) { return symbol.includes('/'); }

// ─── Paths ────────────────────────────────────────────────────────────────────
const PROJECT_ROOT = '/Users/jassonfishback/Projects/BengalOracle';
const ENV_PATH     = join(PROJECT_ROOT, '.env');
const LOG_PATH     = join(PROJECT_ROOT, 'logs/trader9.log');
const STATUS_PATH  = '/tmp/trader9-status.txt';
const HALT_PATH    = join(PROJECT_ROOT, 'data/trader9-halt-until.txt');

// ─── Alpaca endpoints ─────────────────────────────────────────────────────────
const TRADE_BASE      = 'https://api.alpaca.markets';
const PAPER_BASE      = 'https://paper-api.alpaca.markets';
const STOCK_DATA_URL  = 'https://data.alpaca.markets';
const CRYPTO_DATA_URL = 'https://data.alpaca.markets';

// ─── Load API Keys ────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(ENV_PATH, 'utf-8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_0-9]+)=(.+)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}
const env = loadEnv();

// FORT C-04: Live requires BOTH the live keys AND explicit opt-in flag.
const LIVE_KEY_PRESENT = !!env.ALPACA_LIVE_API_KEY;
const LIVE_FLAG_SET    = env.ALPACA_LIVE_ENABLED === 'true';
const USE_LIVE         = LIVE_KEY_PRESENT && LIVE_FLAG_SET;
if (LIVE_KEY_PRESENT && !LIVE_FLAG_SET) {
  console.log('[Trader9] FORT C-04: ALPACA_LIVE_API_KEY present but ALPACA_LIVE_ENABLED != "true" — forcing paper mode.');
}

const BASE_URL   = USE_LIVE ? TRADE_BASE : PAPER_BASE;
const API_KEY    = USE_LIVE ? env.ALPACA_LIVE_API_KEY    : env.ALPACA_API_KEY;
const SECRET_KEY = USE_LIVE ? env.ALPACA_LIVE_SECRET_KEY : env.ALPACA_SECRET_KEY;

if (!API_KEY || !SECRET_KEY) {
  console.error('[Trader9] FATAL: Missing Alpaca API keys in .env');
  process.exit(1);
}

const ALPACA_HEADERS = {
  'APCA-API-KEY-ID':     API_KEY,
  'APCA-API-SECRET-KEY': SECRET_KEY,
  'Content-Type':        'application/json',
};

// ─── Sentry init ──────────────────────────────────────────────────────────────
if (env.SENTRY_DSN_TRADER9_BOT) {
  Sentry.init({
    dsn:              env.SENTRY_DSN_TRADER9_BOT,
    environment:      env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii:   false,
    release:          env.GIT_SHA || 'dev',
  });
}

process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  console.error(`[Trader9] UNCAUGHT EXCEPTION: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  console.error(`[Trader9] UNHANDLED REJECTION: ${reason}`);
});

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + '\n'); } catch { /* ignore */ }
}

function logTrade(action, details) {
  const entry = { time: new Date().toISOString(), action, mode: USE_LIVE ? 'LIVE' : 'PAPER', ...details };
  log(`TRADE [${entry.mode}]: ${action} | ${JSON.stringify(details)}`);
  return entry;
}

// ─── Telegram Alerts ──────────────────────────────────────────────────────────
async function sendTelegramAlert(message) {
  if (DRY_RUN) { log(`[DRY-RUN] Telegram suppressed: ${message}`); return; }
  try {
    await fetch('http://localhost:3457/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ channel: 'telegram', message }),
    });
  } catch (e) {
    log(`WARN: Telegram alert failed: ${e.message}`);
  }
}

// ─── Market Clock ─────────────────────────────────────────────────────────────
function etDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function etMidnightMs() {
  const now   = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etNow = new Date(etStr);
  const next  = new Date(etNow);
  next.setHours(24, 0, 0, 0);
  return next - etNow;
}

function isEquityMarketOpen() {
  const now    = new Date();
  const etStr  = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etStr);
  const day    = etDate.getDay();
  const mins   = etDate.getHours() * 60 + etDate.getMinutes();
  if (day === 0 || day === 6) return false;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ─── FeeModel (hard gate — MONEY Section 4, Priority 5) ──────────────────────
/**
 * Calculates net expected value for a trade.
 * Returns { netEV, breakdown, pass } where pass = true if trade clears the minimum.
 *
 * @param {object} params
 *   venue:        'alpaca_equity' | 'alpaca_crypto' | 'hyperliquid' | 'kalshi' | 'polymarket'
 *   orderType:    'maker' | 'taker'  (both legs assumed taker if unknown — conservative)
 *   grossProfitPct: expected gross profit as a decimal (e.g., 0.005 = 0.5%)
 *   tradeSize:    dollar value of position
 *   isRoundTrip:  true = include both entry and exit fees
 */
function feeModel({ venue, orderType = 'taker', grossProfitPct, tradeSize, isRoundTrip = true }) {
  let entryFeePct, exitFeePct, slippagePct;

  switch (venue) {
    case 'alpaca_equity':
      entryFeePct = CFG.ALPACA_EQUITY_TAKER;
      exitFeePct  = CFG.ALPACA_EQUITY_TAKER;
      slippagePct = CFG.SLIPPAGE_EQUITY;
      break;
    case 'alpaca_crypto':
      entryFeePct = orderType === 'maker' ? CFG.ALPACA_CRYPTO_MAKER : CFG.ALPACA_CRYPTO_TAKER;
      exitFeePct  = orderType === 'maker' ? CFG.ALPACA_CRYPTO_MAKER : CFG.ALPACA_CRYPTO_TAKER;
      slippagePct = CFG.SLIPPAGE_CRYPTO_ALPACA;
      break;
    case 'hyperliquid':
      entryFeePct = orderType === 'maker' ? CFG.HYPERLIQUID_MAKER : CFG.HYPERLIQUID_TAKER;
      exitFeePct  = orderType === 'maker' ? CFG.HYPERLIQUID_MAKER : CFG.HYPERLIQUID_TAKER;
      slippagePct = CFG.SLIPPAGE_HYPERLIQUID;
      break;
    case 'kalshi':
      // Kalshi fee is on profit, not notional — modeled as reduction to gross
      entryFeePct = 0;
      exitFeePct  = 0;
      slippagePct = 0.03; // ~3% spread on mid-range contracts
      break;
    case 'polymarket':
      entryFeePct = CFG.POLYMARKET_TAKER;
      exitFeePct  = CFG.POLYMARKET_TAKER;
      slippagePct = 0.02;
      break;
    default:
      entryFeePct = 0.003;
      exitFeePct  = 0.003;
      slippagePct = 0.002;
  }

  const grossProfit   = grossProfitPct * tradeSize;
  const entryFee      = entryFeePct * tradeSize;
  const exitFee       = isRoundTrip ? exitFeePct * tradeSize : 0;
  const slippageCost  = slippagePct * tradeSize;

  // Kalshi: deduct fee from profit
  const kalshiProfitFee = venue === 'kalshi' ? grossProfit * CFG.KALSHI_FEE_RATE : 0;

  const totalCost = entryFee + exitFee + slippageCost + kalshiProfitFee;
  const netEV     = grossProfit - totalCost;
  const pass      = netEV >= CFG.MIN_NET_EV_DOLLARS;

  return {
    netEV,
    pass,
    breakdown: {
      grossProfit:   grossProfit.toFixed(4),
      entryFee:      entryFee.toFixed(4),
      exitFee:       exitFee.toFixed(4),
      slippage:      slippageCost.toFixed(4),
      kalshiFee:     kalshiProfitFee.toFixed(4),
      totalCost:     totalCost.toFixed(4),
      netEV:         netEV.toFixed(4),
      minRequired:   CFG.MIN_NET_EV_DOLLARS.toFixed(2),
    },
  };
}

// ─── RiskManager ─────────────────────────────────────────────────────────────
const riskState = {
  highWaterMark:     null,    // account equity high-water mark
  globalHalt:        false,   // true = 15% HWM drawdown tripped
  strategyPaused:    {},      // { strategyName: true } if paused due to session loss
  strategySessionPnl:{},      // { strategyName: dollarPnl } for current session
};

function riskManagerInit(equity) {
  if (riskState.highWaterMark === null || equity > riskState.highWaterMark) {
    riskState.highWaterMark = equity;
  }
}

function riskManagerUpdate(equity) {
  if (equity > riskState.highWaterMark) {
    riskState.highWaterMark = equity;
    log(`RiskManager: new high-water mark $${equity.toFixed(2)}`);
  }

  const drawdown = (riskState.highWaterMark - equity) / riskState.highWaterMark;
  if (!riskState.globalHalt && drawdown >= CFG.HWM_DRAWDOWN_PCT) {
    riskState.globalHalt = true;
    const msg = `TRADER9 GLOBAL HALT: account drawdown ${(drawdown * 100).toFixed(1)}% from high-water mark ($${riskState.highWaterMark.toFixed(2)} → $${equity.toFixed(2)}). ALL strategies halted. 9 sign-off required to resume.`;
    log(`RISK: ${msg}`);
    // Alert routing disabled — log only, not sent to Owner's Telegram (Apr 9 directive)
    log(`[alert-suppressed] ${msg}`);
  }
}

function recordStrategyPnl(strategyName, dollarPnl, accountEquity) {
  riskState.strategySessionPnl[strategyName] = (riskState.strategySessionPnl[strategyName] || 0) + dollarPnl;
  const sessionLoss = riskState.strategySessionPnl[strategyName];
  const lossPct     = Math.abs(Math.min(0, sessionLoss)) / accountEquity;

  if (!riskState.strategyPaused[strategyName] && lossPct >= CFG.STRATEGY_SESSION_LOSS) {
    riskState.strategyPaused[strategyName] = true;
    const msg = `TRADER9 STRATEGY PAUSE: ${strategyName} lost ${(lossPct * 100).toFixed(1)}% of account this session ($${sessionLoss.toFixed(2)}). Pausing ${strategyName} only.`;
    log(`RISK: ${msg}`);
    // Alert routing disabled — log only, not sent to Owner's Telegram (Apr 9 directive)
    log(`[alert-suppressed] ${msg}`);
  }
}

function isStrategyAllowed(strategyName) {
  if (riskState.globalHalt) return false;
  if (riskState.strategyPaused[strategyName]) {
    log(`RiskManager: ${strategyName} is paused (session loss limit).`);
    return false;
  }
  return true;
}

// ─── Daily Drawdown Circuit Breaker (preserved from v1) ──────────────────────
let dayStartEquity      = null;
let dayStartDate        = null;
let realizedDayPnl      = 0;
let haltedUntilMidnight = false;
let tradeLog            = [];
let cycleCount          = 0;
let startEquity         = null;

const maxDailyLossPct = parseFloat(env.MAX_DAILY_LOSS_PCT ?? String(CFG.MAX_DAILY_LOSS_PCT * 100)) / 100;

function persistHalt() {
  const tomorrow = new Date(Date.now() + etMidnightMs() + 1000).toISOString();
  try { writeFileSync(HALT_PATH, tomorrow); } catch (e) { log(`WARN: halt file write failed: ${e.message}`); }
}

function clearHalt() {
  try { writeFileSync(HALT_PATH, ''); } catch { /* ignore */ }
  haltedUntilMidnight = false;
}

function isHalted() {
  if (haltedUntilMidnight) return true;
  try {
    if (!existsSync(HALT_PATH)) return false;
    const raw = readFileSync(HALT_PATH, 'utf-8').trim();
    if (!raw) return false;
    const haltUntil = new Date(raw);
    if (isNaN(haltUntil.getTime())) return false;
    if (Date.now() < haltUntil.getTime()) { haltedUntilMidnight = true; return true; }
    clearHalt();
    return false;
  } catch { return false; }
}

function checkDayReset(equity) {
  const today = etDateString();
  if (dayStartDate !== today) {
    if (dayStartDate !== null) log(`NEW TRADING DAY: ${today}. Previous day P&L: $${realizedDayPnl.toFixed(2)}`);
    dayStartDate   = today;
    dayStartEquity = equity;
    realizedDayPnl = 0;
    clearHalt();
    log(`Day start equity: $${dayStartEquity.toFixed(2)} | Max daily loss: ${(maxDailyLossPct * 100).toFixed(1)}% = $${(dayStartEquity * maxDailyLossPct).toFixed(2)}`);
  }
}

function recordRealizedPnl(pnlPct, entryPrice, qty) {
  const dollar = pnlPct * entryPrice * qty;
  realizedDayPnl += dollar;
  log(`REALIZED P&L: $${dollar.toFixed(2)} | Day total: $${realizedDayPnl.toFixed(2)}`);
  return dollar;
}

function checkDailyDrawdownBreaker() {
  if (!dayStartEquity || isHalted()) return false;
  const maxLoss = dayStartEquity * maxDailyLossPct;
  if (realizedDayPnl <= -maxLoss) {
    const pct = (Math.abs(realizedDayPnl) / dayStartEquity * 100).toFixed(2);
    const msg = `TRADER9 DAILY DRAWDOWN TRIPPED: lost ${pct}% today ($${Math.abs(realizedDayPnl).toFixed(2)}), halted until midnight ET.`;
    log(`CIRCUIT BREAKER: ${msg}`);
    haltedUntilMidnight = true;
    persistHalt();
    // Alert suppressed (Apr 9)
    // sendTelegramAlert(`[PAPER] ${msg}`).catch(() => {});
    return true;
  }
  return false;
}

// ─── Alpaca API ───────────────────────────────────────────────────────────────
async function alpacaApi(url, opts = {}) {
  const res = await fetch(url, { headers: ALPACA_HEADERS, ...opts });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alpaca API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getAccount() {
  return alpacaApi(`${BASE_URL}/v2/account`);
}

async function getPosition(symbol) {
  try {
    return await alpacaApi(`${BASE_URL}/v2/positions/${symbol.replace('/', '')}`);
  } catch (e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

async function submitOrder(symbol, qty, side, dryRun = false) {
  const isC = isCrypto(symbol);
  const body = {
    symbol:        isC ? symbol.replace('/', '') : symbol,
    qty:           isC ? String(qty) : String(Math.floor(qty)),
    side,
    type:          'market',
    time_in_force: isC ? 'gtc' : 'day',
  };

  if (dryRun || DRY_RUN) {
    log(`[DRY-RUN] ORDER: ${side} ${body.qty} ${symbol}`);
    return { id: 'DRY-RUN', status: 'simulated' };
  }

  log(`ORDER: ${side} ${body.qty} ${symbol} (market)`);
  return alpacaApi(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}

async function closePosition(symbol, dryRun = false) {
  if (dryRun || DRY_RUN) {
    log(`[DRY-RUN] CLOSE POSITION: ${symbol}`);
    return { status: 'simulated' };
  }
  try {
    return await alpacaApi(`${BASE_URL}/v2/positions/${symbol.replace('/', '')}`, { method: 'DELETE' });
  } catch (e) {
    log(`Close position failed for ${symbol}: ${e.message}`);
    return null;
  }
}

// ─── Market Data — Bars ───────────────────────────────────────────────────────
async function getStockBars(symbol, limit = 200) {
  const hoursBack = Math.ceil((limit * 5) / 60) + 48;
  const start     = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  let allBars = [];
  let url = `${STOCK_DATA_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=${limit}&start=${start}&adjustment=raw&feed=iex`;

  while (url) {
    const data     = await alpacaApi(url);
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
    const data     = await alpacaApi(url);
    const pageBars = data.bars?.[symbol] || [];
    allBars = allBars.concat(pageBars);
    if (data.next_page_token && allBars.length < limit * 3) {
      url = `${CRYPTO_DATA_URL}/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=5Min&limit=${limit}&start=${start}&page_token=${data.next_page_token}`;
    } else {
      url = null;
    }
  }

  if (allBars.length > limit) allBars = allBars.slice(-limit);
  return allBars;
}

async function getBars(symbol, limit = 200) {
  return isCrypto(symbol) ? getCryptoBars(symbol, limit) : getStockBars(symbol, limit);
}

async function getLatestPrice(symbol) {
  if (isCrypto(symbol)) {
    const encoded = encodeURIComponent(symbol);
    const data    = await alpacaApi(`${CRYPTO_DATA_URL}/v1beta3/crypto/us/latest/trades?symbols=${encoded}`);
    return data.trades?.[symbol]?.p ?? null;
  } else {
    const data = await alpacaApi(`${STOCK_DATA_URL}/v2/stocks/${symbol}/trades/latest?feed=iex`);
    return data.trade?.p ?? null;
  }
}

// ─── Technical Indicators ─────────────────────────────────────────────────────
function calcMean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calcStdDev(arr) {
  const mean = calcMean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

function calcZScore(series) {
  // Returns rolling z-score array for the last element
  const mean = calcMean(series);
  const std  = calcStdDev(series);
  if (std === 0) return 0;
  return (series[series.length - 1] - mean) / std;
}

function calcEMA(data, period) {
  const k   = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const rsi = new Array(period).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
  }
  avgGain /= period; avgLoss /= period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

// ─── Strategy 1: StatArbEquity ────────────────────────────────────────────────
/**
 * ETF Pairs Mean Reversion per MONEY Section 2, Priority 1C.
 *
 * For each pair (A, B):
 *   - Fetch LOOKBACK_BARS of price data for both legs
 *   - Compute log-price spread: log(A) - hedge_ratio * log(B)
 *   - Compute rolling z-score of spread over last LOOKBACK_BARS bars
 *   - Enter when z-score >= ZSCORE_ENTRY (spread too wide → bet on reversion)
 *     Long the cheap leg, short the expensive leg
 *   - Exit when z-score reverts to ZSCORE_EXIT
 *   - Stop at ZSCORE_STOP (spread diverging further)
 *
 * FeeModel gate: only trade if net EV >= MIN_NET_EV_DOLLARS.
 * Alpaca equity commissions are $0 — main cost is slippage.
 */
const statArbPositions = {}; // { pairName: { legA: {symbol,side,qty,entry}, legB: {...}, entryZ, stopLevel } }

async function runStatArbEquity(equity) {
  if (!isEquityMarketOpen()) {
    log('[StatArb] Market closed — skipping.');
    return;
  }
  if (!isStrategyAllowed('StatArbEquity')) return;

  log('[StatArb] Scanning ETF pairs...');

  for (const pair of STAT_ARB_PAIRS) {
    try {
      await runStatArbPair(pair, equity);
    } catch (e) {
      log(`[StatArb] Error on pair ${pair.name}: ${e.message}`);
    }
  }
}

async function runStatArbPair(pair, equity) {
  const pairName = pair.name;
  const existing = statArbPositions[pairName];

  // Fetch bars for both legs
  const [barsA, barsB] = await Promise.all([
    getStockBars(pair.a, CFG.LOOKBACK_BARS + 5),
    getStockBars(pair.b, CFG.LOOKBACK_BARS + 5),
  ]);

  const minLen = Math.min(barsA.length, barsB.length);
  if (minLen < CFG.BARS_MIN) {
    log(`[StatArb] ${pairName}: insufficient bars (${minLen}), skipping.`);
    return;
  }

  // Align by time: use last minLen bars
  const closesA = barsA.slice(-minLen).map(b => b.c);
  const closesB = barsB.slice(-minLen).map(b => b.c);

  // Log-price spread (hedge ratio = 1 for same-index ETF pairs — they track same index)
  const spread = closesA.map((a, i) => Math.log(a) - Math.log(closesB[i]));

  // Use last LOOKBACK_BARS for z-score calculation
  const lookbackSpread = spread.slice(-CFG.LOOKBACK_BARS);
  const zScore         = calcZScore(lookbackSpread);
  const lastA          = closesA[closesA.length - 1];
  const lastB          = closesB[closesB.length - 1];

  log(`[StatArb] ${pairName}: A=$${lastA.toFixed(2)} B=$${lastB.toFixed(2)} spread=${(spread[spread.length - 1]).toFixed(4)} z=${zScore.toFixed(3)}`);

  // ── Manage existing position ──────────────────────────────────────────────
  if (existing) {
    const exitTrigger = Math.abs(zScore) <= CFG.ZSCORE_EXIT;
    const stopTrigger = Math.abs(zScore) >= CFG.ZSCORE_STOP;

    if (exitTrigger || stopTrigger) {
      const reason = exitTrigger ? 'ZSCORE_REVERT' : 'ZSCORE_STOP';
      log(`[StatArb] ${pairName}: closing pair — ${reason} (z=${zScore.toFixed(3)})`);

      // Close both legs
      await closePosition(pair.a);
      await closePosition(pair.b);

      // Compute P&L (simplified: use current prices vs entry)
      const pnlA = (existing.sideA === 'buy')
        ? (lastA - existing.entryA) * existing.qtyA
        : (existing.entryA - lastA) * existing.qtyA;
      const pnlB = (existing.sideB === 'buy')
        ? (lastB - existing.entryB) * existing.qtyB
        : (existing.entryB - lastB) * existing.qtyB;
      const totalPnl = pnlA + pnlB;

      logTrade(reason, { pair: pairName, pnlA: pnlA.toFixed(2), pnlB: pnlB.toFixed(2), totalPnl: totalPnl.toFixed(2), exitZ: zScore.toFixed(3) });
      recordRealizedPnl(totalPnl / equity, 1, equity); // record as dollar amount via pct
      recordStrategyPnl('StatArbEquity', totalPnl, equity);
      checkDailyDrawdownBreaker();

      delete statArbPositions[pairName];
    } else {
      log(`[StatArb] ${pairName}: holding pair (z=${zScore.toFixed(3)}, entry z=${existing.entryZ.toFixed(3)})`);
    }
    return;
  }

  // ── Check for new entry ───────────────────────────────────────────────────
  if (Math.abs(zScore) < CFG.ZSCORE_ENTRY) {
    log(`[StatArb] ${pairName}: no signal (|z|=${Math.abs(zScore).toFixed(3)} < ${CFG.ZSCORE_ENTRY})`);
    return;
  }

  // z > +ZSCORE_ENTRY: A expensive vs B → short A, long B
  // z < -ZSCORE_ENTRY: A cheap vs B → long A, short B
  const longSym  = zScore > 0 ? pair.b : pair.a;
  const shortSym = zScore > 0 ? pair.a : pair.b;
  const longPrice  = zScore > 0 ? lastB : lastA;
  const shortPrice = zScore > 0 ? lastA : lastB;

  const allocPerLeg  = equity * CFG.POSITION_PCT * 0.5; // split allocation across both legs
  const longQty      = Math.floor(allocPerLeg / longPrice);
  const shortQty     = Math.floor(allocPerLeg / shortPrice);

  if (longQty < 1 || shortQty < 1) {
    log(`[StatArb] ${pairName}: qty too small (long ${longQty}, short ${shortQty}), skipping.`);
    return;
  }

  // Expected gross profit: spread mean reversion from z=2.0 to z=0.5 = 1.5 sigma move
  const spreadStd       = calcStdDev(lookbackSpread);
  const expectedMovePct = spreadStd * (CFG.ZSCORE_ENTRY - CFG.ZSCORE_EXIT); // ~1.5 sigma
  const feeCheck        = feeModel({
    venue:          'alpaca_equity',
    orderType:      'taker',
    grossProfitPct: expectedMovePct,
    tradeSize:      allocPerLeg * 2,
    isRoundTrip:    true,
  });

  log(`[StatArb] ${pairName}: FeeModel check — expected move ${(expectedMovePct * 100).toFixed(3)}% | ${JSON.stringify(feeCheck.breakdown)}`);

  if (!feeCheck.pass) {
    log(`[StatArb] ${pairName}: FeeModel BLOCK — net EV $${feeCheck.netEV.toFixed(4)} below $${CFG.MIN_NET_EV_DOLLARS} minimum.`);
    return;
  }

  // Execute: note Alpaca paper does not support shorting ETFs in all cases.
  // The SELL order will be rejected if ETB list excludes it — bot handles gracefully.
  log(`[StatArb] ${pairName}: ENTERING — long ${longQty} ${longSym} @ $${longPrice.toFixed(2)}, short ${shortQty} ${shortSym} @ $${shortPrice.toFixed(2)} | z=${zScore.toFixed(3)}`);

  try {
    const orderLong  = await submitOrder(longSym,  longQty,  'buy');
    const orderShort = await submitOrder(shortSym, shortQty, 'sell');

    statArbPositions[pairName] = {
      entryZ: zScore,
      sideA:  zScore > 0 ? 'sell' : 'buy',
      sideB:  zScore > 0 ? 'buy'  : 'sell',
      entryA: lastA,
      entryB: lastB,
      qtyA:   zScore > 0 ? shortQty : longQty,
      qtyB:   zScore > 0 ? longQty  : shortQty,
    };

    logTrade('STAT_ARB_ENTER', {
      pair:    pairName,
      longSym, longQty, longPrice: longPrice.toFixed(2),
      shortSym, shortQty, shortPrice: shortPrice.toFixed(2),
      zScore:  zScore.toFixed(3),
      netEV:   feeCheck.netEV.toFixed(2),
      orderLongId:  orderLong.id,
      orderShortId: orderShort.id,
    });
  } catch (e) {
    log(`[StatArb] ${pairName}: Order failed — ${e.message}. Aborting pair entry.`);
    // If one leg filled and other failed, we need to close the filled leg.
    // Conservative: attempt to close both.
    await closePosition(pair.a).catch(() => {});
    await closePosition(pair.b).catch(() => {});
  }
}

// ─── Strategy 2: FundingRateCarry (Scaffold) ─────────────────────────────────
/**
 * Funding-rate basis capture per MONEY Section 2, Priority 1A.
 *
 * SCAFFOLD — real execution blocked until:
 *   - Hyperliquid wallet funded
 *   - HYPERLIQUID_ENABLED=true in .env
 *   - 9 sign-off
 *
 * Currently: monitors Hyperliquid funding rate and logs opportunities.
 * Paper P&L is tracked hypothetically.
 */
const fundingCarryState = {
  inPosition:    false,
  entryRate:     null,
  entryBtcPrice: null,
  paperPnl:      0,
};

async function runFundingRateCarry(equity) {
  // Gate: only proceed if Hyperliquid integration is explicitly enabled
  if (env.HYPERLIQUID_ENABLED !== 'true') {
    log('[FundingCarry] SCAFFOLD: HYPERLIQUID_ENABLED not set. Monitoring rates only (no execution).');
  }

  if (!isStrategyAllowed('FundingRateCarry')) return;

  // Fetch Hyperliquid funding rate (public endpoint, no auth required)
  let fundingRateApr = null;
  try {
    const res  = await fetch('https://api.hyperliquid.xyz/info', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (res.ok) {
      const data    = await res.json();
      // data[1] is array of asset contexts; find BTC (index 0 on Hyperliquid)
      const assetCtxs = data[1];
      const btcCtx    = Array.isArray(assetCtxs) ? assetCtxs[0] : null;
      if (btcCtx?.funding) {
        // Hyperliquid funding is per 1-hour period, expressed as a decimal fraction
        const hourlyRate = parseFloat(btcCtx.funding);
        fundingRateApr   = hourlyRate * 24 * 365; // annualized
        log(`[FundingCarry] BTC funding rate: ${(hourlyRate * 100).toFixed(4)}%/hr = ${(fundingRateApr * 100).toFixed(2)}% APR`);
      }
    }
  } catch (e) {
    log(`[FundingCarry] Funding rate fetch failed: ${e.message}`);
    return;
  }

  if (fundingRateApr === null) {
    log('[FundingCarry] Could not parse funding rate. Skipping.');
    return;
  }

  if (env.HYPERLIQUID_ENABLED !== 'true') {
    // Paper-track hypothetical position
    if (!fundingCarryState.inPosition && fundingRateApr >= CFG.FUNDING_ENTRY_APR) {
      log(`[FundingCarry] PAPER SIGNAL: funding rate ${(fundingRateApr * 100).toFixed(2)}% APR >= ${(CFG.FUNDING_ENTRY_APR * 100)}% entry threshold. Would ENTER carry trade. (Blocked: Hyperliquid not configured.)`);
      // Alert suppressed (Apr 9)
    // sendTelegramAlert(`[PAPER] FundingCarry: BTC funding ${(fundingRateApr * 100).toFixed(1)}% APR — carry trade opportunity. Hyperliquid account needed to execute.`).catch(() => {});
    } else if (fundingCarryState.inPosition && (fundingRateApr <= CFG.FUNDING_EXIT_APR || fundingRateApr <= CFG.FUNDING_STOP_APR)) {
      log(`[FundingCarry] PAPER SIGNAL: funding rate ${(fundingRateApr * 100).toFixed(2)}% APR — would EXIT carry trade.`);
    }
    return;
  }

  // Full execution path (only when HYPERLIQUID_ENABLED=true)
  const allocSize   = equity * CFG.POSITION_PCT;
  const btcEstimate = 30000; // placeholder — would pull live BTC price

  if (!fundingCarryState.inPosition && fundingRateApr >= CFG.FUNDING_ENTRY_APR) {
    // FeeModel check: entry cost is Alpaca crypto maker (spot buy) + Hyperliquid taker (perp short)
    const dailyCarryPct = fundingRateApr / 365;
    const feeCheck      = feeModel({
      venue:          'alpaca_crypto',
      orderType:      'taker',
      grossProfitPct: dailyCarryPct * 30, // estimate 30-day hold
      tradeSize:      allocSize,
      isRoundTrip:    true,
    });

    if (!feeCheck.pass) {
      log(`[FundingCarry] FeeModel BLOCK: net EV $${feeCheck.netEV.toFixed(2)} below minimum.`);
      return;
    }

    log(`[FundingCarry] ENTERING carry: buy BTC spot on Alpaca + short perp on Hyperliquid | APR ${(fundingRateApr * 100).toFixed(2)}%`);
    // Spot buy on Alpaca
    const btcQty = parseFloat((allocSize / btcEstimate).toFixed(6));
    await submitOrder(CRYPTO_CARRY_SYMBOL, btcQty, 'buy');
    // Hyperliquid short would go here — blocked until Hyperliquid API integration
    fundingCarryState.inPosition    = true;
    fundingCarryState.entryRate     = fundingRateApr;
    fundingCarryState.entryBtcPrice = btcEstimate;
    logTrade('FUNDING_CARRY_ENTER', { apr: (fundingRateApr * 100).toFixed(2), allocSize: allocSize.toFixed(2) });

  } else if (fundingCarryState.inPosition) {
    const shouldExit = fundingRateApr <= CFG.FUNDING_EXIT_APR || fundingRateApr <= CFG.FUNDING_STOP_APR;
    if (shouldExit) {
      const reason = fundingRateApr <= CFG.FUNDING_STOP_APR ? 'FUNDING_NEGATIVE_STOP' : 'FUNDING_RATE_LOW';
      log(`[FundingCarry] EXITING carry: ${reason} (rate ${(fundingRateApr * 100).toFixed(2)}% APR)`);
      await closePosition(CRYPTO_CARRY_SYMBOL);
      fundingCarryState.inPosition = false;
      logTrade(reason, { exitRate: (fundingRateApr * 100).toFixed(2) });
    }
  }
}

// ─── Strategy 3: PredictionMarketArb (Scaffold) ───────────────────────────────
/**
 * Cross-platform prediction market arbitrage per MONEY Section 2, Priority 1B + 2A.
 *
 * SCAFFOLD — real execution blocked until:
 *   - Kalshi account KYC complete, API key in env (KALSHI_API_KEY)
 *   - Polymarket wallet funded, CLOB API key in env (POLYMARKET_API_KEY)
 *   - PREDICTION_MARKET_ENABLED=true in .env
 *   - Paper trading validated across 50+ trades
 *   - 9 sign-off
 *
 * Currently: polls Kalshi markets, logs opportunities, tracks hypothetical P&L.
 *
 * Logic per MONEY Section 2, Priority 1B:
 *   For each matched market on both platforms:
 *     If (Kalshi YES price) + (Polymarket NO price) < $0.98 (2¢ minimum edge after fees)
 *     → BUY YES on Kalshi AND BUY NO on Polymarket (simultaneous execution required)
 *     Locked profit = $1.00 - combined_cost on resolution
 */
const predMarketState = {
  paperTrades:    [],
  paperPnl:       0,
  opportunities:  0,
};

async function runPredictionMarketArb() {
  if (!isStrategyAllowed('PredictionMarketArb')) return;

  if (!env.KALSHI_API_KEY) {
    log('[PredMarket] SCAFFOLD: no KALSHI_API_KEY in .env. Skipping poll.');
    return;
  }

  try {
    // Fetch active Kalshi markets (limited to first page for now)
    const res = await fetch('https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=20', {
      headers: { Authorization: `Token ${env.KALSHI_API_KEY}` },
    });

    if (!res.ok) {
      log(`[PredMarket] Kalshi API ${res.status}. Skipping.`);
      return;
    }

    const data    = await res.json();
    const markets = data.markets || [];
    log(`[PredMarket] Fetched ${markets.length} open Kalshi markets.`);

    // For each market: check for combinatorial logic arb (MONEY Section 2, Priority 2B)
    // and cross-platform arb if Polymarket is configured.
    for (const market of markets) {
      const yesPrice = market.yes_ask;  // taker ask for YES
      const noPrice  = market.no_ask;   // taker ask for NO

      if (!yesPrice || !noPrice) continue;

      // Combinatorial: YES + NO should always sum to >= $1.00
      // If YES_ask + NO_ask < $0.98, there is a locked arb opportunity
      const combined = yesPrice + noPrice;
      if (combined < 0.98) {
        const grossEdge  = 1.0 - combined;
        const tradeSize  = 100; // $100 contract
        const feeCheckK  = feeModel({
          venue:          'kalshi',
          orderType:      'taker',
          grossProfitPct: grossEdge,
          tradeSize,
          isRoundTrip:    false,
        });

        predMarketState.opportunities++;
        log(`[PredMarket] COMBINATORIAL ARB: ${market.ticker} YES=${yesPrice} + NO=${noPrice} = ${combined.toFixed(2)} (edge ${(grossEdge * 100).toFixed(1)}¢) | Net EV: $${feeCheckK.netEV.toFixed(2)} | Pass: ${feeCheckK.pass}`);

        if (feeCheckK.pass) {
          if (env.PREDICTION_MARKET_ENABLED === 'true') {
            // Real execution (future)
            log(`[PredMarket] Would execute combinatorial arb on ${market.ticker}`);
          } else {
            // Paper track
            predMarketState.paperTrades.push({
              time:    new Date().toISOString(),
              market:  market.ticker,
              type:    'COMBINATORIAL',
              edge:    grossEdge,
              netEV:   feeCheckK.netEV,
            });
            predMarketState.paperPnl += feeCheckK.netEV;
            log(`[PredMarket] PAPER TRADE: ${market.ticker} | net EV $${feeCheckK.netEV.toFixed(2)} | running paper P&L $${predMarketState.paperPnl.toFixed(2)}`);

            if (predMarketState.paperTrades.length % 10 === 0) {
              // Alert suppressed (Apr 9)
    // sendTelegramAlert(`[PAPER] PredMarketArb: ${predMarketState.paperTrades.length} paper trades | P&L $${predMarketState.paperPnl.toFixed(2)}`).catch(() => {});
            }
          }
        }
      }
    }
  } catch (e) {
    log(`[PredMarket] Error: ${e.message}`);
  }
}

// ─── Status Writer ────────────────────────────────────────────────────────────
function writeStatus(equity, cash) {
  const pnl       = startEquity ? ((equity - startEquity) / startEquity * 100).toFixed(4) : '0.0000';
  const pnlDollar = startEquity ? (equity - startEquity).toFixed(2) : '0.00';

  const statArbOpen = Object.keys(statArbPositions).map(k => `  ${k}: z=${statArbPositions[k].entryZ.toFixed(2)}`).join('\n') || '  None';

  const status = [
    `Trader9 v2 Status — ${new Date().toISOString()}`,
    `${'─'.repeat(60)}`,
    `Mode:           ${USE_LIVE ? 'LIVE TRADING' : 'PAPER TRADING'}${DRY_RUN ? ' [DRY-RUN]' : ''}`,
    `Market:         ${isEquityMarketOpen() ? 'OPEN' : 'CLOSED'} (equity 9:30–16:00 ET | crypto 24/7)`,
    `Cycles:         ${cycleCount}`,
    `Start Equity:   $${startEquity?.toFixed(2) || 'N/A'}`,
    `Current Equity: $${equity.toFixed(2)}`,
    `Cash:           $${cash.toFixed(2)}`,
    `P&L:            $${pnlDollar} (${pnl}%)`,
    `Day P&L:        $${realizedDayPnl.toFixed(2)} | Limit: -$${dayStartEquity ? (dayStartEquity * maxDailyLossPct).toFixed(2) : 'N/A'} | ${haltedUntilMidnight ? 'HALTED' : 'ACTIVE'}`,
    `HWM:            $${riskState.highWaterMark?.toFixed(2) || 'N/A'} | Global halt: ${riskState.globalHalt}`,
    `${'─'.repeat(60)}`,
    `Strategy: StatArbEquity`,
    `  Open pairs:`,
    statArbOpen,
    `  Paused: ${riskState.strategyPaused['StatArbEquity'] || false}`,
    `Strategy: FundingRateCarry`,
    `  In position: ${fundingCarryState.inPosition}${env.HYPERLIQUID_ENABLED !== 'true' ? ' [SCAFFOLD]' : ''}`,
    `Strategy: PredictionMarketArb`,
    `  Paper trades: ${predMarketState.paperTrades.length} | Paper P&L: $${predMarketState.paperPnl.toFixed(2)}${env.PREDICTION_MARKET_ENABLED !== 'true' ? ' [SCAFFOLD]' : ''}`,
    `  Opps found this session: ${predMarketState.opportunities}`,
    `${'─'.repeat(60)}`,
    `Recent Trades (last 5):`,
    ...tradeLog.slice(-5).map(t => `  ${t.time} | ${t.action} | ${JSON.stringify(t)}`),
  ].join('\n');

  try { writeFileSync(STATUS_PATH, status + '\n'); } catch { /* ignore */ }
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────
async function cycle() {
  cycleCount++;
  log(`\n${'='.repeat(60)}`);
  log(`TRADER9 v2 CYCLE ${cycleCount} — ${new Date().toISOString()}${DRY_RUN ? ' [DRY-RUN]' : ''}`);

  try {
    const account    = await getAccount();
    const equity     = parseFloat(account.equity);
    const cash       = parseFloat(account.cash);
    const buyingPower = parseFloat(account.buying_power);

    if (!startEquity) startEquity = equity;

    checkDayReset(equity);
    riskManagerInit(equity);
    riskManagerUpdate(equity);

    log(`Account — Equity: $${equity.toFixed(2)} | Cash: $${cash.toFixed(2)} | Buying Power: $${buyingPower.toFixed(2)} | HWM: $${riskState.highWaterMark?.toFixed(2)}`);

    if (riskState.globalHalt) {
      log('GLOBAL HALT ACTIVE — all strategies suspended. Requires 9 sign-off to resume.');
      writeStatus(equity, cash);
      return;
    }

    if (isHalted()) {
      log(`DAILY CIRCUIT BREAKER ACTIVE — no new trades today. Day P&L: $${realizedDayPnl.toFixed(2)}`);
      writeStatus(equity, cash);
      return;
    }

    // Run all strategies in sequence (per MONEY architecture — parallel would race on position state)
    await runStatArbEquity(equity);
    await runFundingRateCarry(equity);
    await runPredictionMarketArb();

    writeStatus(equity, cash);

    if (DRY_RUN) {
      log('\n[DRY-RUN] One cycle complete. Exiting.');
      process.exit(0);
    }

  } catch (err) {
    log(`ERROR: ${err.message}`);
    log(err.stack || '');
    Sentry.captureException(err);
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function main() {
  try { mkdirSync(join(PROJECT_ROOT, 'logs'), { recursive: true }); } catch { /* exists */ }

  log(`Trader9 v2 starting — ${USE_LIVE ? 'LIVE MODE' : 'PAPER MODE'}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  log(`Strategy plan: MONEY April 5, 2026 retraining plan`);
  log(`Active strategies: StatArbEquity (live) | FundingRateCarry (${env.HYPERLIQUID_ENABLED === 'true' ? 'live' : 'scaffold'}) | PredictionMarketArb (${env.PREDICTION_MARKET_ENABLED === 'true' ? 'live' : 'scaffold'})`);
  log(`Config: position ${CFG.POSITION_PCT * 100}% | HWM halt ${CFG.HWM_DRAWDOWN_PCT * 100}% | strategy pause ${CFG.STRATEGY_SESSION_LOSS * 100}% | min net EV $${CFG.MIN_NET_EV_DOLLARS}`);
  log(`Fee model: equity $0 | crypto ${CFG.ALPACA_CRYPTO_TAKER * 100}% taker | Hyperliquid ${CFG.HYPERLIQUID_TAKER * 100}% taker`);
  log(`Pairs: ${STAT_ARB_PAIRS.map(p => p.name).join(', ')}`);

  // Verify Alpaca connection
  try {
    const account = await getAccount();
    log(`Connected — Account: ${account.account_number} | Equity: $${parseFloat(account.equity).toFixed(2)} | Status: ${account.status}`);
    if (account.status !== 'ACTIVE') log(`WARNING: Account status ${account.status}`);
    startEquity = parseFloat(account.equity);
  } catch (err) {
    log(`FATAL: Cannot connect to Alpaca — ${err.message}`);
    process.exit(1);
  }

  await cycle();

  if (!DRY_RUN) {
    setInterval(cycle, CFG.CYCLE_MS);
    log(`Trader9 v2 running. Cycle every ${CFG.CYCLE_MS / 1000}s.`);
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
