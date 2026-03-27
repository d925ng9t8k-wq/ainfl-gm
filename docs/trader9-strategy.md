# trader9 — Crypto Trading Strategy
**Date:** March 26, 2026
**Account:** $200 paper (Alpaca Markets)
**Mode:** 24/7 autonomous crypto trading

---

## Market Context (Current as of March 26, 2026)

**Conditions: BEARISH / RANGING**

- BTC: ~$69,837 — below all key EMAs, tight 50-day consolidation range
- ETH: ~$2,115 — 6-month red streak, descending channel, ETH/BTC at multi-year lows
- MACD: bearish crossover confirmed, histogram at -28.11
- RSI: 48.52, neutral-to-bearish
- Macro: Fed held rates at 3.5-3.75%, hawkish dot plot, strong dollar
- Near-term: High volatility expected due to Iran conflict (day 28), risk-off environment

**What this means for trader9:**
Trending strategies will get chopped. Mean reversion and range scalping are best-suited for current conditions. Momentum trades must have tight stops — false breakouts are common in ranging markets.

---

## Supported Alpaca Crypto Pairs

Alpaca supports 56 crypto pairs across BTC, USDT, USDC, and USD bases.

**Best pairs for trader9 (high liquidity, tight spreads):**

| Symbol | Why |
|--------|-----|
| BTC/USD | Most liquid, tightest spreads, best data |
| ETH/USD | High volatility = more opportunities |
| DOGE/USD | High volatility, sentiment-driven, exploitable |
| LINK/USD | Mid-cap, good momentum signals |
| AVAX/USD | Active, reliable range behavior |

**Primary pairs:** BTC/USD and ETH/USD — these get 70% of capital. Others only on confirmed signals.

---

## Strategy Rankings

### RANK 1 — EMA Momentum Scalp (Best for current conditions)

**Type:** Trend-following momentum on short timeframes
**Expected return:** 0.5-2% per day in active sessions. High frequency. Small wins that compound.
**Best conditions:** Any trending market, including micro-trends within a range.

**Indicators:**
- EMA 9 (fast)
- EMA 21 (slow)
- RSI 14 (filter)
- Volume (confirmation)

**Entry Rules (BUY):**
1. EMA 9 crosses ABOVE EMA 21 on 5-minute chart
2. RSI is between 45 and 65 (not overbought, has room to run)
3. Volume on the signal candle is above 20-period average volume
4. Price is above the EMA 21

**Entry Rules (SELL/EXIT):**
1. EMA 9 crosses BELOW EMA 21, OR
2. RSI reaches 70+ (overbought — take profit), OR
3. Stop loss triggered (see below)

**Position sizing:**
- Use 15% of account per trade ($30 on $200)
- Max 2 positions open simultaneously
- Fractional crypto — Alpaca supports notional orders (dollar amounts, not full coins)

**Risk per trade:**
- Stop loss: 1.5% below entry
- Take profit: 2.5-3% above entry
- Risk/reward: 1:1.7 minimum

**On $200 account:**
- Risk per trade: $4.50 (1.5% of $30 position)
- Target per trade: $7.50-9.00
- Need 3 wins per loss to grow account

---

### RANK 2 — Bollinger Band Mean Reversion (Best for ranging market — our current environment)

**Type:** Buy oversold dips within a range, sell overbought rips
**Expected return:** 1-3% per day during ranging conditions. Fewer trades, higher win rate.
**Best conditions:** Tight range markets, consolidation phases. THIS IS NOW.

**Indicators:**
- Bollinger Bands (20 SMA, 2 std dev) on 15-minute chart
- RSI 14
- Stochastic (5, 3, 3)

**Entry Rules (BUY — mean reversion long):**
1. Price touches or closes below the LOWER Bollinger Band
2. RSI < 35 (oversold)
3. Stochastic crossover bullish (K crosses above D below 20)
4. No major news in last 30 minutes that caused the drop

**Entry Rules (EXIT):**
1. Price reaches the MIDDLE band (20 SMA) — take partial profit (50%)
2. Price reaches the UPPER band — close remainder
3. Stop loss: close below the lower band by more than 1% — this means reversion failed, trend is actually down

**Position sizing:**
- Use 20% of account per trade ($40 on $200)
- Max 1 position open (mean reversion requires conviction)

**Risk per trade:**
- Stop loss: 2% below lower band touch
- Take profit: Middle band = +1.5%, Upper band = +3%
- Win rate target: 65% (mean reversion strategies typically hit 60-70% in ranging markets)

**On $200 account:**
- Risk per trade: $0.80 (2% of $40)
- Target per trade: $0.60-1.20
- Low-risk compounding play

---

### RANK 3 — News Sentiment Micro-Spike (Opportunistic, not continuous)

**Type:** Catch sudden price spikes driven by breaking news
**Expected return:** Irregular — can be 5-15% on a single event or 0% for days. HIGH VARIANCE.
**Best conditions:** Breaking news environment (we're in one — Iran conflict day 28)

**How it works:**
1. Monitor crypto news feeds (CoinDesk, CoinTelegraph RSS, crypto Twitter/X via API)
2. When major news breaks (exchange hack, regulatory approval, conflict escalation, ETF news), detect the sentiment and direction
3. Enter fast — momentum runs 2-5 minutes after major news before retail catches up
4. Exit within 10-15 minutes — the spike fades fast

**Signal detection (Claude-assisted):**
- Feed headlines into the bot via a news API (CryptoPanic free tier, CoinDesk RSS)
- Score each headline: +1 bullish, -1 bearish, 0 neutral
- If 3+ consecutive bullish headlines for BTC within 2 minutes: trigger long signal
- Confirm with 1-minute RSI spike above 55 AND volume 2x average
- This is the only strategy where Claude should be called to interpret ambiguous headlines

**Entry/Exit:**
- Enter at market immediately on confirmed signal
- Set hard exit timer: 10 minutes max (news trades are time-limited)
- Stop loss: 2% from entry
- Target: 4-6% (catch the spike, not the whole move)

**Position sizing:**
- Use 25% of account ($50 on $200)
- One trade at a time

**Risk:** This strategy is the most volatile. Skip it during low-news periods. Only deploy when there is confirmed breaking news.

---

## Risk Management Rules (Non-Negotiable)

### Per-Trade Rules
| Rule | Value |
|------|-------|
| Max loss per trade | 2% of account ($4 on $200) |
| Max position size | 25% of account ($50) |
| Stop loss | Always set at order entry — never manual |
| Take profit | Always set — never hold hoping for more |
| Max open positions | 2 simultaneous |

### Daily Rules
| Rule | Value |
|------|-------|
| Daily loss limit | 5% of account ($10 on $200) |
| If daily limit hit | Stop trading, wait 24 hours |
| Daily trade limit | 20 trades max (prevents overtrading) |
| Winning day threshold | +2% = $4 profit |

### Weekly Rules
| Rule | Value |
|------|-------|
| Weekly loss limit | 15% of account ($30 on $200) |
| If weekly limit hit | Full review before resuming |
| Weekly target | +5-10% = $10-$20 profit |

### Account Growth Rules
| Account Level | Change |
|---------------|--------|
| $200 (start) | Current rules |
| $250 (+25%) | Increase position size to 20% |
| $300 (+50%) | Add Strategy 2 capital allocation |
| $400 (+100%) | Review and upgrade to live trading |

---

## Escalation Protocol

**Phase 1: Paper Trading (NOW)**
- Run all 3 strategies on paper
- Track every trade in logs
- Run for minimum 7 days before any real money consideration
- Target: 5% weekly gain on paper before escalation

**Phase 2: Live with $10/hour cap**
- After 3 consecutive profitable paper trading days
- Switch to live account, same $200 starting capital (real money)
- Hard cap: $10/hour maximum deployed (prevents runaway losses)
- Daily loss limit drops to $8 (tighter on real money)
- Report daily P&L to 9 via Telegram

**Phase 3: Scale**
- After 2 profitable live weeks
- Remove hourly cap
- Increase account to $500 (Owner decision)
- Add second crypto pair (ETH if not already running)

**Escalation requires Owner approval at each phase transition.**

---

## What NOT to Do

1. Do NOT trade during extreme news events without a confirmed sentiment direction
2. Do NOT hold positions through major FOMC announcements (next one in May 2026)
3. Do NOT chase a trade you missed — wait for the next setup
4. Do NOT disable stop losses — ever
5. Do NOT add to a losing position (no averaging down)
6. Do NOT trade SHIB, DOGE, or other meme coins without explicit volatility filter

---

## Optimization Results (March 27, 2026)

Parameter sweep across 130 EMA combos and 216 Bollinger combos per asset (692 total backtests).
90-day backtest on 4-hour candles. Data: CoinGecko free API.

### Baseline Performance (original params)

| Strategy | Asset | Return | Win Rate | Sharpe |
|----------|-------|--------|----------|--------|
| EMA 9/21 | BTC/USD | -1.53% | 28.57% | -30.35 |
| EMA 9/21 | ETH/USD | -0.85% | 28.57% | n/a |
| BB 20/2.0 | BTC/USD | -0.10% | 37.50% | 9.19 |
| BB 20/2.0 | ETH/USD | +1.75% | 66.67% | n/a |

### Optimized Best Parameters

**EMA Strategy:**

| Asset | Fast/Slow | Stop Loss | Take Profit | Trend Filter | Return | Win Rate | Sharpe |
|-------|-----------|-----------|-------------|--------------|--------|----------|--------|
| BTC/USD | 5/20 | 1.0% | 3.0% | Yes (50 EMA) | +0.18% | 40% | 3.73 |
| ETH/USD | 5/20 | 2.5% | 3.0% | No | +1.68% | 75% | 22.26 |

Key EMA findings:
- 5/20 period combo significantly outperformed 9/21 on both assets
- Trend filter (50-period EMA) helps BTC but hurts ETH
- Wider take profits (3-4%) outperform the original 2.5%
- On BTC, only 4/130 combos were profitable -- EMA momentum is poorly suited to BTC in this bearish/ranging environment
- On ETH, 99/130 combos were profitable -- ETH shows much stronger momentum characteristics

**Bollinger Band Strategy:**

| Asset | Period | Std Dev | Stop Loss | RSI Threshold | Trend Filter | Return | Win Rate | Sharpe |
|-------|--------|---------|-----------|---------------|--------------|--------|----------|--------|
| BTC/USD | 25 | 2.0 | 1.5% | <40 | No | +1.81% | 54.55% | 23.72 |
| ETH/USD | 25 | 2.0 | 1.5% | <30 | No | +3.51% | 66.67% | 44.03 |

Key Bollinger findings:
- 25-period BB outperforms 20-period -- longer lookback reduces false signals in ranging markets
- Tighter stop loss (1.5% vs 2.0%) improves results by cutting losers faster
- Relaxed RSI threshold (40 for BTC, 30 for ETH) allows more trade opportunities
- Bollinger dominates EMA on both assets in current market conditions
- ETH is the strongest performer: +3.51% return, 66.67% win rate, 44.03 Sharpe

### Recommended Parameter Changes

1. **Switch EMA periods from 9/21 to 5/20** -- faster signal with more separation
2. **Increase EMA take profit from 2.5% to 3.0%** -- let winners run
3. **Enable trend filter (50 EMA) for BTC EMA trades** -- avoids counter-trend entries
4. **Switch Bollinger period from 20 to 25** -- reduces noise
5. **Tighten Bollinger stop loss from 2.0% to 1.5%** -- cut losses faster
6. **Relax Bollinger RSI entry from <35 to <40 for BTC** -- more entry opportunities
7. **Prioritize ETH/USD** -- both strategies perform significantly better on ETH
8. **Prioritize Bollinger over EMA** -- mean reversion dominates in current bearish/ranging conditions

### Asset Allocation Recommendation

Given results, shift capital allocation:
- **ETH/USD Bollinger**: 40% of capital (highest return, best risk-adjusted)
- **BTC/USD Bollinger**: 30% of capital (solid, positive return)
- **ETH/USD EMA**: 20% of capital (strong momentum on ETH)
- **BTC/USD EMA**: 10% of capital (marginal, keep small)

---

## Sources
- [Alpaca Crypto Trading Docs](https://docs.alpaca.markets/docs/crypto-trading)
- [Alpaca Supported Coin Pairs](https://alpaca.markets/support/what-are-the-supported-coins-pairs)
- [Best Crypto Scalping Strategies 2026 — Dypto Crypto](https://dypto-crypto.com/resources/best-crypto-scalping-strategies/)
- [Mean Reversion in Crypto — stoic.ai](https://stoic.ai/blog/mean-reversion-trading-how-i-profit-from-crypto-market-overreactions/)
- [MACD + RSI 77% Win Rate — Gate.io Analysis Jan 2026](https://dex.gate.com/crypto-wiki/article/how-to-use-macd-rsi-and-bollinger-bands-for-crypto-technical-analysis-in-2026-20260107)
- [Crypto Market Analysis March 23, 2026 — CSFX](https://www.capitalstreetfx.com/crypto-market-analysis-march-23-2026/)
- [March 2026 FOMC BTC/ETH Impact — Crypto.com](https://crypto.com/en/market-updates/march-2026-fomc-recap-btc-eth-price)
- [BTC/ETH Price Drops March 27, 2026 — CryptoTimes](https://www.cryptotimes.io/2026/03/27/btc-eth-xrp-price-drops-is-the-crypto-market-going-to-crash-as-iran-war-enters-day-28/)
- [LLMs for Crypto Trading Research — BingX](https://bingx.com/en/learn/article/how-to-use-llms-for-crypto-trading-research)
