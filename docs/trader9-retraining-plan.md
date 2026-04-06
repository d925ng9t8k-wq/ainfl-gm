# Trader9 Retraining Plan — Phase 1 Strategy Document
**Prepared by:** MONEY (9 Revenue Specialist)
**Date:** April 5, 2026
**Status:** Research complete — strategy phase. No code written. Awaiting 9 synthesis before Owner review.

---

## Context

Trader9 ran live Apr 2–5, 2026 on Alpaca account 216104741. Starting capital ~$333, ending ~$305 (-8.4%). Strategy: BB_REVERT on BTC/USD only, 30-min cycles. Cause of loss: over-trading against a single direction with fees and slippage grinding the account below zero expectancy. The strategy was never fee-aware. It is now dormant, all cash. This document is the foundation for a full rebuild.

---

## Section 1: Fee Reference (Verified April 2026)

Before evaluating any strategy, the fee model must be pinned. These are verified current rates.

### Alpaca — Crypto (Tier 1, $0–$100K/30-day volume)
- Maker: **0.15%**
- Taker: **0.25%**
- Round-trip (taker both legs): **0.50%** of trade value
- Volume tiers improve to Maker 0.00% / Taker 0.10% at $100M+/30 days — irrelevant at $10K

### Alpaca — Equities and ETFs
- Commission: **$0.00** (zero for self-directed API accounts)
- SEC fee (sells): ~$22.90 per $1,000,000 principal — negligible on small accounts
- FINRA TAF (sells): $0.000119/share — negligible
- Options: commission-free; exchange/regulatory fees apply per contract (typically $0.50–$0.65/contract total)

### Hyperliquid (DEX perpetuals — alternative venue, not Alpaca)
- Taker: **0.045%**
- Maker rebate: **+0.015%** (they pay you)
- Round-trip taker: **0.09%** — dramatically cheaper than Alpaca crypto for high-frequency
- Note: Hyperliquid is a DEX. Requires separate wallet/account. Not accessible through Alpaca API.

### Kalshi (prediction markets)
- Trading fee: up to **2% of maximum profit**, capped at $1.74 per $100 trade
- Highest near 50¢ contracts (near-even markets), lowest at 1¢/99¢ (near-certain outcomes)
- ACH deposits/withdrawals: **free**. Debit card: 2% fee.
- Interest on balances: 3.50% APY on $250+
- API access: **free** for all verified users

### Polymarket (prediction markets, US regulated exchange)
- US traders: **0.30% taker fee, 0.20% maker rebate**
- Non-US (crypto): up to 1.80% taker depending on market category
- Gas: effectively **$0** — Polygon L2, meta-transactions, Polymarket subsidizes
- API access: **free** (Gamma API, no auth required; CLOB API requires funded wallet + API key)

### Practical slippage estimates
| Market | Typical bid-ask spread | Adverse selection estimate | Effective round-trip cost |
|---|---|---|---|
| BTC/USD (Alpaca, taker) | 0.02–0.05% | 0.05–0.10% | 0.55–0.70% |
| BTC/USDT (Hyperliquid perps, taker) | 0.01–0.02% | 0.02–0.05% | 0.15–0.20% |
| S&P 500 ETF (SPY, Alpaca) | $0.01/share = ~0.002% | 0.002–0.005% | 0.005–0.01% |
| Kalshi 50¢ contract | 2–4¢ spread = 4–8% | N/A | ~2–5% of profit |
| Polymarket US 50¢ contract | 2–5¢ spread | N/A | ~1–3% of profit |

**The BB_REVERT failure in plain numbers:** At 0.50% round-trip crypto fee, a strategy needs to capture more than 0.50% per trade just to break even. On 30-min BTC/USD mean reversion, average moves are 0.2–0.4%. You lose money by construction.

---

## Section 2: Strategy Candidates by Priority Area

### Priority 1: Arbitrage

#### 1A. Funding-Rate Basis Capture (Cash-and-Carry, Perpetuals)
**How it works:** When perpetual futures carry a positive funding rate (longs pay shorts), you buy BTC spot on Alpaca and short BTC perpetuals on Hyperliquid. You collect the funding payment every hour while remaining delta-neutral. When funding turns negative (or approaches zero), you unwind.

**Expected edge at $10K:**
- Historical funding rates: average 6–8% annualized on BTC, frequently spiking to 20–40% annualized during bull markets
- At $10K capital, earning 10% annualized = $1,000/year, assuming you can stay delta-neutral and unwind cleanly
- Fee drag on entry/exit: ~0.20–0.50% each way — acceptable against 10%+ carry

**Infrastructure required:**
- Alpaca (spot BTC buy)
- Hyperliquid account + wallet (perpetual short)
- CoinGlass or similar for real-time funding rate monitoring across exchanges
- Delta-neutral rebalancer (if BTC price moves, position sizes drift and need trimming)

**Minimum backtest requirements:**
- 12 months of hourly funding rate data (CoinGlass, Hyperliquid historical API)
- Model: enter when annualized rate > threshold (e.g., 15%), exit when < 5%
- Include full round-trip fees both legs, plus rebalancing cost
- Stress test on funding rate reversal risk (rate goes negative before you unwind)

**Dealbreakers / failure modes:**
- Funding rate can flip negative rapidly — short position then pays longs. Risk: you overstay and give back carry gains
- Exchange counterparty risk: Hyperliquid is a DEX but still carries smart contract and liquidity risk
- Capital immobility: $10K split between Alpaca (spot) and Hyperliquid (margin) means you cannot chase other opportunities simultaneously
- Alpaca does not support perpetuals — requires operating two separate platforms in lockstep
- Regulatory: Hyperliquid access for US users — verify current geo status before building

**Realistic annual return estimate ($10K):** 8–15% in neutral-to-bullish crypto conditions. Near-zero or negative in sustained bear markets where funding stays negative.

**Rank: #1 arbitrage strategy.** Structural edge, market-neutral, verifiable before deployment.

---

#### 1B. Kalshi / Polymarket Cross-Platform Arbitrage
**How it works:** When the same binary event is priced differently on Kalshi vs. Polymarket, buy YES on the cheaper platform and YES on the opposing NO on the other, locking in a guaranteed profit if combined cost < $1.00 (e.g., buy YES at 47¢ on Kalshi and NO at 50¢ on Polymarket = locked profit of 3¢ regardless of outcome).

**Expected edge at $10K:**
- Academic research documents $40M+ in arbitrage profits extracted from Polymarket Apr 2024–Apr 2025
- Typical cross-platform spread when it exists: 2–6¢ on a $1 contract
- At $10K deployed across both platforms, 10–20 opportunities/week at 2–4¢ profit each = $1K–$4K/year (10–40% return)
- Reality: most windows last seconds to minutes. Bot speed is the entire edge.

**Infrastructure required:**
- Kalshi account (US, fully regulated) + API key (free, Basic tier: 20 reads/10 writes per second)
- Polymarket wallet (Polygon) + CLOB API key (free with funded account)
- Real-time price polling: both platforms WebSocket or high-frequency REST
- Matching engine: when (Kalshi YES price) + (Polymarket NO price) < $0.98 (leaving 2¢ profit after fees), execute both legs simultaneously

**Minimum backtest requirements:**
- 90 days of cross-platform order book snapshots for the same markets
- Model: log every moment when combined cost < $0.98, measure how long the window stays open and what fill price is realistically achievable
- Include Kalshi fee (up to 2% of profit on mid-range contracts), Polymarket fee (0.30% taker US)

**Dealbreakers / failure modes:**
- Speed: 14 of the 20 top Polymarket wallets are bots. Windows close in under 60 seconds for major markets
- Slippage on fill: if your order does not fill at the quoted price, the spread disappears or inverts
- Kalshi market availability: not all Kalshi markets have Polymarket equivalents — requires continuous catalog matching
- Settlement timing: if one platform resolves before the other, you carry naked risk during the gap
- Rate limits: Kalshi Basic tier (20 reads/10 writes/sec) may throttle fast execution — Premier tier requires 3.75% of monthly volume

**Realistic annual return estimate ($10K):** 15–35% if bot latency is competitive. Near-zero if latency is poor. This is a speed game.

**Rank: #2 arbitrage strategy.** High edge but execution complexity is highest of any strategy here.

---

#### 1C. ETF/Underlying Stat-Arb (Equity Pairs)
**How it works:** Exploit temporary divergences between correlated equity instruments — e.g., SPY vs. IVV (two S&P 500 ETFs), or sector ETF vs. constituent stocks. When the price ratio deviates significantly from the statistical mean, bet on reversion.

**Expected edge at $10K:**
- Sharpe ratios for backtested pairs strategies: 0.6–0.9 on US equities
- Annual return range: 10–25% gross. After fees and slippage, 5–18% net.
- At $10K account: $500–$1,800/year realistic net
- Key constraint: Alpaca equity commissions are $0, regulatory fees are negligible. Slippage on SPY/IVV is near zero (penny spreads). Fee drag is minimal. The edge is real but modest.

**Infrastructure required:**
- Alpaca equity trading account (already exists)
- Cointegration testing library (Python: statsmodels, arch)
- Real-time quote feed (Alpaca free data tier for equities)
- Pairs universe: start with 10–20 highly correlated ETF pairs (SPY/IVV, QQQ/QQQM, XLK/VGT, etc.)

**Minimum backtest requirements:**
- 3–5 years of daily/hourly data on candidate pairs
- Walk-forward validation: test on out-of-sample periods (not just in-sample curve-fitting)
- Model regime shifts: pairs that co-integrated 2020–2023 may have broken since
- Transaction cost model: even at $0 commission, size matters — 200 share minimum for meaningful position

**Dealbreakers / failure modes:**
- Cointegration breaks: pairs that "always revert" sometimes don't. Lehman moment = permanent divergence
- Overfitting: easy to find pairs that look perfect in backtest and fail live
- Alpaca short-selling constraints: need to verify ETB (easy-to-borrow) list for short legs
- Equity market hours only: 9:30am–4pm ET. Dead time otherwise.

**Realistic annual return estimate ($10K):** 8–20% net. Lower volatility, lower max drawdown than crypto strategies.

**Rank: #3 arbitrage strategy.** Best risk-adjusted profile but requires robust backtesting to avoid overfitting.

---

### Priority 2: Political Event / Prediction Market Exploitation

#### 2A. Economic Catalyst Mispricing (Kalshi, Event-Driven)
**How it works:** Federal Reserve meetings, CPI prints, NFP releases, and election events all generate predictable market-making behavior where Kalshi's traditional-finance user base and Polymarket's crypto-native users price events differently. Bot monitors both order books, identifies systematic mispricings before catalyst events, and takes positions where the edge is calculable.

**Expected edge at $10K:**
- High variance. Single event plays can return 5–20% on deployed capital if the mispricing is real
- Example: market prices Fed cut at 55% on Kalshi, 62% on Polymarket → cross-platform arb opportunity OR outright position if one is demonstrably wrong vs. Fed futures pricing
- Information asymmetry is the edge: bot cross-references Fed funds futures (CME), Kalshi, Polymarket simultaneously to find the platform with stale pricing

**Infrastructure required:**
- Kalshi API (event market access — Fed, CPI, NFP markets)
- Polymarket CLOB API
- CME Group data feed or Quandl/FRED for macro data baseline pricing
- Event calendar parser (FRED economic calendar, Fed meeting schedule)

**Minimum backtest requirements:**
- Pull historical resolution data for all Fed meeting contracts on Kalshi (2022–present)
- Model: at T-60min before each event, what was the implied probability vs. what was the realized outcome vs. what was the CME-implied probability?
- Measure whether systematic mispricings existed and were exploitable before they closed

**Dealbreakers / failure modes:**
- Thin markets near event time: spreads widen dramatically, edge disappears
- Adverse selection: if you are the only buyer at a price, ask why nobody else is buying there
- Regulatory changes: Kalshi's CFTC-regulated status means product changes can happen with little notice
- Correlation events: if markets move adversely AND the prediction market resolves against you on the same event (e.g., surprise Fed hike crushes equities and your Kalshi YES position), double loss

**Realistic annual return estimate ($10K):** 10–30% in an event-rich year. Near-zero or negative in quiet macro periods.

**Rank: Best event-driven strategy.** Pairable with Priority 1 arbitrage to use the same Kalshi/Polymarket infrastructure.

---

#### 2B. Combinatorial Logical Arbitrage (Prediction Markets)
**How it works:** Markets that should logically sum to $1.00 often don't. Example: "Trump wins presidency" at 55¢ while "Republican wins presidency" at 50¢ is a logical impossibility — Trump is Republican. Buy the NO on "Republican wins" at 50¢ and YES on "Trump wins" at 55¢ for a structural arb that must resolve correctly.

**Expected edge at $10K:**
- Lower frequency than cross-platform arb — these windows are rarer but last longer (minutes to hours, not seconds)
- Typically 3–8¢ per $1 contract profit when they appear
- Volume is the constraint: can rarely size more than $500–$1,000 per opportunity before moving the market

**Infrastructure required:**
- Kalshi API with full market catalog monitoring
- Logic rules engine: define all valid logical relationships between market categories and scan continuously for violations
- This can run entirely on Kalshi alone — no Polymarket required

**Minimum backtest requirements:**
- Pull complete Kalshi market catalog history
- Map logical dependency trees (election outcome chains, policy outcome chains)
- Scan for historical violations and measure how often they were fillable at quoted prices vs. disappeared on contact

**Dealbreakers / failure modes:**
- Kalshi market definitions sometimes differ subtly — what looks like a logical arb may have different resolution criteria
- Position limits per market can cap size
- Low frequency: may go weeks without an opportunity

**Realistic annual return estimate ($10K):** 5–15% supplemental. Not a standalone strategy — runs alongside others.

**Rank: Good supplemental strategy.** Low complexity once logic tree is built. Run in background alongside other strategies.

---

#### 2C. Political Catalyst Directional Trading (Equities via Alpaca)
**How it works:** When a high-confidence political event outcome becomes near-certain in prediction markets (e.g., Kalshi pricing a regulatory action at 92%) before it fully prices into affected equities, take a directional equity position ahead of the market moving to catch up. This is not pure arbitrage — it is informed directional trading with a prediction market signal.

**Expected edge at $10K:**
- High variance. Tail-risk heavy. A few big wins, several moderate losses.
- Not recommended as a primary strategy given the mandate for fee-aware structural edge

**Infrastructure required:**
- Kalshi/Polymarket signal feed
- Alpaca equity execution
- Event-to-equity mapping (e.g., FDA drug approval → pharma stock, tariff vote → affected sector ETFs)

**Dealbreakers / failure modes:**
- Reflexivity: prediction markets often move after equities, not before — the direction of information flow is uncertain
- Execution timing: by the time a 92% Kalshi print is visible to bot, options market and equity market may already have moved
- Holding cost: some events take weeks to resolve — capital tied up

**Rank: Low priority.** Too directional. Keep in Hopper for Phase 2 when capital is larger and strategy is more mature.

---

### Priority 3: Multi-Asset Coverage

The bot must cover four asset classes to achieve 24/7 coverage:

| Asset Class | Primary Venue | Hours | Best Strategy Type |
|---|---|---|---|
| US Equities / ETFs | Alpaca | 9:30am–4pm ET (M–F) | Stat-arb pairs, ETF/NAV arb |
| Crypto spot + perps | Alpaca (spot) + Hyperliquid (perps) | 24/7 | Funding-rate carry, triangular arb |
| Prediction markets | Kalshi + Polymarket | 24/7 | Cross-platform arb, combinatorial arb, event-driven |
| FX | Alpaca does not support FX directly | — | See note below |

**FX note:** Alpaca does not currently offer FX trading. Interactive Brokers (IBKR) supports algorithmic FX trading with a Python API (IB TWS API or ib_insync). Adding FX would require a second broker relationship. Verdict: defer to Phase 2 unless a specific FX arb opportunity is identified. Not worth the added complexity for Phase 1.

**Options note:** Alpaca offers commission-free options trading. Options open the door to volatility arbitrage (buying cheap implied vol before events, selling expensive vol after), but this requires Greeks management and is Phase 2 work.

---

### Priority 4: 24/7 Operation Map

```
Equity market hours (9:30am–4pm ET, Mon–Fri):
  ACTIVE: ETF stat-arb pairs (Priority 1C)
  ACTIVE: Political catalyst equity plays (if signal exists)
  PASSIVE: Prediction market monitoring

After-hours + weekends (4pm–9:30am ET, all weekend):
  ACTIVE: Funding-rate carry (crypto, continuous)
  ACTIVE: Cross-platform prediction market arb (Kalshi + Polymarket 24/7)
  ACTIVE: Combinatorial logic arb on prediction markets
  PASSIVE: Watch for macro catalyst signals pre-market

Never idle: at minimum, prediction market arb scanner runs 24/7.
Funding-rate monitoring runs 24/7 regardless of whether active position is on.
```

---

### Priority 5: Fee-Aware Scoring (Minimum Viable Filter)

Every strategy candidate must pass this gate before a trade is placed:

```
Expected gross profit per trade
  minus: entry fee (maker or taker, per venue)
  minus: exit fee (maker or taker, per venue)
  minus: estimated slippage (bid-ask spread / 2 per leg)
  minus: adverse selection estimate (historical vs. expected fill)
  = NET EXPECTED VALUE

If NET EXPECTED VALUE < 0: DO NOT TRADE
If NET EXPECTED VALUE < breakeven threshold (e.g., $2 minimum): DO NOT TRADE
```

This filter is the single most important upgrade over BB_REVERT. It must be hardcoded and non-bypassable.

---

### Priority 6: Aggression Level 8/10

At 8/10 aggression:
- When edge exists, size to 15–25% of account per position (not 2–5%)
- Use Kelly Criterion or fractional Kelly (0.5x Kelly) for position sizing on prediction market bets
- Drawdown hard stop: if account drops 15% from high-water mark, halt all live trading and alert 9 via Telegram
- Drawdown pause: if any single strategy loses 5% of account in one session, pause that strategy only and continue others

This is not reckless — it is conviction-sized. A bot that trades $50 positions on a $10K account is not 8/10 aggression.

---

## Section 3: Top 3 Strategies to Build First

### Recommendation

**Phase 1 build order:**

**#1: ETF Stat-Arb Pairs (Priority 1C)**
- Why first: runs entirely on existing Alpaca account, zero new accounts needed, zero regulatory friction, lowest slippage of any strategy, fully backtestable with free Alpaca data. Start here to prove the architecture and fee-aware engine works before touching crypto or prediction markets.
- Expected effort: 1–2 weeks to build pairs selection, cointegration test, mean-reversion signal, and backtest harness.
- Risk: modest. Capital stays on Alpaca. No new platform exposure.
- Target: Sharpe > 0.8 on 3-year walk-forward before live enable.

**#2: Funding-Rate Carry (Priority 1A)**
- Why second: structural edge is among the highest available, market-neutral, calculable. The main prerequisite is standing up a Hyperliquid account alongside Alpaca and building the delta-neutral rebalancer. This adds one new platform (Hyperliquid) but not a new broker relationship — Alpaca spot stays.
- Expected effort: 2–3 weeks including Hyperliquid account setup, API integration, delta-neutral hedger, and funding-rate monitor.
- Risk: moderate. Execution risk on unwinding if funding reverses rapidly. Hard stop: if funding goes negative, exit both legs within 30 minutes.
- Target: annualized carry > 12% net of fees before live enable.

**#3: Kalshi/Polymarket Cross-Platform Arb (Priority 1B + 2A combined)**
- Why third: requires two new accounts (Kalshi + Polymarket), dual API integration, and the hardest engineering problem (sub-second simultaneous execution). But the fee structure is favorable (Kalshi fee is on profit, not notional; Polymarket US is 0.30% taker), and prediction market inefficiency is documented at scale. Build this after the first two strategies are live and generating revenue, using that confidence and capital as buffer.
- Expected effort: 3–4 weeks. Kalshi account (US, CFTC-regulated — easy to open). Polymarket wallet (Polygon, requires small ETH/USDC to fund). Dual order-book monitor. Opportunity matcher. Simultaneous execution engine.
- Risk: execution risk is the highest of the three. Backtest on historical order book snapshots before live. Run paper for minimum 30 days.
- Target: profitable on paper across 50+ trades before live enable.

---

## Section 4: Architecture Sketch — Multi-Market Trader9

This is high-level only. No code.

```
trader9-bot.mjs (orchestrator)
│
├── MarketClock module
│   — knows current time, determines which markets are active
│   — schedules strategy runners accordingly
│
├── FeeModel module (UNIVERSAL — applies to ALL orders before execution)
│   — per-venue fee tables (Alpaca crypto, Alpaca equity, Hyperliquid, Kalshi, Polymarket)
│   — calculates NET EXPECTED VALUE before any order is placed
│   — blocks trades below minimum expected value threshold
│
├── RiskManager module
│   — account-level: hard stop at -15% drawdown from high-water mark
│   — strategy-level: pause any strategy that loses 5% in one session
│   — position sizing: fractional Kelly or fixed percent-of-account per strategy
│   — Telegram alerts on: live/paper mode switch, drawdown breach, account anomaly, any error
│
├── Strategies (each a self-contained module)
│   ├── StatArbEquity (Alpaca equities, market hours only)
│   │   — cointegration pairs monitor
│   │   — mean-reversion signal
│   │   — FeeModel check before order
│   │
│   ├── FundingRateCarry (Alpaca spot + Hyperliquid perps, 24/7)
│   │   — funding rate scanner (Hyperliquid API + CoinGlass)
│   │   — delta-neutral position manager
│   │   — automatic rebalancer on large BTC price moves
│   │   — FeeModel check on entry and exit
│   │
│   └── PredictionMarketArb (Kalshi + Polymarket, 24/7)
│       — dual order-book poller (WebSocket preferred)
│       — opportunity matcher (cross-platform + combinatorial)
│       — simultaneous execution engine
│       — event calendar watcher (FRED, Kalshi upcoming markets)
│       — FeeModel check before any trade
│
├── BacktestHarness (offline — not part of live bot)
│   — per-strategy module that replays historical data
│   — identical FeeModel to live bot (no optimistic assumptions)
│   — outputs: Sharpe, max drawdown, win rate, net P&L, fee drag breakdown
│
├── Reporting module
│   — all P&L fields explicitly labeled: LIVE vs. PAPER
│   — no hardcoded constants — all thresholds in config file
│   — daily Telegram summary: P&L by strategy, fees paid, opportunities found/skipped
│
└── DataFeeds
    — Alpaca WebSocket (equity + crypto quotes)
    — Hyperliquid REST + WebSocket (perp prices, funding rates)
    — Kalshi WebSocket (order book, market catalog)
    — Polymarket CLOB WebSocket (order book)
    — FRED API (economic calendar, free)
    — CoinGlass API (cross-exchange funding rate monitor)
```

**Key architectural principles:**
1. FeeModel is a hard gate, not an optional check. Every order passes through it.
2. Live and paper accounts are tracked separately with explicit labels — no mixing.
3. RiskManager has kill-switch authority. It can halt any strategy or the entire bot and push Telegram alert without any other module's permission.
4. Each strategy module is independently enable/disable-able. Turning off stat-arb does not affect funding-rate carry.
5. All strategy thresholds (minimum edge, position size limits, drawdown limits) live in a config file — never hardcoded. Changeable without a code deploy.

---

## Section 5: Accounts, APIs, and Broker Relationships Needed

### Already have:
- Alpaca trading account (account 216104741) — equities, ETFs, options, crypto spot
- Alpaca API keys

### Need to acquire:
| Account / Service | Purpose | Cost | Action |
|---|---|---|---|
| Hyperliquid wallet | Perpetual futures for funding-rate carry | Free (self-custody wallet, Polygon/Arbitrum bridge fees ~$5 one-time) | Create MetaMask wallet, bridge USDC |
| Kalshi account | Prediction market arb + event-driven | Free (CFTC-regulated, US persons OK, ACH deposits free) | Sign up at kalshi.com, complete KYC |
| Polymarket account (US regulated) | Cross-platform arb | Free to create; ~$20 USDC needed to fund for trading | Create Polygon wallet, fund via bridge or Moonpay |
| CoinGlass API | Funding rate data across exchanges | Free tier available (limited), Pro ~$29/mo | Sign up at coinglass.com; start free tier |
| FRED API | Economic calendar, macro data | Free | Register at fred.stlouisfed.org/docs/api/ |
| Interactive Brokers (optional) | Better FX + options access, lower options fees | No minimum for IBKR Lite; Pro has fees | Defer to Phase 2 |

**Total new account cost to start Phase 1:** ~$25 in bridge/gas fees. Monthly ongoing: $0–$29/mo (CoinGlass, start free).

**All of the above are under the $100 single-spend rule — no Owner approval required for setup.**

---

## Section 6: Honest P&L Expectations

No sugarcoating. These are realistic ranges based on verified research, not marketing copy.

### $10K Account

| Strategy | Expected Annual Return (net) | Max Drawdown | Notes |
|---|---|---|---|
| ETF stat-arb pairs | 8–18% ($800–$1,800) | 8–12% | Requires solid backtest. Lower end without regime awareness. |
| Funding-rate carry | 8–15% ($800–$1,500) | 5–10% | Depends heavily on crypto market sentiment. Near-zero in bear markets. |
| Cross-platform prediction arb | 15–35% ($1,500–$3,500) | 10–15% | High upside but execution-dependent. Requires fast latency. |
| All three combined | **20–40% ($2,000–$4,000)** | 12–18% | Additive if not correlated. Best realistic scenario. |

**Conservative projection (things go OK):** $1,500–$2,500 net/year on $10K. 15–25% return.
**Aggressive projection (everything works):** $3,000–$4,000 net/year. 30–40% return.
**Honest base case:** assume 50% of backtest performance in live trading. Strategies rarely beat their backtests.

### $100K Account

Position sizing becomes more meaningful. Same strategies, larger absolute returns.
- Conservative: $12,000–$20,000/year (12–20%)
- Aggressive: $25,000–$40,000/year (25–40%)
- Warning: at $100K, market impact becomes a factor for prediction market strategies. Sizing a $50K bet on a Kalshi contract moves the market. Scale prediction market allocation to ~15–20% of capital maximum.

### $1M Account

- Prediction market strategies cap out quickly — markets are thin. Max useful allocation to prediction markets: $50K–$100K
- ETF stat-arb scales well up to ~$500K before market impact becomes relevant on liquid names
- Funding-rate carry scales well (Hyperliquid is deep enough) but funding rate compresses as more capital chases it
- Realistic returns at $1M: **10–20% annualized** ($100K–$200K/year)
- The dirty secret of small-edge arbitrage strategies: they scale worse than you hope. A strategy earning 25% on $10K earns maybe 12% on $1M because you move the market.

### What the BB_REVERT history tells us

The bot traded enough volume to incur meaningful fees on a $333 account. A 0.50% round-trip fee is a 33% annual fee drag if you make one round trip per trading day (250 days). Mean reversion strategies that capture 0.2–0.3% per trade can never clear this. This was a structural failure, not bad luck. The new architecture prevents this by construction.

---

## Section 7: Dealbreaker Checklist

Before any live re-enable, confirm all of the following:

- [ ] FeeModel module built and verified: every backtested trade shows fee subtraction, not gross
- [ ] Paper trading results show positive net expectancy over minimum 30 trading days
- [ ] Live/paper labels verified in every Telegram update — no mixing
- [ ] Drawdown hard stop tested: simulate account drop of 15%, confirm bot halts and alerts
- [ ] Hyperliquid account funded and delta-neutral hedger tested on paper
- [ ] Kalshi account KYC complete, API key obtained
- [ ] Polymarket wallet funded ($20 minimum), CLOB API authenticated
- [ ] Backtest walk-forward validation complete for stat-arb pairs (3-year, out-of-sample)
- [ ] All strategy thresholds in config file, zero hardcoded constants
- [ ] 9 review and sign-off before live re-enable

---

## Notes for Wendy (Implementation)

1. Build stat-arb pairs first. It is the lowest-risk, fastest path to a proven architecture. Use it to validate FeeModel and RiskManager before adding crypto or prediction market complexity.

2. CoinGlass free tier is sufficient to start. Do not pay for Pro until funding-rate carry is live and generating. Upgrade if data latency is a problem.

3. Hyperliquid fees (0.045% taker) are 5x cheaper than Alpaca crypto (0.25% taker). For any strategy involving crypto, Hyperliquid should be the execution venue, not Alpaca crypto. Alpaca crypto is only justified for spot-hold positions (funding-rate carry spot leg).

4. Kalshi pays 3.50% APY on idle balances. Keep working capital in Kalshi earning yield while waiting for arb opportunities. This is a free 3.50% floor on any capital allocated to prediction market strategies.

5. Do not build Priority 2C (political catalyst directional equity trading) yet. The information asymmetry assumption is weak and the strategy is directional, not structural. It belongs in Phase 2 evaluation.

6. The report to Owner should be: "Phase 1 strategy plan complete. Three strategies selected. New accounts needed: Hyperliquid wallet (~$5 gas), Kalshi (free), Polymarket (~$20 USDC). Total startup cost under $25. Timeline to first live trade: 6–8 weeks of build + paper testing. Realistic first-year return on $10K: $1,500–$4,000 depending on market conditions." Do not oversell.

---

*Document prepared by MONEY (9 Revenue Specialist). Verified fee structures: Alpaca (docs.alpaca.markets), Kalshi (help.kalshi.com/trading/fees), Polymarket (docs.polymarket.com), Hyperliquid (hyperliquid.gitbook.io/hyperliquid-docs/trading/fees). Research conducted April 5, 2026.*
