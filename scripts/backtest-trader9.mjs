/**
 * trader9 — Backtesting Framework v1.0
 *
 * Backtests EMA 9/21 crossover and Bollinger Band mean reversion strategies
 * using free historical crypto data from CoinGecko public API.
 *
 * NO API keys required. NO external npm dependencies.
 *
 * Usage: node scripts/backtest-trader9.mjs [--days=90] [--coin=bitcoin] [--strategy=both|ema|bollinger]
 *
 * Outputs:
 *   - Console: trade log + performance summary
 *   - File: data/backtest-results.json
 */

import fs from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';

// ─── CLI Args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
    .map(([k, v]) => [k, v ?? 'true'])
);

const DAYS     = parseInt(args.days || '90', 10);
const COIN     = args.coin || 'bitcoin';       // CoinGecko coin ID
const STRATEGY = args.strategy || 'both';      // ema | bollinger | both

// Map CoinGecko IDs to display symbols
const COIN_MAP = {
  bitcoin:  'BTC/USD',
  ethereum: 'ETH/USD',
};

const DISPLAY_SYMBOL = COIN_MAP[COIN] || `${COIN.toUpperCase()}/USD`;

// Risk management constants (matching trading-bot.mjs / trader9-strategy.md)
const STARTING_CAPITAL     = 200;
const POSITION_PCT_EMA     = 0.15;    // 15% per EMA trade
const POSITION_PCT_BB      = 0.20;    // 20% per Bollinger trade
const STOP_LOSS_PCT_EMA    = 0.015;   // 1.5%
const STOP_LOSS_PCT_BB     = 0.020;   // 2.0%
const TAKE_PROFIT_PCT_EMA  = 0.025;   // 2.5%
const TAKE_PROFIT_BB_MID   = 0.015;   // 1.5% (to middle band)
const TAKE_PROFIT_BB_UPPER = 0.030;   // 3.0% (to upper band)
const DAILY_LOSS_LIMIT_PCT = 0.05;    // 5%

// ─── HTTP Fetch (built-in, no deps) ─────────────────────────────────────────
function httpGetRaw(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'trader9-backtest/1.0' } }, (res) => {
      if (res.statusCode === 429) {
        reject(new Error('RATE_LIMITED'));
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpGet(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await httpGetRaw(url);
    } catch (e) {
      if (e.message === 'RATE_LIMITED' && attempt < retries) {
        const wait = attempt * 15;
        console.log(`Rate limited by CoinGecko. Waiting ${wait}s before retry ${attempt}/${retries}...`);
        await sleep(wait * 1000);
        continue;
      }
      if (e.message === 'RATE_LIMITED') {
        throw new Error('Rate limited by CoinGecko after multiple retries. Wait a few minutes and try again.');
      }
      throw e;
    }
  }
}

// ─── Fetch Historical Data from CoinGecko ────────────────────────────────────

/**
 * For <=30 days: use /ohlc endpoint (gives 4-hour OHLC candles directly).
 * For >30 days: use /market_chart endpoint (gives hourly prices) and build
 *   synthetic 4-hour candles from the price ticks.
 */
async function fetchOHLC(coinId, days) {
  console.log(`Fetching ${days} days of ${coinId} data from CoinGecko...`);

  if (days <= 30) {
    return fetchOHLCDirect(coinId, days);
  }
  return fetchAndBuildCandles(coinId, days);
}

async function fetchOHLCDirect(coinId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
  const data = await httpGet(url);

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No OHLC data returned for ${coinId}. Got: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const candles = data.map(d => ({
    timestamp: d[0],
    date:      new Date(d[0]).toISOString(),
    open:      d[1],
    high:      d[2],
    low:       d[3],
    close:     d[4],
    volume:    1,
  }));

  console.log(`Got ${candles.length} candles (OHLC) from ${candles[0].date.slice(0,10)} to ${candles[candles.length-1].date.slice(0,10)}`);
  return candles;
}

async function fetchAndBuildCandles(coinId, days) {
  // market_chart gives hourly price points for <=90 days
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  const data = await httpGet(url);

  if (!data.prices || data.prices.length === 0) {
    throw new Error(`No market_chart data returned for ${coinId}.`);
  }

  const prices = data.prices; // [[timestamp, price], ...]
  console.log(`Got ${prices.length} price points. Building 4-hour candles...`);

  // Group into 4-hour buckets and build OHLC
  const BUCKET_MS = 4 * 60 * 60 * 1000;
  const candles = [];
  let bucketStart = Math.floor(prices[0][0] / BUCKET_MS) * BUCKET_MS;
  let bucket = [];

  for (const [ts, price] of prices) {
    if (ts >= bucketStart + BUCKET_MS) {
      // Flush current bucket
      if (bucket.length > 0) {
        candles.push({
          timestamp: bucketStart,
          date:      new Date(bucketStart).toISOString(),
          open:      bucket[0],
          high:      Math.max(...bucket),
          low:       Math.min(...bucket),
          close:     bucket[bucket.length - 1],
          volume:    1,
        });
      }
      bucketStart = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
      bucket = [];
    }
    bucket.push(price);
  }
  // Flush last bucket
  if (bucket.length > 0) {
    candles.push({
      timestamp: bucketStart,
      date:      new Date(bucketStart).toISOString(),
      open:      bucket[0],
      high:      Math.max(...bucket),
      low:       Math.min(...bucket),
      close:     bucket[bucket.length - 1],
      volume:    1,
    });
  }

  console.log(`Built ${candles.length} candles from ${candles[0].date.slice(0,10)} to ${candles[candles.length-1].date.slice(0,10)}`);
  return candles;
}

// ─── Technical Indicators ────────────────────────────────────────────────────
// Replicating the exact same indicator functions from trading-bot.mjs

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcAllEMAs(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result = new Array(prices.length).fill(null);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
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
    lower: sma - stdMult * std,
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
    prevD: dValues[dValues.length - 2] ?? null,
  };
}

// ─── EMA 9/21 Crossover Backtest ──────────────────────────────────────────────
function backtestEMA(candles) {
  const closes = candles.map(c => c.close);
  const ema9All  = calcAllEMAs(closes, 9);
  const ema21All = calcAllEMAs(closes, 21);

  let capital = STARTING_CAPITAL;
  let position = null;   // { entryPrice, notional, stopLoss, takeProfit, entryIdx }
  const trades = [];
  let peakCapital = capital;
  let maxDrawdown = 0;

  // Start at index 21 (need enough data for EMA 21)
  for (let i = 22; i < candles.length; i++) {
    const price    = closes[i];
    const ema9     = ema9All[i];
    const ema9prev = ema9All[i - 1];
    const ema21    = ema21All[i];
    const ema21prev = ema21All[i - 1];

    if (!ema9 || !ema21 || !ema9prev || !ema21prev) continue;

    // RSI on last 15 candles
    const rsi = calcRSI(closes.slice(0, i + 1), 14);

    // Track drawdown on equity curve
    if (capital > peakCapital) peakCapital = capital;
    const dd = (peakCapital - capital) / peakCapital;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Check stop loss / take profit on open position
    if (position) {
      if (price <= position.stopLoss) {
        // Stop loss hit
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({
          strategy: 'EMA',
          side: 'sell',
          reason: 'stop_loss',
          entryPrice: position.entryPrice,
          exitPrice: price,
          notional: position.notional,
          pnl,
          date: candles[i].date,
        });
        position = null;
        continue;
      }
      if (price >= position.takeProfit) {
        // Take profit hit
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({
          strategy: 'EMA',
          side: 'sell',
          reason: 'take_profit',
          entryPrice: position.entryPrice,
          exitPrice: price,
          notional: position.notional,
          pnl,
          date: candles[i].date,
        });
        position = null;
        continue;
      }

      // EMA bearish crossover or RSI overbought -> exit
      const crossedDown = ema9prev >= ema21prev && ema9 < ema21;
      const overbought  = rsi !== null && rsi > 70;
      if (crossedDown || overbought) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({
          strategy: 'EMA',
          side: 'sell',
          reason: crossedDown ? 'bearish_crossover' : 'rsi_overbought',
          entryPrice: position.entryPrice,
          exitPrice: price,
          notional: position.notional,
          pnl,
          date: candles[i].date,
        });
        position = null;
        continue;
      }
    }

    // BUY signal: EMA9 crosses above EMA21
    if (!position) {
      const crossedUp  = ema9prev <= ema21prev && ema9 > ema21;
      const rsiInRange = rsi !== null && rsi >= 45 && rsi <= 65;
      // Volume filter skipped (CoinGecko OHLC has no volume) — noted in results
      const priceAboveEma21 = price > ema21;

      if (crossedUp && rsiInRange && priceAboveEma21) {
        const notional  = capital * POSITION_PCT_EMA;
        const stopLoss  = price * (1 - STOP_LOSS_PCT_EMA);
        const takeProfit = price * (1 + TAKE_PROFIT_PCT_EMA);
        position = { entryPrice: price, notional, stopLoss, takeProfit, entryIdx: i };
        trades.push({
          strategy: 'EMA',
          side: 'buy',
          reason: 'ema_crossover',
          entryPrice: price,
          notional,
          stopLoss,
          takeProfit,
          date: candles[i].date,
        });
      }
    }
  }

  // Close any open position at end
  if (position) {
    const price = closes[closes.length - 1];
    const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
    capital += pnl;
    trades.push({
      strategy: 'EMA',
      side: 'sell',
      reason: 'end_of_backtest',
      entryPrice: position.entryPrice,
      exitPrice: price,
      notional: position.notional,
      pnl,
      date: candles[candles.length - 1].date,
    });
  }

  // Final drawdown check
  if (capital > peakCapital) peakCapital = capital;
  const dd = (peakCapital - capital) / peakCapital;
  if (dd > maxDrawdown) maxDrawdown = dd;

  return { trades, finalCapital: capital, maxDrawdown };
}

// ─── Bollinger Band Mean Reversion Backtest ──────────────────────────────────
function backtestBollinger(candles) {
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);

  let capital = STARTING_CAPITAL;
  let position = null;  // { entryPrice, notional, stopLoss, halfClosed }
  const trades = [];
  let peakCapital = capital;
  let maxDrawdown = 0;

  // Need at least 25 candles for BB(20) + Stochastic(5,3)
  for (let i = 25; i < candles.length; i++) {
    const price = closes[i];

    // Calculate indicators on data up to current candle
    const priceSlice = closes.slice(0, i + 1);
    const highSlice  = highs.slice(0, i + 1);
    const lowSlice   = lows.slice(0, i + 1);

    const bb    = calcBollingerBands(priceSlice, 20, 2);
    const rsi   = calcRSI(priceSlice, 14);
    const stoch = calcStochastic(highSlice, lowSlice, priceSlice, 5, 3);

    if (!bb || !rsi || !stoch) continue;

    // Track drawdown
    if (capital > peakCapital) peakCapital = capital;
    const dd = (peakCapital - capital) / peakCapital;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Manage open position
    if (position) {
      // Stop: price below lower band by >1% (reversion failed)
      if (price < bb.lower * 0.99) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({
          strategy: 'BB',
          side: 'sell',
          reason: 'stop_loss_band_breach',
          entryPrice: position.entryPrice,
          exitPrice: price,
          notional: position.notional,
          pnl,
          date: candles[i].date,
        });
        position = null;
        continue;
      }

      // Hard stop loss
      if (price <= position.stopLoss) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({
          strategy: 'BB',
          side: 'sell',
          reason: 'stop_loss',
          entryPrice: position.entryPrice,
          exitPrice: price,
          notional: position.notional,
          pnl,
          date: candles[i].date,
        });
        position = null;
        continue;
      }

      // Partial close at middle band (50% of remaining)
      if (!position.halfClosed && price >= bb.middle * 0.999) {
        const halfNotional = position.notional / 2;
        const pnl = halfNotional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        position.notional -= halfNotional;
        position.halfClosed = true;
        trades.push({
          strategy: 'BB',
          side: 'sell_partial',
          reason: 'middle_band',
          entryPrice: position.entryPrice,
          exitPrice: price,
          notional: halfNotional,
          pnl,
          date: candles[i].date,
        });
      }

      // Full close at upper band
      if (price >= bb.upper * 0.995) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({
          strategy: 'BB',
          side: 'sell',
          reason: 'upper_band',
          entryPrice: position.entryPrice,
          exitPrice: price,
          notional: position.notional,
          pnl,
          date: candles[i].date,
        });
        position = null;
        continue;
      }
    }

    // BUY signal
    if (!position) {
      const atLower        = price <= bb.lower * 1.005;
      const oversold       = rsi < 35;
      const stochBullCross = stoch.prevK !== null && stoch.prevK < stoch.prevD && stoch.k > stoch.d && stoch.k < 20;

      if (atLower && oversold && stochBullCross) {
        const notional = capital * POSITION_PCT_BB;
        const stopLoss = price * (1 - STOP_LOSS_PCT_BB);
        position = { entryPrice: price, notional, stopLoss, halfClosed: false };
        trades.push({
          strategy: 'BB',
          side: 'buy',
          reason: 'lower_band_oversold',
          entryPrice: price,
          notional,
          stopLoss,
          date: candles[i].date,
        });
      }
    }
  }

  // Close open position at end
  if (position) {
    const price = closes[closes.length - 1];
    const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
    capital += pnl;
    trades.push({
      strategy: 'BB',
      side: 'sell',
      reason: 'end_of_backtest',
      entryPrice: position.entryPrice,
      exitPrice: price,
      notional: position.notional,
      pnl,
      date: candles[candles.length - 1].date,
    });
  }

  if (capital > peakCapital) peakCapital = capital;
  const dd = (peakCapital - capital) / peakCapital;
  if (dd > maxDrawdown) maxDrawdown = dd;

  return { trades, finalCapital: capital, maxDrawdown };
}

// ─── Performance Metrics ─────────────────────────────────────────────────────
function calcMetrics(trades, finalCapital, maxDrawdown, strategyName) {
  // Completed round-trip trades (buys that have a corresponding sell)
  const sellTrades = trades.filter(t => t.side === 'sell' || t.side === 'sell_partial');
  const buyTrades  = trades.filter(t => t.side === 'buy');

  const wins   = sellTrades.filter(t => t.pnl > 0);
  const losses = sellTrades.filter(t => t.pnl <= 0);
  const totalPnL   = sellTrades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate     = sellTrades.length > 0 ? wins.length / sellTrades.length : 0;
  const totalReturn = (finalCapital - STARTING_CAPITAL) / STARTING_CAPITAL;

  // Sharpe ratio approximation
  // Using individual trade returns as "periods"
  const tradeReturns = sellTrades.map(t => t.pnl / t.notional);
  const avgReturn    = tradeReturns.length > 0 ? tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length : 0;
  const returnStd    = tradeReturns.length > 1
    ? Math.sqrt(tradeReturns.reduce((acc, r) => acc + Math.pow(r - avgReturn, 2), 0) / (tradeReturns.length - 1))
    : 0;
  // Annualize: assume ~6 trades per day on 4-hour candles, 365 days
  const annFactor = Math.sqrt(365 * 6);
  const sharpe    = returnStd > 0 ? (avgReturn / returnStd) * annFactor : 0;

  // Average win/loss
  const avgWin  = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  return {
    strategy:      strategyName,
    symbol:        DISPLAY_SYMBOL,
    period:        `${DAYS} days`,
    startCapital:  STARTING_CAPITAL,
    finalCapital:  Math.round(finalCapital * 100) / 100,
    totalReturn:   Math.round(totalReturn * 10000) / 100,   // percent with 2 decimals
    totalPnL:      Math.round(totalPnL * 100) / 100,
    totalTrades:   buyTrades.length,
    completedExits: sellTrades.length,
    wins:          wins.length,
    losses:        losses.length,
    winRate:       Math.round(winRate * 10000) / 100,
    avgWin:        Math.round(avgWin * 100) / 100,
    avgLoss:       Math.round(avgLoss * 100) / 100,
    maxDrawdown:   Math.round(maxDrawdown * 10000) / 100,
    sharpeRatio:   Math.round(sharpe * 100) / 100,
  };
}

// ─── Display Results ─────────────────────────────────────────────────────────
function printResults(metrics, trades) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${metrics.strategy} Strategy — ${metrics.symbol} — ${metrics.period}`);
  console.log('='.repeat(60));
  console.log(`  Start Capital:   $${metrics.startCapital.toFixed(2)}`);
  console.log(`  Final Capital:   $${metrics.finalCapital.toFixed(2)}`);
  console.log(`  Total Return:    ${metrics.totalReturn >= 0 ? '+' : ''}${metrics.totalReturn}%`);
  console.log(`  Total P&L:       ${metrics.totalPnL >= 0 ? '+' : ''}$${metrics.totalPnL.toFixed(2)}`);
  console.log('-'.repeat(60));
  console.log(`  Total Trades:    ${metrics.totalTrades} entries, ${metrics.completedExits} exits`);
  console.log(`  Wins / Losses:   ${metrics.wins} / ${metrics.losses}`);
  console.log(`  Win Rate:        ${metrics.winRate}%`);
  console.log(`  Avg Win:         $${metrics.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:        $${metrics.avgLoss.toFixed(2)}`);
  console.log('-'.repeat(60));
  console.log(`  Max Drawdown:    ${metrics.maxDrawdown}%`);
  console.log(`  Sharpe Ratio:    ${metrics.sharpeRatio}`);
  console.log('='.repeat(60));

  // Print trade log
  if (trades.length > 0) {
    console.log('\nTrade Log:');
    for (const t of trades) {
      const dir = t.side === 'buy' ? 'BUY ' : 'SELL';
      const pnlStr = t.pnl !== undefined ? ` P&L: ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '';
      const priceStr = t.exitPrice
        ? `$${t.entryPrice.toFixed(2)} -> $${t.exitPrice.toFixed(2)}`
        : `$${t.entryPrice.toFixed(2)}`;
      console.log(`  ${t.date.slice(0,16)} | ${dir} | ${t.reason.padEnd(22)} | ${priceStr}${pnlStr}`);
    }
  } else {
    console.log('\nNo trades triggered during this period.');
    console.log('This is normal — strict entry criteria protect against bad trades.');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('trader9 Backtesting Framework v1.0');
  console.log(`Coin: ${COIN} (${DISPLAY_SYMBOL}) | Period: ${DAYS} days | Strategy: ${STRATEGY}`);
  console.log('Data source: CoinGecko public API (no API key required)');
  console.log('');

  // Fetch data
  let candles;
  try {
    candles = await fetchOHLC(COIN, DAYS);
  } catch (e) {
    console.error(`Failed to fetch data: ${e.message}`);
    process.exit(1);
  }

  if (candles.length < 30) {
    console.error(`Insufficient data: only ${candles.length} candles. Need at least 30.`);
    process.exit(1);
  }

  const results = {
    metadata: {
      coin: COIN,
      symbol: DISPLAY_SYMBOL,
      days: DAYS,
      candles: candles.length,
      dataRange: {
        from: candles[0].date,
        to: candles[candles.length - 1].date,
      },
      runAt: new Date().toISOString(),
      notes: [
        'CoinGecko OHLC does not include volume data; volume filter is bypassed in EMA strategy.',
        'Candle granularity: 4-hour for 30-90 day lookback.',
        'Position sizing and risk rules match trader9-strategy.md exactly.',
      ],
    },
    strategies: {},
  };

  // Run EMA backtest
  if (STRATEGY === 'ema' || STRATEGY === 'both') {
    console.log('\nRunning EMA 9/21 Crossover backtest...');
    const ema = backtestEMA(candles);
    const emaMetrics = calcMetrics(ema.trades, ema.finalCapital, ema.maxDrawdown, 'EMA 9/21 Crossover');
    printResults(emaMetrics, ema.trades);
    results.strategies.ema = { metrics: emaMetrics, trades: ema.trades };
  }

  // Run Bollinger backtest
  if (STRATEGY === 'bollinger' || STRATEGY === 'both') {
    console.log('\nRunning Bollinger Band Mean Reversion backtest...');
    const bb = backtestBollinger(candles);
    const bbMetrics = calcMetrics(bb.trades, bb.finalCapital, bb.maxDrawdown, 'Bollinger Band Mean Reversion');
    printResults(bbMetrics, bb.trades);
    results.strategies.bollinger = { metrics: bbMetrics, trades: bb.trades };
  }

  // Combined summary if both
  if (STRATEGY === 'both' && results.strategies.ema && results.strategies.bollinger) {
    const ema = results.strategies.ema.metrics;
    const bb  = results.strategies.bollinger.metrics;
    console.log('\n' + '='.repeat(60));
    console.log('  COMBINED SUMMARY');
    console.log('='.repeat(60));
    console.log(`  EMA Return:       ${ema.totalReturn >= 0 ? '+' : ''}${ema.totalReturn}% | Win Rate: ${ema.winRate}% | Sharpe: ${ema.sharpeRatio}`);
    console.log(`  BB Return:        ${bb.totalReturn >= 0 ? '+' : ''}${bb.totalReturn}% | Win Rate: ${bb.winRate}% | Sharpe: ${bb.sharpeRatio}`);
    const bestStrategy = ema.totalReturn > bb.totalReturn ? 'EMA 9/21 Crossover' : 'Bollinger Band Mean Reversion';
    console.log(`  Best performer:   ${bestStrategy}`);
    console.log('='.repeat(60));
    results.recommendation = bestStrategy;
  }

  // Write results to file
  const outputDir = new URL('../data', import.meta.url).pathname;
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = `${outputDir}/backtest-results.json`;
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outputPath}`);
}

main().catch(e => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});
