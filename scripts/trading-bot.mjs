/**
 * 9 Enterprises — Trading Bot v0.2
 *
 * Paper trading bot using Alpaca Markets API.
 * Supports crypto (BTC/USD, ETH/USD, etc.) with 24/7 trading.
 * Multiple strategies: EMA momentum, Bollinger mean reversion, news sentiment.
 * Reports P&L to 9 via comms hub.
 *
 * SAFETY: Paper trading only. No real money without Owner approval.
 *
 * Setup:
 *   1. Create free Alpaca account at alpaca.markets
 *   2. Get paper trading API keys
 *   3. Set ALPACA_API_KEY and ALPACA_SECRET_KEY in .env
 *   4. Run: node scripts/trading-bot.mjs [--strategy=ema|bollinger|sentiment] [--symbol=BTC/USD]
 *
 * Strategies:
 *   ema        — EMA 9/21 momentum crossover (default)
 *   bollinger  — Bollinger Band mean reversion
 *   sentiment  — News sentiment micro-spike (manual trigger via TRIGGER_SENTIMENT=1)
 */

import fs from 'node:fs';
import { URL } from 'node:url';

// ─── Load .env ───────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────
const API_KEY    = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const BASE_URL   = 'https://paper-api.alpaca.markets';
const DATA_URL   = 'https://data.alpaca.markets';
const HUB_URL    = 'http://localhost:3457';

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
    .map(([k, v]) => [k, v ?? 'true'])
);

// Active strategy and symbol — override with CLI flags
const STRATEGY = args.strategy || 'ema';            // ema | bollinger | sentiment
const SYMBOL   = (args.symbol  || 'BTC/USD').toUpperCase(); // BTC/USD | ETH/USD | DOGE/USD

// Risk management constants (from docs/trader9-strategy.md)
const ACCOUNT_BUDGET       = 200;          // Starting capital
const POSITION_PCT_EMA     = 0.15;         // 15% per EMA trade
const POSITION_PCT_BB      = 0.20;         // 20% per Bollinger trade
const POSITION_PCT_SENT    = 0.25;         // 25% per sentiment trade
const STOP_LOSS_PCT_EMA    = 0.015;        // 1.5% stop loss
const STOP_LOSS_PCT_BB     = 0.020;        // 2.0% stop loss
const STOP_LOSS_PCT_SENT   = 0.020;        // 2.0% stop loss
const TAKE_PROFIT_PCT_EMA  = 0.025;        // 2.5% take profit
const TAKE_PROFIT_PCT_BB   = 0.015;        // 1.5% take profit (to middle band)
const TAKE_PROFIT_PCT_SENT = 0.050;        // 5.0% take profit (news spike)
const DAILY_LOSS_LIMIT_PCT = 0.05;         // 5% daily loss limit
const MAX_DAILY_TRADES     = 20;           // Trade frequency cap
const MAX_OPEN_POSITIONS   = 2;            // Simultaneous positions cap

// Cycle intervals
const CYCLE_INTERVAL_MS  = 5 * 60 * 1000;  // 5 minutes (crypto = 24/7)
const REPORT_INTERVAL_MS = 60 * 60 * 1000; // Hourly P&L report

const LOG_FILE   = '/tmp/trading-bot.log';
const STATE_FILE = new URL('../data/trading-bot-state.json', import.meta.url).pathname;

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  dailyTrades: 0,
  dailyPnL: 0,
  startEquity: null,
  lastReportDate: null,
  positions: {},          // symbol -> { entryPrice, stopLoss, takeProfit, notional }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
    }
  } catch {}
}

function saveState() {
  try {
    const dir = STATE_FILE.replace(/\/[^/]+$/, '');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] [${STRATEGY}/${SYMBOL}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ─── Alpaca API ──────────────────────────────────────────────────────────────
async function alpaca(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'APCA-API-KEY-ID': API_KEY,
      'APCA-API-SECRET-KEY': SECRET_KEY,
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function alpacaData(endpoint) {
  const url = `${DATA_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': API_KEY,
      'APCA-API-SECRET-KEY': SECRET_KEY
    }
  });
  if (!res.ok) throw new Error(`Data API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Account & Positions ─────────────────────────────────────────────────────
async function getAccount()   { return alpaca('/v2/account'); }
async function getPositions() { return alpaca('/v2/positions'); }

// ─── Crypto Market Data ──────────────────────────────────────────────────────
/**
 * Get recent bars for a crypto symbol.
 * Alpaca crypto data endpoint differs from stocks.
 * Symbol format: BTC/USD → encoded as BTC%2FUSD in URL
 */
async function getCryptoBars(symbol, timeframe = '5Min', limit = 50) {
  const encoded = encodeURIComponent(symbol);
  const endpoint = `/v2/crypto/us/bars?symbols=${encoded}&timeframe=${timeframe}&limit=${limit}`;
  const data = await alpacaData(endpoint);
  // Response: { bars: { "BTC/USD": [...] } }
  return data.bars?.[symbol] || [];
}

async function getLatestCryptoPrice(symbol) {
  const encoded = encodeURIComponent(symbol);
  const endpoint = `/v2/crypto/us/latest/bars?symbols=${encoded}`;
  const data = await alpacaData(endpoint);
  return data.bars?.[symbol]?.c || null;
}

// ─── Place Order (crypto uses notional, not qty) ──────────────────────────────
async function placeOrder(symbol, notional, side) {
  // Crypto orders use `notional` (dollar amount) instead of `qty`
  // time_in_force for crypto must be 'gtc' (good till canceled)
  const order = {
    symbol,
    notional:      String(notional.toFixed(2)),
    side,
    type:          'market',
    time_in_force: 'gtc'
  };
  log(`Placing ${side} order: $${notional.toFixed(2)} notional of ${symbol}`);
  return alpaca('/v2/orders', 'POST', order);
}

async function closePosition(symbol) {
  // Alpaca requires symbol without slash for position close endpoint
  const sym = symbol.replace('/', '');
  log(`Closing position: ${symbol}`);
  try {
    return await alpaca(`/v2/positions/${sym}`, 'DELETE');
  } catch (e) {
    log(`Close position error: ${e.message}`);
    return null;
  }
}

// ─── Indicators ──────────────────────────────────────────────────────────────
function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(-period - 1).map((p, i, a) => i > 0 ? p - a[i - 1] : 0).slice(1);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcBollingerBands(prices, period = 20, stdMult = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, p) => acc + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: sma + stdMult * std,
    middle: sma,
    lower: sma - stdMult * std
  };
}

function calcStochastic(highs, lows, closes, kPeriod = 5, dPeriod = 3) {
  if (closes.length < kPeriod + dPeriod) return null;
  const kValues = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const high = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const low  = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kValues.push(low === high ? 50 : ((closes[i] - low) / (high - low)) * 100);
  }
  const dValues = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    dValues.push(kValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod);
  }
  return {
    k: kValues[kValues.length - 1],
    d: dValues[dValues.length - 1],
    prevK: kValues[kValues.length - 2] ?? null,
    prevD: dValues[dValues.length - 2] ?? null
  };
}

function calcAvgVolume(volumes, period = 20) {
  if (volumes.length < period) return null;
  return volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── Strategy 1: EMA Momentum Scalp ──────────────────────────────────────────
async function strategyEMA(symbol) {
  const bars = await getCryptoBars(symbol, '5Min', 60);
  if (bars.length < 25) { log('Not enough data for EMA strategy'); return null; }

  const closes  = bars.map(b => b.c);
  const volumes = bars.map(b => b.v);

  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const rsi   = calcRSI(closes, 14);
  const avgVol = calcAvgVolume(volumes, 20);
  const lastVol = volumes[volumes.length - 1];
  const price = closes[closes.length - 1];

  // Also get previous EMAs to detect crossover direction
  const prevCloses = closes.slice(0, -1);
  const prevEma9   = calcEMA(prevCloses, 9);
  const prevEma21  = calcEMA(prevCloses, 21);

  log(`EMA: price=${price.toFixed(2)}, EMA9=${ema9?.toFixed(2)}, EMA21=${ema21?.toFixed(2)}, RSI=${rsi?.toFixed(1)}, vol=${lastVol?.toFixed(0)}/avg=${avgVol?.toFixed(0)}`);

  if (!ema9 || !ema21 || !rsi || !avgVol) return null;

  // BUY signal: EMA9 crosses above EMA21, RSI 45-65, volume above average
  const crossedUp   = prevEma9 <= prevEma21 && ema9 > ema21;
  const rsiInRange  = rsi >= 45 && rsi <= 65;
  const volumeSpike = lastVol > avgVol * 1.2;

  if (crossedUp && rsiInRange && volumeSpike) {
    log(`EMA BUY signal: crossover confirmed, RSI=${rsi.toFixed(1)}, volume spike`);
    return { signal: 'buy', price, stopLoss: price * (1 - STOP_LOSS_PCT_EMA), takeProfit: price * (1 + TAKE_PROFIT_PCT_EMA) };
  }

  // SELL signal: EMA9 crosses below EMA21
  const crossedDown = prevEma9 >= prevEma21 && ema9 < ema21;
  if (crossedDown) {
    log(`EMA SELL signal: bearish crossover`);
    return { signal: 'sell', price };
  }

  // RSI overbought exit
  if (rsi > 70) {
    log(`EMA SELL signal: RSI overbought (${rsi.toFixed(1)})`);
    return { signal: 'sell', price };
  }

  return { signal: 'hold', price };
}

// ─── Strategy 2: Bollinger Band Mean Reversion ───────────────────────────────
async function strategyBollinger(symbol) {
  const bars = await getCryptoBars(symbol, '15Min', 60);
  if (bars.length < 25) { log('Not enough data for Bollinger strategy'); return null; }

  const closes = bars.map(b => b.c);
  const highs  = bars.map(b => b.h);
  const lows   = bars.map(b => b.l);

  const price = closes[closes.length - 1];
  const bb    = calcBollingerBands(closes, 20, 2);
  const rsi   = calcRSI(closes, 14);
  const stoch = calcStochastic(highs, lows, closes, 5, 3);

  if (!bb || !rsi || !stoch) { log('Bollinger: insufficient indicator data'); return null; }

  log(`BB: price=${price.toFixed(2)}, lower=${bb.lower.toFixed(2)}, mid=${bb.middle.toFixed(2)}, upper=${bb.upper.toFixed(2)}, RSI=${rsi.toFixed(1)}, stoch K=${stoch.k.toFixed(1)}/D=${stoch.d.toFixed(1)}`);

  // BUY signal: price at/below lower band, RSI oversold, stochastic bullish crossover
  const atLower         = price <= bb.lower * 1.005; // within 0.5% of lower band
  const oversold        = rsi < 35;
  const stochBullCross  = stoch.prevK !== null && stoch.prevK < stoch.prevD && stoch.k > stoch.d && stoch.k < 20;

  if (atLower && oversold && stochBullCross) {
    log(`BB BUY signal: price at lower band, RSI oversold, stoch bullish cross`);
    return {
      signal: 'buy',
      price,
      stopLoss:     price * (1 - STOP_LOSS_PCT_BB),
      takeProfit:   bb.middle,            // Take partial profit at middle band
      takeProfit2:  bb.upper              // Full profit at upper band
    };
  }

  // EXIT signal: price reaches middle band (take 50%) or upper band (close all)
  const atMiddle = price >= bb.middle * 0.999;
  const atUpper  = price >= bb.upper  * 0.995;

  if (atUpper)  { log(`BB SELL signal: price at upper band — close full`); return { signal: 'sell_full', price }; }
  if (atMiddle) { log(`BB SELL signal: price at middle band — take partial`); return { signal: 'sell_partial', price }; }

  // STOP: price closes below lower band by >1% = reversion failed
  if (price < bb.lower * 0.99) {
    log(`BB STOP signal: price breached lower band — mean reversion failed`);
    return { signal: 'stop', price };
  }

  return { signal: 'hold', price };
}

// ─── Strategy 3: News Sentiment Micro-Spike ──────────────────────────────────
// Requires TRIGGER_SENTIMENT env var or manual invocation.
// In production, hook this into a news feed parser.
async function strategySentiment(symbol) {
  // Check for manual sentiment trigger via env
  const trigger = process.env.TRIGGER_SENTIMENT;
  if (!trigger) {
    log('Sentiment: no trigger active — monitoring mode');
    return { signal: 'hold', price: await getLatestCryptoPrice(symbol) };
  }

  // trigger format: "bullish" or "bearish"
  const direction = trigger.toLowerCase();
  const price = await getLatestCryptoPrice(symbol);
  if (!price) return null;

  // Confirm with 1-minute bars: RSI spike and volume
  const bars1m = await getCryptoBars(symbol, '1Min', 10);
  const closes = bars1m.map(b => b.c);
  const volumes = bars1m.map(b => b.v);
  const rsi = calcRSI(closes, 7); // fast RSI for 1-min
  const avgVol = calcAvgVolume(volumes, 5);
  const lastVol = volumes[volumes.length - 1];

  log(`Sentiment: trigger=${direction}, price=${price}, RSI7=${rsi?.toFixed(1)}, vol=${lastVol}/avg=${avgVol?.toFixed(0)}`);

  if (direction === 'bullish' && rsi && rsi > 55 && lastVol > (avgVol || 0) * 2) {
    log(`Sentiment BUY signal confirmed: bullish news + RSI spike + volume 2x`);
    // Set 10-minute hard exit timer
    setTimeout(() => {
      log('Sentiment: 10-minute timer expired — force close');
      process.env.FORCE_CLOSE_SENTIMENT = '1';
    }, 10 * 60 * 1000);
    return {
      signal: 'buy',
      price,
      stopLoss:   price * (1 - STOP_LOSS_PCT_SENT),
      takeProfit: price * (1 + TAKE_PROFIT_PCT_SENT),
    };
  }

  if (direction === 'bearish') {
    log(`Sentiment SELL signal: bearish news trigger`);
    return { signal: 'sell', price };
  }

  return { signal: 'hold', price };
}

// ─── Risk Guard ───────────────────────────────────────────────────────────────
async function checkRiskLimits(account) {
  const equity = parseFloat(account.equity);

  // Initialize start equity on first run of the day
  const today = new Date().toDateString();
  if (state.lastReportDate !== today) {
    state.startEquity = equity;
    state.dailyTrades = 0;
    state.dailyPnL = 0;
    state.lastReportDate = today;
    saveState();
  }

  const dailyPnL = equity - (state.startEquity || equity);
  const dailyLossLimit = (state.startEquity || ACCOUNT_BUDGET) * DAILY_LOSS_LIMIT_PCT;

  if (dailyPnL < -dailyLossLimit) {
    log(`RISK LIMIT: Daily loss limit hit ($${Math.abs(dailyPnL).toFixed(2)} > $${dailyLossLimit.toFixed(2)}). Halting trading.`);
    await notify(`trader9 HALTED: Daily loss limit hit. Down $${Math.abs(dailyPnL).toFixed(2)} today. Trading paused 24hrs.`);
    return false;
  }

  if (state.dailyTrades >= MAX_DAILY_TRADES) {
    log(`RISK LIMIT: Max daily trades reached (${MAX_DAILY_TRADES}). Halting until tomorrow.`);
    return false;
  }

  return true;
}

// ─── Notifications ───────────────────────────────────────────────────────────
async function notify(msg) {
  try {
    await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message: msg })
    });
  } catch {
    log('Could not send notification to hub');
  }
}

// ─── Main Trading Cycle ───────────────────────────────────────────────────────
async function runTradingCycle() {
  try {
    const account   = await getAccount();
    const positions = await getPositions();
    const equity    = parseFloat(account.equity);

    // Risk check
    const riskOk = await checkRiskLimits(account);
    if (!riskOk) return;

    // Check open position count
    const openCount = positions.length;
    const hasPosition = positions.some(p =>
      p.symbol === SYMBOL || p.symbol === SYMBOL.replace('/', '')
    );

    // Force-close for sentiment timer expiry
    if (process.env.FORCE_CLOSE_SENTIMENT === '1' && hasPosition) {
      await closePosition(SYMBOL);
      delete process.env.FORCE_CLOSE_SENTIMENT;
      state.dailyTrades++;
      saveState();
      log('Sentiment: force-closed position after 10-minute timer');
      return;
    }

    // Evaluate strategy
    let result = null;
    if (STRATEGY === 'ema')        result = await strategyEMA(SYMBOL);
    else if (STRATEGY === 'bollinger') result = await strategyBollinger(SYMBOL);
    else if (STRATEGY === 'sentiment') result = await strategySentiment(SYMBOL);

    if (!result) return;

    const { signal, price, stopLoss, takeProfit } = result;
    log(`Signal: ${signal} @ $${price?.toFixed(2)}`);

    // Execute trades
    if ((signal === 'buy') && !hasPosition && openCount < MAX_OPEN_POSITIONS) {
      const pctMap = { ema: POSITION_PCT_EMA, bollinger: POSITION_PCT_BB, sentiment: POSITION_PCT_SENT };
      const notional = equity * (pctMap[STRATEGY] || POSITION_PCT_EMA);

      if (notional < 1) { log('Notional too small to trade'); return; }

      await placeOrder(SYMBOL, notional, 'buy');

      // Track position for stop/profit management
      state.positions[SYMBOL] = { entryPrice: price, stopLoss, takeProfit, notional };
      state.dailyTrades++;
      saveState();

      await notify(`trader9 BUY: $${notional.toFixed(2)} of ${SYMBOL} @ ~$${price?.toFixed(2)} | Stop: $${stopLoss?.toFixed(2)} | Target: $${takeProfit?.toFixed(2)} | Strategy: ${STRATEGY}`);

    } else if ((signal === 'sell' || signal === 'sell_full' || signal === 'stop') && hasPosition) {
      await closePosition(SYMBOL);
      delete state.positions[SYMBOL];
      state.dailyTrades++;
      saveState();

      const reason = signal === 'stop' ? 'STOP LOSS' : 'TAKE PROFIT / EXIT SIGNAL';
      await notify(`trader9 SELL (${reason}): ${SYMBOL} closed @ ~$${price?.toFixed(2)} | Strategy: ${STRATEGY}`);

    } else if (signal === 'sell_partial' && hasPosition) {
      // Partial close: close 50% — Alpaca supports notional partial close
      const pos = positions.find(p => p.symbol === SYMBOL || p.symbol === SYMBOL.replace('/', ''));
      if (pos) {
        const halfNotional = parseFloat(pos.market_value) / 2;
        await placeOrder(SYMBOL, halfNotional, 'sell');
        state.dailyTrades++;
        saveState();
        log(`Partial close: sold $${halfNotional.toFixed(2)} of ${SYMBOL}`);
      }

    } else {
      // Check stop/take-profit against tracked position
      const tracked = state.positions[SYMBOL];
      if (tracked && price) {
        if (price <= tracked.stopLoss) {
          log(`Stop loss triggered: price ${price.toFixed(2)} <= stop ${tracked.stopLoss.toFixed(2)}`);
          await closePosition(SYMBOL);
          delete state.positions[SYMBOL];
          state.dailyTrades++;
          saveState();
          await notify(`trader9 STOP LOSS hit: ${SYMBOL} @ $${price.toFixed(2)} (entry was $${tracked.entryPrice?.toFixed(2)})`);
        } else if (price >= tracked.takeProfit) {
          log(`Take profit triggered: price ${price.toFixed(2)} >= target ${tracked.takeProfit.toFixed(2)}`);
          await closePosition(SYMBOL);
          delete state.positions[SYMBOL];
          state.dailyTrades++;
          saveState();
          await notify(`trader9 TAKE PROFIT: ${SYMBOL} @ $${price.toFixed(2)} (entry was $${tracked.entryPrice?.toFixed(2)})`);
        }
      }
    }

  } catch (e) {
    log(`Trading cycle error: ${e.message}`);
  }
}

// ─── P&L Report ───────────────────────────────────────────────────────────────
async function reportPnL() {
  try {
    const account   = await getAccount();
    const positions = await getPositions();

    const equity     = parseFloat(account.equity);
    const startEq    = state.startEquity || equity;
    const dailyPnL   = equity - startEq;
    const dailyPnLPct = startEq > 0 ? (dailyPnL / startEq * 100) : 0;

    let report = `trader9 Hourly Report\n`;
    report += `Strategy: ${STRATEGY.toUpperCase()} | Symbol: ${SYMBOL}\n`;
    report += `Equity: $${equity.toFixed(2)}\n`;
    report += `Session P&L: ${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)} (${dailyPnLPct >= 0 ? '+' : ''}${dailyPnLPct.toFixed(2)}%)\n`;
    report += `Trades today: ${state.dailyTrades}/${MAX_DAILY_TRADES}\n`;

    if (positions.length > 0) {
      report += `\nOpen Positions:\n`;
      for (const pos of positions) {
        const unrealized = parseFloat(pos.unrealized_pl);
        const tracked = state.positions[pos.symbol] || state.positions[pos.symbol.replace('/', '')] || {};
        report += `  ${pos.symbol}: $${parseFloat(pos.market_value).toFixed(2)}, P&L: ${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)}`;
        if (tracked.stopLoss)   report += ` | Stop: $${tracked.stopLoss.toFixed(2)}`;
        if (tracked.takeProfit) report += ` | Target: $${tracked.takeProfit.toFixed(2)}`;
        report += '\n';
      }
    } else {
      report += `No open positions.\n`;
    }

    report += `\n(Paper trading — no real money)`;

    await notify(report);
    log(`P&L report sent: equity=$${equity.toFixed(2)}, session=${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)}`);
  } catch (e) {
    log(`P&L report error: ${e.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY || !SECRET_KEY) {
    log('ERROR: ALPACA_API_KEY and ALPACA_SECRET_KEY required in .env');
    log('Sign up for free paper trading at https://alpaca.markets');
    process.exit(1);
  }

  loadState();

  log(`Trading bot v0.2 starting — PAPER TRADING MODE`);
  log(`Strategy: ${STRATEGY} | Symbol: ${SYMBOL} | 24/7 crypto mode`);

  // Connect and verify account
  try {
    const account = await getAccount();
    log(`Connected: account ${account.account_number}, status ${account.status}`);
    log(`Equity: $${parseFloat(account.equity).toFixed(2)}, Buying power: $${parseFloat(account.buying_power).toFixed(2)}`);

    if (!state.startEquity) {
      state.startEquity = parseFloat(account.equity);
      state.lastReportDate = new Date().toDateString();
      saveState();
    }
  } catch (e) {
    log(`Failed to connect to Alpaca: ${e.message}`);
    process.exit(1);
  }

  // Note: NO market hours check for crypto — runs 24/7
  log('Crypto mode: 24/7 trading enabled (no market hours restriction)');

  // Run first cycle immediately
  await runTradingCycle();

  // Then every 5 minutes
  setInterval(runTradingCycle, CYCLE_INTERVAL_MS);

  // Hourly P&L report
  setInterval(reportPnL, REPORT_INTERVAL_MS);

  log(`Bot running. Cycle interval: ${CYCLE_INTERVAL_MS / 60000}min | Report interval: ${REPORT_INTERVAL_MS / 60000}min`);
  log(`Risk limits: daily loss cap ${(DAILY_LOSS_LIMIT_PCT * 100).toFixed(0)}% | max ${MAX_DAILY_TRADES} trades/day`);
  log(`Stop loss: EMA ${(STOP_LOSS_PCT_EMA * 100).toFixed(1)}% | BB ${(STOP_LOSS_PCT_BB * 100).toFixed(1)}% | Sentiment ${(STOP_LOSS_PCT_SENT * 100).toFixed(1)}%`);
  log('Usage: node scripts/trading-bot.mjs --strategy=ema|bollinger|sentiment --symbol=BTC/USD');
}

main().catch(e => { log(`Fatal error: ${e.message}`); process.exit(1); });
