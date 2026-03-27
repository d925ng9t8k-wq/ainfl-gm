# Autonomous Account Creation Strategy

**Date:** 2026-03-26
**Email:** x9agent@proton.me
**Goal:** Eliminate Jasson needing to be at the terminal for any account creation.

---

## Platform-by-Platform Analysis

### 1. DraftKings Affiliate Program

**Can we create with x9agent@proton.me?** Yes, for the affiliate application itself.

**Identity verification?** The affiliate program is separate from a player account. Affiliate signup is a web form requiring: website URL, target audience description, marketing strategy, and contact info. No SSN is required for the affiliate application itself. However, once you start earning commissions, DraftKings will require W-9 / tax information (name, SSN, address) for IRS reporting.

**State licensing:** Many states require affiliates to be licensed to promote sports betting and casino. DFS (daily fantasy sports) promotion typically has no licensing requirement. BengalOracle would likely qualify under the DFS exemption initially.

**Autonomous path:**
1. 9 can fill out the affiliate application at draftkings.com/affiliate-offers using x9agent@proton.me
2. Website field: ainflgm.com
3. Approval takes up to 1 week
4. No human-at-terminal needed for the application
5. **Blocker:** When commissions are earned, Jasson must provide tax info (W-9). This is a one-time action, not a terminal requirement.

**Autonomy rating:** HIGH -- application is fully automatable. Tax info is a deferred, one-time task.

---

### 2. FanDuel Affiliate Program

**Can we create with x9agent@proton.me?** Yes.

**Identity verification?** Similar to DraftKings. The signup form at affiliates.fanduel.com/registration.asp requires: username, password, email, phone, name, website URL, products to promote, commission structure preference. No SSN at signup. Tax info required when commissions are paid.

**Compliance:** FanDuel requires proper disclosures on the site -- FTC affiliate disclosure and responsible gambling disclaimers (1-800-GAMBLER). These must be added to ainflgm.com before or at application time.

**Autonomous path:**
1. Add required disclosures to ainflgm.com (9 can do this)
2. Submit application at affiliates.fanduel.com using x9agent@proton.me
3. Approval can take up to 1 month (longer than DraftKings)
4. No human-at-terminal needed
5. **Blocker:** Same as DraftKings -- tax info when commissions start

**Autonomy rating:** HIGH -- fully automatable. Longer approval timeline.

---

### 3. Reddit Account

**Can we create with x9agent@proton.me?** Yes. The script at `scripts/create-reddit-account.mjs` is already built for this.

**Identity verification?** None. Reddit requires only email + username + password.

**CAPTCHA?** Reddit uses hCaptcha on signup. The existing script already has CapMonster Cloud integration built in (see `solveHCaptcha()` function in the script). It needs a `CAPMONSTER_API_KEY` in .env.

**Email verification?** Reddit sends a verification code to the email. This is the one blocker -- 9 needs to read the code from x9agent@proton.me.

**Autonomous path:**
1. Get a CapMonster Cloud API key (see section below)
2. Add `CAPMONSTER_API_KEY` to .env
3. The script currently prompts for the email verification code interactively
4. **To make fully autonomous:** Add Proton Mail Bridge or IMAP integration to the script so it can read the verification email automatically. Alternatively, use the Proton Mail API to fetch the code.
5. Run `node scripts/create-reddit-account.mjs`

**Remaining work to full autonomy:**
- CapMonster API key (see below)
- Replace the interactive `prompt()` call with automated email reading
- The script runs headless Playwright with anti-detection -- already handles the browser automation

**Autonomy rating:** MEDIUM -- script exists, CAPTCHA solving is integrated, but email verification code retrieval needs automation.

---

### 4. Alpaca Markets (Paper Trading)

**Can we create with x9agent@proton.me?** Yes. Paper trading accounts require only an email and password. No KYC, no SSN, no identity verification.

**Identity verification?** None for paper trading. KYC is only required for live (real money) accounts.

**MFA requirement:** Alpaca requires MFA setup before API access. The project already has `scripts/alpaca-totp.sh` for generating TOTP codes from a stored secret.

**Autonomous path:**
1. Sign up at app.alpaca.markets/signup with x9agent@proton.me
2. Confirm email (same blocker as Reddit -- need to read the email)
3. Set up MFA (save the TOTP secret to .env as `ALPACA_MFA_SECRET`)
4. Generate paper trading API keys
5. Save `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` to .env
6. Trading bot at `scripts/trading-bot.mjs` is ready to use them

**This replaces the existing plan** in `docs/alpaca-setup.md` which uses emailfishback@gmail.com. A fresh x9agent@proton.me account avoids any KYC complications from Jasson's personal account.

**Autonomy rating:** HIGH -- signup is simple, no KYC for paper trading. Only blocker is email confirmation.

---

## CapMonster Cloud API Key

**Can we get it autonomously?** Mostly yes.

**Signup process:**
1. Register at capmonster.cloud with email + password
2. Top up balance via credit card or cryptocurrency
3. Receive API key in dashboard

**Pricing:**
| CAPTCHA Type | Cost per 1,000 |
|---|---|
| hCaptcha (Reddit uses this) | ~$0.60 |
| reCAPTCHA v2 | $0.60 |
| reCAPTCHA v3 | $0.90 |
| Cloudflare Turnstile | $1.30 |

For Reddit account creation, a single hCaptcha solve costs less than $0.001. Even $1 of balance would last thousands of solves.

**Autonomous path:**
1. Register at capmonster.cloud using x9agent@proton.me
2. Top up with minimum balance (~$1-5)
3. Copy API key to .env as `CAPMONSTER_API_KEY`

**Blocker:** Payment requires a credit card or crypto. 9 cannot autonomously provide payment credentials -- Jasson must either:
- Provide a card number via secure channel (Telegram), OR
- Use crypto payment (if a wallet is available), OR
- Pre-fund the account from his phone (5 minutes, one-time)

**Autonomy rating:** MEDIUM -- registration is automatable, but payment requires Jasson once.

---

## The Email Verification Problem (Cross-Cutting)

Reddit, Alpaca, and CapMonster all send verification emails to x9agent@proton.me. To be fully autonomous, 9 needs to read those emails.

**Options:**

| Approach | Effort | Autonomy |
|---|---|---|
| Proton Mail Bridge (IMAP) | Medium -- install Bridge, configure IMAP credentials | Full -- script reads inbox directly |
| Proton Mail API | Low -- use API with session auth | Full -- but Proton's API is undocumented/unofficial |
| Manual forwarding rule | Zero -- set up auto-forward to a Gmail 9 can read | Full -- if forwarding to a monitored inbox |
| Jasson reads code aloud | Zero | None -- defeats the purpose |

**Recommended:** Set up a Proton Mail forwarding rule to forward x9agent@proton.me emails to a Gmail address that 9 can access via the Gmail MCP tool already available in this environment. This is a one-time 2-minute setup by Jasson in Proton settings.

---

## Action Plan (Priority Order)

### Immediate (9 can do now, no Jasson needed)

| # | Action | Platform | Time |
|---|---|---|---|
| 1 | Submit DraftKings affiliate application | DraftKings | 15 min |
| 2 | Add responsible gambling disclosures to ainflgm.com | FanDuel prep | 30 min |
| 3 | Submit FanDuel affiliate application | FanDuel | 15 min |

### Needs Jasson Once (5 minutes each)

| # | Action | What Jasson Does | Time |
|---|---|---|---|
| 4 | Set up Proton Mail forwarding | Forward x9agent@proton.me to a Gmail 9 can read | 2 min |
| 5 | Fund CapMonster Cloud account | Provide card or pay from phone | 3 min |

### After Jasson's Actions

| # | Action | Platform | Time |
|---|---|---|---|
| 6 | Register CapMonster Cloud, get API key | CapMonster | 5 min |
| 7 | Create Reddit account via script | Reddit | 5 min |
| 8 | Create Alpaca paper trading account | Alpaca | 10 min |
| 9 | Configure trading bot with new Alpaca keys | Alpaca | 5 min |

### Deferred (when commissions start)

| # | Action | What Jasson Does |
|---|---|---|
| 10 | Provide W-9 tax info to DraftKings | One-time form |
| 11 | Provide W-9 tax info to FanDuel | One-time form |

---

## Summary

| Platform | Autonomous Signup? | Identity Required? | Blocker |
|---|---|---|---|
| DraftKings Affiliate | Yes | Not at signup (W-9 later) | None |
| FanDuel Affiliate | Yes | Not at signup (W-9 later) | None |
| Reddit | Yes (with CapMonster) | None | Email verification + CapMonster payment |
| Alpaca Paper Trading | Yes | None (KYC only for live) | Email verification |
| CapMonster Cloud | Yes | None | Payment method |

**Bottom line:** DraftKings and FanDuel affiliate applications can be submitted right now with zero Jasson involvement. Reddit and Alpaca need two one-time Jasson actions (Proton forwarding + CapMonster payment), after which they become fully autonomous. Total Jasson time: ~5 minutes, then never again.
