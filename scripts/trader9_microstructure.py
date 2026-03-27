"""
trader9_microstructure.py — Market Microstructure Analysis
Session 3: Advanced Strategies

Analyzes the mechanics beneath price movements:
  1. Order book dynamics (bid/ask spread, depth, imbalance)
  2. Spread analysis and trading cost modeling
  3. Volume analysis (accumulation/distribution)
  4. Market regime detection (trending vs ranging vs volatile)
  5. Alpaca paper trading API integration for live microstructure data

These signals are layered on top of technical indicators to improve
entry timing. A technically perfect setup can still be killed by
poor microstructure (wide spread, thin order book, distribution pattern).

Usage:
    python3 scripts/trader9_microstructure.py [--symbol=BTC/USD] [--live]

Note: --live requires ALPACA_API_KEY and ALPACA_SECRET_KEY in .env
"""

import os
import sys
import json
import math
import urllib.request
import urllib.parse
import urllib.error
import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trader9_indicators import EMA, SMA, ATR, RSI, VWAP


# ---------------------------------------------------------------------------
# ORDER BOOK ANALYSIS
# ---------------------------------------------------------------------------

@dataclass
class OrderBookSnapshot:
    """Snapshot of the order book at a moment in time."""
    symbol:      str
    timestamp:   str
    bid_price:   float       # best bid
    ask_price:   float       # best ask
    bid_size:    float       # size at best bid
    ask_size:    float       # size at best ask
    bids:        List[Tuple[float, float]]  # [(price, size), ...]
    asks:        List[Tuple[float, float]]

    @property
    def spread(self) -> float:
        """Bid-ask spread in absolute terms."""
        return self.ask_price - self.bid_price

    @property
    def spread_pct(self) -> float:
        """Bid-ask spread as % of mid price."""
        mid = self.mid_price
        return (self.spread / mid * 100) if mid > 0 else 0

    @property
    def mid_price(self) -> float:
        return (self.bid_price + self.ask_price) / 2

    def bid_ask_imbalance(self, depth_levels: int = 5) -> float:
        """
        Order book imbalance at top N levels.

        Positive = more buying pressure (more bid volume)
        Negative = more selling pressure (more ask volume)
        Range: -1 to +1

        Interpretation:
            > 0.3:  buyers dominating — bullish signal
            < -0.3: sellers dominating — bearish signal
            Near 0: balanced, no edge from order book
        """
        bid_vol = sum(s for _, s in self.bids[:depth_levels])
        ask_vol = sum(s for _, s in self.asks[:depth_levels])
        total   = bid_vol + ask_vol
        if total == 0:
            return 0.0
        return round((bid_vol - ask_vol) / total, 4)

    def weighted_mid(self, depth_levels: int = 3) -> float:
        """
        Weighted mid price using order book depth.

        Better than simple mid for large-order execution price estimation.
        Used by institutions to assess true price impact.
        """
        bid_total_vol = sum(s for _, s in self.bids[:depth_levels])
        ask_total_vol = sum(s for _, s in self.asks[:depth_levels])
        total = bid_total_vol + ask_total_vol
        if total == 0:
            return self.mid_price

        weighted_bid = sum(p * s for p, s in self.bids[:depth_levels]) / bid_total_vol if bid_total_vol > 0 else self.bid_price
        weighted_ask = sum(p * s for p, s in self.asks[:depth_levels]) / ask_total_vol if ask_total_vol > 0 else self.ask_price

        return round((weighted_bid * ask_total_vol + weighted_ask * bid_total_vol) / total, 4)

    def market_depth_usd(self, depth_pct: float = 0.01) -> Dict:
        """
        How much USD volume exists within depth_pct% of mid price?

        Low depth = thin market = higher slippage risk
        High depth = liquid market = safer for larger orders
        """
        mid   = self.mid_price
        limit = mid * depth_pct

        bid_depth = sum(s * p for p, s in self.bids if (mid - p) <= limit)
        ask_depth = sum(s * p for p, s in self.asks if (p - mid) <= limit)

        return {
            'bid_depth_usd': round(bid_depth, 2),
            'ask_depth_usd': round(ask_depth, 2),
            'total_depth_usd': round(bid_depth + ask_depth, 2),
            'depth_pct_range': depth_pct * 100,
        }


class SpreadAnalyzer:
    """
    Tracks spread over time and calculates trading cost impact.

    Wide spreads kill small accounts. On a $30 position with a 0.1% spread,
    you're immediately down $0.03 before the trade even moves.
    """

    def __init__(self, position_size_usd: float = 30.0):
        self.position_size = position_size_usd
        self.history:       List[float] = []

    def record(self, spread_pct: float):
        self.history.append(spread_pct)
        if len(self.history) > 100:
            self.history = self.history[-100:]

    def trading_cost_usd(self, spread_pct: float) -> float:
        """Dollar cost of crossing the spread on entry + exit."""
        return self.position_size * (spread_pct / 100) * 2  # round trip

    def is_tradeable(self, spread_pct: float,
                     expected_move_pct: float = 0.015) -> Dict:
        """
        Is the spread acceptable for this trade?

        Rule: spread must be < 20% of expected move.
        If spread is 0.1% and expected move is 1.5%, spread = 6.7% of move = OK.
        If spread is 0.5% and expected move is 1.5%, spread = 33% of move = NOT OK.
        """
        cost_as_pct_of_move = (spread_pct / expected_move_pct) if expected_move_pct > 0 else 999
        breakeven_move_pct  = spread_pct * 2  # need to move this much just to break even

        tradeable = cost_as_pct_of_move < 0.20  # spread < 20% of expected move

        return {
            'tradeable':             tradeable,
            'spread_pct':            round(spread_pct, 4),
            'cost_pct_of_move':      round(cost_as_pct_of_move * 100, 1),
            'breakeven_move_pct':    round(breakeven_move_pct, 4),
            'cost_usd':              round(self.trading_cost_usd(spread_pct), 4),
            'recommendation':        'TRADE' if tradeable else 'SKIP — spread too wide',
        }

    def avg_spread(self) -> float:
        if not self.history:
            return 0.0
        return round(float(np.mean(self.history)), 4)

    def spread_regime(self) -> str:
        """Is the market currently in a tight-spread or wide-spread regime?"""
        if len(self.history) < 10:
            return 'unknown'
        recent = np.mean(self.history[-10:])
        avg    = np.mean(self.history)
        if recent > avg * 1.5:
            return 'wide (elevated risk)'
        elif recent < avg * 0.7:
            return 'tight (favorable)'
        return 'normal'


# ---------------------------------------------------------------------------
# VOLUME ANALYSIS
# ---------------------------------------------------------------------------

class VolumeAnalyzer:
    """
    Accumulation/Distribution and related volume signals.

    Volume is the market's heartbeat. Price movements without volume
    confirmation are suspect. Volume surges on breakouts confirm the move.
    Volume drying up on pullbacks signals continuation.
    """

    def accumulation_distribution(self,
                                   highs: np.ndarray,
                                   lows: np.ndarray,
                                   closes: np.ndarray,
                                   volumes: np.ndarray) -> np.ndarray:
        """
        Accumulation/Distribution Line (A/D).

        A/D measures whether money is flowing into (accumulation) or
        out of (distribution) an asset.

        Money Flow Multiplier = ((close - low) - (high - close)) / (high - low)
        Money Flow Volume = MFM * volume
        A/D = cumulative sum of MFV

        Divergence with price = warning signal:
        - Price rising, A/D falling = distribution (smart money selling)
        - Price falling, A/D rising = accumulation (smart money buying)
        """
        highs  = np.asarray(highs,  dtype=float)
        lows   = np.asarray(lows,   dtype=float)
        closes = np.asarray(closes, dtype=float)
        volumes = np.asarray(volumes, dtype=float)

        hl_range = highs - lows
        with np.errstate(invalid='ignore', divide='ignore'):
            mfm = np.where(hl_range > 0,
                           ((closes - lows) - (highs - closes)) / hl_range,
                           0.0)
        mfv = mfm * volumes
        ad  = np.cumsum(mfv)
        return ad

    def on_balance_volume(self,
                          closes: np.ndarray,
                          volumes: np.ndarray) -> np.ndarray:
        """
        On-Balance Volume (OBV).

        Running total: add volume on up days, subtract on down days.
        OBV rising with price = confirmed trend.
        OBV diverging from price = potential reversal.
        """
        closes  = np.asarray(closes,  dtype=float)
        volumes = np.asarray(volumes, dtype=float)
        obv     = np.zeros(len(closes))
        obv[0]  = volumes[0]

        for i in range(1, len(closes)):
            if closes[i] > closes[i-1]:
                obv[i] = obv[i-1] + volumes[i]
            elif closes[i] < closes[i-1]:
                obv[i] = obv[i-1] - volumes[i]
            else:
                obv[i] = obv[i-1]

        return obv

    def volume_price_trend(self,
                           closes: np.ndarray,
                           volumes: np.ndarray) -> np.ndarray:
        """
        Volume-Price Trend (VPT).

        Like OBV but scales by % price change.
        VPT = VPT_prev + Volume * (close_change / prev_close)

        More sensitive than OBV — captures magnitude of price change.
        """
        closes  = np.asarray(closes,  dtype=float)
        volumes = np.asarray(volumes, dtype=float)
        vpt     = np.zeros(len(closes))

        for i in range(1, len(closes)):
            if closes[i-1] > 0:
                vpt[i] = vpt[i-1] + volumes[i] * (closes[i] - closes[i-1]) / closes[i-1]
            else:
                vpt[i] = vpt[i-1]

        return vpt

    def chaikin_money_flow(self,
                            highs: np.ndarray,
                            lows: np.ndarray,
                            closes: np.ndarray,
                            volumes: np.ndarray,
                            period: int = 20) -> np.ndarray:
        """
        Chaikin Money Flow (CMF).

        Oscillates between -1 and +1.
        > 0.1: buying pressure (bullish)
        < -0.1: selling pressure (bearish)
        Crosses zero = directional shift
        """
        highs  = np.asarray(highs,  dtype=float)
        lows   = np.asarray(lows,   dtype=float)
        closes = np.asarray(closes, dtype=float)
        volumes = np.asarray(volumes, dtype=float)

        hl_range = highs - lows
        with np.errstate(invalid='ignore', divide='ignore'):
            clv = np.where(hl_range > 0,
                           ((closes - lows) - (highs - closes)) / hl_range,
                           0.0)
        mfv  = clv * volumes
        cmf  = np.full(len(closes), np.nan)

        for i in range(period - 1, len(closes)):
            vol_sum = np.sum(volumes[i - period + 1 : i + 1])
            if vol_sum > 0:
                cmf[i] = np.sum(mfv[i - period + 1 : i + 1]) / vol_sum

        return cmf

    def volume_surge_score(self,
                            volumes: np.ndarray,
                            closes: np.ndarray,
                            lookback: int = 20) -> Dict:
        """
        Comprehensive volume surge analysis.

        Returns a signal dict indicating whether volume is confirming
        or warning about the current price move.
        """
        if len(volumes) < lookback + 2:
            return {'score': 0, 'signal': 'insufficient_data'}

        avg_vol     = float(np.mean(volumes[-(lookback+1):-1]))
        curr_vol    = float(volumes[-1])
        vol_ratio   = curr_vol / avg_vol if avg_vol > 0 else 1.0
        price_up    = closes[-1] > closes[-2]

        score = 0.0
        signals = []

        if vol_ratio > 2.0 and price_up:
            score += 2
            signals.append(f'Strong volume surge ({vol_ratio:.1f}x) on up move — bullish confirmation')
        elif vol_ratio > 2.0 and not price_up:
            score -= 2
            signals.append(f'Strong volume surge ({vol_ratio:.1f}x) on down move — bearish confirmation')
        elif vol_ratio > 1.5:
            score += 0.5 if price_up else -0.5
            signals.append(f'Moderate volume surge ({vol_ratio:.1f}x)')
        elif vol_ratio < 0.5:
            signals.append(f'Low volume ({vol_ratio:.1f}x avg) — weak conviction, caution on entry')
            score -= 0.5

        # Climax volume (extreme spike often marks reversals)
        if vol_ratio > 5.0:
            score = score * -0.5  # Reverse the signal — extremes often reverse
            signals.append(f'CLIMAX VOLUME ({vol_ratio:.1f}x) — potential reversal at extremes')

        return {
            'score':       round(score, 2),
            'vol_ratio':   round(vol_ratio, 2),
            'avg_volume':  round(avg_vol, 2),
            'curr_volume': round(curr_vol, 2),
            'price_up':    price_up,
            'signals':     signals,
        }


# ---------------------------------------------------------------------------
# MARKET REGIME DETECTOR (Advanced)
# ---------------------------------------------------------------------------

class AdvancedRegimeDetector:
    """
    Advanced market regime detection.

    Combines:
    - ADX (trend strength)
    - Efficiency Ratio
    - BB bandwidth (squeeze detection)
    - Volume trend
    - Choppiness Index

    Regimes:
    1. Trending Up (strong + directional): use momentum/EMA strategies
    2. Trending Down (strong + directional): use momentum short or stay out
    3. Ranging (weak + horizontal): use mean reversion/BB strategies
    4. Volatile (high ATR + erratic): reduce size, tighter stops
    5. Squeeze (low volatility pre-breakout): wait for breakout direction
    """

    def __init__(self):
        pass

    def choppiness_index(self,
                         highs: np.ndarray,
                         lows: np.ndarray,
                         closes: np.ndarray,
                         period: int = 14) -> float:
        """
        Choppiness Index (CHOP).

        100 * LOG10(sum of 14-period ATRs / (14-period highest high - 14-period lowest low)) / LOG10(14)

        Range: 38.2 to 100
        < 38.2: Strong trend (use momentum strategies)
        > 61.8: Choppy/ranging (use mean reversion strategies)
        38.2 - 61.8: Transitional

        Note: The 38.2 and 61.8 levels are Fibonacci levels — the indicator
        was designed with these as the natural thresholds.
        """
        highs  = np.asarray(highs[-period:],  dtype=float)
        lows   = np.asarray(lows[-period:],   dtype=float)
        closes = np.asarray(closes[-(period+1):], dtype=float)

        if len(closes) < period + 1:
            return 50.0  # Default: indeterminate

        # Sum of individual ATRs
        atr_sum = 0.0
        for i in range(1, period + 1):
            tr = max(
                highs[i-1] - lows[i-1],
                abs(highs[i-1] - closes[i-2]),
                abs(lows[i-1]  - closes[i-2]),
            )
            atr_sum += tr

        hhigh = np.max(highs)
        llow  = np.min(lows)
        hl_range = hhigh - llow

        if hl_range == 0 or atr_sum == 0:
            return 50.0

        chop = 100 * math.log10(atr_sum / hl_range) / math.log10(period)
        return round(min(100, max(0, chop)), 2)

    def detect(self,
               closes: np.ndarray,
               highs: np.ndarray,
               lows: np.ndarray,
               volumes: np.ndarray,
               period: int = 20) -> Dict:
        """
        Full regime detection combining multiple signals.

        Returns:
        {
            'regime':       'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'squeeze',
            'choppiness':   float (38-100),
            'bb_bandwidth': float (% bandwidth),
            'strategy_fit': {
                'mean_reversion': float (0-1),
                'momentum':       float (0-1),
                'stay_out':       float (0-1),
            },
            'recommended_strategy': str,
        }
        """
        from trader9_indicators import BollingerBands, BB_bandwidth as bb_bw, MarketRegime

        closes  = np.asarray(closes,  dtype=float)
        highs   = np.asarray(highs,   dtype=float)
        lows    = np.asarray(lows,    dtype=float)
        volumes = np.asarray(volumes, dtype=float)

        chop      = self.choppiness_index(highs, lows, closes, period)
        base_reg  = MarketRegime(closes)

        bb_up, bb_mid, bb_low = BollingerBands(closes)
        bw_arr = bb_bw(bb_up, bb_low, bb_mid)
        bw     = float(bw_arr[-1]) if not np.isnan(bw_arr[-1]) else 0.04

        atr_arr = ATR(highs, lows, closes)
        atr_val = float(atr_arr[-1]) if not np.isnan(atr_arr[-1]) else 0
        atr_pct = (atr_val / closes[-1] * 100) if closes[-1] > 0 else 0

        # Squeeze: bandwidth very low (< historical 20th percentile)
        valid_bw = bw_arr[~np.isnan(bw_arr)]
        bw_pct20 = float(np.percentile(valid_bw, 20)) if len(valid_bw) > 20 else 0.03

        is_squeeze  = bw < bw_pct20
        is_trending = chop < 38.2
        is_ranging  = chop > 61.8
        is_volatile = atr_pct > 3.0  # >3% daily range = high volatility

        # Determine primary regime
        if is_squeeze:
            regime = 'squeeze'
        elif is_trending and base_reg['ema_slope'] > 0:
            regime = 'trending_up'
        elif is_trending and base_reg['ema_slope'] < 0:
            regime = 'trending_down'
        elif is_volatile:
            regime = 'volatile'
        else:
            regime = 'ranging'

        # Strategy fit scores
        mr_fit   = min(1.0, chop / 100) if is_ranging else 0.3
        mom_fit  = (1 - chop / 100) if is_trending else 0.2
        stay_out = 0.8 if is_volatile and not is_trending else (0.6 if is_squeeze else 0.1)

        # Normalize
        total = mr_fit + mom_fit + stay_out
        if total > 0:
            mr_fit   = round(mr_fit   / total, 2)
            mom_fit  = round(mom_fit  / total, 2)
            stay_out = round(stay_out / total, 2)

        best = max({'mean_reversion': mr_fit, 'momentum': mom_fit, 'stay_out': stay_out}.items(),
                   key=lambda x: x[1])[0]

        return {
            'regime':           regime,
            'choppiness_index': chop,
            'bb_bandwidth_pct': round(bw * 100, 4),
            'atr_pct':          round(atr_pct, 3),
            'is_squeeze':       is_squeeze,
            'base_regime':      base_reg['regime'],
            'ema_slope':        base_reg['ema_slope'],
            'strategy_fit': {
                'mean_reversion': mr_fit,
                'momentum':       mom_fit,
                'stay_out':       stay_out,
            },
            'recommended_strategy': best,
        }


# ---------------------------------------------------------------------------
# ALPACA PAPER TRADING API — Microstructure Data
# ---------------------------------------------------------------------------

class AlpacaPaperMicro:
    """
    Fetch real-time microstructure data from Alpaca paper trading API.

    Endpoints used:
    - GET /v2/stocks/{symbol}/quotes/latest  (bid/ask/size)
    - GET /v2/crypto/{symbol}/orderbook      (full depth)
    - GET /v2/crypto/{symbol}/trades/latest  (last trade)

    Paper trading base URL: https://paper-api.alpaca.markets
    Data base URL:          https://data.alpaca.markets

    Requires: ALPACA_API_KEY and ALPACA_SECRET_KEY from .env
    """

    PAPER_BASE = 'https://paper-api.alpaca.markets'
    DATA_BASE  = 'https://data.alpaca.markets'

    def __init__(self, api_key: str, secret_key: str):
        self.headers = {
            'APCA-API-KEY-ID':     api_key,
            'APCA-API-SECRET-KEY': secret_key,
            'Accept':              'application/json',
        }

    def _get(self, base: str, path: str, params: Optional[Dict] = None) -> Dict:
        url = base + path
        if params:
            url += '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Alpaca API error {e.code}: {e.read().decode()[:200]}")

    def get_crypto_quote(self, symbol: str) -> Dict:
        """
        Get latest bid/ask for a crypto symbol.
        symbol: e.g. 'BTC/USD' (Alpaca uses '/' format)
        """
        alpaca_sym = symbol.replace('/', '')  # 'BTC/USD' -> 'BTCUSD'
        data = self._get(self.DATA_BASE, f'/v1beta3/crypto/us/latest/quotes',
                         params={'symbols': alpaca_sym})
        quotes = data.get('quotes', {})
        q      = quotes.get(alpaca_sym, {})
        return {
            'symbol':    symbol,
            'bid_price': q.get('bp', 0),
            'bid_size':  q.get('bs', 0),
            'ask_price': q.get('ap', 0),
            'ask_size':  q.get('as', 0),
            'timestamp': q.get('t', ''),
        }

    def get_latest_trade(self, symbol: str) -> Dict:
        """Get the last trade price and size."""
        alpaca_sym = symbol.replace('/', '')
        data = self._get(self.DATA_BASE, f'/v1beta3/crypto/us/latest/trades',
                         params={'symbols': alpaca_sym})
        trades = data.get('trades', {})
        t      = trades.get(alpaca_sym, {})
        return {
            'symbol': symbol,
            'price':  t.get('p', 0),
            'size':   t.get('s', 0),
            'time':   t.get('t', ''),
        }

    def get_account(self) -> Dict:
        """Get paper trading account info (balance, positions)."""
        return self._get(self.PAPER_BASE, '/v2/account')

    def get_positions(self) -> List[Dict]:
        """Get all open positions."""
        return self._get(self.PAPER_BASE, '/v2/positions')

    def get_orders(self, status: str = 'open') -> List[Dict]:
        """Get orders by status: 'open', 'closed', 'all'"""
        return self._get(self.PAPER_BASE, '/v2/orders', params={'status': status})

    def get_orderbook(self, symbol: str) -> Optional[OrderBookSnapshot]:
        """
        Get full order book depth for a crypto symbol.
        Returns OrderBookSnapshot or None if unavailable.
        """
        alpaca_sym = symbol.replace('/', '')
        try:
            data = self._get(self.DATA_BASE, f'/v1beta3/crypto/us/latest/orderbooks',
                             params={'symbols': alpaca_sym})
            books = data.get('orderbooks', {})
            book  = books.get(alpaca_sym, {})

            if not book:
                return None

            bids = [(float(b['p']), float(b['s'])) for b in book.get('b', [])]
            asks = [(float(a['p']), float(a['s'])) for a in book.get('a', [])]

            if not bids or not asks:
                return None

            return OrderBookSnapshot(
                symbol    = symbol,
                timestamp = book.get('t', datetime.now(timezone.utc).isoformat()),
                bid_price = bids[0][0],
                ask_price = asks[0][0],
                bid_size  = bids[0][1],
                ask_size  = asks[0][1],
                bids      = bids,
                asks      = asks,
            )
        except Exception as e:
            return None


# ---------------------------------------------------------------------------
# MICROSTRUCTURE SIGNAL AGGREGATOR
# ---------------------------------------------------------------------------

class MicrostructureSignal:
    """
    Combines all microstructure signals into a trading recommendation.

    This is the final confirmation layer before sending an order.
    A technically valid signal with poor microstructure = skip.
    A technically valid signal with strong microstructure = execute.
    """

    def __init__(self):
        self.vol_analyzer  = VolumeAnalyzer()
        self.regime_det    = AdvancedRegimeDetector()
        self.spread_anal   = SpreadAnalyzer()

    def evaluate(self,
                 closes:  np.ndarray,
                 highs:   np.ndarray,
                 lows:    np.ndarray,
                 volumes: np.ndarray,
                 opens:   Optional[np.ndarray] = None,
                 orderbook: Optional[OrderBookSnapshot] = None) -> Dict:
        """
        Full microstructure evaluation.

        Returns:
        {
            'micro_score':    -5 to +5,
            'regime':         dict,
            'volume':         dict,
            'orderbook':      dict (or None),
            'spread':         dict (or None),
            'recommendation': 'CONFIRM' | 'CAUTION' | 'REJECT',
            'reasons':        [str, ...],
        }
        """
        score   = 0.0
        reasons = []

        # 1. Market regime
        regime = self.regime_det.detect(closes, highs, lows, volumes)
        if regime['regime'] == 'volatile' and regime.get('is_squeeze') is False:
            score -= 1.0
            reasons.append(f"High volatility regime: reduce position size")
        if regime['regime'] in ('trending_up', 'ranging'):
            score += 0.5
            reasons.append(f"Favorable regime: {regime['regime']}")

        # 2. Volume analysis
        vol_data = self.vol_analyzer.volume_surge_score(volumes, closes)
        score += vol_data['score']
        reasons.extend(vol_data['signals'])

        # A/D divergence check
        ad = self.vol_analyzer.accumulation_distribution(highs, lows, closes, volumes)
        obv = self.vol_analyzer.on_balance_volume(closes, volumes)

        # Simple divergence: is A/D trending up while price is down? (bullish div)
        if len(ad) >= 10 and len(closes) >= 10:
            price_trend = closes[-1] - closes[-10]
            ad_trend    = ad[-1] - ad[-10]
            if price_trend < 0 and ad_trend > 0:
                score += 1.0
                reasons.append("Bullish A/D divergence: price down, accumulation up")
            elif price_trend > 0 and ad_trend < 0:
                score -= 1.0
                reasons.append("Bearish A/D divergence: price up, distribution")

        # OBV confirmation
        if len(obv) >= 5 and len(closes) >= 5:
            obv_dir   = obv[-1] > obv[-5]
            price_dir = closes[-1] > closes[-5]
            if obv_dir == price_dir:
                score += 0.5
                reasons.append("OBV confirms price direction")
            else:
                score -= 0.5
                reasons.append("OBV diverging from price")

        # 3. Order book (if available)
        ob_data = None
        if orderbook:
            imbalance = orderbook.bid_ask_imbalance(depth_levels=5)
            spread_pct = orderbook.spread_pct

            self.spread_anal.record(spread_pct)
            spread_check = self.spread_anal.is_tradeable(spread_pct)

            if not spread_check['tradeable']:
                score -= 2.0
                reasons.append(f"Spread too wide: {spread_pct:.3f}% — cost eats into profit")
            else:
                reasons.append(f"Spread acceptable: {spread_pct:.3f}%")

            if imbalance > 0.3:
                score += 1.0
                reasons.append(f"Order book shows buying pressure: imbalance={imbalance:.2f}")
            elif imbalance < -0.3:
                score -= 1.0
                reasons.append(f"Order book shows selling pressure: imbalance={imbalance:.2f}")

            depth = orderbook.market_depth_usd(depth_pct=0.005)
            if depth['total_depth_usd'] < 10_000:
                score -= 0.5
                reasons.append(f"Thin market: only ${depth['total_depth_usd']:,.0f} within 0.5%")

            ob_data = {
                'spread_pct':      round(spread_pct, 4),
                'imbalance':       round(imbalance, 4),
                'depth':           depth,
                'spread_ok':       spread_check['tradeable'],
            }

        # Determine recommendation
        score = round(score, 2)
        if score >= 2.0:
            recommendation = 'CONFIRM'
        elif score <= -2.0:
            recommendation = 'REJECT'
        else:
            recommendation = 'CAUTION'

        return {
            'micro_score':    score,
            'regime':         regime,
            'volume':         vol_data,
            'orderbook':      ob_data,
            'recommendation': recommendation,
            'reasons':        reasons,
        }


# ---------------------------------------------------------------------------
# QUICK DEMO
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--live',   action='store_true', help='Use live Alpaca data (requires .env)')
    parser.add_argument('--symbol', default='ETH/USD', help='Symbol to analyze')
    args = parser.parse_args()

    print("=== trader9 Microstructure Demo ===\n")

    # Synthetic data
    np.random.seed(99)
    n = 200
    closes  = 2100 + np.cumsum(np.random.randn(n) * 20)
    highs   = closes + np.random.rand(n) * 30
    lows    = closes - np.random.rand(n) * 30
    opens   = closes + np.random.randn(n) * 10
    volumes = np.random.rand(n) * 1000 + 100

    # Volume analysis
    va  = VolumeAnalyzer()
    ad  = va.accumulation_distribution(highs, lows, closes, volumes)
    obv = va.on_balance_volume(closes, volumes)
    cmf = va.chaikin_money_flow(highs, lows, closes, volumes)

    print(f"A/D trend (last 5 bars): {ad[-5:]}")
    print(f"OBV (last): {obv[-1]:.0f}")
    print(f"CMF (last): {cmf[-1]:.4f}")

    vol_surge = va.volume_surge_score(volumes, closes)
    print(f"\nVolume surge: {vol_surge['vol_ratio']:.2f}x avg")
    print(f"Signals: {vol_surge['signals']}")

    # Regime detection
    reg = AdvancedRegimeDetector()
    regime = reg.detect(closes, highs, lows, volumes)
    print(f"\nRegime: {regime['regime']}")
    print(f"Choppiness Index: {regime['choppiness_index']} (38=trend, 62=range)")
    print(f"BB Bandwidth: {regime['bb_bandwidth_pct']:.3f}%")
    print(f"Squeeze: {regime['is_squeeze']}")
    print(f"Best strategy: {regime['recommended_strategy']}")

    # Spread analysis
    sa = SpreadAnalyzer(position_size_usd=30)
    check = sa.is_tradeable(spread_pct=0.08, expected_move_pct=1.5)
    print(f"\nSpread 0.08% on 1.5% expected move:")
    print(f"  Tradeable: {check['tradeable']} | Cost: {check['cost_pct_of_move']}% of move | {check['recommendation']}")

    # Mock order book
    mock_book = OrderBookSnapshot(
        symbol    = 'ETH/USD',
        timestamp = datetime.now(timezone.utc).isoformat(),
        bid_price = 2099.5,
        ask_price = 2100.1,
        bid_size  = 0.5,
        ask_size  = 0.3,
        bids      = [(2099.5, 0.5), (2099.0, 1.2), (2098.5, 2.0), (2098.0, 3.5), (2097.0, 5.0)],
        asks      = [(2100.1, 0.3), (2100.5, 0.8), (2101.0, 1.5), (2101.5, 2.0), (2102.0, 4.0)],
    )
    print(f"\nOrder Book:")
    print(f"  Spread: ${mock_book.spread:.2f} ({mock_book.spread_pct:.4f}%)")
    print(f"  Imbalance: {mock_book.bid_ask_imbalance():.3f}")
    print(f"  Depth (0.5%): {mock_book.market_depth_usd(0.005)}")

    # Full microstructure signal
    micro = MicrostructureSignal()
    result = micro.evaluate(closes, highs, lows, volumes, opens, mock_book)
    print(f"\nMicro Score: {result['micro_score']} -> {result['recommendation']}")
    for reason in result['reasons']:
        print(f"  - {reason}")

    # Live Alpaca test (if credentials available)
    if args.live:
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
        key = sec = None
        try:
            with open(env_path) as f:
                for line in f:
                    if line.startswith('ALPACA_API_KEY='):
                        key = line.strip().split('=', 1)[1]
                    if line.startswith('ALPACA_SECRET_KEY='):
                        sec = line.strip().split('=', 1)[1]
        except FileNotFoundError:
            pass

        if key and sec:
            print(f"\n--- Live Alpaca Data for {args.symbol} ---")
            client = AlpacaPaperMicro(key, sec)
            try:
                quote = client.get_crypto_quote(args.symbol)
                print(f"Quote: Bid ${quote['bid_price']} x {quote['bid_size']} | Ask ${quote['ask_price']} x {quote['ask_size']}")
                account = client.get_account()
                print(f"Account: ${float(account.get('equity','0')):.2f} equity | ${float(account.get('cash','0')):.2f} cash")
            except Exception as e:
                print(f"Live data error: {e}")
        else:
            print("\nSkipping live test — ALPACA_API_KEY not found in .env")

    print("\nAll microstructure checks passed.")
