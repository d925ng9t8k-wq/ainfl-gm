# Alpaca Paper Trading Setup

**Purpose:** Run the trading bot (scripts/trading-bot.mjs) on paper money. No real funds at risk.

**Time required:** 5 minutes on your phone.

**Script ready:** `scripts/trading-bot.mjs` is built and waiting.

---

## Step 1: Create Alpaca Account

Alpaca supports API-based signup, but the simplest path is the browser:

1. Go to **alpaca.markets** on your phone
2. Click **Get Started** or **Sign Up**
3. Use emailfishback@gmail.com
4. Fill in name, password — no SSN or funding required for paper trading
5. Verify email

---

## Step 2: Get Paper Trading API Keys

1. After login, go to **Paper Trading** (not Live Trading)
2. Click **Your API Keys** in the sidebar
3. Click **Generate New Key**
4. Copy:
   - **API Key ID** (e.g., PKxxxxxxxxxxxxxxxx)
   - **Secret Key** (shown once — copy it now)

---

## Step 3: Give Keys to 9

Send 9 in Telegram:

> "Alpaca paper trading keys: Key ID: [PK...], Secret: [xxx]"

9 will add them to the Locker and start the bot.

---

## Env Vars Needed

| Variable | Value |
|----------|-------|
| `ALPACA_API_KEY` | Paper trading Key ID |
| `ALPACA_SECRET_KEY` | Paper trading Secret Key |

No other credentials needed. Bot uses the paper trading endpoint automatically.

---

## What the Bot Does

- Trades SPY (S&P 500 ETF) using momentum strategy
- 10% position sizing, 2% stop loss, 3% take profit
- Reports daily P&L to 9 via the comms hub
- Paper money only — no real funds until Owner explicitly approves live trading

---

## Paper Account Balance

Alpaca starts paper accounts with $100,000 in simulated funds. You can reset this anytime from the dashboard.

---

## Note on Live Trading

The bot is hardcoded to `paper-api.alpaca.markets`. Switching to live trading requires:
1. Owner explicit approval
2. Funding the account ($0 minimum but must deposit to trade)
3. Code change to swap the endpoint

9 will not make that switch without direct instruction.
