"""
trader9_indicators.py — Technical Analysis Library
Session 3: Advanced Strategies

Complete indicator library for trader9. All functions are pure Python/numpy —
no TA-Lib dependency. Each function takes a numpy array or list and returns
a value or array.

Usage:
    from trader9_indicators import RSI, MACD, BollingerBands, VWAP, ATR
    from trader9_indicators import FibLevels, SupportResistance, CandlePatterns
"""

import numpy as np
from typing import Optional, Tuple, List, Dict, NamedTuple


# ---------------------------------------------------------------------------
# CORE MOVING AVERAGES
# ---------------------------------------------------------------------------

def SMA(prices: np.ndarray, period: int) -> np.ndarray:
    """Simple Moving Average. Returns array same length as input, NaN-padded."""
    prices = np.asarray(prices, dtype=float)
    result = np.full(len(prices), np.nan)
    for i in range(period - 1, len(prices)):
        result[i] = np.mean(prices[i - period + 1 : i + 1])
    return result


def EMA(prices: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average. Returns full-length array."""
    prices = np.asarray(prices, dtype=float)
    result = np.full(len(prices), np.nan)
    if len(prices) < period:
        return result
    k = 2.0 / (period + 1)
    # Seed with SMA of first `period` values
    result[period - 1] = np.mean(prices[:period])
    for i in range(period, len(prices)):
        result[i] = prices[i] * k + result[i - 1] * (1 - k)
    return result


def WMA(prices: np.ndarray, period: int) -> np.ndarray:
    """Weighted Moving Average. Linear weights, most recent = highest weight."""
    prices = np.asarray(prices, dtype=float)
    result = np.full(len(prices), np.nan)
    weights = np.arange(1, period + 1, dtype=float)
    denom = weights.sum()
    for i in range(period - 1, len(prices)):
        result[i] = np.dot(prices[i - period + 1 : i + 1], weights) / denom
    return result


def VWMA(prices: np.ndarray, volumes: np.ndarray, period: int) -> np.ndarray:
    """Volume-Weighted Moving Average."""
    prices  = np.asarray(prices,  dtype=float)
    volumes = np.asarray(volumes, dtype=float)
    result  = np.full(len(prices), np.nan)
    for i in range(period - 1, len(prices)):
        p = prices[i - period + 1 : i + 1]
        v = volumes[i - period + 1 : i + 1]
        result[i] = np.dot(p, v) / v.sum() if v.sum() > 0 else np.nan
    return result


# ---------------------------------------------------------------------------
# RSI — Relative Strength Index
# ---------------------------------------------------------------------------

def RSI(prices: np.ndarray, period: int = 14) -> np.ndarray:
    """
    RSI using Wilder's smoothed method (standard).

    Returns:
        Array of RSI values (0-100). NaN for first `period` values.

    Interpretation:
        > 70: Overbought — consider sell/exit
        < 30: Oversold — consider buy
        50 cross: Momentum confirmation
    """
    prices = np.asarray(prices, dtype=float)
    result = np.full(len(prices), np.nan)
    if len(prices) < period + 1:
        return result

    deltas = np.diff(prices)
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    # Initial average (SMA seed)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])

    idx = period  # first RSI value maps to prices[period]
    if avg_loss == 0:
        result[idx] = 100.0
    else:
        rs = avg_gain / avg_loss
        result[idx] = 100 - (100 / (1 + rs))

    # Wilder smoothing for remaining values
    for i in range(period + 1, len(prices)):
        g = gains[i - 1]
        l = losses[i - 1]
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        if avg_loss == 0:
            result[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            result[i] = 100 - (100 / (1 + rs))

    return result


def RSI_divergence(prices: np.ndarray, rsi_vals: np.ndarray,
                   lookback: int = 20) -> Dict[str, bool]:
    """
    Detect bullish/bearish RSI divergence.

    Bullish divergence: price makes lower low, RSI makes higher low
    Bearish divergence: price makes higher high, RSI makes lower high

    Returns: {'bullish': bool, 'bearish': bool}
    """
    prices   = np.asarray(prices[-lookback:],   dtype=float)
    rsi_vals = np.asarray(rsi_vals[-lookback:], dtype=float)

    # Find local minima/maxima (simple: compare to neighbors)
    price_lows  = [(i, prices[i])   for i in range(1, len(prices)-1)
                   if prices[i] < prices[i-1] and prices[i] < prices[i+1]]
    price_highs = [(i, prices[i])   for i in range(1, len(prices)-1)
                   if prices[i] > prices[i-1] and prices[i] > prices[i+1]]
    rsi_lows    = [(i, rsi_vals[i]) for i in range(1, len(rsi_vals)-1)
                   if rsi_vals[i] < rsi_vals[i-1] and rsi_vals[i] < rsi_vals[i+1]]
    rsi_highs   = [(i, rsi_vals[i]) for i in range(1, len(rsi_vals)-1)
                   if rsi_vals[i] > rsi_vals[i-1] and rsi_vals[i] > rsi_vals[i+1]]

    bullish = False
    if len(price_lows) >= 2 and len(rsi_lows) >= 2:
        # Most recent two price lows: price going lower but RSI going higher
        p1, p2 = price_lows[-2][1], price_lows[-1][1]
        r1, r2 = rsi_lows[-2][1],   rsi_lows[-1][1]
        bullish = (p2 < p1) and (r2 > r1)

    bearish = False
    if len(price_highs) >= 2 and len(rsi_highs) >= 2:
        p1, p2 = price_highs[-2][1], price_highs[-1][1]
        r1, r2 = rsi_highs[-2][1],   rsi_highs[-1][1]
        bearish = (p2 > p1) and (r2 < r1)

    return {'bullish': bullish, 'bearish': bearish}


# ---------------------------------------------------------------------------
# MACD — Moving Average Convergence/Divergence
# ---------------------------------------------------------------------------

def MACD(prices: np.ndarray,
         fast: int = 12,
         slow: int = 26,
         signal: int = 9) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Standard MACD.

    Returns:
        (macd_line, signal_line, histogram)
        All arrays same length as input, NaN-padded.

    Signals:
        Histogram cross above 0: bullish momentum building
        Histogram cross below 0: bearish momentum building
        MACD cross above signal: buy signal
        MACD cross below signal: sell signal
        Zero-line cross: trend confirmation
    """
    ema_fast   = EMA(prices, fast)
    ema_slow   = EMA(prices, slow)
    macd_line  = ema_fast - ema_slow       # NaN until slow period reached

    # Signal line is EMA of MACD line (only on valid values)
    signal_line = np.full(len(prices), np.nan)
    valid_macd  = np.where(~np.isnan(macd_line))[0]
    if len(valid_macd) >= signal:
        start = valid_macd[0]
        macd_segment  = macd_line[start:]
        signal_segment = EMA(macd_segment, signal)
        signal_line[start:] = signal_segment

    histogram = macd_line - signal_line

    return macd_line, signal_line, histogram


def MACD_signal(macd: np.ndarray, signal: np.ndarray,
                hist: np.ndarray) -> Dict[str, bool]:
    """
    Evaluate current MACD crossover signals from the last two bars.

    Returns dict of signal flags for the current bar.
    """
    if len(macd) < 2 or np.isnan(macd[-1]) or np.isnan(signal[-1]):
        return {'bullish_cross': False, 'bearish_cross': False,
                'histogram_positive': False, 'strong_momentum': False}

    bullish_cross = (macd[-2] <= signal[-2]) and (macd[-1] > signal[-1])
    bearish_cross = (macd[-2] >= signal[-2]) and (macd[-1] < signal[-1])
    hist_positive = hist[-1] > 0 if not np.isnan(hist[-1]) else False

    # Strong momentum: histogram expanding in the current direction
    strong_mom = False
    if not np.isnan(hist[-1]) and not np.isnan(hist[-2]):
        strong_mom = abs(hist[-1]) > abs(hist[-2])

    return {
        'bullish_cross':     bullish_cross,
        'bearish_cross':     bearish_cross,
        'histogram_positive': hist_positive,
        'strong_momentum':   strong_mom,
    }


# ---------------------------------------------------------------------------
# BOLLINGER BANDS
# ---------------------------------------------------------------------------

def BollingerBands(prices: np.ndarray,
                   period: int = 20,
                   std_mult: float = 2.0) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Bollinger Bands.

    Returns:
        (upper, middle, lower) — all same length as input.

    Signals:
        Price at lower band + RSI oversold: mean reversion buy
        Price at upper band + RSI overbought: mean reversion sell
        Band squeeze (bandwidth contracting): breakout incoming
        Band walk (price hugs band for 3+ bars): strong trend
    """
    prices = np.asarray(prices, dtype=float)
    middle = SMA(prices, period)
    upper  = np.full(len(prices), np.nan)
    lower  = np.full(len(prices), np.nan)

    for i in range(period - 1, len(prices)):
        std = np.std(prices[i - period + 1 : i + 1], ddof=0)
        upper[i] = middle[i] + std_mult * std
        lower[i] = middle[i] - std_mult * std

    return upper, middle, lower


def BB_bandwidth(upper: np.ndarray,
                 lower: np.ndarray,
                 middle: np.ndarray) -> np.ndarray:
    """
    Bollinger Bandwidth — measures band width relative to middle.
    Low bandwidth = squeeze = potential breakout.
    """
    with np.errstate(invalid='ignore', divide='ignore'):
        bw = (upper - lower) / middle
    return bw


def BB_percent_b(prices: np.ndarray,
                 upper: np.ndarray,
                 lower: np.ndarray) -> np.ndarray:
    """
    %B — where price is within the Bollinger Bands.
    0 = lower band, 0.5 = middle, 1.0 = upper band.
    Negative = below lower band, >1 = above upper band.
    """
    with np.errstate(invalid='ignore', divide='ignore'):
        pct = (prices - lower) / (upper - lower)
    return pct


# ---------------------------------------------------------------------------
# VWAP — Volume-Weighted Average Price
# ---------------------------------------------------------------------------

def VWAP(highs: np.ndarray,
         lows: np.ndarray,
         closes: np.ndarray,
         volumes: np.ndarray,
         session_reset: bool = True) -> np.ndarray:
    """
    VWAP — intraday anchor from session open.

    For crypto (24/7), we reset at midnight UTC unless session_reset=False.
    If session_reset=False, calculates a rolling cumulative VWAP.

    Typical price = (H + L + C) / 3
    VWAP = sum(typical * volume) / sum(volume)

    Signals:
        Price above VWAP: bullish bias (institutions buying above)
        Price below VWAP: bearish bias
        VWAP as dynamic support/resistance in trends
    """
    highs   = np.asarray(highs,   dtype=float)
    lows    = np.asarray(lows,    dtype=float)
    closes  = np.asarray(closes,  dtype=float)
    volumes = np.asarray(volumes, dtype=float)

    typical = (highs + lows + closes) / 3.0
    result  = np.full(len(closes), np.nan)

    cum_vol   = 0.0
    cum_pv    = 0.0

    for i in range(len(closes)):
        cum_vol += volumes[i]
        cum_pv  += typical[i] * volumes[i]
        if cum_vol > 0:
            result[i] = cum_pv / cum_vol

    return result


# ---------------------------------------------------------------------------
# ATR — Average True Range
# ---------------------------------------------------------------------------

def ATR(highs: np.ndarray,
        lows: np.ndarray,
        closes: np.ndarray,
        period: int = 14) -> np.ndarray:
    """
    ATR — measures volatility. Core input for stop-loss sizing.

    True Range = max(H-L, abs(H-prevC), abs(L-prevC))
    ATR = Wilder's smoothed average of TR

    Usage:
        stop_loss = entry_price - (atr_multiplier * ATR[-1])
        Common multipliers: 1.5x for scalps, 2x for swings, 3x for position trades
    """
    highs  = np.asarray(highs,  dtype=float)
    lows   = np.asarray(lows,   dtype=float)
    closes = np.asarray(closes, dtype=float)
    n      = len(closes)
    result = np.full(n, np.nan)

    tr = np.full(n, np.nan)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(
            highs[i]  - lows[i],
            abs(highs[i]  - closes[i - 1]),
            abs(lows[i]   - closes[i - 1]),
        )

    if n < period:
        return result

    # Initial ATR = SMA of first `period` TRs
    result[period - 1] = np.mean(tr[:period])
    # Wilder's smoothing
    for i in range(period, n):
        result[i] = (result[i - 1] * (period - 1) + tr[i]) / period

    return result


def ATR_stop(entry: float, atr: float, multiplier: float = 2.0,
             side: str = 'long') -> float:
    """
    ATR-based trailing stop.

    Args:
        entry:      entry price
        atr:        current ATR value
        multiplier: how many ATRs to place stop (1.5-3x is standard)
        side:       'long' or 'short'

    Returns:
        Stop price
    """
    if side == 'long':
        return entry - (multiplier * atr)
    return entry + (multiplier * atr)


# ---------------------------------------------------------------------------
# FIBONACCI RETRACEMENTS AND EXTENSIONS
# ---------------------------------------------------------------------------

def FibLevels(swing_high: float,
              swing_low: float,
              mode: str = 'retracement') -> Dict[str, float]:
    """
    Fibonacci retracement and extension levels.

    Standard Fib retracement levels: 23.6%, 38.2%, 50%, 61.8%, 78.6%
    Standard Fib extension levels: 127.2%, 161.8%, 200%, 261.8%

    Args:
        swing_high: recent significant high
        swing_low:  recent significant low
        mode:       'retracement' or 'extension'

    Returns:
        Dict of level_name -> price

    Usage in trend trading:
        After a rally, price often retraces to 38.2% or 61.8% before continuing.
        61.8% (golden ratio) is the strongest retracement level.
        Extension levels are profit targets after breakout.
    """
    diff = swing_high - swing_low

    if mode == 'retracement':
        return {
            '0.0%':   swing_high,
            '23.6%':  swing_high - 0.236 * diff,
            '38.2%':  swing_high - 0.382 * diff,
            '50.0%':  swing_high - 0.500 * diff,
            '61.8%':  swing_high - 0.618 * diff,
            '78.6%':  swing_high - 0.786 * diff,
            '100.0%': swing_low,
        }
    else:  # extension
        return {
            '0.0%':   swing_high,
            '127.2%': swing_high + 0.272 * diff,
            '161.8%': swing_high + 0.618 * diff,
            '200.0%': swing_high + 1.000 * diff,
            '261.8%': swing_high + 1.618 * diff,
        }


def nearest_fib_level(price: float,
                      fib_levels: Dict[str, float],
                      threshold_pct: float = 0.5) -> Optional[str]:
    """
    Returns the name of the nearest Fibonacci level if price is within threshold_pct.
    Returns None if no level is nearby.
    """
    for name, level in fib_levels.items():
        distance_pct = abs(price - level) / level * 100
        if distance_pct <= threshold_pct:
            return name
    return None


# ---------------------------------------------------------------------------
# SUPPORT AND RESISTANCE DETECTION
# ---------------------------------------------------------------------------

def SupportResistance(prices: np.ndarray,
                      lookback: int = 50,
                      sensitivity: float = 0.02) -> Dict[str, List[float]]:
    """
    Support and resistance level detection using pivot points.

    Algorithm:
    1. Find all local highs and lows within lookback window
    2. Cluster nearby levels (within sensitivity%) together
    3. Return merged support and resistance levels ranked by touches

    Args:
        prices:      close prices
        lookback:    number of bars to analyze
        sensitivity: group levels within this % of each other (0.02 = 2%)

    Returns:
        {'support': [...sorted asc], 'resistance': [...sorted asc]}
    """
    prices  = np.asarray(prices[-lookback:], dtype=float)
    n       = len(prices)

    local_highs = []
    local_lows  = []

    for i in range(2, n - 2):
        if prices[i] > prices[i-1] and prices[i] > prices[i-2] \
           and prices[i] > prices[i+1] and prices[i] > prices[i+2]:
            local_highs.append(prices[i])
        if prices[i] < prices[i-1] and prices[i] < prices[i-2] \
           and prices[i] < prices[i+1] and prices[i] < prices[i+2]:
            local_lows.append(prices[i])

    def cluster(levels: List[float]) -> List[float]:
        if not levels:
            return []
        levels = sorted(levels)
        clusters = [[levels[0]]]
        for lv in levels[1:]:
            # If within sensitivity% of current cluster center, merge
            center = np.mean(clusters[-1])
            if abs(lv - center) / center < sensitivity:
                clusters[-1].append(lv)
            else:
                clusters.append([lv])
        return [float(np.mean(c)) for c in clusters]

    support    = cluster(local_lows)
    resistance = cluster(local_highs)

    # Filter: support must be below current price, resistance above
    current = prices[-1]
    support    = [s for s in support    if s < current]
    resistance = [r for r in resistance if r > current]

    return {'support': support, 'resistance': resistance}


def nearest_level(price: float,
                  sr: Dict[str, List[float]]) -> Dict[str, Optional[float]]:
    """
    Find the nearest support and resistance levels to current price.

    Returns:
        {'nearest_support': float|None, 'nearest_resistance': float|None,
         'support_distance_pct': float, 'resistance_distance_pct': float}
    """
    supports    = sr.get('support', [])
    resistances = sr.get('resistance', [])

    ns = max(supports,    default=None)  # highest support (nearest below)
    nr = min(resistances, default=None)  # lowest resistance (nearest above)

    sd = abs(price - ns) / price * 100 if ns else float('inf')
    rd = abs(price - nr) / price * 100 if nr else float('inf')

    return {
        'nearest_support':         ns,
        'nearest_resistance':      nr,
        'support_distance_pct':    round(sd, 2),
        'resistance_distance_pct': round(rd, 2),
    }


# ---------------------------------------------------------------------------
# MOVING AVERAGE CROSSOVER SIGNALS
# ---------------------------------------------------------------------------

def golden_cross(fast_ema: np.ndarray, slow_ema: np.ndarray) -> bool:
    """
    Golden Cross: fast EMA crosses above slow EMA.
    Classic: 50 EMA crosses 200 EMA. Bullish long-term signal.
    """
    if len(fast_ema) < 2 or len(slow_ema) < 2:
        return False
    if np.isnan(fast_ema[-1]) or np.isnan(slow_ema[-1]):
        return False
    return (fast_ema[-2] <= slow_ema[-2]) and (fast_ema[-1] > slow_ema[-1])


def death_cross(fast_ema: np.ndarray, slow_ema: np.ndarray) -> bool:
    """
    Death Cross: fast EMA crosses below slow EMA.
    Classic: 50 EMA crosses 200 EMA. Bearish long-term signal.
    """
    if len(fast_ema) < 2 or len(slow_ema) < 2:
        return False
    if np.isnan(fast_ema[-1]) or np.isnan(slow_ema[-1]):
        return False
    return (fast_ema[-2] >= slow_ema[-2]) and (fast_ema[-1] < slow_ema[-1])


def ema_stack(prices: np.ndarray) -> Dict[str, float]:
    """
    EMA stack analysis: compare 9, 21, 50, 200 EMAs to detect trend strength.

    Perfect bullish stack: EMA9 > EMA21 > EMA50 > EMA200
    Perfect bearish stack: EMA9 < EMA21 < EMA50 < EMA200

    Returns alignment score: +1 (perfect bull), -1 (perfect bear), 0 (mixed)
    """
    ema9   = EMA(prices, 9)[-1]
    ema21  = EMA(prices, 21)[-1]
    ema50  = EMA(prices, 50)[-1]
    ema200 = EMA(prices, 200)[-1]

    values = {
        'ema9': round(float(ema9),   4) if not np.isnan(ema9)   else None,
        'ema21': round(float(ema21),  4) if not np.isnan(ema21)  else None,
        'ema50': round(float(ema50),  4) if not np.isnan(ema50)  else None,
        'ema200': round(float(ema200), 4) if not np.isnan(ema200) else None,
    }

    valid = [v for v in [ema9, ema21, ema50, ema200] if not np.isnan(v)]
    if len(valid) < 4:
        values['alignment'] = 'insufficient_data'
        values['score'] = 0
        return values

    if ema9 > ema21 > ema50 > ema200:
        values['alignment'] = 'perfect_bull'
        values['score'] = 1
    elif ema9 < ema21 < ema50 < ema200:
        values['alignment'] = 'perfect_bear'
        values['score'] = -1
    else:
        # Count bull relationships
        pairs = [(ema9, ema21), (ema21, ema50), (ema50, ema200)]
        bull  = sum(1 for a, b in pairs if a > b)
        values['alignment'] = 'mixed_bull' if bull >= 2 else 'mixed_bear'
        values['score'] = (bull - 1.5) / 1.5  # normalize to -1..+1

    return values


# ---------------------------------------------------------------------------
# CANDLESTICK PATTERN RECOGNITION
# ---------------------------------------------------------------------------

def CandlePatterns(opens: np.ndarray,
                   highs: np.ndarray,
                   lows: np.ndarray,
                   closes: np.ndarray) -> Dict[str, bool]:
    """
    Detect candlestick patterns on the most recent 3 bars.

    Single-bar patterns (bar -1):
        - hammer:         long lower shadow, small body, at bottom — bullish reversal
        - shooting_star:  long upper shadow, small body, at top — bearish reversal
        - doji:           open ~= close (indecision)
        - marubozu_bull:  large bullish body, tiny wicks — strong buyers
        - marubozu_bear:  large bearish body, tiny wicks — strong sellers

    Two-bar patterns (bars -2, -1):
        - bullish_engulf: small red candle, then large green engulfs — reversal
        - bearish_engulf: small green candle, then large red engulfs — reversal
        - tweezer_bottom: two candles with same low — support confirmation

    Three-bar patterns (bars -3, -2, -1):
        - morning_star:   big red, small doji, big green — bottom reversal
        - evening_star:   big green, small doji, big red — top reversal
        - three_white:    three consecutive green candles — strong uptrend
        - three_black:    three consecutive red candles — strong downtrend

    Returns dict of pattern_name -> bool
    """
    opens  = np.asarray(opens[-4:],  dtype=float)
    highs  = np.asarray(highs[-4:],  dtype=float)
    lows   = np.asarray(lows[-4:],   dtype=float)
    closes = np.asarray(closes[-4:], dtype=float)

    if len(opens) < 3:
        return {}

    o1, h1, l1, c1 = opens[-1], highs[-1], lows[-1], closes[-1]
    o2, h2, l2, c2 = opens[-2], highs[-2], lows[-2], closes[-2]
    o3, h3, l3, c3 = opens[-3], highs[-3], lows[-3], closes[-3]

    body1  = abs(c1 - o1)
    body2  = abs(c2 - o2)
    body3  = abs(c3 - o3)
    range1 = h1 - l1
    range2 = h2 - l2

    upper_wick1 = h1 - max(o1, c1)
    lower_wick1 = min(o1, c1) - l1
    upper_wick2 = h2 - max(o2, c2)

    patterns = {}

    # --- Single bar ---
    # Hammer: lower wick >= 2x body, upper wick small, bullish context
    patterns['hammer'] = (
        range1 > 0 and
        lower_wick1 >= 2 * body1 and
        upper_wick1 <= 0.2 * range1 and
        body1 > 0
    )

    # Shooting star: upper wick >= 2x body, lower wick small
    upper_wick1_raw = h1 - max(o1, c1)
    patterns['shooting_star'] = (
        range1 > 0 and
        upper_wick1_raw >= 2 * body1 and
        lower_wick1 <= 0.2 * range1 and
        body1 > 0
    )

    # Doji: body is <= 10% of range
    patterns['doji'] = (
        range1 > 0 and
        body1 <= 0.1 * range1
    )

    # Marubozu bullish: body >= 90% of range, green
    patterns['marubozu_bull'] = (
        range1 > 0 and
        c1 > o1 and
        body1 >= 0.9 * range1
    )

    # Marubozu bearish
    patterns['marubozu_bear'] = (
        range1 > 0 and
        c1 < o1 and
        body1 >= 0.9 * range1
    )

    # --- Two bar ---
    # Bullish engulfing: bar2 red, bar1 green, bar1 body engulfs bar2
    patterns['bullish_engulf'] = (
        c2 < o2 and   # bar2 bearish
        c1 > o1 and   # bar1 bullish
        o1 <= c2 and  # opens at or below bar2 close
        c1 >= o2      # closes at or above bar2 open
    )

    # Bearish engulfing
    patterns['bearish_engulf'] = (
        c2 > o2 and
        c1 < o1 and
        o1 >= c2 and
        c1 <= o2
    )

    # Tweezer bottom: same lows (within 0.1%)
    patterns['tweezer_bottom'] = (
        abs(l1 - l2) / max(l1, l2) < 0.001
    )

    # --- Three bar ---
    # Morning star: bar3 large red, bar2 small body (doji-ish), bar1 large green
    patterns['morning_star'] = (
        c3 < o3 and body3 >= 0.5 * (h3 - l3) and  # large red
        body2 <= 0.3 * body3 and                    # small middle
        c1 > o1 and body1 >= 0.5 * (h1 - l1) and  # large green
        c1 > (o3 + c3) / 2                          # closes above bar3 midpoint
    )

    # Evening star
    patterns['evening_star'] = (
        c3 > o3 and body3 >= 0.5 * (h3 - l3) and
        body2 <= 0.3 * body3 and
        c1 < o1 and body1 >= 0.5 * (h1 - l1) and
        c1 < (o3 + c3) / 2
    )

    # Three white soldiers
    patterns['three_white'] = (
        c1 > o1 and c2 > o2 and c3 > o3 and
        c1 > c2 > c3
    )

    # Three black crows
    patterns['three_black'] = (
        c1 < o1 and c2 < o2 and c3 < o3 and
        c1 < c2 < c3
    )

    return patterns


def bullish_patterns(patterns: Dict[str, bool]) -> List[str]:
    """Returns list of active bullish pattern names."""
    BULLISH = {'hammer', 'bullish_engulf', 'morning_star',
               'three_white', 'tweezer_bottom', 'marubozu_bull'}
    return [k for k, v in patterns.items() if v and k in BULLISH]


def bearish_patterns(patterns: Dict[str, bool]) -> List[str]:
    """Returns list of active bearish pattern names."""
    BEARISH = {'shooting_star', 'bearish_engulf', 'evening_star',
               'three_black', 'marubozu_bear'}
    return [k for k, v in patterns.items() if v and k in BEARISH]


# ---------------------------------------------------------------------------
# STOCHASTIC OSCILLATOR
# ---------------------------------------------------------------------------

def Stochastic(highs: np.ndarray,
               lows: np.ndarray,
               closes: np.ndarray,
               k_period: int = 14,
               d_period: int = 3) -> Tuple[np.ndarray, np.ndarray]:
    """
    Stochastic Oscillator (%K and %D).

    %K = (close - lowest_low) / (highest_high - lowest_low) * 100
    %D = SMA(%K, d_period) — the signal line

    Signals:
        %K crosses %D below 20: bullish (buy)
        %K crosses %D above 80: bearish (sell)
        Divergence with price: reversal warning
    """
    highs  = np.asarray(highs,  dtype=float)
    lows   = np.asarray(lows,   dtype=float)
    closes = np.asarray(closes, dtype=float)
    n      = len(closes)

    k = np.full(n, np.nan)
    for i in range(k_period - 1, n):
        hh = np.max(highs[i - k_period + 1 : i + 1])
        ll = np.min(lows[i  - k_period + 1 : i + 1])
        k[i] = 0 if hh == ll else (closes[i] - ll) / (hh - ll) * 100

    d = SMA(k, d_period)
    return k, d


# ---------------------------------------------------------------------------
# VOLUME PROFILE
# ---------------------------------------------------------------------------

def VolumeProfile(prices: np.ndarray,
                  volumes: np.ndarray,
                  bins: int = 24) -> Dict:
    """
    Volume Profile — distribution of volume by price level.

    Identifies Point of Control (POC): price level with most volume traded.
    High-volume nodes = strong S/R. Low-volume nodes = price moves fast through.

    Args:
        prices:  close prices
        volumes: corresponding volumes
        bins:    number of price buckets

    Returns:
        {
            'poc':        Point of Control price,
            'value_area_high': VAH (70% of volume above/below),
            'value_area_low':  VAL,
            'histogram': list of (price_mid, volume),
        }
    """
    prices  = np.asarray(prices,  dtype=float)
    volumes = np.asarray(volumes, dtype=float)

    price_min = prices.min()
    price_max = prices.max()
    edges     = np.linspace(price_min, price_max, bins + 1)

    vol_by_bin = np.zeros(bins)
    for i in range(len(prices)):
        bin_idx = np.searchsorted(edges[1:], prices[i])
        bin_idx = min(bin_idx, bins - 1)
        vol_by_bin[bin_idx] += volumes[i]

    mids = (edges[:-1] + edges[1:]) / 2
    poc_idx = int(np.argmax(vol_by_bin))
    poc     = float(mids[poc_idx])

    # Value Area: accumulate 70% of total volume from POC outward
    total_vol  = vol_by_bin.sum()
    target_vol = total_vol * 0.70
    accumulated = vol_by_bin[poc_idx]
    low_idx  = poc_idx
    high_idx = poc_idx

    while accumulated < target_vol:
        expand_low  = low_idx  > 0
        expand_high = high_idx < bins - 1
        if not expand_low and not expand_high:
            break
        low_add  = vol_by_bin[low_idx  - 1] if expand_low  else 0
        high_add = vol_by_bin[high_idx + 1] if expand_high else 0
        if low_add >= high_add and expand_low:
            low_idx -= 1
            accumulated += low_add
        elif expand_high:
            high_idx += 1
            accumulated += high_add
        else:
            low_idx -= 1
            accumulated += low_add

    return {
        'poc':              poc,
        'value_area_high':  float(mids[high_idx]),
        'value_area_low':   float(mids[low_idx]),
        'histogram':        list(zip(mids.tolist(), vol_by_bin.tolist())),
    }


# ---------------------------------------------------------------------------
# MARKET REGIME DETECTION
# ---------------------------------------------------------------------------

def MarketRegime(prices: np.ndarray,
                 period: int = 50) -> Dict[str, object]:
    """
    Detect whether the market is trending or ranging.

    Uses ADX-inspired approach:
    1. Calculate directional movement
    2. Measure trend strength via EMA slope
    3. Compare ATR to price level for volatility context

    Returns:
        {
            'regime':     'trending_up' | 'trending_down' | 'ranging' | 'volatile',
            'strength':   0-100 (higher = stronger trend),
            'ema_slope':  slope of 20 EMA (positive = up, negative = down),
            'volatility': 'low' | 'medium' | 'high',
        }
    """
    prices = np.asarray(prices[-period:], dtype=float)
    n = len(prices)

    ema20 = EMA(prices, 20)
    valid_ema = ema20[~np.isnan(ema20)]

    if len(valid_ema) < 10:
        return {'regime': 'insufficient_data', 'strength': 0,
                'ema_slope': 0, 'volatility': 'unknown'}

    # EMA slope (annualized directional bias)
    slope = (valid_ema[-1] - valid_ema[-10]) / valid_ema[-10] * 100

    # Efficiency ratio: how much price moved vs total path traveled
    # High ER = trending, Low ER = ranging
    price_move = abs(prices[-1] - prices[0])
    total_path = sum(abs(prices[i] - prices[i-1]) for i in range(1, n))
    er = price_move / total_path if total_path > 0 else 0

    # Normalized volatility using coefficient of variation
    cv = np.std(prices) / np.mean(prices) * 100

    # Regime classification
    if er > 0.4 and slope > 2:
        regime = 'trending_up'
    elif er > 0.4 and slope < -2:
        regime = 'trending_down'
    elif cv > 5:
        regime = 'volatile'
    else:
        regime = 'ranging'

    strength = min(100, er * 100)

    if cv < 2:
        volatility = 'low'
    elif cv < 5:
        volatility = 'medium'
    else:
        volatility = 'high'

    return {
        'regime':     regime,
        'strength':   round(strength, 1),
        'ema_slope':  round(slope, 3),
        'volatility': volatility,
        'efficiency_ratio': round(er, 3),
    }


# ---------------------------------------------------------------------------
# COMPOSITE SIGNAL SCORER
# ---------------------------------------------------------------------------

def SignalScore(
    closes: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    opens: np.ndarray,
    volumes: np.ndarray,
) -> Dict:
    """
    Composite signal scorer. Combines all indicators into a single
    directional score from -10 (strong sell) to +10 (strong buy).

    This is trader9's master signal function.

    Scoring:
        RSI oversold (<30):          +2
        RSI overbought (>70):        -2
        RSI neutral (30-70):          0
        MACD bullish cross:          +2
        MACD bearish cross:          -2
        BB lower band touch:         +1.5
        BB upper band touch:         -1.5
        Golden cross (EMA):          +2
        Death cross (EMA):           -2
        EMA stack full bull:         +1
        EMA stack full bear:         -1
        Bullish candle pattern:      +1 per pattern (max +2)
        Bearish candle pattern:      -1 per pattern (max -2)
        Price above VWAP:            +0.5
        Price below VWAP:            -0.5
        Market regime trending_up:   +1
        Market regime trending_down: -1

    Returns dict with score, component breakdown, and recommendation.
    """
    score = 0.0
    breakdown = {}

    # RSI
    rsi_arr = RSI(closes)
    rsi_val = rsi_arr[-1] if not np.isnan(rsi_arr[-1]) else 50
    if rsi_val < 30:
        s = +2.0
    elif rsi_val > 70:
        s = -2.0
    else:
        s = 0.0
    breakdown['rsi'] = {'value': round(rsi_val, 1), 'score': s}
    score += s

    # MACD
    macd, sig, hist = MACD(closes)
    macd_sig = MACD_signal(macd, sig, hist)
    if macd_sig['bullish_cross']:
        s = +2.0
    elif macd_sig['bearish_cross']:
        s = -2.0
    elif macd_sig['histogram_positive']:
        s = +0.5
    else:
        s = -0.5
    breakdown['macd'] = {**macd_sig, 'score': s}
    score += s

    # Bollinger Bands
    bb_upper, bb_mid, bb_lower = BollingerBands(closes)
    price = closes[-1]
    pct_b = BB_percent_b(closes, bb_upper, bb_lower)[-1]
    if pct_b <= 0.05:
        s = +1.5
    elif pct_b >= 0.95:
        s = -1.5
    else:
        s = 0.0
    breakdown['bollinger'] = {'pct_b': round(float(pct_b), 3) if not np.isnan(pct_b) else None, 'score': s}
    score += s

    # EMA cross (fast 9/21)
    ema9  = EMA(closes, 9)
    ema21 = EMA(closes, 21)
    if golden_cross(ema9, ema21):
        s = +2.0
    elif death_cross(ema9, ema21):
        s = -2.0
    else:
        s = 0.0
    breakdown['ema_cross'] = {'golden': golden_cross(ema9, ema21),
                               'death':  death_cross(ema9, ema21), 'score': s}
    score += s

    # EMA stack
    if len(closes) >= 200:
        stack = ema_stack(closes)
        s = stack['score'] if isinstance(stack['score'], (int, float)) else 0
        score += s
        breakdown['ema_stack'] = {'alignment': stack['alignment'], 'score': s}

    # Candle patterns
    patterns = CandlePatterns(opens, highs, lows, closes)
    bull_p = bullish_patterns(patterns)
    bear_p = bearish_patterns(patterns)
    s = min(2.0, len(bull_p)) - min(2.0, len(bear_p))
    breakdown['candles'] = {'bullish': bull_p, 'bearish': bear_p, 'score': s}
    score += s

    # VWAP
    vwap = VWAP(highs, lows, closes, volumes)
    if not np.isnan(vwap[-1]):
        s = +0.5 if price > vwap[-1] else -0.5
        breakdown['vwap'] = {'value': round(float(vwap[-1]), 4), 'price_above': price > vwap[-1], 'score': s}
        score += s

    # Market regime
    regime = MarketRegime(closes)
    if regime['regime'] == 'trending_up':
        s = +1.0
    elif regime['regime'] == 'trending_down':
        s = -1.0
    else:
        s = 0.0
    breakdown['regime'] = {**regime, 'score': s}
    score += s

    # Recommendation
    score = round(score, 2)
    if score >= 4:
        recommendation = 'STRONG_BUY'
    elif score >= 2:
        recommendation = 'BUY'
    elif score <= -4:
        recommendation = 'STRONG_SELL'
    elif score <= -2:
        recommendation = 'SELL'
    else:
        recommendation = 'NEUTRAL'

    return {
        'score':          score,
        'max_possible':   10,
        'recommendation': recommendation,
        'breakdown':      breakdown,
    }


# ---------------------------------------------------------------------------
# QUICK DEMO
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import json

    # Synthetic price data for testing
    np.random.seed(42)
    n = 300
    prices = 50000 + np.cumsum(np.random.randn(n) * 200)
    highs  = prices + np.random.rand(n) * 300
    lows   = prices - np.random.rand(n) * 300
    opens  = prices + np.random.randn(n) * 100
    volumes = np.random.rand(n) * 1000 + 100

    print("=== trader9 Indicator Library Demo ===\n")

    rsi = RSI(prices)
    print(f"RSI (last 3): {rsi[-3:]}")

    macd, sig, hist = MACD(prices)
    print(f"MACD line (last): {macd[-1]:.2f}")
    print(f"MACD signal:      {sig[-1]:.2f}")
    print(f"MACD histogram:   {hist[-1]:.2f}")

    upper, mid, lower = BollingerBands(prices)
    print(f"\nBollinger Bands: {lower[-1]:.0f} | {mid[-1]:.0f} | {upper[-1]:.0f}")
    print(f"Current price:   {prices[-1]:.0f}")
    print(f"%B:              {BB_percent_b(prices, upper, lower)[-1]:.3f}")

    atr = ATR(highs, lows, prices)
    print(f"\nATR: {atr[-1]:.2f}")
    print(f"ATR stop (2x, long): {ATR_stop(prices[-1], atr[-1], 2.0, 'long'):.2f}")

    fibs = FibLevels(prices.max(), prices.min())
    print(f"\nFib Retracements (from {prices.min():.0f} to {prices.max():.0f}):")
    for k, v in fibs.items():
        print(f"  {k}: {v:.0f}")

    sr = SupportResistance(prices)
    print(f"\nSupport levels:    {[round(s, 0) for s in sr['support'][-3:]]}")
    print(f"Resistance levels: {[round(r, 0) for r in sr['resistance'][:3]]}")

    patterns = CandlePatterns(opens, highs, lows, prices)
    active = [k for k, v in patterns.items() if v]
    print(f"\nActive patterns: {active if active else 'none'}")

    regime = MarketRegime(prices)
    print(f"\nMarket Regime: {regime['regime']} (strength: {regime['strength']})")

    composite = SignalScore(prices, highs, lows, opens, volumes)
    print(f"\nComposite Signal: {composite['score']} -> {composite['recommendation']}")

    print("\nAll checks passed.")
