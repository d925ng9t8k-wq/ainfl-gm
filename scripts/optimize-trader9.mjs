/**
 * trader9 — Parameter Optimization Sweep v1.0
 *
 * Sweeps EMA crossover and Bollinger Band parameters across BTC/USD and ETH/USD
 * to find optimal settings. Uses CoinGecko free public API (no keys needed).
 *
 * Improvements over baseline backtest:
 *   - Multiple EMA period combos (5/20, 8/21, 9/21, 12/26, 12/50)
 *   - Multiple Bollinger params (period 15-25, stddev 1.5-2.5)
 *   - Trend filter: 50-period EMA as long-term direction gate
 *   - Multi-asset: BTC/USD + ETH/USD
 *   - Wider stop/TP ranges tested
 *
 * Usage: node scripts/optimize-trader9.mjs
 *
 * Outputs:
 *   - Console: ranked parameter sets
 *   - File: data/optimized-backtest-results.json
 */

import fs from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────
function httpGetRaw(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'trader9-optimize/1.0' } }, (res) => {
      if (res.statusCode === 429) { reject(new Error('RATE_LIMITED')); res.resume(); return; }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpGet(url, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await httpGetRaw(url);
    } catch (e) {
      if (e.message === 'RATE_LIMITED' && attempt < retries) {
        const wait = attempt * 20;
        console.log(`  Rate limited. Waiting ${wait}s (attempt ${attempt}/${retries})...`);
        await sleep(wait * 1000);
        continue;
      }
      if (e.message === 'RATE_LIMITED') {
        throw new Error('CoinGecko rate limited after retries. Wait a few minutes.');
      }
      throw e;
    }
  }
}

// ─── Fetch Data ───────────────────────────────────────────────────────────────
async function fetchCandles(coinId, days) {
  console.log(`Fetching ${days}d ${coinId} data...`);
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  const data = await httpGet(url);

  if (!data.prices || data.prices.length === 0) {
    throw new Error(`No data for ${coinId}`);
  }

  const prices = data.prices;
  const BUCKET_MS = 4 * 60 * 60 * 1000;
  const candles = [];
  let bucketStart = Math.floor(prices[0][0] / BUCKET_MS) * BUCKET_MS;
  let bucket = [];

  for (const [ts, price] of prices) {
    if (ts >= bucketStart + BUCKET_MS) {
      if (bucket.length > 0) {
        candles.push({
          timestamp: bucketStart,
          date: new Date(bucketStart).toISOString(),
          open: bucket[0],
          high: Math.max(...bucket),
          low: Math.min(...bucket),
          close: bucket[bucket.length - 1],
        });
      }
      bucketStart = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
      bucket = [];
    }
    bucket.push(price);
  }
  if (bucket.length > 0) {
    candles.push({
      timestamp: bucketStart,
      date: new Date(bucketStart).toISOString(),
      open: bucket[0],
      high: Math.max(...bucket),
      low: Math.min(...bucket),
      close: bucket[bucket.length - 1],
    });
  }

  console.log(`  ${candles.length} candles: ${candles[0].date.slice(0,10)} to ${candles[candles.length-1].date.slice(0,10)}`);
  return candles;
}

// ─── Technical Indicators ─────────────────────────────────────────────────────
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
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcBollingerBands(prices, period = 20, stdMult = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, p) => acc + Math.pow(p - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: sma + stdMult * std, middle: sma, lower: sma - stdMult * std };
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

// ─── Parameterized EMA Backtest ───────────────────────────────────────────────
function backtestEMA(candles, params) {
  const {
    fastPeriod = 9,
    slowPeriod = 21,
    trendPeriod = 50,       // long-term trend filter (0 = disabled)
    stopLossPct = 0.015,
    takeProfitPct = 0.025,
    positionPct = 0.15,
    rsiLow = 45,
    rsiHigh = 65,
    useTrendFilter = false,
  } = params;

  const STARTING_CAPITAL = 200;
  const closes = candles.map(c => c.close);
  const emaFastAll = calcAllEMAs(closes, fastPeriod);
  const emaSlowAll = calcAllEMAs(closes, slowPeriod);
  const emaTrendAll = useTrendFilter ? calcAllEMAs(closes, trendPeriod) : null;

  let capital = STARTING_CAPITAL;
  let position = null;
  const trades = [];
  let peakCapital = capital;
  let maxDrawdown = 0;

  const startIdx = Math.max(slowPeriod + 1, useTrendFilter ? trendPeriod + 1 : 0);

  for (let i = startIdx; i < candles.length; i++) {
    const price     = closes[i];
    const emaFast   = emaFastAll[i];
    const emaPrev   = emaFastAll[i - 1];
    const emaSlow   = emaSlowAll[i];
    const eSlowPrev = emaSlowAll[i - 1];

    if (!emaFast || !emaSlow || !emaPrev || !eSlowPrev) continue;

    // Trend filter: only go long if price is above long-term EMA
    const trendOk = !useTrendFilter || (emaTrendAll && emaTrendAll[i] && price > emaTrendAll[i]);

    const rsi = calcRSI(closes.slice(0, i + 1), 14);

    if (capital > peakCapital) peakCapital = capital;
    const dd = (peakCapital - capital) / peakCapital;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (position) {
      if (price <= position.stopLoss) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({ side: 'sell', reason: 'stop_loss', pnl, notional: position.notional });
        position = null;
        continue;
      }
      if (price >= position.takeProfit) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({ side: 'sell', reason: 'take_profit', pnl, notional: position.notional });
        position = null;
        continue;
      }
      const crossedDown = emaPrev >= eSlowPrev && emaFast < emaSlow;
      const overbought  = rsi !== null && rsi > 70;
      if (crossedDown || overbought) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({ side: 'sell', reason: crossedDown ? 'bearish_cross' : 'rsi_overbought', pnl, notional: position.notional });
        position = null;
        continue;
      }
    }

    if (!position) {
      const crossedUp   = emaPrev <= eSlowPrev && emaFast > emaSlow;
      const rsiInRange  = rsi !== null && rsi >= rsiLow && rsi <= rsiHigh;
      const priceAbove  = price > emaSlow;

      if (crossedUp && rsiInRange && priceAbove && trendOk) {
        const notional   = capital * positionPct;
        const stopLoss   = price * (1 - stopLossPct);
        const takeProfit = price * (1 + takeProfitPct);
        position = { entryPrice: price, notional, stopLoss, takeProfit };
        trades.push({ side: 'buy', notional });
      }
    }
  }

  // Close open at end
  if (position) {
    const price = closes[closes.length - 1];
    const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
    capital += pnl;
    trades.push({ side: 'sell', reason: 'end', pnl, notional: position.notional });
  }

  if (capital > peakCapital) peakCapital = capital;
  const dd = (peakCapital - capital) / peakCapital;
  if (dd > maxDrawdown) maxDrawdown = dd;

  return computeMetrics(trades, capital, maxDrawdown, STARTING_CAPITAL);
}

// ─── Parameterized Bollinger Backtest ─────────────────────────────────────────
function backtestBollinger(candles, params) {
  const {
    bbPeriod = 20,
    bbStdDev = 2,
    stopLossPct = 0.02,
    positionPct = 0.20,
    rsiThreshold = 35,
    stochThreshold = 20,
    useTrendFilter = false,
    trendPeriod = 50,
  } = params;

  const STARTING_CAPITAL = 200;
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const emaTrendAll = useTrendFilter ? calcAllEMAs(closes, trendPeriod) : null;

  let capital = STARTING_CAPITAL;
  let position = null;
  const trades = [];
  let peakCapital = capital;
  let maxDrawdown = 0;

  const startIdx = Math.max(bbPeriod + 5, useTrendFilter ? trendPeriod + 1 : 0);

  for (let i = startIdx; i < candles.length; i++) {
    const price = closes[i];
    const priceSlice = closes.slice(0, i + 1);
    const highSlice  = highs.slice(0, i + 1);
    const lowSlice   = lows.slice(0, i + 1);

    const bb    = calcBollingerBands(priceSlice, bbPeriod, bbStdDev);
    const rsi   = calcRSI(priceSlice, 14);
    const stoch = calcStochastic(highSlice, lowSlice, priceSlice, 5, 3);

    if (!bb || !rsi || !stoch) continue;

    // Trend filter for BB: only buy if price above trend EMA (mild filter)
    // For mean reversion in a downtrend, we relax this: allow if price is within 5% of trend EMA
    const trendEma = useTrendFilter && emaTrendAll ? emaTrendAll[i] : null;
    const trendOk = !useTrendFilter || !trendEma || price > trendEma * 0.95;

    if (capital > peakCapital) peakCapital = capital;
    const dd = (peakCapital - capital) / peakCapital;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (position) {
      if (price < bb.lower * 0.99) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({ side: 'sell', reason: 'band_breach', pnl, notional: position.notional });
        position = null;
        continue;
      }
      if (price <= position.stopLoss) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({ side: 'sell', reason: 'stop_loss', pnl, notional: position.notional });
        position = null;
        continue;
      }
      if (!position.halfClosed && price >= bb.middle * 0.999) {
        const halfNotional = position.notional / 2;
        const pnl = halfNotional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        position.notional -= halfNotional;
        position.halfClosed = true;
        trades.push({ side: 'sell_partial', reason: 'middle_band', pnl, notional: halfNotional });
      }
      if (price >= bb.upper * 0.995) {
        const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
        capital += pnl;
        trades.push({ side: 'sell', reason: 'upper_band', pnl, notional: position.notional });
        position = null;
        continue;
      }
    }

    if (!position) {
      const atLower  = price <= bb.lower * 1.005;
      const oversold = rsi < rsiThreshold;
      const stochOk  = stoch.prevK !== null && stoch.prevK < stoch.prevD && stoch.k > stoch.d && stoch.k < stochThreshold;

      if (atLower && oversold && stochOk && trendOk) {
        const notional = capital * positionPct;
        const stopLoss = price * (1 - stopLossPct);
        position = { entryPrice: price, notional, stopLoss, halfClosed: false };
        trades.push({ side: 'buy', notional });
      }
    }
  }

  if (position) {
    const price = closes[closes.length - 1];
    const pnl = position.notional * ((price - position.entryPrice) / position.entryPrice);
    capital += pnl;
    trades.push({ side: 'sell', reason: 'end', pnl, notional: position.notional });
  }

  if (capital > peakCapital) peakCapital = capital;
  const dd = (peakCapital - capital) / peakCapital;
  if (dd > maxDrawdown) maxDrawdown = dd;

  return computeMetrics(trades, capital, maxDrawdown, STARTING_CAPITAL);
}

// ─── Metrics ──────────────────────────────────────────────────────────────────
function computeMetrics(trades, finalCapital, maxDrawdown, startCapital) {
  const sellTrades = trades.filter(t => t.side === 'sell' || t.side === 'sell_partial');
  const buyTrades  = trades.filter(t => t.side === 'buy');
  const wins   = sellTrades.filter(t => t.pnl > 0);
  const losses = sellTrades.filter(t => t.pnl <= 0);
  const totalPnL   = sellTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalReturn = ((finalCapital - startCapital) / startCapital) * 100;

  const tradeReturns = sellTrades.map(t => t.pnl / t.notional);
  const avgReturn    = tradeReturns.length > 0 ? tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length : 0;
  const returnStd    = tradeReturns.length > 1
    ? Math.sqrt(tradeReturns.reduce((acc, r) => acc + Math.pow(r - avgReturn, 2), 0) / (tradeReturns.length - 1))
    : 0;
  const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(365 * 6) : 0;

  const avgWin  = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  return {
    finalCapital: Math.round(finalCapital * 100) / 100,
    totalReturn:  Math.round(totalReturn * 100) / 100,
    totalPnL:     Math.round(totalPnL * 100) / 100,
    totalTrades:  buyTrades.length,
    exits:        sellTrades.length,
    wins:         wins.length,
    losses:       losses.length,
    winRate:      sellTrades.length > 0 ? Math.round((wins.length / sellTrades.length) * 10000) / 100 : 0,
    avgWin:       Math.round(avgWin * 100) / 100,
    avgLoss:      Math.round(avgLoss * 100) / 100,
    maxDrawdown:  Math.round(maxDrawdown * 10000) / 100,
    sharpe:       Math.round(sharpe * 100) / 100,
  };
}

// ─── Parameter Sweep Definitions ──────────────────────────────────────────────
function getEMASweepParams() {
  const combos = [];
  const emaPairs = [
    [5, 20], [8, 21], [9, 21], [12, 26], [12, 50],
  ];
  const stopLosses   = [0.01, 0.015, 0.02, 0.025];
  const takeProfits  = [0.02, 0.025, 0.03, 0.04];
  const trendFilters = [false, true];

  for (const [fast, slow] of emaPairs) {
    for (const sl of stopLosses) {
      for (const tp of takeProfits) {
        if (tp <= sl) continue; // R:R must be > 1
        for (const tf of trendFilters) {
          combos.push({
            fastPeriod: fast,
            slowPeriod: slow,
            stopLossPct: sl,
            takeProfitPct: tp,
            useTrendFilter: tf,
            trendPeriod: 50,
            positionPct: 0.15,
            rsiLow: 45,
            rsiHigh: 65,
          });
        }
      }
    }
  }
  return combos;
}

function getBBSweepParams() {
  const combos = [];
  const periods   = [15, 20, 25];
  const stdDevs   = [1.5, 2.0, 2.5];
  const stopLosses = [0.015, 0.02, 0.025, 0.03];
  const rsiThresholds = [30, 35, 40];
  const trendFilters  = [false, true];

  for (const period of periods) {
    for (const std of stdDevs) {
      for (const sl of stopLosses) {
        for (const rsi of rsiThresholds) {
          for (const tf of trendFilters) {
            combos.push({
              bbPeriod: period,
              bbStdDev: std,
              stopLossPct: sl,
              rsiThreshold: rsi,
              stochThreshold: 20,
              positionPct: 0.20,
              useTrendFilter: tf,
              trendPeriod: 50,
            });
          }
        }
      }
    }
  }
  return combos;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('trader9 Parameter Optimization v1.0');
  console.log('====================================\n');

  const DAYS = 90;
  const coins = [
    { id: 'bitcoin', symbol: 'BTC/USD' },
    { id: 'ethereum', symbol: 'ETH/USD' },
  ];

  const allResults = {
    metadata: {
      runAt: new Date().toISOString(),
      days: DAYS,
      coins: coins.map(c => c.symbol),
    },
    ema: {},
    bollinger: {},
    bestOverall: {},
  };

  // Fetch data for all coins with rate-limit pause between
  const candleData = {};
  for (const coin of coins) {
    candleData[coin.id] = await fetchCandles(coin.id, DAYS);
    if (coins.indexOf(coin) < coins.length - 1) {
      console.log('  Pausing 12s for rate limit...');
      await sleep(12000);
    }
  }

  // ── EMA Sweep ──
  const emaCombos = getEMASweepParams();
  console.log(`\nEMA sweep: ${emaCombos.length} param combos x ${coins.length} assets = ${emaCombos.length * coins.length} backtests`);

  for (const coin of coins) {
    const candles = candleData[coin.id];
    const results = [];

    for (const params of emaCombos) {
      const metrics = backtestEMA(candles, params);
      results.push({
        params: {
          fast: params.fastPeriod,
          slow: params.slowPeriod,
          stopLoss: params.stopLossPct,
          takeProfit: params.takeProfitPct,
          trendFilter: params.useTrendFilter,
        },
        metrics,
      });
    }

    // Sort by total return, then sharpe
    results.sort((a, b) => {
      if (b.metrics.totalReturn !== a.metrics.totalReturn) return b.metrics.totalReturn - a.metrics.totalReturn;
      return b.metrics.sharpe - a.metrics.sharpe;
    });

    allResults.ema[coin.symbol] = {
      totalCombos: results.length,
      top10: results.slice(0, 10),
      baseline: results.find(r =>
        r.params.fast === 9 && r.params.slow === 21 &&
        r.params.stopLoss === 0.015 && r.params.takeProfit === 0.025 &&
        !r.params.trendFilter
      ),
      profitable: results.filter(r => r.metrics.totalReturn > 0).length,
    };

    const best = results[0];
    console.log(`\n  ${coin.symbol} EMA Best: ${best.params.fast}/${best.params.slow} SL=${best.params.stopLoss} TP=${best.params.takeProfit} trend=${best.params.trendFilter}`);
    console.log(`    Return: ${best.metrics.totalReturn}% | WinRate: ${best.metrics.winRate}% | Sharpe: ${best.metrics.sharpe} | Trades: ${best.metrics.totalTrades} | MaxDD: ${best.metrics.maxDrawdown}%`);

    const bl = allResults.ema[coin.symbol].baseline;
    if (bl) {
      console.log(`    Baseline (9/21): Return: ${bl.metrics.totalReturn}% | WinRate: ${bl.metrics.winRate}%`);
    }
    console.log(`    Profitable combos: ${allResults.ema[coin.symbol].profitable}/${results.length}`);
  }

  // ── Bollinger Sweep ──
  const bbCombos = getBBSweepParams();
  console.log(`\nBollinger sweep: ${bbCombos.length} param combos x ${coins.length} assets = ${bbCombos.length * coins.length} backtests`);

  for (const coin of coins) {
    const candles = candleData[coin.id];
    const results = [];

    for (const params of bbCombos) {
      const metrics = backtestBollinger(candles, params);
      results.push({
        params: {
          period: params.bbPeriod,
          stdDev: params.bbStdDev,
          stopLoss: params.stopLossPct,
          rsiThreshold: params.rsiThreshold,
          trendFilter: params.useTrendFilter,
        },
        metrics,
      });
    }

    results.sort((a, b) => {
      if (b.metrics.totalReturn !== a.metrics.totalReturn) return b.metrics.totalReturn - a.metrics.totalReturn;
      return b.metrics.sharpe - a.metrics.sharpe;
    });

    allResults.bollinger[coin.symbol] = {
      totalCombos: results.length,
      top10: results.slice(0, 10),
      baseline: results.find(r =>
        r.params.period === 20 && r.params.stdDev === 2 &&
        r.params.stopLoss === 0.02 && r.params.rsiThreshold === 35 &&
        !r.params.trendFilter
      ),
      profitable: results.filter(r => r.metrics.totalReturn > 0).length,
    };

    const best = results[0];
    console.log(`\n  ${coin.symbol} BB Best: period=${best.params.period} std=${best.params.stdDev} SL=${best.params.stopLoss} RSI<${best.params.rsiThreshold} trend=${best.params.trendFilter}`);
    console.log(`    Return: ${best.metrics.totalReturn}% | WinRate: ${best.metrics.winRate}% | Sharpe: ${best.metrics.sharpe} | Trades: ${best.metrics.totalTrades} | MaxDD: ${best.metrics.maxDrawdown}%`);

    const bl = allResults.bollinger[coin.symbol].baseline;
    if (bl) {
      console.log(`    Baseline (20/2.0): Return: ${bl.metrics.totalReturn}% | WinRate: ${bl.metrics.winRate}%`);
    }
    console.log(`    Profitable combos: ${allResults.bollinger[coin.symbol].profitable}/${results.length}`);
  }

  // ── Best Overall ──
  console.log('\n====================================');
  console.log('BEST PARAMETER SETS (recommended)');
  console.log('====================================');

  for (const coin of coins) {
    const emaBest = allResults.ema[coin.symbol].top10[0];
    const bbBest  = allResults.bollinger[coin.symbol].top10[0];

    allResults.bestOverall[coin.symbol] = {
      ema: emaBest,
      bollinger: bbBest,
      recommendation: emaBest.metrics.totalReturn > bbBest.metrics.totalReturn ? 'EMA' : 'Bollinger',
    };

    console.log(`\n${coin.symbol}:`);
    console.log(`  EMA:       ${emaBest.params.fast}/${emaBest.params.slow} | SL=${emaBest.params.stopLoss} TP=${emaBest.params.takeProfit} trend=${emaBest.params.trendFilter} | Return: ${emaBest.metrics.totalReturn}%`);
    console.log(`  Bollinger: period=${bbBest.params.period} std=${bbBest.params.stdDev} | SL=${bbBest.params.stopLoss} RSI<${bbBest.params.rsiThreshold} trend=${bbBest.params.trendFilter} | Return: ${bbBest.metrics.totalReturn}%`);
    console.log(`  Winner:    ${allResults.bestOverall[coin.symbol].recommendation}`);
  }

  // ── Save Results ──
  const outputDir = new URL('../data', import.meta.url).pathname;
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = `${outputDir}/optimized-backtest-results.json`;
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to ${outputPath}`);
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
