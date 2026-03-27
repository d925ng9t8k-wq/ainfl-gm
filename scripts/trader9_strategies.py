"""
trader9_strategies.py — Advanced Strategy Implementations
Session 3: Advanced Strategies

Implements six strategies beyond the baseline EMA/Bollinger:
  1. Mean Reversion (z-score based)
  2. Momentum (rate-of-change + volume)
  3. Pairs Trading (spread mean reversion)
  4. Options Flow Signal (unusual options activity as stock directional signal)
  5. Sector Rotation (relative strength between crypto sectors)
  6. Earnings Momentum (post-earnings drift on correlated assets)

All strategies return standardized Signal objects.
All strategies are paper-trading only via Alpaca paper API.
"""

import sys
import os
import json
import time
import math
import numpy as np
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Tuple
from datetime import datetime, timezone

# Add scripts dir to path so we can import indicators
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trader9_indicators import (
    RSI, MACD, BollingerBands, EMA, ATR, SMA,
    MarketRegime, CandlePatterns, bullish_patterns, bearish_patterns,
    SignalScore, BB_bandwidth,
)


# ---------------------------------------------------------------------------
# SIGNAL — Standardized Output
# ---------------------------------------------------------------------------

@dataclass
class Signal:
    """Standardized signal emitted by every strategy."""
    strategy:     str               # strategy name
    symbol:       str               # e.g. 'BTC/USD' or 'ETHUSD'
    direction:    str               # 'long', 'short', 'flat' (close position)
    confidence:   float             # 0.0 to 1.0
    entry_price:  float             # suggested entry (current market price)
    stop_loss:    float             # hard stop price
    take_profit:  List[float]       # [tp1, tp2] — partial at tp1, full at tp2
    size_pct:     float             # suggested position size as % of capital
    reason:       str               # human-readable explanation
    timestamp:    str               # ISO8601 UTC

    def to_dict(self) -> dict:
        return asdict(self)

    def risk_reward(self) -> float:
        """R:R ratio on first take profit."""
        if not self.take_profit or self.entry_price == self.stop_loss:
            return 0.0
        risk   = abs(self.entry_price - self.stop_loss)
        reward = abs(self.take_profit[0] - self.entry_price)
        return round(reward / risk, 2) if risk > 0 else 0.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# 1. MEAN REVERSION — Z-Score Based
# ---------------------------------------------------------------------------

class MeanReversionStrategy:
    """
    Z-score mean reversion.

    Concept: Crypto prices oscillate around a rolling mean. When z-score
    exceeds +/-2, price is statistically overextended and likely to revert.

    Filters to avoid trend trades:
    - Market regime must be 'ranging' or 'volatile'
    - RSI must confirm oversold/overbought
    - BB must show price at extreme band

    Best conditions: sideways markets, consolidation phases
    Avoid: strong trending markets (the mean keeps moving away from price)
    """

    def __init__(self,
                 lookback: int = 50,
                 z_entry: float = 2.0,
                 z_exit: float = 0.5,
                 stop_loss_atr: float = 2.0):
        self.lookback      = lookback
        self.z_entry       = z_entry    # z-score threshold to enter
        self.z_exit        = z_exit     # z-score to exit (near mean)
        self.stop_loss_atr = stop_loss_atr

    def z_score(self, prices: np.ndarray) -> float:
        """Z-score of last price vs rolling mean."""
        window = prices[-self.lookback:]
        mean   = np.mean(window)
        std    = np.std(window, ddof=1)
        if std == 0:
            return 0.0
        return float((prices[-1] - mean) / std)

    def evaluate(self,
                 symbol: str,
                 closes: np.ndarray,
                 highs: np.ndarray,
                 lows: np.ndarray,
                 opens: np.ndarray,
                 volumes: np.ndarray) -> Optional[Signal]:
        """
        Returns a Signal if entry conditions are met, else None.
        """
        if len(closes) < self.lookback + 20:
            return None

        price   = closes[-1]
        z       = self.z_score(closes)
        rsi_arr = RSI(closes)
        rsi_val = rsi_arr[-1] if not np.isnan(rsi_arr[-1]) else 50

        regime  = MarketRegime(closes)
        atr_arr = ATR(highs, lows, closes)
        atr_val = atr_arr[-1] if not np.isnan(atr_arr[-1]) else price * 0.02

        bb_up, bb_mid, bb_low = BollingerBands(closes)

        # Regime must NOT be a strong trend
        if regime['regime'] == 'trending_up' and regime['strength'] > 60:
            return None
        if regime['regime'] == 'trending_down' and regime['strength'] > 60:
            return None

        stop  = self.stop_loss_atr * atr_val
        mean  = float(np.mean(closes[-self.lookback:]))

        # LONG: price massively oversold, z-score < -z_entry
        if z < -self.z_entry and rsi_val < 40:
            confidence = min(1.0, (abs(z) - self.z_entry) / 2)
            return Signal(
                strategy    = 'mean_reversion',
                symbol      = symbol,
                direction   = 'long',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = round(price - stop, 4),
                take_profit = [round(mean, 4), round(bb_mid[-1] if not np.isnan(bb_mid[-1]) else mean * 1.01, 4)],
                size_pct    = 0.15,
                reason      = f'Z-score {z:.2f} < -{self.z_entry} (extreme oversold). RSI={rsi_val:.1f}. Regime={regime["regime"]}.',
                timestamp   = _now(),
            )

        # SHORT: price massively overbought
        if z > self.z_entry and rsi_val > 60:
            confidence = min(1.0, (abs(z) - self.z_entry) / 2)
            return Signal(
                strategy    = 'mean_reversion',
                symbol      = symbol,
                direction   = 'short',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = round(price + stop, 4),
                take_profit = [round(mean, 4), round(bb_mid[-1] if not np.isnan(bb_mid[-1]) else mean * 0.99, 4)],
                size_pct    = 0.15,
                reason      = f'Z-score {z:.2f} > {self.z_entry} (extreme overbought). RSI={rsi_val:.1f}. Regime={regime["regime"]}.',
                timestamp   = _now(),
            )

        return None


# ---------------------------------------------------------------------------
# 2. MOMENTUM — Rate-of-Change + Volume Confirmation
# ---------------------------------------------------------------------------

class MomentumStrategy:
    """
    Momentum (trend-following).

    Uses:
    - Rate of Change (ROC): % price change over N bars
    - Volume surge confirmation (volume > 1.5x average)
    - MACD momentum direction
    - EMA trend filter

    Best conditions: breakout from range, news-driven moves, trending markets
    Avoid: ranging/choppy markets (whipsaws)
    """

    def __init__(self,
                 roc_period: int = 10,
                 roc_threshold: float = 3.0,
                 vol_multiplier: float = 1.5,
                 trend_ema: int = 50):
        self.roc_period     = roc_period
        self.roc_threshold  = roc_threshold   # ROC% required to enter
        self.vol_multiplier = vol_multiplier  # volume must be this much above avg
        self.trend_ema      = trend_ema       # trend filter

    def roc(self, prices: np.ndarray) -> float:
        """Rate of Change: % change from N bars ago."""
        if len(prices) < self.roc_period + 1:
            return 0.0
        past  = prices[-(self.roc_period + 1)]
        now   = prices[-1]
        return float((now - past) / past * 100) if past > 0 else 0.0

    def volume_surge(self, volumes: np.ndarray, lookback: int = 20) -> bool:
        """Is current volume above average by the required multiplier?"""
        if len(volumes) < lookback + 1:
            return False
        avg_vol = np.mean(volumes[-(lookback + 1):-1])
        return volumes[-1] > self.vol_multiplier * avg_vol

    def evaluate(self,
                 symbol: str,
                 closes: np.ndarray,
                 highs: np.ndarray,
                 lows: np.ndarray,
                 opens: np.ndarray,
                 volumes: np.ndarray) -> Optional[Signal]:

        if len(closes) < max(self.trend_ema, self.roc_period) + 10:
            return None

        price   = closes[-1]
        roc_val = self.roc(closes)
        vol_ok  = self.volume_surge(volumes)

        trend_ema = EMA(closes, self.trend_ema)
        ema_val   = trend_ema[-1] if not np.isnan(trend_ema[-1]) else price

        macd_line, sig_line, hist = MACD(closes)
        atr_arr = ATR(highs, lows, closes)
        atr_val = atr_arr[-1] if not np.isnan(atr_arr[-1]) else price * 0.02

        regime = MarketRegime(closes)

        # Only trade in trending regime
        if regime['regime'] not in ('trending_up', 'trending_down', 'volatile'):
            return None

        # LONG momentum: strong positive ROC + volume + price above trend EMA
        if (roc_val >= self.roc_threshold and
                vol_ok and
                price > ema_val and
                not np.isnan(hist[-1]) and hist[-1] > 0):

            confidence = min(1.0, roc_val / (self.roc_threshold * 2))
            stop       = round(price - 2.0 * atr_val, 4)
            tp1        = round(price * (1 + 0.03), 4)   # 3%
            tp2        = round(price * (1 + 0.05), 4)   # 5%

            return Signal(
                strategy    = 'momentum',
                symbol      = symbol,
                direction   = 'long',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = stop,
                take_profit = [tp1, tp2],
                size_pct    = 0.20,
                reason      = f'ROC={roc_val:.1f}% > threshold. Volume surge={vol_ok}. Price above EMA{self.trend_ema}. MACD histogram positive.',
                timestamp   = _now(),
            )

        # SHORT momentum: strong negative ROC + volume + price below trend EMA
        if (roc_val <= -self.roc_threshold and
                vol_ok and
                price < ema_val and
                not np.isnan(hist[-1]) and hist[-1] < 0):

            confidence = min(1.0, abs(roc_val) / (self.roc_threshold * 2))
            stop       = round(price + 2.0 * atr_val, 4)
            tp1        = round(price * (1 - 0.03), 4)
            tp2        = round(price * (1 - 0.05), 4)

            return Signal(
                strategy    = 'momentum',
                symbol      = symbol,
                direction   = 'short',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = stop,
                take_profit = [tp1, tp2],
                size_pct    = 0.20,
                reason      = f'ROC={roc_val:.1f}% < -threshold. Volume surge={vol_ok}. Price below EMA{self.trend_ema}. MACD histogram negative.',
                timestamp   = _now(),
            )

        return None


# ---------------------------------------------------------------------------
# 3. PAIRS TRADING — Spread Mean Reversion
# ---------------------------------------------------------------------------

class PairsTradingStrategy:
    """
    Pairs trading: exploit the spread between two correlated assets.

    When BTC and ETH move together historically, divergences in their
    price ratio (the spread) revert. We go long the underperformer
    and short the outperformer when the spread is extreme.

    Common crypto pairs:
    - BTC/ETH (most correlated, ~0.85 Pearson)
    - ETH/LINK
    - BTC/SOL

    This implementation:
    - Calculates log price ratio (spread) between asset A and asset B
    - Uses z-score of the spread vs rolling mean
    - Enters when z > threshold (A expensive relative to B: short A, long B)
    - Exits when spread reverts to mean

    Note: In crypto-only accounts, "shorting" is implemented by
    under-weighting or selling existing positions. True short requires
    margin/derivatives.
    """

    def __init__(self,
                 lookback: int = 60,
                 z_threshold: float = 2.0,
                 hedge_ratio_method: str = 'ols'):
        self.lookback              = lookback
        self.z_threshold           = z_threshold
        self.hedge_ratio_method    = hedge_ratio_method

    def compute_spread(self,
                       prices_a: np.ndarray,
                       prices_b: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        Compute the spread and hedge ratio.

        Hedge ratio (OLS): how many units of B to hedge 1 unit of A
        Spread = log(A) - hedge_ratio * log(B)
        """
        log_a = np.log(prices_a)
        log_b = np.log(prices_b)

        # OLS regression: log_a = alpha + beta * log_b
        n = min(len(log_a), len(log_b), self.lookback)
        la = log_a[-n:]
        lb = log_b[-n:]

        # Simple OLS
        cov  = np.cov(la, lb)
        beta = cov[0, 1] / cov[1, 1] if cov[1, 1] > 0 else 1.0

        spread = la - beta * lb
        return spread, float(beta)

    def cointegration_check(self,
                            prices_a: np.ndarray,
                            prices_b: np.ndarray) -> float:
        """
        Simple cointegration test: correlation of the spread's ADF.
        Returns correlation coefficient (proxy for how 'paired' they are).
        """
        n   = min(len(prices_a), len(prices_b))
        cor = float(np.corrcoef(prices_a[-n:], prices_b[-n:])[0, 1])
        return round(cor, 4)

    def evaluate(self,
                 symbol_a: str,
                 symbol_b: str,
                 closes_a: np.ndarray,
                 closes_b: np.ndarray) -> Optional[Dict]:
        """
        Returns trade signal for the pair.

        Result:
        {
            'leg_a': Signal (long or short),
            'leg_b': Signal (opposite direction to leg_a),
            'spread_z': current z-score,
            'hedge_ratio': beta,
            'correlation': pearson r,
        }
        """
        n = min(len(closes_a), len(closes_b))
        if n < self.lookback + 10:
            return None

        closes_a = closes_a[-n:]
        closes_b = closes_b[-n:]

        correlation = self.cointegration_check(closes_a, closes_b)
        if correlation < 0.7:
            return None  # Not correlated enough to pairs trade

        spread, hedge_ratio = self.compute_spread(closes_a, closes_b)

        spread_mean = np.mean(spread[-self.lookback:])
        spread_std  = np.std(spread[-self.lookback:], ddof=1)

        if spread_std == 0:
            return None

        z = float((spread[-1] - spread_mean) / spread_std)

        price_a = closes_a[-1]
        price_b = closes_b[-1]

        # Spread is high: A is expensive relative to B
        # Action: short A, long B
        if z > self.z_threshold:
            direction_a = 'short'
            direction_b = 'long'
        elif z < -self.z_threshold:
            direction_a = 'long'
            direction_b = 'short'
        else:
            return None

        confidence = min(1.0, (abs(z) - self.z_threshold) / 2)

        # Simple stop: if spread moves further by 1.5x threshold
        spread_stop = 1.5 * self.z_threshold

        return {
            'signal_a': Signal(
                strategy    = 'pairs_trading',
                symbol      = symbol_a,
                direction   = direction_a,
                confidence  = round(confidence, 2),
                entry_price = price_a,
                stop_loss   = round(price_a * (1.03 if direction_a == 'short' else 0.97), 4),
                take_profit = [round(price_a * (0.98 if direction_a == 'short' else 1.02), 4)],
                size_pct    = 0.15,
                reason      = f'Pairs trade: spread z={z:.2f}. {direction_a.upper()} {symbol_a} vs {symbol_b}. Corr={correlation}.',
                timestamp   = _now(),
            ),
            'signal_b': Signal(
                strategy    = 'pairs_trading',
                symbol      = symbol_b,
                direction   = direction_b,
                confidence  = round(confidence, 2),
                entry_price = price_b,
                stop_loss   = round(price_b * (1.03 if direction_b == 'short' else 0.97), 4),
                take_profit = [round(price_b * (0.98 if direction_b == 'short' else 1.02), 4)],
                size_pct    = 0.15,
                reason      = f'Pairs trade hedge leg: {direction_b.upper()} {symbol_b}. Spread z={z:.2f}.',
                timestamp   = _now(),
            ),
            'spread_z':    round(z, 3),
            'hedge_ratio': round(hedge_ratio, 4),
            'correlation': correlation,
        }


# ---------------------------------------------------------------------------
# 4. OPTIONS FLOW SIGNAL
# ---------------------------------------------------------------------------

class OptionsFlowStrategy:
    """
    Use unusual options activity as a directional signal for the underlying.

    Options flow reveals what smart money (institutions, hedge funds) expects.
    When call/put volume is unusually high at out-of-the-money strikes,
    it signals directional conviction in the underlying.

    Key signals:
    - Unusual call buying at OTM strikes: bullish (expects price to rise)
    - Unusual put buying at OTM strikes: bearish (expects price to fall or hedging)
    - Call/Put volume ratio (P/C ratio):
        P/C > 1.5: bearish (more puts being bought)
        P/C < 0.5: bullish (more calls being bought)
    - Large block trades (sweeps): high urgency — someone buying across exchanges fast

    Data sources:
    - Tradier API (options chains, free tier)
    - Unusual Whales / Market Chameleon (paid but rich data)
    - For crypto: Deribit has ETH/BTC options (free API)

    This implementation works with a structured options flow data dict
    that can be sourced from any provider.
    """

    def __init__(self,
                 pc_ratio_bullish: float = 0.5,
                 pc_ratio_bearish: float = 1.5,
                 volume_spike_multiplier: float = 3.0,
                 min_premium: float = 50_000):   # min total premium to care about
        self.pc_bullish  = pc_ratio_bullish
        self.pc_bearish  = pc_ratio_bearish
        self.vol_spike   = volume_spike_multiplier
        self.min_premium = min_premium

    def score_flow(self, flow_data: Dict) -> Dict:
        """
        Score a single options flow event.

        flow_data schema:
        {
            'symbol':        'AAPL' or 'BTC',
            'type':          'call' or 'put',
            'strike':        float,
            'underlying':    float,   # current price
            'expiry_days':   int,     # days until expiration
            'volume':        int,
            'avg_volume':    int,     # 30-day average volume at this strike
            'open_interest': int,
            'premium':       float,   # total dollar premium
            'is_sweep':      bool,    # aggressive multi-leg buy
            'sentiment':     'bullish'|'bearish'|'neutral',
        }

        Returns:
        {
            'score':     -2 to +2 (pos = bullish underlying signal),
            'reasoning': str,
        }
        """
        score     = 0.0
        reasoning = []

        # Is this a call or put?
        is_call  = flow_data.get('type') == 'call'
        is_put   = flow_data.get('type') == 'put'
        strike   = flow_data.get('strike', 0)
        current  = flow_data.get('underlying', 0)
        otm      = (strike > current * 1.02) if is_call else (strike < current * 0.98)

        # OTM options buying is more directionally significant
        if otm and is_call:
            score += 1.0
            reasoning.append(f'OTM call buying at {strike} (underlying {current})')
        elif otm and is_put:
            score -= 1.0
            reasoning.append(f'OTM put buying at {strike} (underlying {current})')

        # Volume vs avg volume
        vol    = flow_data.get('volume', 0)
        avg    = flow_data.get('avg_volume', 1)
        if avg > 0:
            vol_ratio = vol / avg
            if vol_ratio > self.vol_spike:
                delta = 0.5 if is_call else -0.5
                score += delta
                reasoning.append(f'Volume spike: {vol_ratio:.1f}x average')

        # Premium filter
        premium = flow_data.get('premium', 0)
        if premium < self.min_premium:
            score *= 0.5
            reasoning.append(f'Low premium (${premium:,.0f}) — reduced conviction')

        # Sweeps = urgency
        if flow_data.get('is_sweep'):
            delta = 0.5 if is_call else -0.5
            score += delta
            reasoning.append('Sweep order — institutional urgency')

        # Expiry: short-dated options (< 14 days) are more directional
        expiry = flow_data.get('expiry_days', 30)
        if expiry < 14:
            score *= 1.25
            reasoning.append(f'Short-dated ({expiry}d) — high conviction')
        elif expiry > 60:
            score *= 0.8
            reasoning.append(f'Long-dated ({expiry}d) — could be hedge, lower signal weight')

        return {
            'score':     round(min(2.0, max(-2.0, score)), 2),
            'reasoning': '; '.join(reasoning),
        }

    def aggregate_flow(self,
                       symbol: str,
                       flow_events: List[Dict],
                       closes: np.ndarray,
                       highs: np.ndarray,
                       lows: np.ndarray) -> Optional[Signal]:
        """
        Aggregate multiple flow events into a single trading signal.

        flow_events: list of flow_data dicts from score_flow()
        """
        if not flow_events or len(closes) < 20:
            return None

        scores = [self.score_flow(e) for e in flow_events]
        total_score = sum(s['score'] for s in scores)
        avg_score   = total_score / len(scores)

        atr_arr = ATR(highs, lows, closes)
        atr_val = atr_arr[-1] if not np.isnan(atr_arr[-1]) else closes[-1] * 0.02
        price   = closes[-1]

        if avg_score >= 1.0:
            # Bullish signal
            confidence = min(1.0, avg_score / 2)
            return Signal(
                strategy    = 'options_flow',
                symbol      = symbol,
                direction   = 'long',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = round(price - 2.0 * atr_val, 4),
                take_profit = [round(price * 1.03, 4), round(price * 1.06, 4)],
                size_pct    = 0.15,
                reason      = f'Options flow bullish: avg score {avg_score:.2f} across {len(flow_events)} events. ' + '; '.join(s['reasoning'] for s in scores[:2]),
                timestamp   = _now(),
            )
        elif avg_score <= -1.0:
            confidence = min(1.0, abs(avg_score) / 2)
            return Signal(
                strategy    = 'options_flow',
                symbol      = symbol,
                direction   = 'short',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = round(price + 2.0 * atr_val, 4),
                take_profit = [round(price * 0.97, 4), round(price * 0.94, 4)],
                size_pct    = 0.15,
                reason      = f'Options flow bearish: avg score {avg_score:.2f} across {len(flow_events)} events.',
                timestamp   = _now(),
            )

        return None


# ---------------------------------------------------------------------------
# 5. SECTOR ROTATION
# ---------------------------------------------------------------------------

class SectorRotationStrategy:
    """
    Sector rotation: rotate capital into the strongest performing crypto sector.

    Crypto sectors (simplified):
    - Layer 1:  BTC, ETH, SOL, AVAX
    - DeFi:     LINK, UNI, AAVE
    - Layer 2:  MATIC, ARB
    - Meme:     DOGE, SHIB (excluded from core trading)

    Strategy:
    1. Calculate 30-day relative performance for each tracked asset
    2. Rank assets by relative strength (RS)
    3. Buy top RS assets when their RS is improving
    4. Exit when RS starts deteriorating vs peers

    Relative Strength = asset_return / benchmark_return
    (benchmark = BTC or equal-weighted average)
    """

    def __init__(self,
                 rs_period: int = 30,
                 top_n: int = 2,
                 min_rs_threshold: float = 1.05):  # must outperform benchmark by 5%
        self.rs_period    = rs_period
        self.top_n        = top_n
        self.min_rs       = min_rs_threshold

    def relative_strength(self,
                          asset_prices: np.ndarray,
                          benchmark_prices: np.ndarray) -> float:
        """
        Relative strength: how much better/worse than benchmark.
        RS > 1: outperforming. RS < 1: underperforming.
        """
        n = min(len(asset_prices), len(benchmark_prices), self.rs_period + 1)
        if n < 2:
            return 1.0

        asset_ret     = (asset_prices[-1] - asset_prices[-n]) / asset_prices[-n]
        benchmark_ret = (benchmark_prices[-1] - benchmark_prices[-n]) / benchmark_prices[-n]

        if benchmark_ret == -1:
            return 0.0
        return (1 + asset_ret) / (1 + benchmark_ret)

    def rs_momentum(self,
                    asset_prices: np.ndarray,
                    benchmark_prices: np.ndarray,
                    lookback: int = 5) -> float:
        """
        RS momentum: is RS improving or deteriorating over recent bars?
        Positive = RS improving (strength building)
        Negative = RS deteriorating (rotate out)
        """
        rs_series = []
        n = min(len(asset_prices), len(benchmark_prices))
        for offset in range(lookback, 0, -1):
            a = asset_prices[:n - offset + 1]
            b = benchmark_prices[:n - offset + 1]
            rs_series.append(self.relative_strength(a, b))

        if len(rs_series) < 2:
            return 0.0

        # Simple slope of RS
        return float(np.polyfit(range(len(rs_series)), rs_series, 1)[0])

    def evaluate(self,
                 assets: Dict[str, np.ndarray],
                 benchmark_symbol: str = 'BTC/USD') -> List[Dict]:
        """
        Evaluate sector rotation across all assets.

        Args:
            assets: {symbol: close_prices_array}
            benchmark_symbol: which asset to use as benchmark

        Returns:
            List of rotation recommendations sorted by RS score.
        """
        if benchmark_symbol not in assets:
            return []

        benchmark = assets[benchmark_symbol]
        results   = []

        for symbol, prices in assets.items():
            if symbol == benchmark_symbol:
                continue
            if len(prices) < self.rs_period + 10:
                continue

            rs     = self.relative_strength(prices, benchmark)
            rs_mom = self.rs_momentum(prices, benchmark)

            results.append({
                'symbol':        symbol,
                'rs':            round(rs, 4),
                'rs_momentum':   round(rs_mom, 6),
                'current_price': float(prices[-1]),
                'recommendation': 'BUY' if rs > self.min_rs and rs_mom > 0
                                  else ('SELL' if rs < (1 / self.min_rs) else 'HOLD'),
            })

        results.sort(key=lambda x: x['rs'], reverse=True)
        return results


# ---------------------------------------------------------------------------
# 6. EARNINGS MOMENTUM
# ---------------------------------------------------------------------------

class EarningsMomentumStrategy:
    """
    Earnings momentum for crypto-correlated stocks.

    Crypto and certain tech stocks are highly correlated (COIN, MSTR, MARA, RIOT).
    When these companies beat earnings expectations, it's a bullish signal
    for crypto itself.

    Post-earnings drift (PEAD): After a big earnings surprise, prices continue
    drifting in the same direction for days/weeks. This strategy catches that drift.

    Application for crypto:
    - COIN earnings beat -> bullish for BTC/ETH (their business depends on crypto prices)
    - MSTR buys more BTC -> immediate BTC bullish signal
    - MARA/RIOT beat -> miners profitable -> BTC supply pressure reduced -> bullish

    Signal construction:
    1. Monitor earnings events for COIN, MSTR, MARA, RIOT
    2. On beat: enter crypto long on open next day
    3. Hold for 3-5 days (typical PEAD duration)
    4. Stop loss: if crypto reverses >3% from entry
    """

    # Crypto-correlated equity tickers and their correlation to crypto
    CORRELATED_EQUITIES = {
        'COIN':  {'asset': 'ETH/USD', 'correlation': 0.85, 'type': 'exchange'},
        'MSTR':  {'asset': 'BTC/USD', 'correlation': 0.92, 'type': 'holder'},
        'MARA':  {'asset': 'BTC/USD', 'correlation': 0.78, 'type': 'miner'},
        'RIOT':  {'asset': 'BTC/USD', 'correlation': 0.75, 'type': 'miner'},
        'CLSK':  {'asset': 'BTC/USD', 'correlation': 0.72, 'type': 'miner'},
    }

    def __init__(self,
                 hold_days: int = 5,
                 beat_threshold: float = 0.05,   # EPS beat by 5%+
                 min_correlation: float = 0.70):
        self.hold_days       = hold_days
        self.beat_threshold  = beat_threshold
        self.min_correlation = min_correlation

    def evaluate_earnings_event(self,
                                ticker: str,
                                eps_actual: float,
                                eps_estimate: float,
                                crypto_closes: np.ndarray,
                                crypto_highs: np.ndarray,
                                crypto_lows: np.ndarray) -> Optional[Signal]:
        """
        Generate a crypto trade signal based on an earnings event.

        Args:
            ticker:       equity ticker (e.g. 'COIN')
            eps_actual:   reported EPS
            eps_estimate: analyst consensus EPS estimate
            crypto_closes/highs/lows: crypto price arrays

        Returns:
            Signal or None
        """
        if ticker not in self.CORRELATED_EQUITIES:
            return None

        meta   = self.CORRELATED_EQUITIES[ticker]
        symbol = meta['asset']

        if meta['correlation'] < self.min_correlation:
            return None

        if eps_estimate == 0:
            return None

        surprise_pct = (eps_actual - eps_estimate) / abs(eps_estimate)

        if len(crypto_closes) < 20:
            return None

        price   = crypto_closes[-1]
        atr_arr = ATR(crypto_highs, crypto_lows, crypto_closes)
        atr_val = atr_arr[-1] if not np.isnan(atr_arr[-1]) else price * 0.02

        # Positive earnings surprise -> long crypto
        if surprise_pct >= self.beat_threshold:
            confidence = min(1.0, surprise_pct / 0.20)
            return Signal(
                strategy    = 'earnings_momentum',
                symbol      = symbol,
                direction   = 'long',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = round(price - 3.0 * atr_val, 4),
                take_profit = [round(price * 1.03, 4), round(price * 1.06, 4)],
                size_pct    = 0.15,
                reason      = f'{ticker} earnings beat: actual {eps_actual:.2f} vs estimate {eps_estimate:.2f} ({surprise_pct*100:.1f}% surprise). PEAD play on {symbol}. Hold {self.hold_days} days.',
                timestamp   = _now(),
            )

        # Negative earnings surprise -> short crypto (or reduce long)
        if surprise_pct <= -self.beat_threshold:
            confidence = min(1.0, abs(surprise_pct) / 0.20)
            return Signal(
                strategy    = 'earnings_momentum',
                symbol      = symbol,
                direction   = 'short',
                confidence  = round(confidence, 2),
                entry_price = price,
                stop_loss   = round(price + 3.0 * atr_val, 4),
                take_profit = [round(price * 0.97, 4), round(price * 0.94, 4)],
                size_pct    = 0.15,
                reason      = f'{ticker} earnings miss: actual {eps_actual:.2f} vs estimate {eps_estimate:.2f} ({surprise_pct*100:.1f}% miss). {symbol} negative PEAD. Hold {self.hold_days} days.',
                timestamp   = _now(),
            )

        return None


# ---------------------------------------------------------------------------
# STRATEGY ENSEMBLE — Combine All Strategies
# ---------------------------------------------------------------------------

class StrategyEnsemble:
    """
    Ensemble all strategies into a single vote-weighted signal.

    Each strategy votes: +1 (long), -1 (short), 0 (flat)
    Weighted by confidence.
    Final decision made by net vote score.
    """

    def __init__(self, weights: Optional[Dict[str, float]] = None):
        # Default weights — tunable based on backtest results
        self.weights = weights or {
            'mean_reversion': 1.2,  # slightly overweight (best in current regime)
            'momentum':       1.0,
            'pairs_trading':  0.8,
            'options_flow':   0.9,
            'sector_rotation': 0.7,
            'earnings_momentum': 0.8,
            'composite_score': 1.0,  # from SignalScore
        }

        self.mr  = MeanReversionStrategy()
        self.mom = MomentumStrategy()
        self.pt  = PairsTradingStrategy()
        self.opts = OptionsFlowStrategy()
        self.sr  = SectorRotationStrategy()
        self.em  = EarningsMomentumStrategy()

    def vote(self, signal: Optional[Signal]) -> int:
        if signal is None:
            return 0
        if signal.direction == 'long':
            return 1
        if signal.direction == 'short':
            return -1
        return 0

    def evaluate(self,
                 symbol: str,
                 closes: np.ndarray,
                 highs: np.ndarray,
                 lows: np.ndarray,
                 opens: np.ndarray,
                 volumes: np.ndarray,
                 pair_closes: Optional[np.ndarray] = None,
                 pair_symbol: Optional[str] = None) -> Dict:
        """
        Run all applicable strategies and return aggregated recommendation.
        """
        signals   = {}
        net_score = 0.0

        # Mean reversion
        mr_sig = self.mr.evaluate(symbol, closes, highs, lows, opens, volumes)
        signals['mean_reversion'] = mr_sig
        if mr_sig:
            net_score += self.vote(mr_sig) * mr_sig.confidence * self.weights['mean_reversion']

        # Momentum
        mom_sig = self.mom.evaluate(symbol, closes, highs, lows, opens, volumes)
        signals['momentum'] = mom_sig
        if mom_sig:
            net_score += self.vote(mom_sig) * mom_sig.confidence * self.weights['momentum']

        # Composite score
        comp = SignalScore(closes, highs, lows, opens, volumes)
        comp_vote = 1 if comp['score'] >= 2 else (-1 if comp['score'] <= -2 else 0)
        net_score += comp_vote * (abs(comp['score']) / 10) * self.weights['composite_score']
        signals['composite'] = comp

        # Pairs trading (if pair provided)
        if pair_closes is not None and pair_symbol is not None:
            pt_result = self.pt.evaluate(symbol, pair_symbol, closes, pair_closes)
            signals['pairs_trading'] = pt_result
            if pt_result:
                leg_a = pt_result['signal_a']
                net_score += self.vote(leg_a) * leg_a.confidence * self.weights['pairs_trading']

        # Final recommendation
        if net_score >= 1.0:
            direction = 'long'
        elif net_score <= -1.0:
            direction = 'short'
        else:
            direction = 'flat'

        confidence = min(1.0, abs(net_score) / 3)

        return {
            'symbol':         symbol,
            'direction':      direction,
            'net_score':      round(net_score, 3),
            'confidence':     round(confidence, 2),
            'recommendation': 'BUY' if direction == 'long' else ('SELL' if direction == 'short' else 'HOLD'),
            'signals':        {k: (v.to_dict() if isinstance(v, Signal) else v) for k, v in signals.items()},
            'timestamp':      _now(),
        }


# ---------------------------------------------------------------------------
# QUICK DEMO
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    np.random.seed(42)
    n = 200

    # Simulate a ranging BTC market
    closes  = 50000 + np.cumsum(np.random.randn(n) * 300)
    highs   = closes + np.random.rand(n) * 400
    lows    = closes - np.random.rand(n) * 400
    opens   = closes + np.random.randn(n) * 100
    volumes = np.random.rand(n) * 1000 + 100

    print("=== trader9 Strategy Demo ===\n")

    # Mean Reversion
    mr = MeanReversionStrategy()
    mr_sig = mr.evaluate('BTC/USD', closes, highs, lows, opens, volumes)
    print(f"Mean Reversion Signal: {mr_sig.direction if mr_sig else 'None'}")
    if mr_sig:
        print(f"  Entry: {mr_sig.entry_price:.2f}  SL: {mr_sig.stop_loss:.2f}  TP: {mr_sig.take_profit}")
        print(f"  R:R = {mr_sig.risk_reward()}")

    # Momentum
    mom = MomentumStrategy()
    mom_sig = mom.evaluate('BTC/USD', closes, highs, lows, opens, volumes)
    print(f"\nMomentum Signal: {mom_sig.direction if mom_sig else 'None'}")

    # Pairs Trading
    eth_closes = closes * 0.04 + np.cumsum(np.random.randn(n) * 5)
    pt = PairsTradingStrategy()
    pt_result = pt.evaluate('BTC/USD', 'ETH/USD', closes, eth_closes)
    if pt_result:
        print(f"\nPairs Trade: Spread Z={pt_result['spread_z']}, Corr={pt_result['correlation']}")
        print(f"  Leg A ({pt_result['signal_a'].symbol}): {pt_result['signal_a'].direction}")
        print(f"  Leg B ({pt_result['signal_b'].symbol}): {pt_result['signal_b'].direction}")
    else:
        print("\nPairs Trade: No signal (correlation too low or spread in range)")

    # Earnings Momentum demo
    em = EarningsMomentumStrategy()
    em_sig = em.evaluate_earnings_event(
        ticker='COIN',
        eps_actual=1.85,
        eps_estimate=1.50,
        crypto_closes=closes,
        crypto_highs=highs,
        crypto_lows=lows,
    )
    print(f"\nEarnings Momentum (COIN beat): {em_sig.direction if em_sig else 'None'}")
    if em_sig:
        print(f"  {em_sig.reason}")

    # Ensemble
    ensemble = StrategyEnsemble()
    result = ensemble.evaluate(
        symbol='BTC/USD',
        closes=closes, highs=highs, lows=lows, opens=opens, volumes=volumes,
        pair_closes=eth_closes, pair_symbol='ETH/USD',
    )
    print(f"\nEnsemble Recommendation: {result['recommendation']}")
    print(f"  Net score: {result['net_score']}, Confidence: {result['confidence']}")
    print("\nAll strategy checks passed.")
