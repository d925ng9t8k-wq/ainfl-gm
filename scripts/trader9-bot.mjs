#!/usr/bin/env node
/**
 * Trader9 — Crypto Trading Bot for Alpaca Markets (Paper)
 *
 * Strategies (8/10 aggression):
 *   1. EMA Crossover (9/21) — momentum
 *   2. Bollinger Band Mean Reversion — 1.5 std dev (aggressive)
 *   3. Micro-Spike Momentum — price action proxy for news sentiment
 *
 * Position: 20% of portfolio per trade
 * Stop Loss: 3%
 * Cycle: 5 minutes
 * Asset: BTC/USD
 */

import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────
const PROJECT_ROOT = '/Users/jassonfishback/Projects/BengalOracle';
const ENV_PATH = join(PROJECT_ROOT, '.env');
const LOG_PATH = join(PROJECT_ROOT, 'logs/trader9.log');
const STATUS_PATH = '/tmp/trader9-status.txt';
// USE_LIVE determined after loadEnv() below
const DATA_URL = 'https://data.alpaca.markets';
const SYMBOL = 'BTC/USD';
const CYCLE_MS = 5 * 60 * 1000; // 5 minutes
const POSITION_PCT = 0.20;      // 20% of portfolio
const STOP_LOSS_PCT = 0.03;     // 3%
const TAKE_PROFIT_PCT = 0.015;  // 1.5% — take profit
const TRAIL_ACTIVATE_PCT = 0.01; // 1% — activate trailing stop (move stop to breakeven)
const TRAIL_DISTANCE_PCT = 0.015; // 1.5% — trailing stop distance below peak
const TIME_EXIT_CYCLES = 6;     // 30 minutes (6 x 5min cycles)
const TIME_EXIT_MIN_GAIN = 0.005; // 0.5% — minimum gain to keep position past time limit
const MIN_CONFIRMING_SIGNALS = 2; // require 2+ agreeing signals to enter
const EMA_FAST = 9;
const EMA_SLOW = 21;
const BB_PERIOD = 20;
const BB_STD = 1.5;             // Aggressive: 1.5 instead of 2
const SPIKE_THRESHOLD = 0.008;  // 0.8% move in 5 bars = micro-spike
const BARS_NEEDED = 25;         // ideal bars for strategies (EMA21 needs ~21)
const BARS_MIN = 8;             // absolute minimum to attempt trading

// ─── Load API Keys ────────────────────────────────────────────────────────────
function loadEnv() {
  const raw = readFileSync(ENV_PATH, 'utf-8');
  const env = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const USE_LIVE = !!env.ALPACA_LIVE_API_KEY;
const BASE_URL = USE_LIVE ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
const API_KEY = USE_LIVE ? env.ALPACA_LIVE_API_KEY : env.ALPACA_API_KEY;
const SECRET_KEY = USE_LIVE ? env.ALPACA_LIVE_SECRET_KEY : env.ALPACA_SECRET_KEY;

if (!API_KEY || !SECRET_KEY) {
  console.error('Missing ALPACA_API_KEY or ALPACA_SECRET_KEY in .env');
  process.exit(1);
}

const headers = {
  'APCA-API-KEY-ID': API_KEY,
  'APCA-API-SECRET-KEY': SECRET_KEY,
  'Content-Type': 'application/json',
};

// ─── State ────────────────────────────────────────────────────────────────────
let tradeLog = [];
let cycleCount = 0;
let startEquity = null;
let activePosition = null; // { side, qty, entryPrice, stopPrice, entryTime, cyclesHeld, peakPrice }

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  try { appendFileSync(LOG_PATH, line + '\n'); } catch { /* ignore */ }
}

function logTrade(action, details) {
  const entry = { time: new Date().toISOString(), action, ...details };
  tradeLog.push(entry);
  log(`TRADE: ${action} | ${JSON.stringify(details)}`);
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
    // Alpaca crypto positions use symbol without slash (BTCUSD not BTC/USD)
    const posSymbol = symbol.replace('/', '');
    return await api(`${BASE_URL}/v2/positions/${posSymbol}`);
  } catch (e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

async function getBars(symbol, limit = 200) {
  // Try 5Min bars first; if not enough, fall back to 1Min for more data points
  const encoded = encodeURIComponent(symbol);

  // Try 5Min first
  let url = `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=5Min&limit=${limit}`;
  let data = await api(url);
  let bars = data.bars?.[symbol] || [];

  if (bars.length >= BARS_MIN) return bars;

  // Not enough 5Min bars — try 1Min and aggregate to 5Min equivalent
  log(`Only ${bars.length} 5Min bars. Trying 1Min bars...`);
  url = `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=1Min&limit=${limit * 5}`;
  data = await api(url);
  const minBars = data.bars?.[symbol] || [];

  if (minBars.length > bars.length) {
    // Aggregate 1min bars into 5min bars
    const aggregated = [];
    for (let i = 0; i < minBars.length; i += 5) {
      const chunk = minBars.slice(i, i + 5);
      if (chunk.length < 3) break; // need at least 3 bars for reasonable aggregate
      aggregated.push({
        o: chunk[0].o,
        h: Math.max(...chunk.map(b => b.h)),
        l: Math.min(...chunk.map(b => b.l)),
        c: chunk[chunk.length - 1].c,
        v: chunk.reduce((s, b) => s + b.v, 0),
        t: chunk[0].t,
      });
    }
    log(`Aggregated ${minBars.length} 1Min bars into ${aggregated.length} 5Min bars`);
    if (aggregated.length > bars.length) return aggregated;
  }

  return bars;
}

async function getLatestTrade(symbol) {
  const encoded = encodeURIComponent(symbol);
  const url = `${DATA_URL}/v1beta3/crypto/us/latest/trades?symbols=${encoded}`;
  const data = await api(url);
  return data.trades?.[symbol] || null;
}

async function submitOrder(symbol, qty, side, type = 'market') {
  const body = {
    symbol: symbol.replace('/', ''),  // BTCUSD for orders
    qty: String(qty),
    side,
    type,
    time_in_force: 'gtc',
  };
  log(`ORDER: ${side} ${qty} ${symbol} (${type})`);
  return api(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function closePosition(symbol) {
  const posSymbol = symbol.replace('/', '');
  try {
    return await api(`${BASE_URL}/v2/positions/${posSymbol}`, { method: 'DELETE' });
  } catch (e) {
    log(`Close position failed: ${e.message}`);
    return null;
  }
}

// ─── Technical Indicators ─────────────────────────────────────────────────────
function calcEMA(data, period) {
  const k = 2 / (period + 1);
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
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    bands.upper.push(mean + stdMult * std);
    bands.middle.push(mean);
    bands.lower.push(mean - stdMult * std);
  }
  return bands;
}

// ─── Strategy Engine ──────────────────────────────────────────────────────────
function analyzeStrategies(closes) {
  const signals = [];
  const len = closes.length;
  if (len < BARS_MIN) return signals;

  // 1. EMA Crossover (9/21)
  const ema9 = calcEMA(closes, EMA_FAST);
  const ema21 = calcEMA(closes, EMA_SLOW);
  const prevFast = ema9[len - 2], currFast = ema9[len - 1];
  const prevSlow = ema21[len - 2], currSlow = ema21[len - 1];

  if (prevFast <= prevSlow && currFast > currSlow) {
    signals.push({ strategy: 'EMA_CROSS', signal: 'BUY', strength: 0.8, reason: `EMA9 crossed above EMA21 (${currFast.toFixed(0)} > ${currSlow.toFixed(0)})` });
  } else if (prevFast >= prevSlow && currFast < currSlow) {
    signals.push({ strategy: 'EMA_CROSS', signal: 'SELL', strength: 0.8, reason: `EMA9 crossed below EMA21 (${currFast.toFixed(0)} < ${currSlow.toFixed(0)})` });
  }

  // 2. Bollinger Band Mean Reversion
  const bb = calcBollingerBands(closes);
  const lastClose = closes[len - 1];
  const bbUpper = bb.upper[len - 1];
  const bbLower = bb.lower[len - 1];
  const bbMiddle = bb.middle[len - 1];

  if (bbLower !== null) {
    if (lastClose <= bbLower) {
      signals.push({ strategy: 'BB_REVERT', signal: 'BUY', strength: 0.7, reason: `Price ${lastClose.toFixed(0)} hit lower BB ${bbLower.toFixed(0)}` });
    } else if (lastClose >= bbUpper) {
      signals.push({ strategy: 'BB_REVERT', signal: 'SELL', strength: 0.7, reason: `Price ${lastClose.toFixed(0)} hit upper BB ${bbUpper.toFixed(0)}` });
    }
  }

  // 3. Micro-Spike Momentum (news sentiment proxy)
  const recentCloses = closes.slice(-5);
  const pctChange = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0];

  if (pctChange > SPIKE_THRESHOLD) {
    signals.push({ strategy: 'MICRO_SPIKE', signal: 'BUY', strength: 0.6, reason: `+${(pctChange * 100).toFixed(2)}% spike in 5 bars` });
  } else if (pctChange < -SPIKE_THRESHOLD) {
    signals.push({ strategy: 'MICRO_SPIKE', signal: 'SELL', strength: 0.6, reason: `${(pctChange * 100).toFixed(2)}% drop in 5 bars` });
  }

  return signals;
}

function resolveSignals(signals) {
  if (signals.length === 0) return null;

  // Count confirming signals per direction
  let buyCount = 0, sellCount = 0;
  let buyScore = 0, sellScore = 0;
  for (const s of signals) {
    if (s.signal === 'BUY') { buyCount++; buyScore += s.strength; }
    else if (s.signal === 'SELL') { sellCount++; sellScore += s.strength; }
  }

  // Require at least 2 confirming signals to enter (reduces false entries)
  if (buyCount >= MIN_CONFIRMING_SIGNALS && buyScore > sellScore) return 'BUY';
  if (sellCount >= MIN_CONFIRMING_SIGNALS && sellScore > buyScore) return 'SELL';

  if (buyCount < MIN_CONFIRMING_SIGNALS && buyCount > 0) {
    log(`BUY signal insufficient: ${buyCount}/${MIN_CONFIRMING_SIGNALS} confirming signals needed`);
  }
  if (sellCount < MIN_CONFIRMING_SIGNALS && sellCount > 0) {
    log(`SELL signal insufficient: ${sellCount}/${MIN_CONFIRMING_SIGNALS} confirming signals needed`);
  }

  return null;
}

// ─── Position Management ─────────────────────────────────────────────────────
async function managePosition(currentPrice) {
  if (!activePosition) return false;

  // Increment cycle counter
  activePosition.cyclesHeld = (activePosition.cyclesHeld || 0) + 1;

  const entry = activePosition.entryPrice;
  const isLong = activePosition.side === 'long';
  const gainPct = isLong
    ? (currentPrice - entry) / entry
    : (entry - currentPrice) / entry;

  // Update peak price (for trailing stop)
  if (isLong) {
    activePosition.peakPrice = Math.max(activePosition.peakPrice || entry, currentPrice);
  } else {
    activePosition.peakPrice = Math.min(activePosition.peakPrice || entry, currentPrice);
  }

  log(`Position mgmt — gain: ${(gainPct * 100).toFixed(3)}% | cycles: ${activePosition.cyclesHeld} | peak: $${activePosition.peakPrice.toFixed(2)} | stop: $${activePosition.stopPrice.toFixed(2)}`);

  // 1. TAKE PROFIT — up 1.5%, close for profit
  if (gainPct >= TAKE_PROFIT_PCT) {
    log(`TAKE PROFIT: gain ${(gainPct * 100).toFixed(2)}% >= ${TAKE_PROFIT_PCT * 100}% target`);
    await closePosition(SYMBOL);
    logTrade('TAKE_PROFIT', {
      side: isLong ? 'sell' : 'buy',
      price: currentPrice,
      entryPrice: entry,
      pnl: (gainPct * 100).toFixed(2) + '%',
      cyclesHeld: activePosition.cyclesHeld,
    });
    activePosition = null;
    return true;
  }

  // 2. TRAILING STOP — once up 1%, move stop to breakeven then trail at 1.5% below peak
  if (gainPct >= TRAIL_ACTIVATE_PCT) {
    let newStop;
    if (isLong) {
      // Trail at 1.5% below peak, but never below breakeven
      newStop = Math.max(entry, activePosition.peakPrice * (1 - TRAIL_DISTANCE_PCT));
    } else {
      newStop = Math.min(entry, activePosition.peakPrice * (1 + TRAIL_DISTANCE_PCT));
    }

    if ((isLong && newStop > activePosition.stopPrice) || (!isLong && newStop < activePosition.stopPrice)) {
      log(`TRAILING STOP: moved from $${activePosition.stopPrice.toFixed(2)} → $${newStop.toFixed(2)}`);
      activePosition.stopPrice = newStop;
    }
  }

  // 3. STOP LOSS CHECK (includes trailing stop)
  if (isLong && currentPrice <= activePosition.stopPrice) {
    const action = activePosition.stopPrice >= entry ? 'TRAILING_STOP_CLOSE' : 'STOP_LOSS_CLOSE';
    log(`${action}: Price $${currentPrice} <= stop $${activePosition.stopPrice.toFixed(2)}`);
    await closePosition(SYMBOL);
    logTrade(action, {
      side: 'sell',
      price: currentPrice,
      entryPrice: entry,
      pnl: (gainPct * 100).toFixed(2) + '%',
      cyclesHeld: activePosition.cyclesHeld,
    });
    activePosition = null;
    return true;
  }

  if (!isLong && currentPrice >= activePosition.stopPrice) {
    const action = activePosition.stopPrice <= entry ? 'TRAILING_STOP_CLOSE' : 'STOP_LOSS_CLOSE';
    log(`${action}: Price $${currentPrice} >= stop $${activePosition.stopPrice.toFixed(2)}`);
    await closePosition(SYMBOL);
    logTrade(action, {
      side: 'buy',
      price: currentPrice,
      entryPrice: entry,
      pnl: (gainPct * 100).toFixed(2) + '%',
      cyclesHeld: activePosition.cyclesHeld,
    });
    activePosition = null;
    return true;
  }

  // 4. TIME-BASED EXIT — 30 minutes (6 cycles) with < 0.5% gain
  if (activePosition.cyclesHeld >= TIME_EXIT_CYCLES && gainPct < TIME_EXIT_MIN_GAIN) {
    log(`TIME EXIT: ${activePosition.cyclesHeld} cycles with only ${(gainPct * 100).toFixed(2)}% gain (< ${TIME_EXIT_MIN_GAIN * 100}%)`);
    await closePosition(SYMBOL);
    logTrade('TIME_EXIT', {
      side: isLong ? 'sell' : 'buy',
      price: currentPrice,
      entryPrice: entry,
      pnl: (gainPct * 100).toFixed(2) + '%',
      cyclesHeld: activePosition.cyclesHeld,
    });
    activePosition = null;
    return true;
  }

  return false;
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────
async function cycle() {
  cycleCount++;
  log(`\n${'='.repeat(60)}`);
  log(`CYCLE ${cycleCount} START`);

  try {
    // Get account info
    const account = await getAccount();
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    const buyingPower = parseFloat(account.buying_power);

    if (!startEquity) startEquity = equity;

    log(`Account — Equity: $${equity.toFixed(2)} | Cash: $${cash.toFixed(2)} | Buying Power: $${buyingPower.toFixed(2)}`);

    // Get current position
    const pos = await getPosition(SYMBOL);
    if (pos) {
      const posQty = parseFloat(pos.qty);
      const posSide = parseFloat(pos.qty) > 0 ? 'long' : 'short';
      const posEntry = parseFloat(pos.avg_entry_price);
      const posUnrealizedPL = parseFloat(pos.unrealized_pl);
      log(`Position: ${posSide} ${Math.abs(posQty)} BTC @ $${posEntry.toFixed(2)} | P&L: $${posUnrealizedPL.toFixed(2)}`);

      // Sync activePosition if we have a position but lost state
      if (!activePosition) {
        activePosition = {
          side: posSide,
          qty: Math.abs(posQty),
          entryPrice: posEntry,
          stopPrice: posSide === 'long'
            ? posEntry * (1 - STOP_LOSS_PCT)
            : posEntry * (1 + STOP_LOSS_PCT),
          entryTime: Date.now(), // approximate — we lost the real time
          cyclesHeld: 0,
          peakPrice: posEntry,
        };
        log(`Synced active position from Alpaca: stop @ $${activePosition.stopPrice.toFixed(2)}`);
      }
    } else {
      if (activePosition) {
        log(`Position closed externally. Clearing active position state.`);
        activePosition = null;
      }
      log(`No open position.`);
    }

    // Get price bars
    const bars = await getBars(SYMBOL);
    if (bars.length < BARS_MIN) {
      log(`Not enough bars (${bars.length}/${BARS_MIN} minimum). Skipping.`);
      writeStatus(equity, cash);
      return;
    }
    log(`Got ${bars.length} bars for analysis.`);

    const closes = bars.map(b => b.c);
    const currentPrice = closes[closes.length - 1];
    log(`Current BTC price: $${currentPrice.toFixed(2)}`);

    // Manage position exits (take-profit, trailing stop, stop loss, time exit)
    const exited = await managePosition(currentPrice);
    if (exited) {
      writeStatus(equity, cash);
      return;
    }

    // Analyze strategies
    const signals = analyzeStrategies(closes);
    for (const s of signals) {
      log(`Signal: ${s.strategy} → ${s.signal} (strength: ${s.strength}) — ${s.reason}`);
    }

    const decision = resolveSignals(signals);
    log(`Decision: ${decision || 'HOLD'}`);

    // Execute
    if (decision === 'BUY' && !activePosition) {
      // Calculate position size: 20% of equity
      const allocAmount = equity * POSITION_PCT;
      const qty = (allocAmount / currentPrice).toFixed(6);

      if (parseFloat(qty) > 0 && allocAmount <= buyingPower) {
        const order = await submitOrder(SYMBOL, qty, 'buy');
        activePosition = {
          side: 'long',
          qty: parseFloat(qty),
          entryPrice: currentPrice,
          stopPrice: currentPrice * (1 - STOP_LOSS_PCT),
          entryTime: Date.now(),
          cyclesHeld: 0,
          peakPrice: currentPrice,
        };
        logTrade('BUY', {
          qty, price: currentPrice, alloc: allocAmount.toFixed(2),
          stopPrice: activePosition.stopPrice.toFixed(2),
          orderId: order.id,
          triggers: signals.filter(s => s.signal === 'BUY').map(s => s.strategy),
        });
      } else {
        log(`Insufficient buying power ($${buyingPower.toFixed(2)}) for $${allocAmount.toFixed(2)} allocation.`);
      }
    } else if (decision === 'SELL' && activePosition?.side === 'long') {
      // Close long position
      await closePosition(SYMBOL);
      const pnl = ((currentPrice - activePosition.entryPrice) / activePosition.entryPrice * 100);
      logTrade('SELL', {
        qty: activePosition.qty, price: currentPrice,
        entryPrice: activePosition.entryPrice,
        pnl: pnl.toFixed(2) + '%',
        triggers: signals.filter(s => s.signal === 'SELL').map(s => s.strategy),
      });
      activePosition = null;
    } else if (decision === 'SELL' && !activePosition) {
      // At 8/10 aggression, we could short. But Alpaca paper crypto doesn't support shorting easily.
      // Log the signal but don't act.
      log(`SELL signal with no position — skipping (crypto short not supported on paper).`);
    } else if (decision === 'BUY' && activePosition) {
      log(`Already in ${activePosition.side} position. Holding.`);
    }

    writeStatus(equity, cash);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    log(err.stack || '');
  }
}

// ─── Status Writer ────────────────────────────────────────────────────────────
function writeStatus(equity, cash) {
  const now = new Date().toISOString();
  const pnl = startEquity ? ((equity - startEquity) / startEquity * 100).toFixed(4) : '0.0000';
  const pnlDollar = startEquity ? (equity - startEquity).toFixed(2) : '0.00';

  const status = [
    `Trader9 Status — ${now}`,
    `${'─'.repeat(50)}`,
    `Cycles: ${cycleCount}`,
    `Start Equity: $${startEquity?.toFixed(2) || 'N/A'}`,
    `Current Equity: $${equity.toFixed(2)}`,
    `Cash: $${cash.toFixed(2)}`,
    `P&L: $${pnlDollar} (${pnl}%)`,
    `Position: ${activePosition ? `${activePosition.side} ${activePosition.qty} BTC @ $${activePosition.entryPrice.toFixed(2)} (stop: $${activePosition.stopPrice.toFixed(2)} | cycles: ${activePosition.cyclesHeld || 0}/${TIME_EXIT_CYCLES} | peak: $${(activePosition.peakPrice || activePosition.entryPrice).toFixed(2)})` : 'None'}`,
    `Trades This Session: ${tradeLog.length}`,
    `${'─'.repeat(50)}`,
    `Last 5 Trades:`,
    ...tradeLog.slice(-5).map(t => `  ${t.time} | ${t.action} | ${JSON.stringify(t)}`),
    `${'─'.repeat(50)}`,
    `Mode: PAPER TRADING`,
    `Strategy: EMA9/21 + BB(1.5σ) + MicroSpike | Aggression: 8/10`,
    `Asset: ${SYMBOL} | Cycle: 5min | Position Size: 20% | Stop: 3% | TP: 1.5% | Trail: 1%→1.5% | Time Exit: 30min`,
  ].join('\n');

  try { writeFileSync(STATUS_PATH, status + '\n'); } catch { /* ignore */ }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function main() {
  log('Trader9 starting — PAPER MODE');
  log(`Config: ${SYMBOL} | 5min cycles | 20% position | 3% stop | 1.5% TP | trail 1%→1.5% | 30min time exit | 2-signal confirm | 8/10 aggression`);
  log(`Strategies: EMA(${EMA_FAST}/${EMA_SLOW}) + BB(${BB_PERIOD}, ${BB_STD}σ) + MicroSpike(${SPIKE_THRESHOLD * 100}%)`);

  // Verify connection
  try {
    const account = await getAccount();
    log(`Connected to Alpaca Paper — Account: ${account.account_number}`);
    log(`Equity: $${parseFloat(account.equity).toFixed(2)} | Status: ${account.status}`);

    if (account.status !== 'ACTIVE') {
      log(`WARNING: Account status is ${account.status}, not ACTIVE.`);
    }

    startEquity = parseFloat(account.equity);
  } catch (err) {
    log(`FATAL: Cannot connect to Alpaca — ${err.message}`);
    process.exit(1);
  }

  // Run first cycle immediately
  await cycle();

  // Then every 5 minutes
  setInterval(cycle, CYCLE_MS);
  log(`Trader9 running. Next cycle in ${CYCLE_MS / 1000}s.`);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
