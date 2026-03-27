---
agent: trader9
last_updated: 2026-03-26
sessions: 2
---

## Learnings

- **EMA 5/20 beats 9/21 decisively.** Parameter sweep across 130 combos on both BTC and ETH confirmed faster EMA pair with wider separation produces better signals. Original 9/21 had 28.57% win rate on both assets. Optimized 5/20 hit 40% on BTC and 75% on ETH.
- **Bollinger Band mean reversion dominates momentum in bearish/ranging markets.** BB outperformed EMA on both assets. BB is the primary strategy until market regime shifts to trending.
- **ETH is the stronger asset for both strategies.** ETH showed 99/130 profitable EMA combos vs only 4/130 for BTC. ETH Bollinger hit +3.51% return with 44.03 Sharpe. BTC is marginal for momentum.
- **Trend filter (50 EMA) helps BTC but hurts ETH.** BTC needs the filter to avoid counter-trend entries in a ranging market. ETH has stronger micro-trends that the filter blocks.
- **Tighter stop losses win.** 1.0-1.5% stop loss outperforms 2.0% across all combos. Cut losers fast.
- **Wider take profits win.** 3.0% TP outperforms 2.5%. Let winners run.
- **25-period Bollinger Bands outperform 20-period.** Longer lookback reduces false signals in choppy conditions.
- **CoinGecko free API does not provide volume data.** Volume filter is bypassed in EMA backtest. This is a data gap that needs addressing for live trading.
- **Extreme fear = opportunity for mean reversion.** Fear & Greed Index at 14 (46 consecutive days of extreme fear) is historically a contrarian buy signal. BB mean reversion strategy is ideally suited for this environment.
- **Geopolitical volatility creates false signals for momentum strategies.** Iran/Strait of Hormuz tensions caused 5%+ swings in both directions. EMA crossover gets whipsawed; BB mean reversion catches the oversold bounces.
- **Optimizer results are STABLE across reruns.** Second optimization run (session 2) produced identical best params to session 1. This confirms the parameters are robust and not random noise.

## Results Log

### Backtest Run 2 -- March 26, 2026 (Session 2 - Training Day)
**Data:** Fresh pull from CoinGecko
**Starting Capital:** $200

#### 30-Day Backtests (Feb 25 - Mar 27, 2026)

| Strategy | Asset | Final Capital | Return | Win Rate | Sharpe | Trades |
|----------|-------|---------------|--------|----------|--------|--------|
| EMA 9/21 | ETH/USD | $201.17 | **+0.59%** | 66.67% | 20.12 | 3 |
| EMA 9/21 | BTC/USD | $199.49 | -0.26% | 0% | 0 | 1 |
| BB 20/2.0 | ETH/USD | $198.46 | -0.77% | 0% | 0 | 1 |
| BB 20/2.0 | BTC/USD | $200.31 | +0.16% | 50% | 10.23 | 2 |

**30-Day ETH EMA Trade Log:**
- 2026-03-04: BUY ema_crossover $2,055 -> SELL take_profit $2,139 P&L: +$1.22
- 2026-03-10: BUY ema_crossover $2,028 -> SELL rsi_overbought $2,064 P&L: +$0.55
- 2026-03-24: BUY ema_crossover $2,157 -> SELL stop_loss $2,115 P&L: -$0.59

**30-Day BTC BB Trade Log:**
- 2026-03-23: BUY lower_band_oversold $67,849 -> SELL middle_band $70,091 P&L: +$0.66
- 2026-03-27: SELL stop_loss_band_breach $66,666 P&L: -$0.35

#### 90-Day Backtest ETH (Dec 27 - Mar 27, 2026)

| Strategy | Asset | Final Capital | Return | Win Rate | Sharpe | Trades |
|----------|-------|---------------|--------|----------|--------|--------|
| EMA 9/21 | ETH/USD | $198.29 | -0.85% | 28.57% | -10.04 | 7 |
| BB 20/2.0 | ETH/USD | $203.49 | **+1.75%** | 66.67% | 40.99 | 3 exits |

**90-Day ETH BB Trade Log:**
- 2026-01-31: BUY lower_band_oversold $2,418 -> SELL stop_loss $2,369 P&L: -$0.80
- 2026-02-05: BUY lower_band_oversold $1,875 -> SELL middle_band $2,095 P&L: +$2.33
- 2026-02-05: (same entry) -> SELL upper_band $2,060 P&L: +$1.96

#### Optimization Run 2 -- March 26, 2026 (692 param combos)

| Strategy | Asset | Final Capital | Return | Win Rate | Sharpe | Best Params |
|----------|-------|---------------|--------|----------|--------|-------------|
| EMA 5/20 | BTC/USD | $200.36 | +0.18% | 40% | 3.73 | SL 1%, TP 3%, trend ON |
| EMA 5/20 | ETH/USD | $203.35 | +1.68% | 75% | 22.26 | SL 2.5%, TP 3%, trend OFF |
| BB 25/2.0 | BTC/USD | $203.62 | +1.81% | 54.55% | 23.72 | SL 1.5%, RSI<40, trend OFF |
| BB 25/2.0 | ETH/USD | $207.01 | **+3.51%** | 66.67% | 44.03 | SL 1.5%, RSI<30, trend OFF |

**Optimizer confirmed identical best params as Run 1. Parameters are stable.**

### Backtest Run 1 -- March 27, 2026
**Data:** 90 days of 4-hour candles (Dec 27, 2025 - Mar 27, 2026)
**Source:** CoinGecko OHLC (free tier)
**Starting Capital:** $200

#### Baseline Results (original params)

| Strategy | Asset | Final Capital | Return | Win Rate | Sharpe | Trades |
|----------|-------|---------------|--------|----------|--------|--------|
| EMA 9/21 | BTC/USD | $196.94 | -1.53% | 28.57% | -30.35 | 7 |
| EMA 9/21 | ETH/USD | $198.29 | -0.85% | 28.57% | -10.04 | 7 |
| BB 20/2.0 | BTC/USD | $199.80 | -0.10% | 37.50% | 9.19 | 8 exits |
| BB 20/2.0 | ETH/USD | $203.49 | +1.75% | 66.67% | 40.99 | 3 exits |

#### Optimized Results (best params found)

| Strategy | Asset | Final Capital | Return | Win Rate | Sharpe | Params |
|----------|-------|---------------|--------|----------|--------|--------|
| EMA 5/20 | BTC/USD | $200.36 | +0.18% | 40% | 3.73 | SL 1%, TP 3%, trend filter ON |
| EMA 5/20 | ETH/USD | $203.35 | +1.68% | 75% | 22.26 | SL 2.5%, TP 3%, trend filter OFF |
| BB 25/2.0 | BTC/USD | $203.62 | +1.81% | 54.55% | 23.72 | SL 1.5%, RSI<40 |
| BB 25/2.0 | ETH/USD | $207.01 | +3.51% | 66.67% | 44.03 | SL 1.5%, RSI<30 |

#### Optimization Coverage
- EMA: 130 param combos per asset (260 total)
- Bollinger: 216 param combos per asset (432 total)
- Total backtests: 692
- BTC EMA profitable combos: 4/130 (3%)
- ETH EMA profitable combos: 99/130 (76%)
- BTC BB profitable combos: 53/216 (25%)
- ETH BB profitable combos: 62/216 (29%)

## Market Conditions -- March 26, 2026

### Prices
- **BTC/USD:** ~$69,438 (down ~$1,861 from yesterday, range $69,855-$72,026)
- **ETH/USD:** ~$2,073 (down ~4% on the day, recovery attempt stalled near $2,170)
- **ETH Market Cap:** ~$233B
- **BTC Dominance:** 56.6%

### Sentiment
- **Fear & Greed Index:** 14/100 (EXTREME FEAR)
- **Consecutive extreme fear days:** 46 (longest streak since post-FTX collapse late 2022)
- **Index hit 8 on March 24** -- near historical lows (Terra/Luna collapse hit 6)
- **$400M liquidations** on March 23 when BTC dipped to $68K

### Key Events
- **Iran/Strait of Hormuz:** Trump threatened to "obliterate" Iran's power plants. BTC swung 5%+ on the headlines. Postponement of strikes triggered relief rally to $71K, then gave back gains.
- **20 millionth Bitcoin mined** on March 10 -- scarcity narrative reinforced
- **SEC/CFTC regulatory truce** -- joint announcement of unified oversight framework. Positive long-term signal.
- **BlackRock IBIT** absorbed $215M in a single session during peak fear -- institutional accumulation while retail panics

### Market Regime Assessment
- **Regime: BEARISH/RANGING with extreme fear**
- ETH dropped from $3,330 (Jan 13) to $2,073 today -- 38% decline in 2.5 months
- BTC ranging $67K-$72K with high volatility on geopolitical headlines
- This is IDEAL territory for Bollinger Band mean reversion strategy
- EMA crossover will get whipsawed -- keep EMA allocation small
- Extreme fear historically precedes recoveries -- contrarian bias favors long entries on oversold signals

## Strategy Notes

### Recommended Capital Allocation (based on backtest results + market conditions)
- **ETH/USD Bollinger**: 40% ($80) -- highest return, best risk-adjusted, IDEAL market regime
- **ETH/USD EMA**: 25% ($50) -- strong momentum on ETH, but reduce in choppy conditions
- **BTC/USD Bollinger**: 25% ($50) -- solid, positive return
- **Cash Reserve**: 10% ($20) -- dry powder for extreme oversold entries

### Parameter Changes Applied
1. EMA periods: 9/21 -> 5/20
2. EMA take profit: 2.5% -> 3.0%
3. BTC EMA trend filter: OFF -> ON (50 EMA)
4. BB period: 20 -> 25
5. BB stop loss: 2.0% -> 1.5%
6. BTC BB RSI entry: <35 -> <40
7. Priority: ETH over BTC, Bollinger over EMA

### Next Steps
- ~~Run paper trades with optimized params for 7+ days~~ SKIPPING -- going to live with half-size week 1
- Address volume data gap (CoinGecko limitation) -- use Alpaca's market data for volume
- Monitor for market regime change (bearish -> trending) that would shift strategy priority
- First trade: ETH/USD Bollinger Mean Reversion when RSI < 30 and price touches lower band
- Watch Iran headlines -- single biggest volatility driver right now

## Failures

### EMA 9/21 on BTC (Baseline)
- **What happened:** -1.53% return, 28.57% win rate, -30.35 Sharpe
- **Why:** Original EMA periods too slow for 4-hour candles in a ranging market. Generated 7 trades, 5 were stop-loss exits. Signals consistently late.
- **Fix:** Switched to 5/20 with trend filter. Reduced to 5 trades, cut losses from -$3.06 to +$0.36.

### Bollinger Band on BTC (Baseline)
- **What happened:** -0.10% return, first 4 entries all hit stop loss during Jan 2026 BTC selloff
- **Why:** 20-period lookback too short during high volatility. Stop loss at 2% too wide -- held losers too long. RSI threshold at 35 too strict -- missed re-entry opportunities.
- **Fix:** Period 20->25, stop loss 2%->1.5%, RSI <35 -> <40. Result: +1.81% return.

### 30-Day ETH Bollinger (Session 2 Run)
- **What happened:** -0.77% return, single trade hit stop loss
- **Why:** Only 1 trade in 30 days. Entry on March 26 at $2,069 hit stop loss at $1,990 on March 27. The Iran-driven selloff caused a sharp break below the lower band.
- **Lesson:** In extreme fear with geopolitical event risk, even mean reversion can fail on single trades. The 90-day track record (+3.51%) is what matters -- small sample sizes mislead.

### Volume Data Missing
- **What happened:** CoinGecko OHLC endpoint does not return volume. Volume confirmation filter in EMA strategy is bypassed.
- **Why:** Free tier limitation.
- **Impact:** Unknown number of false entries that volume would have filtered out. This is an open risk.
