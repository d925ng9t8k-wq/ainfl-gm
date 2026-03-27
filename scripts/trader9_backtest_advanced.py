"""
trader9_backtest_advanced.py — Advanced Backtesting Framework
Session 3: Advanced Strategies

Builds on the existing backtest-trader9.mjs with:
  1. Walk-forward optimization
  2. Out-of-sample testing
  3. Monte Carlo simulation for strategy robustness
  4. Multi-strategy portfolio backtesting
  5. Results stored to data/backtest-advanced-results.json

Data source: CoinGecko free API (no key required)
Paper trading only — Alpaca paper API for live validation.

Usage:
    python3 scripts/trader9_backtest_advanced.py [--coin=bitcoin] [--days=180] [--mode=walkforward|montecarlo|all]
"""

import sys
import os
import json
import math
import time
import random
import argparse
import urllib.request
import urllib.error
import numpy as np
from typing import List, Dict, Tuple, Optional, Callable
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

# Add scripts dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trader9_indicators import (
    RSI, MACD, BollingerBands, EMA, ATR, SMA,
    MarketRegime, SignalScore, BB_bandwidth,
)
from trader9_risk import (
    position_size_fixed_fractional,
    kelly_criterion,
    TrailingStop,
)


# ---------------------------------------------------------------------------
# CANDLE — Data structure
# ---------------------------------------------------------------------------

@dataclass
class Candle:
    timestamp: int
    date:      str
    open:      float
    high:      float
    low:       float
    close:     float
    volume:    float


# ---------------------------------------------------------------------------
# DATA FETCHER
# ---------------------------------------------------------------------------

def fetch_coingecko(coin_id: str, days: int) -> List[Candle]:
    """
    Fetch OHLC data from CoinGecko. No API key required.
    Builds 4-hour candles.
    """
    url = f'https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart?vs_currency=usd&days={days}'
    print(f"Fetching {days}d {coin_id} data from CoinGecko...")

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'trader9-backtest/2.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                wait = (attempt + 1) * 20
                print(f"Rate limited. Waiting {wait}s...")
                time.sleep(wait)
                continue
            raise
    else:
        raise RuntimeError("Failed to fetch data after retries")

    prices   = data.get('prices', [])
    vol_data = data.get('total_volumes', [])

    # Build volume map
    vol_map = {int(ts): v for ts, v in vol_data}

    # Build 4-hour candles
    BUCKET_MS = 4 * 3600 * 1000
    candles   = []
    bucket_ts = None
    bucket_prices = []

    for ts, price in prices:
        bts = (int(ts) // BUCKET_MS) * BUCKET_MS
        if bts != bucket_ts:
            if bucket_ts is not None and bucket_prices:
                vol = vol_map.get(bucket_ts, 0)
                candles.append(Candle(
                    timestamp = bucket_ts,
                    date      = datetime.fromtimestamp(bucket_ts / 1000, tz=timezone.utc).isoformat(),
                    open      = bucket_prices[0],
                    high      = max(bucket_prices),
                    low       = min(bucket_prices),
                    close     = bucket_prices[-1],
                    volume    = vol / 1e6,  # normalize to millions
                ))
            bucket_ts = bts
            bucket_prices = []
        bucket_prices.append(price)

    # Flush last bucket
    if bucket_ts and bucket_prices:
        vol = vol_map.get(bucket_ts, 0)
        candles.append(Candle(
            timestamp = bucket_ts,
            date      = datetime.fromtimestamp(bucket_ts / 1000, tz=timezone.utc).isoformat(),
            open      = bucket_prices[0],
            high      = max(bucket_prices),
            low       = min(bucket_prices),
            close     = bucket_prices[-1],
            volume    = vol / 1e6,
        ))

    print(f"Got {len(candles)} candles from {candles[0].date[:10]} to {candles[-1].date[:10]}")
    return candles


# ---------------------------------------------------------------------------
# SINGLE PASS BACKTEST ENGINE
# ---------------------------------------------------------------------------

@dataclass
class BacktestConfig:
    """Backtest parameters — varied during optimization."""
    # Bollinger Band
    bb_period:      int   = 25
    bb_std:         float = 2.0
    bb_rsi_entry:   float = 30.0
    bb_stop_pct:    float = 0.015

    # EMA crossover
    ema_fast:       int   = 5
    ema_slow:       int   = 20
    ema_stop_pct:   float = 0.025
    ema_tp_pct:     float = 0.030
    ema_trend_filter: bool = False
    ema_trend_period: int = 50

    # Position sizing
    position_pct:   float = 0.20
    starting_capital: float = 200.0

    # ATR trailing stop
    use_atr_stop:   bool  = False
    atr_mult:       float = 2.0


@dataclass
class BacktestResult:
    config:         BacktestConfig
    total_return:   float   # %
    final_capital:  float
    max_drawdown:   float   # %
    sharpe:         float
    win_rate:       float   # %
    total_trades:   int
    trades:         List[Dict]

    def score(self) -> float:
        """Composite score for optimization. Sharpe * win_rate / (1 + drawdown)."""
        if self.total_trades < 3:
            return -999  # penalize sparse trade counts
        return (self.sharpe * (self.win_rate / 100)) / (1 + self.max_drawdown / 100)


def run_backtest(candles: List[Candle], cfg: BacktestConfig, strategy: str = 'bb') -> BacktestResult:
    """
    Run a single backtest pass with given config.
    strategy: 'bb' | 'ema' | 'combined'
    """
    closes  = np.array([c.close  for c in candles], dtype=float)
    highs   = np.array([c.high   for c in candles], dtype=float)
    lows    = np.array([c.low    for c in candles], dtype=float)
    opens   = np.array([c.open   for c in candles], dtype=float)
    volumes = np.array([c.volume for c in candles], dtype=float)

    capital     = cfg.starting_capital
    peak_cap    = capital
    max_dd      = 0.0
    position    = None
    trades      = []

    MIN_IDX = max(cfg.bb_period + 5, cfg.ema_slow + 5, 30)

    for i in range(MIN_IDX, len(candles)):
        price = closes[i]
        cl    = closes[:i+1]
        hi    = highs[:i+1]
        lo    = lows[:i+1]
        vo    = volumes[:i+1]

        # Track drawdown
        if capital > peak_cap:
            peak_cap = capital
        dd = (peak_cap - capital) / peak_cap if peak_cap > 0 else 0
        if dd > max_dd:
            max_dd = dd

        # ---- BOLLINGER BAND strategy ----
        if strategy in ('bb', 'combined'):
            bb_up, bb_mid, bb_low = BollingerBands(cl, cfg.bb_period, cfg.bb_std)
            rsi_arr = RSI(cl)
            rsi_val = rsi_arr[-1] if not np.isnan(rsi_arr[-1]) else 50

            if position and position.get('strategy') == 'bb':
                entry  = position['entry']
                hard_sl = position['stop_loss']

                # Hard stop
                if price <= hard_sl:
                    pnl = position['notional'] * ((price - entry) / entry)
                    capital += pnl
                    trades.append({'strategy':'bb','side':'sell','reason':'stop','entry':entry,'exit':price,'pnl':pnl,'date':candles[i].date})
                    position = None
                    continue

                # Partial exit at middle band
                if not position.get('half_out') and not np.isnan(bb_mid[-1]) and price >= bb_mid[-1]:
                    half = position['notional'] / 2
                    pnl  = half * ((price - entry) / entry)
                    capital += pnl
                    position['notional'] -= half
                    position['half_out'] = True
                    trades.append({'strategy':'bb','side':'sell_partial','reason':'mid_band','entry':entry,'exit':price,'pnl':pnl,'date':candles[i].date})

                # Full exit at upper band
                if not np.isnan(bb_up[-1]) and price >= bb_up[-1] * 0.99:
                    pnl = position['notional'] * ((price - entry) / entry)
                    capital += pnl
                    trades.append({'strategy':'bb','side':'sell','reason':'upper_band','entry':entry,'exit':price,'pnl':pnl,'date':candles[i].date})
                    position = None
                    continue

            # BB Entry
            if position is None and strategy in ('bb', 'combined'):
                at_lower = not np.isnan(bb_low[-1]) and price <= bb_low[-1] * 1.005
                oversold = rsi_val < cfg.bb_rsi_entry

                if at_lower and oversold:
                    notional = capital * cfg.position_pct
                    stop_px  = price * (1 - cfg.bb_stop_pct)
                    position = {
                        'strategy':  'bb',
                        'entry':     price,
                        'notional':  notional,
                        'stop_loss': stop_px,
                        'half_out':  False,
                    }
                    trades.append({'strategy':'bb','side':'buy','reason':'lower_band+rsi','entry':price,'notional':notional,'date':candles[i].date})

        # ---- EMA CROSSOVER strategy ----
        if strategy in ('ema', 'combined') and position is None:
            fast_ema = EMA(cl, cfg.ema_fast)
            slow_ema = EMA(cl, cfg.ema_slow)
            rsi_arr  = RSI(cl)
            rsi_val  = rsi_arr[-1] if not np.isnan(rsi_arr[-1]) else 50

            if len(fast_ema) < 2 or np.isnan(fast_ema[-1]) or np.isnan(slow_ema[-1]):
                continue

            crossed_up = fast_ema[-2] <= slow_ema[-2] and fast_ema[-1] > slow_ema[-1]
            rsi_ok     = 45 <= rsi_val <= 65

            # Optional trend filter
            trend_ok = True
            if cfg.ema_trend_filter:
                trend_ema = EMA(cl, cfg.ema_trend_period)
                trend_ok  = not np.isnan(trend_ema[-1]) and price > trend_ema[-1]

            if crossed_up and rsi_ok and trend_ok:
                notional = capital * cfg.position_pct
                stop_px  = price * (1 - cfg.ema_stop_pct)
                tp_px    = price * (1 + cfg.ema_tp_pct)
                position = {
                    'strategy': 'ema',
                    'entry':    price,
                    'notional': notional,
                    'stop_loss': stop_px,
                    'take_profit': tp_px,
                }
                trades.append({'strategy':'ema','side':'buy','reason':'ema_cross','entry':price,'notional':notional,'date':candles[i].date})

        # ---- EMA exit management ----
        if position and position.get('strategy') == 'ema':
            entry = position['entry']
            if price <= position['stop_loss']:
                pnl = position['notional'] * ((price - entry) / entry)
                capital += pnl
                trades.append({'strategy':'ema','side':'sell','reason':'stop','entry':entry,'exit':price,'pnl':pnl,'date':candles[i].date})
                position = None
            elif price >= position['take_profit']:
                pnl = position['notional'] * ((price - entry) / entry)
                capital += pnl
                trades.append({'strategy':'ema','side':'sell','reason':'tp','entry':entry,'exit':price,'pnl':pnl,'date':candles[i].date})
                position = None
            else:
                fast_ema = EMA(cl, cfg.ema_fast)
                slow_ema = EMA(cl, cfg.ema_slow)
                if len(fast_ema) >= 2 and not np.isnan(fast_ema[-1]):
                    if fast_ema[-2] >= slow_ema[-2] and fast_ema[-1] < slow_ema[-1]:
                        pnl = position['notional'] * ((price - entry) / entry)
                        capital += pnl
                        trades.append({'strategy':'ema','side':'sell','reason':'cross_down','entry':entry,'exit':price,'pnl':pnl,'date':candles[i].date})
                        position = None

    # Close any open position
    if position:
        price = closes[-1]
        entry = position['entry']
        pnl   = position['notional'] * ((price - entry) / entry)
        capital += pnl
        trades.append({'strategy':position['strategy'],'side':'sell','reason':'eob','entry':entry,'exit':price,'pnl':pnl,'date':candles[-1].date})

    # Metrics
    sells    = [t for t in trades if t['side'] in ('sell', 'sell_partial') and 'pnl' in t]
    wins     = [t for t in sells if t['pnl'] > 0]
    total_ret = (capital - cfg.starting_capital) / cfg.starting_capital * 100

    # Sharpe
    if len(sells) > 1:
        returns = np.array([t['pnl'] / (t.get('notional', cfg.starting_capital * 0.20) or 1) for t in sells])
        avg_r   = np.mean(returns)
        std_r   = np.std(returns, ddof=1)
        sharpe  = (avg_r / std_r * math.sqrt(len(returns) * 365)) if std_r > 0 else 0
    else:
        sharpe  = 0

    return BacktestResult(
        config        = cfg,
        total_return  = round(total_ret, 4),
        final_capital = round(capital, 2),
        max_drawdown  = round(max_dd * 100, 4),
        sharpe        = round(sharpe, 2),
        win_rate      = round(len(wins) / len(sells) * 100, 2) if sells else 0,
        total_trades  = len([t for t in trades if t['side'] == 'buy']),
        trades        = trades,
    )


# ---------------------------------------------------------------------------
# WALK-FORWARD OPTIMIZATION
# ---------------------------------------------------------------------------

def walk_forward_optimization(candles: List[Candle],
                               train_pct: float = 0.70,
                               n_windows: int = 5,
                               strategy: str = 'bb') -> Dict:
    """
    Walk-forward optimization.

    Splits data into N overlapping windows.
    For each window: optimize on train portion, test on out-of-sample portion.

    This prevents overfitting — a strategy that only works on training data
    is useless. Walk-forward shows if optimization generalizes.

    Process:
    1. Divide total data into N windows
    2. For each window:
       a. Take first train_pct as in-sample
       b. Optimize parameters on in-sample
       c. Run BEST params on remaining (out-of-sample)
    3. Aggregate OOS results — this is the true performance estimate

    Args:
        candles:    price data
        train_pct:  fraction of each window used for training (0.70 = 70%)
        n_windows:  number of walk-forward windows
        strategy:   'bb' | 'ema' | 'combined'

    Returns:
        Walk-forward report dict
    """
    print(f"\n=== Walk-Forward Optimization ===")
    print(f"Strategy: {strategy} | Windows: {n_windows} | Train: {train_pct*100:.0f}%")

    n = len(candles)
    window_size = n // n_windows

    # Parameter grid (reduced for speed)
    bb_params = [
        (20, 2.0, 30, 0.015),
        (25, 2.0, 30, 0.015),
        (25, 2.0, 40, 0.015),
        (25, 2.5, 30, 0.020),
        (30, 2.0, 30, 0.015),
    ]

    ema_params = [
        (5, 20, 0.015, 0.025),
        (5, 20, 0.025, 0.030),
        (9, 21, 0.015, 0.025),
        (9, 21, 0.025, 0.030),
        (8, 21, 0.020, 0.030),
    ]

    windows_results = []
    oos_all_trades  = []
    oos_returns     = []

    for w in range(n_windows):
        start = w * window_size
        end   = start + window_size if w < n_windows - 1 else n

        window    = candles[start:end]
        train_end = int(len(window) * train_pct)
        train     = window[:train_end]
        oos       = window[train_end:]

        if len(train) < 50 or len(oos) < 10:
            continue

        print(f"\n  Window {w+1}/{n_windows}: train [{candles[start].date[:10]} -> {window[train_end].date[:10]}]"
              f" | OOS [{window[train_end].date[:10]} -> {window[-1].date[:10]}]")

        # Optimize on training data
        best_score  = -999
        best_config = None

        params_list = bb_params if strategy == 'bb' else ema_params

        for params in params_list:
            if strategy == 'bb':
                cfg = BacktestConfig(bb_period=params[0], bb_std=params[1],
                                     bb_rsi_entry=params[2], bb_stop_pct=params[3])
            else:
                cfg = BacktestConfig(ema_fast=params[0], ema_slow=params[1],
                                     ema_stop_pct=params[2], ema_tp_pct=params[3])

            try:
                result = run_backtest(train, cfg, strategy)
                s = result.score()
                if s > best_score:
                    best_score  = s
                    best_config = cfg
                    best_result = result
            except Exception:
                continue

        if best_config is None:
            print(f"    No valid config found for window {w+1}")
            continue

        # Test on OOS
        oos_result = run_backtest(oos, best_config, strategy)
        oos_returns.append(oos_result.total_return)
        oos_all_trades.extend(oos_result.trades)

        windows_results.append({
            'window':          w + 1,
            'train_from':      candles[start].date[:10],
            'train_to':        window[train_end].date[:10],
            'oos_from':        window[train_end].date[:10],
            'oos_to':          window[-1].date[:10],
            'best_train_score': round(best_score, 4),
            'train_return':    best_result.total_return,
            'oos_return':      oos_result.total_return,
            'oos_win_rate':    oos_result.win_rate,
            'oos_sharpe':      oos_result.sharpe,
            'oos_trades':      oos_result.total_trades,
            'best_params':     _cfg_to_dict(best_config, strategy),
        })

        print(f"    Best train params: {_cfg_to_dict(best_config, strategy)}")
        print(f"    Train return: {best_result.total_return:+.2f}%  |  OOS return: {oos_result.total_return:+.2f}%")

    # Aggregate OOS
    avg_oos_return = float(np.mean(oos_returns)) if oos_returns else 0
    oos_consistency = sum(1 for r in oos_returns if r > 0) / len(oos_returns) if oos_returns else 0

    print(f"\n  Walk-Forward Summary:")
    print(f"    Avg OOS return per window: {avg_oos_return:+.2f}%")
    print(f"    OOS profitable windows: {oos_consistency*100:.0f}%")
    print(f"    OOS total trades: {len([t for t in oos_all_trades if t['side']=='buy'])}")

    return {
        'strategy':            strategy,
        'n_windows':           n_windows,
        'train_pct':           train_pct,
        'avg_oos_return':      round(avg_oos_return, 4),
        'oos_consistency_pct': round(oos_consistency * 100, 1),
        'windows':             windows_results,
        'assessment':          'ROBUST' if avg_oos_return > 0 and oos_consistency > 0.6
                               else ('MARGINAL' if avg_oos_return > 0
                               else 'OVERFIT — do not use'),
    }


def _cfg_to_dict(cfg: BacktestConfig, strategy: str) -> Dict:
    if strategy == 'bb':
        return {'period': cfg.bb_period, 'std': cfg.bb_std,
                'rsi_entry': cfg.bb_rsi_entry, 'stop_pct': cfg.bb_stop_pct}
    return {'fast': cfg.ema_fast, 'slow': cfg.ema_slow,
            'stop_pct': cfg.ema_stop_pct, 'tp_pct': cfg.ema_tp_pct}


# ---------------------------------------------------------------------------
# MONTE CARLO SIMULATION
# ---------------------------------------------------------------------------

def monte_carlo_simulation(trades: List[Dict],
                            starting_capital: float = 200.0,
                            n_simulations: int = 1000,
                            n_trades: Optional[int] = None) -> Dict:
    """
    Monte Carlo simulation to test strategy robustness.

    Method:
    1. Extract trade P&L from historical backtest
    2. Randomly shuffle trade sequence N times
    3. Calculate equity curve for each shuffle
    4. Report distribution of outcomes

    This answers: "How much of our backtest return was luck from trade ordering?"
    A robust strategy has a narrow distribution — order doesn't matter much.
    A lucky strategy has a wide distribution — order mattered a lot.

    Args:
        trades:           list of completed trades from backtest
        starting_capital: starting account value
        n_simulations:    number of random sequences to test
        n_trades:         how many trades to simulate (default: same as historical)

    Returns:
        Monte Carlo report with percentile distribution.
    """
    # Extract P&L from closed trades
    pnl_list = [t['pnl'] for t in trades if 'pnl' in t and t['side'] in ('sell', 'sell_partial')]

    if len(pnl_list) < 5:
        return {'error': f'Insufficient trades for Monte Carlo: {len(pnl_list)} trades (need 5+)'}

    n_trades = n_trades or len(pnl_list)
    print(f"\n=== Monte Carlo Simulation ===")
    print(f"  {n_simulations} simulations, {n_trades} trades each, starting ${starting_capital}")

    final_capitals = []
    max_drawdowns  = []

    for _ in range(n_simulations):
        # Sample with replacement from trade P&Ls
        sim_pnls = random.choices(pnl_list, k=n_trades)
        capital  = starting_capital
        peak     = capital
        max_dd   = 0.0

        for pnl in sim_pnls:
            capital += pnl
            if capital > peak:
                peak = capital
            dd = (peak - capital) / peak if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

        final_capitals.append(capital)
        max_drawdowns.append(max_dd * 100)

    capitals_arr = np.array(final_capitals)
    dd_arr       = np.array(max_drawdowns)

    pct_profitable = float(np.mean(capitals_arr > starting_capital)) * 100
    pct_ruin       = float(np.mean(capitals_arr < starting_capital * 0.5)) * 100

    result = {
        'n_simulations':    n_simulations,
        'n_trades':         n_trades,
        'starting_capital': starting_capital,
        'returns': {
            'p5':    round(float(np.percentile(capitals_arr, 5)), 2),
            'p25':   round(float(np.percentile(capitals_arr, 25)), 2),
            'p50':   round(float(np.percentile(capitals_arr, 50)), 2),
            'p75':   round(float(np.percentile(capitals_arr, 75)), 2),
            'p95':   round(float(np.percentile(capitals_arr, 95)), 2),
            'mean':  round(float(np.mean(capitals_arr)), 2),
            'std':   round(float(np.std(capitals_arr)), 2),
        },
        'drawdowns': {
            'p50_max_dd': round(float(np.percentile(dd_arr, 50)), 2),
            'p95_max_dd': round(float(np.percentile(dd_arr, 95)), 2),
            'worst_dd':   round(float(np.max(dd_arr)), 2),
        },
        'risk': {
            'pct_profitable':    round(pct_profitable, 1),
            'pct_ruin':          round(pct_ruin, 1),
        },
        'assessment': _mc_assessment(pct_profitable, pct_ruin,
                                      np.percentile(capitals_arr, 50),
                                      starting_capital),
    }

    print(f"  P50 outcome: ${result['returns']['p50']} ({(result['returns']['p50']/starting_capital-1)*100:+.1f}%)")
    print(f"  P5  outcome: ${result['returns']['p5']} ({(result['returns']['p5']/starting_capital-1)*100:+.1f}%)")
    print(f"  P95 outcome: ${result['returns']['p95']} ({(result['returns']['p95']/starting_capital-1)*100:+.1f}%)")
    print(f"  Profitable: {pct_profitable:.1f}% of simulations")
    print(f"  Ruin (<50%): {pct_ruin:.1f}% of simulations")
    print(f"  Assessment: {result['assessment']}")

    return result


def _mc_assessment(pct_profitable: float, pct_ruin: float,
                   p50_capital: float, starting: float) -> str:
    if pct_profitable >= 70 and pct_ruin < 5:
        return 'STRONG — deploy with confidence'
    elif pct_profitable >= 55 and pct_ruin < 15:
        return 'ACCEPTABLE — deploy with caution, monitor closely'
    elif pct_profitable >= 45:
        return 'MARGINAL — paper trade longer before live'
    else:
        return 'REJECT — insufficient edge'


# ---------------------------------------------------------------------------
# MULTI-STRATEGY PORTFOLIO BACKTEST
# ---------------------------------------------------------------------------

def portfolio_backtest(candles_btc: List[Candle],
                       candles_eth: List[Candle]) -> Dict:
    """
    Backtest the combined portfolio (Session 2 recommended allocation):
    - ETH/USD Bollinger: 40% of capital
    - ETH/USD EMA:       25% of capital
    - BTC/USD Bollinger: 25% of capital
    - Cash reserve:      10%

    Each strategy gets its own capital slice. P&L is combined.

    Returns portfolio-level metrics.
    """
    print("\n=== Portfolio Backtest ===")
    print("  ETH BB (40%) + ETH EMA (25%) + BTC BB (25%) + Cash (10%)")

    TOTAL_CAPITAL = 200.0
    alloc = {
        'eth_bb':  TOTAL_CAPITAL * 0.40,
        'eth_ema': TOTAL_CAPITAL * 0.25,
        'btc_bb':  TOTAL_CAPITAL * 0.25,
        'cash':    TOTAL_CAPITAL * 0.10,
    }

    # Optimized params from Session 2
    eth_bb_cfg  = BacktestConfig(bb_period=25, bb_std=2.0, bb_rsi_entry=30, bb_stop_pct=0.015,
                                  starting_capital=alloc['eth_bb'], position_pct=1.0)
    eth_ema_cfg = BacktestConfig(ema_fast=5, ema_slow=20, ema_stop_pct=0.025, ema_tp_pct=0.030,
                                  starting_capital=alloc['eth_ema'], position_pct=1.0)
    btc_bb_cfg  = BacktestConfig(bb_period=25, bb_std=2.0, bb_rsi_entry=40, bb_stop_pct=0.015,
                                  starting_capital=alloc['btc_bb'], position_pct=1.0)

    eth_bb_r  = run_backtest(candles_eth, eth_bb_cfg, 'bb')
    eth_ema_r = run_backtest(candles_eth, eth_ema_cfg, 'ema')
    btc_bb_r  = run_backtest(candles_btc, btc_bb_cfg, 'bb')

    total_final = eth_bb_r.final_capital + eth_ema_r.final_capital + btc_bb_r.final_capital + alloc['cash']
    total_return = (total_final - TOTAL_CAPITAL) / TOTAL_CAPITAL * 100

    portfolio_result = {
        'starting_capital': TOTAL_CAPITAL,
        'final_capital':    round(total_final, 2),
        'total_return_pct': round(total_return, 4),
        'strategies': {
            'eth_bb':  {'return': eth_bb_r.total_return,  'trades': eth_bb_r.total_trades,  'win_rate': eth_bb_r.win_rate,  'sharpe': eth_bb_r.sharpe},
            'eth_ema': {'return': eth_ema_r.total_return, 'trades': eth_ema_r.total_trades, 'win_rate': eth_ema_r.win_rate, 'sharpe': eth_ema_r.sharpe},
            'btc_bb':  {'return': btc_bb_r.total_return,  'trades': btc_bb_r.total_trades,  'win_rate': btc_bb_r.win_rate,  'sharpe': btc_bb_r.sharpe},
        },
        'allocation': alloc,
    }

    print(f"  ETH BB:  {eth_bb_r.total_return:+.2f}% | {eth_bb_r.total_trades} trades | {eth_bb_r.win_rate}% win rate")
    print(f"  ETH EMA: {eth_ema_r.total_return:+.2f}% | {eth_ema_r.total_trades} trades | {eth_ema_r.win_rate}% win rate")
    print(f"  BTC BB:  {btc_bb_r.total_return:+.2f}% | {btc_bb_r.total_trades} trades | {btc_bb_r.win_rate}% win rate")
    print(f"  Portfolio total: ${total_final:.2f} ({total_return:+.2f}%)")

    return portfolio_result


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='trader9 Advanced Backtest Framework')
    parser.add_argument('--coin',  default='bitcoin',     help='CoinGecko coin ID')
    parser.add_argument('--coin2', default='ethereum',    help='Second coin for portfolio')
    parser.add_argument('--days',  default=180, type=int, help='Historical days')
    parser.add_argument('--mode',  default='all',         help='walkforward|montecarlo|portfolio|all')
    args = parser.parse_args()

    print("trader9 Advanced Backtesting Framework v2.0")
    print(f"Mode: {args.mode} | Coins: {args.coin}/{args.coin2} | Days: {args.days}")
    print("Data: CoinGecko free API | Paper trading only\n")

    # Fetch data
    candles1 = fetch_coingecko(args.coin,  args.days)
    time.sleep(5)  # Respect rate limit
    candles2 = fetch_coingecko(args.coin2, args.days)

    results = {
        'metadata': {
            'coin':   args.coin,
            'coin2':  args.coin2,
            'days':   args.days,
            'run_at': datetime.now(timezone.utc).isoformat(),
            'mode':   args.mode,
        }
    }

    # Baseline backtest for Monte Carlo input
    baseline_cfg = BacktestConfig(bb_period=25, bb_std=2.0, bb_rsi_entry=30, bb_stop_pct=0.015)
    baseline     = run_backtest(candles2, baseline_cfg, 'bb')
    results['baseline_eth_bb'] = {
        'return':     baseline.total_return,
        'win_rate':   baseline.win_rate,
        'sharpe':     baseline.sharpe,
        'max_dd':     baseline.max_drawdown,
        'trades':     baseline.total_trades,
    }

    if args.mode in ('walkforward', 'all'):
        results['walkforward_bb']  = walk_forward_optimization(candles2, strategy='bb',  n_windows=4)
        time.sleep(2)
        results['walkforward_ema'] = walk_forward_optimization(candles2, strategy='ema', n_windows=4)

    if args.mode in ('montecarlo', 'all'):
        results['montecarlo'] = monte_carlo_simulation(
            baseline.trades,
            starting_capital=200.0,
            n_simulations=2000,
        )

    if args.mode in ('portfolio', 'all'):
        results['portfolio'] = portfolio_backtest(candles1, candles2)

    # Save results
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'backtest-advanced-results.json')
    with open(out_path, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\nAll results saved to {out_path}")

    # Print summary
    print("\n=== FINAL SUMMARY ===")
    if 'walkforward_bb' in results:
        wf = results['walkforward_bb']
        print(f"Walk-Forward BB:  Avg OOS {wf['avg_oos_return']:+.2f}% | {wf['oos_consistency_pct']}% windows profitable | {wf['assessment']}")
    if 'montecarlo' in results:
        mc = results['montecarlo']
        print(f"Monte Carlo:      P50 ${mc['returns']['p50']} | P5 ${mc['returns']['p5']} | {mc['risk']['pct_profitable']}% profitable | {mc['assessment']}")
    if 'portfolio' in results:
        pf = results['portfolio']
        print(f"Portfolio:        ${pf['final_capital']} ({pf['total_return_pct']:+.2f}%)")


if __name__ == '__main__':
    main()
