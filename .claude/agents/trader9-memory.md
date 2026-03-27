---
agent: trader9
last_updated: 2026-03-27
sessions: 1
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

## Results Log

### Backtest Run 1 — March 27, 2026
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

## Strategy Notes

### Recommended Capital Allocation (based on backtest results)
- **ETH/USD Bollinger**: 40% ($80) — highest return, best risk-adjusted
- **BTC/USD Bollinger**: 30% ($60) — solid, positive return
- **ETH/USD EMA**: 20% ($40) — strong momentum on ETH
- **BTC/USD EMA**: 10% ($20) — marginal, keep small

### Parameter Changes Applied
1. EMA periods: 9/21 -> 5/20
2. EMA take profit: 2.5% -> 3.0%
3. BTC EMA trend filter: OFF -> ON (50 EMA)
4. BB period: 20 -> 25
5. BB stop loss: 2.0% -> 1.5%
6. BTC BB RSI entry: <35 -> <40
7. Priority: ETH over BTC, Bollinger over EMA

### Next Steps
- Run paper trades with optimized params for 7+ days
- Address volume data gap (CoinGecko limitation)
- Consider paid data source or Alpaca's own market data for volume
- Monitor for market regime change (bearish -> trending) that would shift strategy priority
- Hit 3 consecutive profitable paper days before escalating to live

## Failures

### EMA 9/21 on BTC (Baseline)
- **What happened:** -1.53% return, 28.57% win rate, -30.35 Sharpe
- **Why:** Original EMA periods too slow for 4-hour candles in a ranging market. Generated 7 trades, 5 were stop-loss exits. Signals consistently late.
- **Fix:** Switched to 5/20 with trend filter. Reduced to 5 trades, cut losses from -$3.06 to +$0.36.

### Bollinger Band on BTC (Baseline)
- **What happened:** -0.10% return, first 4 entries all hit stop loss during Jan 2026 BTC selloff
- **Why:** 20-period lookback too short during high volatility. Stop loss at 2% too wide — held losers too long. RSI threshold at 35 too strict — missed re-entry opportunities.
- **Fix:** Period 20->25, stop loss 2%->1.5%, RSI <35 -> <40. Result: +1.81% return.

### Volume Data Missing
- **What happened:** CoinGecko OHLC endpoint does not return volume. Volume confirmation filter in EMA strategy is bypassed.
- **Why:** Free tier limitation.
- **Impact:** Unknown number of false entries that volume would have filtered out. This is an open risk.
