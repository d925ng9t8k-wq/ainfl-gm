# trader9 — Training Session 3: Advanced Strategies
**Date:** March 27, 2026
**Account:** $200 paper (Alpaca Markets)
**Session:** 3 of N — Advanced Strategies & Infrastructure Build

---

## What Was Built This Session

### Python Scripts

| File | Purpose |
|------|---------|
| `scripts/trader9_indicators.py` | Complete technical analysis library |
| `scripts/trader9_strategies.py` | Six advanced strategy implementations |
| `scripts/trader9_risk.py` | Full risk management engine |
| `scripts/trader9_backtest_advanced.py` | Walk-forward + Monte Carlo + portfolio backtest |
| `scripts/trader9_microstructure.py` | Order book, spread, volume, regime analysis |

---

## Part 1: Technical Analysis Mastery

### Indicators Implemented (`trader9_indicators.py`)

**Moving Averages:**
- `SMA(prices, period)` — Simple Moving Average
- `EMA(prices, period)` — Exponential Moving Average (Wilder's method)
- `WMA(prices, period)` — Weighted Moving Average
- `VWMA(prices, volumes, period)` — Volume-Weighted MA
- `ema_stack(prices)` — Compares EMA 9/21/50/200, returns alignment score

**RSI:**
- `RSI(prices, period=14)` — Full array output, Wilder's smoothing
- `RSI_divergence(prices, rsi, lookback)` — Detects bullish/bearish divergence

**MACD:**
- `MACD(prices, fast=12, slow=26, signal=9)` — Returns (line, signal, histogram)
- `MACD_signal(macd, signal, hist)` — Evaluates crossover signals from last 2 bars

**Bollinger Bands:**
- `BollingerBands(prices, period=20, std=2.0)` — Returns (upper, middle, lower)
- `BB_bandwidth(upper, lower, middle)` — Width relative to middle (squeeze detection)
- `BB_percent_b(prices, upper, lower)` — Where price is in the band (0-1)

**VWAP:**
- `VWAP(highs, lows, closes, volumes)` — Cumulative session VWAP

**ATR:**
- `ATR(highs, lows, closes, period=14)` — Average True Range (volatility measure)
- `ATR_stop(entry, atr, multiplier, side)` — Calculate ATR-based stop price

**Fibonacci:**
- `FibLevels(swing_high, swing_low, mode)` — Retracement and extension levels
- `nearest_fib_level(price, fib_levels)` — Detect proximity to key Fib levels

**Support & Resistance:**
- `SupportResistance(prices, lookback=50, sensitivity=0.02)` — Pivot-based S/R detection
- `nearest_level(price, sr)` — Find nearest support and resistance to current price

**Moving Average Crossovers:**
- `golden_cross(fast_ema, slow_ema)` — Fast crosses above slow (bullish)
- `death_cross(fast_ema, slow_ema)` — Fast crosses below slow (bearish)

**Candlestick Patterns:**
- `CandlePatterns(opens, highs, lows, closes)` — Detects 13 patterns on last 3 bars
  - Single: hammer, shooting_star, doji, marubozu_bull, marubozu_bear
  - Two-bar: bullish_engulf, bearish_engulf, tweezer_bottom
  - Three-bar: morning_star, evening_star, three_white, three_black

**Stochastic:**
- `Stochastic(highs, lows, closes, k=14, d=3)` — %K and %D oscillator

**Volume Profile:**
- `VolumeProfile(prices, volumes, bins=24)` — Point of Control, Value Area High/Low

**Market Regime:**
- `MarketRegime(prices, period=50)` — Returns regime + strength + EMA slope

**Composite:**
- `SignalScore(closes, highs, lows, opens, volumes)` — All indicators into a -10 to +10 score

---

## Part 2: Advanced Strategies

### 1. Mean Reversion — Z-Score Based

**File:** `trader9_strategies.py` — `MeanReversionStrategy`

**How it works:**
1. Calculate rolling z-score of price vs 50-period mean
2. Enter long when z < -2.0 (statistically extreme oversold)
3. Enter short when z > +2.0 (statistically extreme overbought)
4. Target: mean reversion to the rolling average
5. Stop: 2x ATR from entry

**Key filters:**
- Regime must NOT be a strong trend (trending regimes > 60 strength: skip)
- RSI must confirm (< 40 for longs, > 60 for shorts)

**Best conditions:** Ranging/sideways markets. CURRENT MARKET (March 2026 = ranging/bearish) is ideal.

---

### 2. Momentum — Rate of Change + Volume

**File:** `trader9_strategies.py` — `MomentumStrategy`

**How it works:**
1. Calculate Rate of Change (ROC) over 10 bars
2. Require volume surge (> 1.5x 20-bar average)
3. Price must be above trend EMA (50 period) for longs
4. MACD histogram must be positive for longs
5. Targets: 3% and 5% from entry

**Best conditions:** Breakout from range, news-driven moves, trending regime.

**Warning:** Do NOT use in ranging markets. Choppiness eats this strategy alive.

---

### 3. Pairs Trading — Spread Mean Reversion

**File:** `trader9_strategies.py` — `PairsTradingStrategy`

**How it works:**
1. Calculate log price ratio between BTC and ETH
2. Compute hedge ratio via OLS regression
3. Measure z-score of the spread vs 60-period mean
4. When z > 2.0: BTC expensive relative to ETH — short BTC, long ETH
5. When z < -2.0: ETH expensive relative to BTC — long BTC, short ETH

**Requires:** Both legs executed simultaneously. On Alpaca crypto-only, "short" means sell existing long or underweight.

**Key check:** Correlation must be > 0.7 or skip (assets drifted, pairs relationship broken).

---

### 4. Options Flow Signal

**File:** `trader9_strategies.py` — `OptionsFlowStrategy`

**How it works:**
1. Score individual options flow events (OTM call/put buying, sweeps, volume spikes)
2. Aggregate scores across multiple events
3. Bullish signal: avg score >= 1.0 -> long the underlying
4. Bearish signal: avg score <= -1.0 -> short the underlying

**Key factors scored:**
- OTM options buying: +/- 1.0 (directional conviction)
- Volume spike (3x+): +/- 0.5
- Sweep order (institutional urgency): +/- 0.5
- Short-dated (<14d): x1.25 multiplier (higher conviction)
- Low premium (<$50K): x0.5 (reduce weight of small orders)

**Application to crypto:** Use options flow on COIN, MSTR, MARA, RIOT as leading indicators for BTC/ETH.

---

### 5. Sector Rotation

**File:** `trader9_strategies.py` — `SectorRotationStrategy`

**How it works:**
1. Calculate 30-day relative strength of each asset vs BTC benchmark
2. Rank assets by RS score
3. Buy top RS assets when RS momentum is improving
4. Rotate out when RS starts deteriorating

**Current implications:**
- BTC/ETH correlation is ~0.85 — they move together most of the time
- Watch for when ETH outperforms BTC (ETH RS > 1.0): rotate into ETH
- When ETH underperforms (RS < 1.0): reduce ETH, hold BTC

---

### 6. Earnings Momentum (PEAD)

**File:** `trader9_strategies.py` — `EarningsMomentumStrategy`

**How it works:**
1. Monitor earnings for COIN, MSTR, MARA, RIOT (crypto-correlated equities)
2. If company beats estimates by 5%+: enter crypto long next day
3. Hold for 5 days (typical post-earnings drift duration)
4. Stop: 3x ATR from entry

**Correlated equities:**
| Ticker | Crypto Asset | Correlation |
|--------|-------------|-------------|
| COIN | ETH/USD | 0.85 |
| MSTR | BTC/USD | 0.92 |
| MARA | BTC/USD | 0.78 |
| RIOT | BTC/USD | 0.75 |
| CLSK | BTC/USD | 0.72 |

---

### Strategy Ensemble

**File:** `trader9_strategies.py` — `StrategyEnsemble`

All strategies vote (+1 long, -1 short, 0 neutral), weighted by confidence.

| Strategy | Default Weight |
|----------|---------------|
| Mean Reversion | 1.2x (slightly overweight for current regime) |
| Momentum | 1.0x |
| Pairs Trading | 0.8x |
| Options Flow | 0.9x |
| Composite Score | 1.0x |

Net score >= 1.0: BUY
Net score <= -1.0: SELL
Otherwise: HOLD

---

## Part 3: Risk Management

### Kelly Criterion

**File:** `trader9_risk.py` — `kelly_criterion()`, `position_size_kelly()`

Formula: `f* = (b*p - q) / b` where b = odds ratio, p = win rate, q = loss rate

**trader9 uses quarter-Kelly (kelly_fraction=0.25) to reduce variance.**

Example with current strategy stats (win rate 67%, avg win 2.5%, avg loss 1.5%):
- Full Kelly: ~33% of account
- Quarter Kelly: ~8% of account per trade
- On $200: $16 per trade

---

### Fixed Fractional Sizing

**File:** `trader9_risk.py` — `position_size_fixed_fractional()`

Risk a fixed 1% of account on every trade. Position size is derived from stop distance.

Example: $200 account, 1.5% stop:
- Risk amount: $2.00
- Stop distance: 1.5%
- Position size: $2.00 / 0.015 = $133 (then capped at 25% = $50)

---

### ATR Trailing Stop

**File:** `trader9_risk.py` — `TrailingStop`

- Stop initializes at 2x ATR below entry
- Rises with price (never falls for longs)
- Triggered when price drops below trailing stop

Example: Entry $2100, ATR $31.5, 2x multiplier:
- Initial stop: $2100 - (2 x $31.5) = $2037
- After price rises to $2150: stop rises to $2150 - $63 = $2087
- After price rises to $2200: stop rises to $2200 - $56 = $2144

---

### Risk Engine — All Checks

**File:** `trader9_risk.py` — `RiskEngine`

Every trade must pass ALL of these before executing:

1. Paper trading mode confirmed
2. System halt check (hit daily limit, manual halt)
3. Daily trade count (max 20)
4. Weekly loss limit
5. Open position count (max 2)
6. R:R ratio check (min 1.5)
7. Position sizing (Kelly or fixed fractional)
8. Max risk per trade (2% of account)
9. Correlation exposure (max 40% in correlated assets)
10. Portfolio heat (warn if all stops hit simultaneously = >5% loss)
11. Geo risk override (halve sizes when geo_risk_active=True)

---

### Max Drawdown Monitor

**File:** `trader9_risk.py` — `DrawdownMonitor`

- Tracks equity curve
- Warns at 75% of max_drawdown_pct
- Halts trading when max_drawdown_pct hit
- Default: 20% account drawdown = full stop

---

## Part 4: Advanced Backtesting

### Walk-Forward Optimization

**File:** `trader9_backtest_advanced.py` — `walk_forward_optimization()`

**Why this matters:** Standard backtesting overfits. You optimize on all data and declare victory. But that strategy may not work on new data.

Walk-forward tests if optimization generalizes:
1. Split data into N windows (default 4-5)
2. In each window: optimize on first 70% (in-sample)
3. Test best params on remaining 30% (out-of-sample)
4. Aggregate OOS results — this is the real performance estimate

**Assessment:**
- ROBUST: avg OOS return > 0 AND > 60% of windows profitable
- MARGINAL: avg OOS return > 0 but < 60% profitable
- OVERFIT: avg OOS return < 0 (optimization doesn't generalize)

---

### Monte Carlo Simulation

**File:** `trader9_backtest_advanced.py` — `monte_carlo_simulation()`

**Why this matters:** Your backtest shows +5% return. But was that just lucky trade ordering? Monte Carlo answers this.

Process:
1. Extract all trade P&Ls from historical backtest
2. Run 2000 simulations: randomly shuffle trade order
3. Calculate equity curve for each shuffle
4. Report P5/P50/P95 outcomes

**Decision criteria:**
- STRONG: >70% of simulations profitable, <5% ruin
- ACCEPTABLE: >55% profitable, <15% ruin
- MARGINAL: >45% profitable
- REJECT: <45% profitable

---

### Portfolio Backtest

**File:** `trader9_backtest_advanced.py` — `portfolio_backtest()`

Tests the full recommended allocation simultaneously:
- ETH/USD Bollinger (40% of capital)
- ETH/USD EMA 5/20 (25% of capital)
- BTC/USD Bollinger (25% of capital)
- Cash reserve (10%)

Shows combined portfolio P&L vs individual strategy returns.

---

## Part 5: Market Microstructure

### Choppiness Index

**File:** `trader9_microstructure.py` — `AdvancedRegimeDetector.choppiness_index()`

Range: 38-100. Uses Fibonacci levels as thresholds (natural math).
- < 38.2: Strong trend (use momentum)
- 38-61.8: Transitional
- > 61.8: Choppy/ranging (use mean reversion)

---

### Accumulation/Distribution

**File:** `trader9_microstructure.py` — `VolumeAnalyzer`

Three volume indicators:
- **A/D Line:** Uses high-low-close position to detect institutional accumulation vs distribution
- **OBV:** Simple up/down volume running total
- **CMF:** 20-period money flow oscillator (> 0.1 = bullish)

Key signal: **Divergence.** If price makes a new low but A/D is rising, institutions are buying the dip. This precedes reversals.

---

### Order Book Analysis

**File:** `trader9_microstructure.py` — `OrderBookSnapshot`

Key metrics:
- **Spread %:** Cost of entry + exit. Must be < 20% of expected move or skip.
- **Imbalance:** (bid volume - ask volume) / total. > 0.3 = buying pressure.
- **Weighted mid:** Better entry price estimate than simple mid.
- **Market depth:** USD available within 0.5% of mid. Low depth = slippage risk.

---

### Spread Tradability Rule

Before every trade:

```
cost_pct_of_move = spread_pct / expected_move_pct

If cost_pct_of_move > 0.20: SKIP
```

Example:
- Spread: 0.08%, Expected move: 1.5%
- Cost as % of move: 5.3% → TRADE (below 20% threshold)

- Spread: 0.40%, Expected move: 1.5%
- Cost as % of move: 26.7% → SKIP

---

## How to Run the Scripts

### Test indicators (no API key needed):
```bash
python3 scripts/trader9_indicators.py
```

### Test strategies (no API key needed):
```bash
python3 scripts/trader9_strategies.py
```

### Test risk engine (no API key needed):
```bash
python3 scripts/trader9_risk.py
```

### Run advanced backtest (fetches free CoinGecko data):
```bash
python3 scripts/trader9_backtest_advanced.py --days=180 --mode=all
```

This takes ~5-10 minutes. Saves results to `data/backtest-advanced-results.json`.

### Test microstructure (no API key for demo):
```bash
python3 scripts/trader9_microstructure.py
```

### Test with live Alpaca data:
```bash
python3 scripts/trader9_microstructure.py --live --symbol=ETH/USD
```
(Requires ALPACA_API_KEY and ALPACA_SECRET_KEY in .env)

---

## Priority Order: What Signals Matter Most

1. **Market Regime first.** If Choppiness Index > 61.8: use mean reversion only. If < 38.2: use momentum only. Wrong strategy for the regime = guaranteed losses.

2. **Composite Score.** If SignalScore < 2 (absolute), no edge — skip the trade.

3. **Volume confirmation.** No volume surge on entry = weak signal. Wait.

4. **Microstructure final gate.** Spread check + order book imbalance. If spread is too wide or order book shows opposing pressure: skip even a perfect technical setup.

5. **Risk Engine last.** Kelly/fixed fractional sizing, stop placement, daily limits. This never gets skipped.

---

## Current Market Application (March 2026)

**Regime:** BEARISH/RANGING. Choppiness Index likely > 62.

**Best strategies for now:**
1. Mean Reversion (z-score) — designed for this regime
2. Bollinger Band Mean Reversion — confirmed winner from Session 2
3. Pairs Trading (BTC/ETH spread) — market-neutral, regime-independent

**Avoid:**
1. Momentum — gets chopped apart in ranging markets
2. EMA crossover — false signals everywhere in this regime

**Watch for:**
- If Fear & Greed rises above 25: regime may be shifting to trend
- Iran situation resolving: potential trend break upward
- COIN/MSTR earnings: use earnings momentum strategy

---

## Session 4: What's Next

1. **Live bot integration** — Connect strategies to Alpaca paper trading execution
2. **Signal pipeline** — Wire SignalScore + microstructure into actual order submission
3. **Logging and monitoring** — Track every trade, report daily P&L via Telegram
4. **Walk-forward results** — Run the advanced backtest and report findings
5. **Options flow data** — Integrate a data source (Unusual Whales, Tradier, Deribit)
6. **Automated regime switching** — Bot automatically selects strategy based on detected regime

---

## Previous Sessions Reference

- **Session 1** (`trader9-strategy.md`): Base strategies, risk rules, capital allocation
- **Session 2** (`trader9-ready-for-live.md`, `backtest-trader9.mjs`): Optimization (692 backtests), confirmed params, ready-for-live assessment
- **Session 3** (this doc): Advanced strategies, complete indicator library, risk engine, walk-forward/Monte Carlo, microstructure
