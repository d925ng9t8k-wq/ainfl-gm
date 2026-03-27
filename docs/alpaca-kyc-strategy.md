# Alpaca KYC Strategy

## Problem

We need Alpaca API access for the trading bot. The live trading KYC flow uses Onfido embedded in a sandboxed iframe, which blocks browser automation for document upload. DL photos exist at `data/dl-front.jpg` and `data/dl-back.jpg` (in the main repo, not this worktree).

## Research Findings

### Option 1: Onfido Direct API Upload (Not Viable for Us)

Onfido's API v3 does support direct document upload without the SDK:

1. **Create Applicant** -- `POST /v3/applicants` with name, DOB, address
2. **Upload Document** -- `POST /v3/documents` with `multipart/form-data` (the DL photo files)
3. **Create Check** -- `POST /v3/checks` referencing the applicant and document IDs

However, this requires **your own Onfido API token**. Alpaca does not expose their Onfido token to end users. The flow is:

- Alpaca generates an Onfido SDK token via `GET /v1/accounts/{account_id}/onfido/sdk/tokens/`
- That token is scoped to the Onfido SDK only -- it cannot be used for direct API calls
- After the SDK flow completes, you call `PATCH /v1/accounts/{account_id}/onfido/sdk/` to report the outcome to Alpaca

**Bottom line:** We cannot bypass Alpaca's Onfido iframe. The SDK token is not an API token, and we do not have direct Onfido API access.

### Option 2: Alpaca Broker API Document Upload (Requires Broker Account)

Alpaca's Broker API has a `POST /v1/accounts/{account_id}/documents/upload` endpoint that accepts base64-encoded documents. But this is for **Broker API partners** (companies building brokerage apps on top of Alpaca), not individual traders.

**Bottom line:** Not applicable to us.

### Option 3: Manual KYC Completion (Works but Requires Jasson)

The Onfido SDK iframe works fine in a regular browser. Jasson would need to:

1. Log into Alpaca at app.alpaca.markets
2. Navigate to the KYC/verification section
3. Upload DL photos through the Onfido iframe (take photos or upload files)
4. Complete the selfie step
5. Wait for approval (usually minutes to hours)

**Bottom line:** Works but requires Jasson to do it manually. Takes 5 minutes.

### Option 4: Paper Trading Account -- NO KYC NEEDED (Recommended)

**Paper trading accounts require only an email address.** No KYC, no SSN, no document upload. This is the fastest path to getting the trading bot running.

**Alpaca confirms:** "Anyone globally can create a paper only account by signing up with just your email address."

Paper trading includes:
- Real-time market data
- Simulated trades for stocks, ETFs, crypto, and options
- $100,000 in simulated funds (resettable)
- Full API access with separate paper trading API keys

## Recommended Strategy

### Phase 1: Paper Trading (Do Now)

Create a new Alpaca paper trading account:

- **Email:** x9agent@proton.me
- **URL:** https://app.alpaca.markets/signup
- **What's needed:** Just the email and a password. No KYC.
- After signup, go to Paper Trading > Your API Keys > Generate New Key
- Add `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` to the vault
- Point the trading bot at `paper-api.alpaca.markets`

This can be done right now with zero friction.

### Phase 2: Live Trading (When Ready)

When Jasson decides to go live with real money:

1. Jasson logs into the Alpaca account in a browser
2. Completes the Onfido KYC flow manually (5 min -- DL upload + selfie)
3. Waits for approval
4. Funds the account
5. We switch the bot endpoint from `paper-api` to `api.alpaca.markets`

There is no way to automate the Onfido KYC step. The iframe is sandboxed, the SDK token is not an API token, and we do not have Broker API access. Manual completion by Jasson is the only path for live trading.

## Action Items

- [ ] Jasson creates paper account at app.alpaca.markets/signup with x9agent@proton.me
- [ ] Generate paper trading API keys and send to 9 via Telegram
- [ ] 9 configures the trading bot with paper keys
- [ ] Bot runs on paper money for validation period
- [ ] When ready for live: Jasson completes KYC manually (5 min in browser)

## Sources

- [Alpaca Paper Trading Docs](https://docs.alpaca.markets/docs/paper-trading)
- [Alpaca Getting Started](https://docs.alpaca.markets/docs/getting-started-with-trading-api)
- [Alpaca Broker API KYC Guide](https://alpaca.markets/broker-resources/guide/alpaca-broker-api-guide-kyc-process)
- [Alpaca Onfido SDK Integration](https://alpaca.markets/learn/how-to-integrate-the-onfido-sdk-into-your-brokerage-app)
- [Onfido API v3 Documentation](https://documentation.onfido.com/api/3.0.0)
- [Onfido Web SDK Reference](https://documentation.onfido.com/sdk/web/)
- [Alpaca Account Plans](https://docs.alpaca.markets/docs/account-plans)
