# 9 Enterprises — Credential Inventory

**Generated:** 2026-04-05
**Author:** Tee (Engineering Team Lead)
**Purpose:** Cross-reference every credential in .env against code references. Flag orphans, mismatches, and hygiene issues.

---

## Methodology

1. Scanned all `.mjs` scripts in `scripts/`, `cloud-worker/src/worker.js`, and `command-hub/` for `process.env.VAR_NAME` references using grep.
2. No .env.example file exists — flagged as gap.
3. Credential values are never shown — only variable names.
4. .env file was NOT read directly (Locker Protocol). All references are from code-level grep only.

---

## Master Credential Table

Each credential categorized by: which component uses it, whether it was found in code, security classification, and hygiene status.

| Env Var | Used By | Category | Hygiene Status | Notes |
|---------|---------|----------|---------------|-------|
| `ANTHROPIC_API_KEY` | voice-server, jules-telegram, kids-mentor, pilot-server, trinity-agent, underwriter-api, open-terminal (health check) | AI Provider | OK | Used across 7+ components. If rotated, must update .env and restart all services simultaneously. |
| `ANTHROPIC_API_KEY_TC` | comms-hub | AI Provider | FLAG | Separate key for comms-hub only. Purpose unclear from name ("TC" = ?). Why not share ANTHROPIC_API_KEY? Two keys means two rotation events. |
| `TELEGRAM_BOT_TOKEN` | comms-hub, cloud-worker | Messaging | FLAG | Also visible as hardcoded fallback in jules-telegram.mjs source code — token literal in file. Should be env-only. |
| `JULES_TELEGRAM_BOT_TOKEN` | jules-telegram | Messaging | FLAG | Hardcoded fallback literal visible in jules-telegram.mjs source. If leaked via git, bot can be impersonated. |
| `TELEGRAM_CHAT_ID` | comms-hub | Messaging | OK | Jasson's Telegram user ID. Not a secret but correct to keep in env. |
| `TWILIO_ACCOUNT_SID` | comms-hub, pilot-server | Telephony | OK | Standard Twilio auth pattern. |
| `TWILIO_AUTH_TOKEN` | comms-hub, voice-server, pilot-server | Telephony | OK | Used for webhook signature validation in pilot-server (correct). Used for outbound calls in hub. |
| `TWILIO_PHONE_NUMBER` | pilot-server | Telephony | OK | From number for Kyle Cabezas SMS. |
| `TWILIO_FROM_NUMBER` | comms-hub | Telephony | REVIEW | Different var name from `TWILIO_PHONE_NUMBER` — two Twilio numbers in use. Ensure both are registered for A2P compliance. |
| `ELEVENLABS_API_KEY` | voice-server | TTS | OK | Standard key. |
| `ELEVENLABS_VOICE_ID` | voice-server | TTS | OK | Voice persona ID. Not secret but correct in env. Hardcoded fallback `"4XMC8Vdi6YFsmti2NFdp"` in code if env not set. |
| `GMAIL_APP_PASSWORD` | comms-hub | Email | CRITICAL FLAG | Gmail App Password stored in .env. App Passwords are permanent (no expiry). If .env leaks, full email send access. Should be rotated annually minimum. Hub logs a warning if this is not set. |
| `NEON_DATABASE_URL` | comms-hub | Database | CRITICAL FLAG | Contains full database connection string including credentials. If leaked, full read/write access to cloud Neon DB. |
| `SUPABASE_URL` | comms-hub, command-hub | Database | OK | URL only — not a secret by itself. |
| `SUPABASE_ANON_KEY` | comms-hub, command-hub | Database | REVIEW | Anon key has limited access per Supabase RLS. But if service key (`SUPABASE_SERVICE_KEY`) is also in .env, that bypasses RLS entirely. comms-hub tries `SUPABASE_SERVICE_KEY` first, falls back to `SUPABASE_ANON_KEY`. |
| `SUPABASE_SERVICE_KEY` | comms-hub | Database | CRITICAL FLAG | Full admin access to Supabase — bypasses Row Level Security. If leaked, attacker has full read/write to all 9 data. Verify RLS policies are defined even with service key in use. |
| `HUB_API_SECRET` | comms-hub | Internal Auth | FLAG | Protects `/context` endpoint. Optional — if not set, the endpoint is OPEN. Must be set in production. |
| `CLOUD_SECRET` | comms-hub, cloud-worker | Internal Auth | OK | Mutual auth between Mac hub and Cloudflare Worker. Correct pattern. |
| `CLOUD_WORKER_URL` | comms-hub | Internal | OK | URL of cloud worker for state sync. |
| `JASSON_PHONE` | comms-hub | PII | FLAG | Phone number in .env. PII. Not a credential but sensitive — should be documented as PII in any data privacy posture. |
| `JAMIE_PHONE` | comms-hub | PII | FLAG | Same as above — partner's phone number. PII. |
| `JULES_KYLEC_RECIPIENT_PHONE` | comms-hub, pilot-server | PII | FLAG | Kyle Cabezas phone. Customer PII in .env. |
| `JULES_RECIPIENT_PHONE` | jules-server.mjs (legacy) | PII | ORPHAN | Used only in `jules-server.mjs` which appears to be a legacy predecessor to `jules-telegram.mjs`. Verify if still needed. |
| `ALPACA_API_KEY` | trader9-bot | Financial | CRITICAL FLAG | Live/paper trading API key. Financial account access. |
| `ALPACA_SECRET_KEY` | trader9-bot | Financial | CRITICAL FLAG | Trading secret. Full trading account control if leaked. |
| `ALPACA_LIVE_API_KEY` | trader9-bot | Financial | CRITICAL FLAG | Live (real money) Alpaca key. Activates live trading. Presence in .env enables live trading automatically. |
| `ALPACA_LIVE_SECRET_KEY` | trader9-bot | Financial | CRITICAL FLAG | Live trading secret. Paired with above. |
| `OPENWEATHER_API_KEY` | pilot-server | Weather | LOW RISK | Weather API. Limited scope. Low risk if leaked. |
| `SQLITE_ENCRYPTION_KEY` | memory-db | Database | CRITICAL FLAG | Controls SQLCipher encryption of the primary 9 memory database. If lost, database is unrecoverable. If leaked, database is decryptable by anyone with the file. Must be backed up securely outside the project. |
| `X_API_KEY` | x9-poster.mjs | Social Media | REVIEW | X (Twitter) API key. Script is CLI-only, not a running service. Active? |
| `X_API_SECRET` | x9-poster.mjs | Social Media | REVIEW | X API secret. Same question — is this account actively needed? |
| `X_ACCESS_TOKEN` | x9-poster.mjs | Social Media | REVIEW | X OAuth token. |
| `X_ACCESS_SECRET` | x9-poster.mjs | Social Media | REVIEW | X OAuth secret. |
| `MAC_TUNNEL_URL` | telegram-relay.mjs | Internal | ORPHAN | Used only in `telegram-relay.mjs` — a relay script. Is this still active? Verify. |
| `PLACE_ORDER` | food-order-poc.mjs | Feature flag | ORPHAN | Controls dry-run mode for Dominos food ordering POC. POC script — not a running service. |
| `TRIGGER_SENTIMENT` | trading-bot.mjs (legacy) | Feature flag | ORPHAN | Used only in `trading-bot.mjs` (the legacy bot, not trader9-bot.mjs). Should this be removed? |
| `FORCE_CLOSE_SENTIMENT` | trading-bot.mjs (legacy) | Internal flag | ORPHAN | Same as above — legacy trading bot only. Runtime env mutation (not set in .env). |
| `PORT` | pilot-server.mjs | Config | OK | Port override. Standard pattern. |
| `HOME` | kids-mentor, comms-hub | System | OK | macOS system variable. Not set in .env — read from shell environment. |
| **Dominos credentials** | food-order-poc.mjs | Payment + PII | FLAG | `DOMINOS_CARD_NUMBER`, `DOMINOS_CARD_CVV`, `DOMINOS_CARD_EXPIRY`, `DOMINOS_CARD_ZIP`, `DOMINOS_EMAIL`, `DOMINOS_FIRST_NAME`, `DOMINOS_LAST_NAME`, `DOMINOS_PHONE`, `DOMINOS_ADDRESS`, `DOMINOS_TIP` — full payment card data in .env. POC script only. If this is still in .env, it is a PCI DSS violation if the system were ever audited. |
| `TUNNEL_URL` | voice-server, comms-hub | Config | REVIEW | Public tunnel URL. Changes on every tunnel restart. Keeping in .env creates staleness risk. |

---

## Flagged Issues Summary

### CRITICAL (immediate action recommended)

| # | Issue | Var(s) Affected | Risk |
|---|-------|-----------------|------|
| C-01 | Payment card data in .env | `DOMINOS_CARD_NUMBER`, `DOMINOS_CARD_CVV`, `DOMINOS_CARD_EXPIRY`, `DOMINOS_CARD_ZIP` | PCI DSS violation if audited. Card data should never be in a flat config file. |
| C-02 | Supabase service key bypasses RLS | `SUPABASE_SERVICE_KEY` | Full admin DB access. If .env leaks, attacker owns all 9 data. |
| C-03 | SQLite encryption key in .env | `SQLITE_ENCRYPTION_KEY` | Same file as the encrypted DB path. Key and lock in same location. Should be in separate secure store. |
| C-04 | Live trading keys in .env | `ALPACA_LIVE_API_KEY`, `ALPACA_LIVE_SECRET_KEY` | Real money trading account. Activation is automatic when these keys are present. |
| C-05 | Telegram bot token hardcoded in source | `JULES_TELEGRAM_BOT_TOKEN` | Token literal visible in jules-telegram.mjs. If ever committed to a public repo, bot is compromised. |
| C-06 | Neon DB connection string in .env | `NEON_DATABASE_URL` | Full connection string with credentials = full cloud DB access. |

### HIGH (fix in current sprint)

| # | Issue | Var(s) Affected | Risk |
|---|-------|-----------------|------|
| H-01 | Gmail App Password never expires | `GMAIL_APP_PASSWORD` | Permanent credential. No rotation policy. Single leaked .env = permanent email send access. |
| H-02 | No .env.example file exists | All | Any new developer or deployment has no documented credential requirements. Kyle will ask for this immediately. |
| H-03 | HUB_API_SECRET optional — /context endpoint open if not set | `HUB_API_SECRET` | Any process on the same machine (or via network if hub is ever exposed) can write to shared state. |
| H-04 | PII (phone numbers) in .env | `JASSON_PHONE`, `JAMIE_PHONE`, `JULES_KYLEC_RECIPIENT_PHONE` | Not a security credential but PII. Must be documented in data privacy posture. GLBA relevant if Rapid data is ever involved. |

### MEDIUM (fix within 30 days)

| # | Issue | Var(s) Affected | Risk |
|---|-------|-----------------|------|
| M-01 | Two Anthropic API keys with unclear purpose split | `ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY_TC` | Two keys to rotate, no documented reason for split. Simplify or document. |
| M-02 | Two Twilio phone numbers with different var names | `TWILIO_PHONE_NUMBER`, `TWILIO_FROM_NUMBER` | Risk of sending from wrong number. Document which is which. |
| M-03 | X API credentials for non-running service | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | x9 posting is CLI-only, not a service. If keys are stale or revoked, they're dead credentials. Verify or remove. |
| M-04 | TUNNEL_URL stale after restart | `TUNNEL_URL` | Ephemeral tunnel URL in .env becomes stale each restart. Creates confusion and operational errors. |

### ORPHAN CREDENTIALS (verify before removing)

These vars appear in code but only in scripts that are either legacy, deprecated, or POC-only:

| Var | Script | Status |
|-----|--------|--------|
| `JULES_RECIPIENT_PHONE` | `jules-server.mjs` | Legacy — may be superseded by `JULES_TELEGRAM_BOT_TOKEN` flow |
| `MAC_TUNNEL_URL` | `telegram-relay.mjs` | Relay script — active use unclear |
| `PLACE_ORDER` | `food-order-poc.mjs` | POC only |
| `TRIGGER_SENTIMENT` | `trading-bot.mjs` (legacy) | Legacy bot, not trader9-bot.mjs |
| `FORCE_CLOSE_SENTIMENT` | `trading-bot.mjs` (legacy) | Same |

---

## Missing .env.example

**Status: .env.example DOES NOT EXIST**

This is a gap Kyle will flag immediately. Any enterprise-grade system must document its configuration requirements. Without .env.example:
- No new deployment can be set up without reverse-engineering all 44 env vars from code
- No documentation of which vars are required vs optional
- No indication of expected formats or example values
- No way for a CIO to audit what credentials the system requires without reading all source code

**Action required:** Create `.env.example` documenting all 44 env vars with:
- Whether each is required or optional
- What format/type is expected
- Which service it belongs to
- A placeholder value (never a real value)

---

## Credentials in .env NOT Verified in Code

The following categories of credentials are likely in .env based on the services used, but were not confirmed in code grep. This does not mean they don't exist — it means the code was checked and these patterns were not found:

- `RESEND_API_KEY` — Resend email service mentioned in memory files but not found in any script
- `HEYGEN_API_KEY` — HeyGen video API, API key visible in screenshots, but no script found importing it
- `GITHUB_TOKEN` — Used by GitHub Actions implicitly but not referenced in any local script

---

## Recommendations for Kyle Shea Presentation

1. **Remove Dominos card data immediately** — C-01 is a PCI data handling violation regardless of whether the POC is active.
2. **Create .env.example** — 2-hour task. Documents all 44 vars. Kyle needs to see this before any architecture review.
3. **Move SQLITE_ENCRYPTION_KEY to a secrets manager** (1Password, AWS Secrets Manager, or even a separate encrypted file) — key and lock should not be co-located.
4. **Rotate JULES_TELEGRAM_BOT_TOKEN** and remove the hardcoded fallback from source — tokens in source code are a standard security finding in any pen test.
5. **Document the ANTHROPIC_API_KEY vs ANTHROPIC_API_KEY_TC split** — Kyle will ask why there are two keys. Have the answer ready.
6. **Make HUB_API_SECRET required** — removing the optional bypass closes an open endpoint.

---

*Part of the 9 Enterprises dependency map suite.*
*See `docs/dependency-map.md` for component reference.*
*See `docs/dependency-map-critical-path.md` for failure chains.*
