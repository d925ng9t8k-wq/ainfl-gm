/**
 * 9 Enterprises — Trading Bot v0.1
 *
 * Paper trading bot using Alpaca Markets API.
 * Starts with simple momentum strategy on SPY.
 * Reports daily P&L to 9 via comms hub.
 *
 * SAFETY: Paper trading only. No real money without Owner approval.
 *
 * Setup:
 *   1. Create free Alpaca account at alpaca.markets
 *   2. Get paper trading API keys
 *   3. Set ALPACA_API_KEY and ALPACA_SECRET_KEY in .env
 *   4. Run: node scripts/trading-bot.mjs
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
const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const BASE_URL = 'https://paper-api.alpaca.markets'; // Paper trading endpoint
const DATA_URL = 'https://data.alpaca.markets';
const HUB_URL = 'http://localhost:3457';

const SYMBOL = 'SPY'; // Start with SPY — most liquid ETF
const POSITION_SIZE = 0.1; // Use 10% of portfolio per trade
const STOP_LOSS_PCT = 0.02; // 2% stop loss
const TAKE_PROFIT_PCT = 0.03; // 3% take profit

const LOG_FILE = '/tmp/trading-bot.log';
const STATE_FILE = new URL('../data/trading-bot-state.json', import.meta.url).pathname;

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
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
  if (!res.ok) throw new Error(`Data API error ${res.status}`);
  return res.json();
}

// ─── Account Info ────────────────────────────────────────────────────────────
async function getAccount() {
  return alpaca('/v2/account');
}

async function getPositions() {
  return alpaca('/v2/positions');
}

async function getOrders(status = 'open') {
  return alpaca(`/v2/orders?status=${status}`);
}

// ─── Trading ─────────────────────────────────────────────────────────────────
async function placeOrder(symbol, qty, side, type = 'market', limitPrice = null) {
  const order = {
    symbol,
    qty: String(qty),
    side, // 'buy' or 'sell'
    type, // 'market', 'limit', 'stop', 'stop_limit'
    time_in_force: 'day'
  };
  if (limitPrice) order.limit_price = String(limitPrice);

  log(`Placing ${side} order: ${qty} ${symbol} (${type})`);
  return alpaca('/v2/orders', 'POST', order);
}

async function closePosition(symbol) {
  log(`Closing position: ${symbol}`);
  return alpaca(`/v2/positions/${symbol}`, 'DELETE');
}

// ─── Simple Momentum Strategy ────────────────────────────────────────────────
// Buy when price is above 20-period SMA, sell when below.
// This is intentionally simple — a starting point, not the final strategy.
async function getLatestBars(symbol, timeframe = '1Day', limit = 25) {
  const endpoint = `/v2/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`;
  return alpacaData(endpoint);
}

function calculateSMA(bars, period) {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  const sum = slice.reduce((acc, bar) => acc + bar.c, 0);
  return sum / period;
}

async function evaluateStrategy() {
  try {
    const barsData = await getLatestBars(SYMBOL, '1Day', 25);
    const bars = barsData.bars || [];

    if (bars.length < 20) {
      log('Not enough data for SMA calculation');
      return null;
    }

    const currentPrice = bars[bars.length - 1].c;
    const sma20 = calculateSMA(bars, 20);
    const sma5 = calculateSMA(bars, 5);

    log(`${SYMBOL}: Price=$${currentPrice.toFixed(2)}, SMA5=$${sma5.toFixed(2)}, SMA20=$${sma20.toFixed(2)}`);

    // Signal: SMA5 crosses above SMA20 = buy, below = sell
    if (sma5 > sma20) return 'buy';
    if (sma5 < sma20) return 'sell';
    return 'hold';
  } catch (e) {
    log(`Strategy evaluation error: ${e.message}`);
    return null;
  }
}

// ─── Trading Loop ────────────────────────────────────────────────────────────
async function runTradingCycle() {
  try {
    // Check if market is open
    const clock = await alpaca('/v2/clock');
    if (!clock.is_open) {
      log('Market is closed. Skipping cycle.');
      return;
    }

    const account = await getAccount();
    const positions = await getPositions();
    const signal = await evaluateStrategy();

    if (!signal) return;

    const hasPosition = positions.some(p => p.symbol === SYMBOL);
    const buyingPower = parseFloat(account.buying_power);
    const equity = parseFloat(account.equity);

    log(`Account: Equity=$${equity.toFixed(2)}, Buying Power=$${buyingPower.toFixed(2)}, Signal=${signal}`);

    if (signal === 'buy' && !hasPosition) {
      // Calculate position size
      const barsData = await getLatestBars(SYMBOL, '1Day', 1);
      const price = barsData.bars?.[0]?.c;
      if (!price) return;

      const positionValue = equity * POSITION_SIZE;
      const qty = Math.floor(positionValue / price);

      if (qty > 0 && buyingPower >= qty * price) {
        await placeOrder(SYMBOL, qty, 'buy');
        log(`BUY signal executed: ${qty} shares of ${SYMBOL} at ~$${price.toFixed(2)}`);
      }
    } else if (signal === 'sell' && hasPosition) {
      await closePosition(SYMBOL);
      log(`SELL signal executed: closed ${SYMBOL} position`);
    } else {
      log(`HOLD — Signal=${signal}, Position=${hasPosition ? 'YES' : 'NO'}`);
    }
  } catch (e) {
    log(`Trading cycle error: ${e.message}`);
  }
}

// ─── Daily P&L Report ────────────────────────────────────────────────────────
async function reportDailyPnL() {
  try {
    const account = await getAccount();
    const positions = await getPositions();

    const equity = parseFloat(account.equity);
    const dailyPnL = parseFloat(account.equity) - parseFloat(account.last_equity);
    const dailyPnLPct = (dailyPnL / parseFloat(account.last_equity) * 100);

    let report = `📊 Trading Bot Daily Report\n`;
    report += `Equity: $${equity.toFixed(2)}\n`;
    report += `Daily P&L: ${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)} (${dailyPnLPct >= 0 ? '+' : ''}${dailyPnLPct.toFixed(2)}%)\n`;

    if (positions.length > 0) {
      report += `\nOpen Positions:\n`;
      for (const pos of positions) {
        const unrealized = parseFloat(pos.unrealized_pl);
        report += `  ${pos.symbol}: ${pos.qty} shares, ${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)}\n`;
      }
    } else {
      report += `No open positions.\n`;
    }

    report += `\n(Paper trading — no real money)`;

    // Send to hub for Telegram relay
    try {
      await fetch(`${HUB_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'telegram', message: report })
      });
    } catch {
      log('Could not send daily report to hub');
    }

    log(`Daily report sent: Equity=$${equity.toFixed(2)}, P&L=${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)}`);
  } catch (e) {
    log(`Daily report error: ${e.message}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY || !SECRET_KEY) {
    log('ERROR: ALPACA_API_KEY and ALPACA_SECRET_KEY required in .env');
    log('Sign up for free paper trading at https://alpaca.markets');
    process.exit(1);
  }

  log('Trading bot starting (PAPER TRADING MODE)');

  try {
    const account = await getAccount();
    log(`Connected to Alpaca: ${account.account_number}`);
    log(`Account status: ${account.status}`);
    log(`Equity: $${parseFloat(account.equity).toFixed(2)}`);
    log(`Buying power: $${parseFloat(account.buying_power).toFixed(2)}`);
  } catch (e) {
    log(`Failed to connect to Alpaca: ${e.message}`);
    process.exit(1);
  }

  // Run trading cycle every 5 minutes during market hours
  setInterval(runTradingCycle, 5 * 60 * 1000);

  // Run initial cycle
  await runTradingCycle();

  // Daily report at 4:30 PM ET (after market close)
  const now = new Date();
  const reportTime = new Date();
  reportTime.setHours(20, 30, 0, 0); // 4:30 PM ET = 20:30 UTC
  if (reportTime < now) reportTime.setDate(reportTime.getDate() + 1);

  const msUntilReport = reportTime - now;
  setTimeout(() => {
    reportDailyPnL();
    // Then repeat daily
    setInterval(reportDailyPnL, 24 * 60 * 60 * 1000);
  }, msUntilReport);

  log(`Trading bot running. Next report in ${Math.round(msUntilReport / 60000)} minutes.`);
  log('Strategy: SMA5/SMA20 crossover on SPY');
  log('Position size: 10% of portfolio');
  log('Stop loss: 2% | Take profit: 3%');
}

main().catch(e => { log(`Fatal error: ${e.message}`); process.exit(1); });
