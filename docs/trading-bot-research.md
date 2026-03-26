# Trading Bot — Research & Recommended Stack
**Date:** March 26, 2026

---

## The Opportunity

AI trading bots are generating real returns for small investors. The key is API-first platforms with commission-free trading and paper trading for risk-free testing.

---

## Recommended Platform: Alpaca Markets

**Why Alpaca:**
- Commission-free stock and ETF trading
- Free paper trading (simulated with real-time market data)
- REST API + official MCP server (Claude Code can trade directly)
- Anyone globally can create a paper account with just an email
- Real-time market data included
- Supports stocks, ETFs, options, and crypto

**Cost:** $0 for paper trading. $0 commission on live trades. Just need capital to trade.

**MCP Server:** Alpaca has an official MCP server at github.com/alpacahq/alpaca-mcp-server — this means an agent can trade in plain English through Claude Code. "Buy 10 shares of AAPL" just works.

---

## Other Platforms Evaluated

| Platform | Cost | Paper Trading | API Quality | Verdict |
|----------|------|---------------|-------------|---------|
| **Alpaca** | Free | Yes | Excellent | **RECOMMENDED** |
| Tickeron | $60/yr+ | Limited | Good | Good for signals, not execution |
| Trade Ideas | Free tier | Yes | Good | "Holly" AI signals, $228/yr for pro |
| Composer | $5-40/mo | Yes | Good | Strategy builder, not raw API |

---

## Recommended Strategy for Budget Trading

**Phase 1: Paper Trading (FREE)**
- Set up Alpaca paper account
- Build a simple momentum/mean-reversion bot
- Run for 30 days with simulated money
- Track performance, iterate

**Phase 2: Small Live Trading ($100-500 starting capital)**
- Graduate best-performing strategy to live
- Start with ETFs (SPY, QQQ) for liquidity
- Set strict stop-losses (2% max per trade)
- Target 1-2% monthly return

**Phase 3: Prediction Markets**
- Polymarket API for event-based trading
- Lower capital requirements than stock market
- AI advantage: can process news/data faster than humans
- Kalshi for regulated prediction markets

---

## Bot Architecture

```
Claude Code Agent (Trading Bot)
├── Alpaca MCP Server (execution)
├── Market Data API (real-time prices)
├── Strategy Engine
│   ├── Momentum (trend following)
│   ├── Mean Reversion (buy dips)
│   ├── News Sentiment (process headlines)
│   └── Pattern Recognition (chart patterns)
├── Risk Manager
│   ├── Position sizing (Kelly criterion)
│   ├── Stop-loss enforcement
│   ├── Daily loss limits
│   └── Portfolio exposure limits
└── Reporting (daily P&L to Jasson)
```

---

## Regulatory Notes

- Alpaca is SEC-registered broker-dealer and FINRA member
- No special licensing needed for personal algorithmic trading
- Pattern Day Trader rules apply if account < $25K and making 4+ day trades per week
- Solution: swing trading (hold overnight) avoids PDT rules
- Paper trading has zero regulatory requirements

---

## Cost Summary

| Item | Cost |
|------|------|
| Alpaca account | Free |
| Paper trading | Free |
| Live trading commission | Free |
| Starting capital (live) | $100-500 (Owner decision) |
| Prediction market deposit | $50-200 (Owner decision) |
| **Total to get started** | **$0 (paper) or $100-500 (live)** |

---

## Next Steps

1. Create Alpaca paper trading account (free, email only)
2. Install Alpaca MCP server in Claude Code
3. Build basic momentum strategy
4. Paper trade for 30 days
5. Present results to Owner for live trading approval

**Owner approval needed:** Yes, before any live trading with real money.
