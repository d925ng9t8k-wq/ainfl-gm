# 9 Enterprises — Security Audit

**Date:** 2026-04-09
**Scope:** Full security posture review — credentials, network, firewall, SSH, rotation, source control, PCI, recommendations
**Prior Art:** `docs/credential-inventory.md` (2026-04-05), FORT Phase B remediation (2026-04-05)
**Audience:** CIO-level review (Kyle Shea, Rapid Mortgage)

---

## Executive Summary

The April 5 FORT remediation closed the six original critical findings (PCI card data, Supabase service key abuse, SQLite key co-location, live trading keys, hardcoded tokens, Neon connection string exposure). However, the .env file has grown from 44 to 90+ variables since that audit and now contains plaintext passwords for multiple services, duplicate API tokens, and reused passwords. The macOS firewall is disabled. Seven HTTP servers bind to all interfaces (`*`), making them reachable from any device on the same network. No TLS termination exists on any local service. No API key has ever been rotated.

**Overall Risk Rating: HIGH** — The system is operationally functional but would not pass a SOC 2 Type II or NIST 800-53 controls assessment in its current state.

---

## 1. Environment Variables and Secrets

### 1.1 Current Inventory

| Metric | Count |
|--------|-------|
| Total env vars in `.env` | 90 |
| Documented in `.env.example` | 91 |
| CRITICAL-class secrets (API keys, DB credentials, trading keys) | 22 |
| Plaintext passwords in `.env` | 8 |
| PII entries (phone numbers, names) | 5 |
| Orphan/unused credentials | 4+ |

### 1.2 Properly Secured (FORT remediation confirmed)

| Item | Status | Notes |
|------|--------|-------|
| PCI card data (AMEX) | Moved to `~/.9-secrets/pii.env` (chmod 600) | C-01 closed |
| SSN, DL data | Moved to `~/.9-secrets/pii.env` | C-01 closed |
| SQLITE_ENCRYPTION_KEY | Moved to macOS Keychain | C-03 closed |
| Supabase service key | comms-hub switched to anon key | C-02 closed |
| HUB_API_SECRET | Fail-closed when not set | H-03 closed |
| `.env` file permissions | `-rw-------` (owner-only read/write) | Correct |
| `~/.9-secrets/` directory | `drwx------` (owner-only) | Correct |
| `.env` in `.gitignore` | Yes — never committed to git history | Confirmed |
| `.env.example` exists | Yes — created by FORT | H-02 closed |

### 1.3 Needs Immediate Attention

| Finding | Severity | Detail |
|---------|----------|--------|
| **Plaintext passwords in .env** | P0 | `ALPACA_PASSWORD`, `DNSIMPLE_PASSWORD`, `DO_PASSWORD`, `PROTON_9E_PASSWORD`, `FANDUEL_AFFILIATE_PASSWORD`, `X9_PROTON_PASSWORD` — six service passwords stored in cleartext. These are not API keys; they are login credentials that grant full account access. |
| **Alpaca MFA secret + emergency code in .env** | P0 | `ALPACA_MFA_SECRET` and `ALPACA_MFA_EMERGENCY` in .env. Anyone with these values can generate valid TOTP codes and bypass account recovery. This negates the entire purpose of MFA on the brokerage account. |
| **Password reuse** | P1 | `21Century!!!` (Alpaca) and `21Century!` (FanDuel) — near-identical passwords across a brokerage and an affiliate account. Credential stuffing risk. |
| **Duplicate DNSIMPLE_API_TOKEN** | P1 | Two different tokens with the same variable name at lines 93 and 100 of .env. Second value silently overwrites the first. One is a user token (`dnsimple_u_`), one is an account token (`dnsimple_a_`). Different scopes, same var name. |
| **Duplicate GMAIL_APP_PASSWORD** | P1 | Defined twice — line 44 (empty) and line 61 (with value). The empty one would break any service that reads it before the second definition. |
| **EIN in .env** | P2 | `EIN=41-5160635` and `EIN_NAME_CONTROL=9ENT` — federal tax ID in a config file. Not a secret per se, but sensitive business data that should be in `~/.9-secrets/pii.env`. |
| **LLC entity number in .env** | P2 | `LLC_ENTITY_NUMBER` and `LLC_DOC_ID` — Ohio Secretary of State filing data. Same recommendation. |
| **FANDUEL_AFFILIATE_SECRET_Q/A in .env** | P2 | Security question and answer in plaintext. Social engineering vector. |

### 1.4 Credential Classification Matrix

| Category | Variables | Risk if .env Leaks |
|----------|-----------|---------------------|
| **Financial — Real Money** | `ALPACA_LIVE_API_KEY`, `ALPACA_LIVE_SECRET_KEY`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_PASSWORD`, `ALPACA_MFA_SECRET`, `ALPACA_MFA_EMERGENCY` | Full brokerage account takeover. Live trading execution. MFA bypass. |
| **Financial — Payments** | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Payment processing access. Currently test keys (`mk_` prefix) — not yet live. |
| **Infrastructure** | `ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY_TC`, `DO_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_TOKEN` | API billing exposure (Anthropic), full VPS control (DigitalOcean), DNS/CDN control (Cloudflare). |
| **Database** | `NEON_DATABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` | Cloud database read/write. Service key bypasses RLS. |
| **Communications** | `TELEGRAM_BOT_TOKEN`, `JULES_TELEGRAM_BOT_TOKEN`, `TWILIO_AUTH_TOKEN`, `GMAIL_APP_PASSWORD`, `RESEND_API_KEY` | Bot impersonation, SMS spoofing, email sending as 9. |
| **Social/Third-party** | `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `XAI_API_KEY`, `HEYGEN_API_KEY`, `DID_API_KEY` | Social media account control, video generation abuse. |
| **Domain/DNS** | `DNSIMPLE_API_TOKEN` (x2), `DNSIMPLE_PASSWORD` | Domain transfer, DNS hijacking. |

---

## 2. Network Exposure

### 2.1 Port Binding Analysis

Servers were audited via `lsof` and source code review. The bind address determines who can connect.

| Port | Service | Bind Address | Exposure | Auth |
|------|---------|-------------|----------|------|
| 3457 | comms-hub | `*` (all interfaces) | LAN-reachable | Secret on POST /context only; GET endpoints open |
| 3456 | voice-server | `*` (all interfaces) | LAN-reachable + Cloudflare tunnel (public internet) | None — Twilio webhook signature not enforced on all paths |
| 3472 | pilot-server | `*` (all interfaces) | LAN-reachable | Twilio HMAC-SHA1 on webhook only |
| 3473 | (unidentified service) | `*` (all interfaces) | LAN-reachable | Unknown |
| 3480 | team agent | `*` (all interfaces) | LAN-reachable | None verified |
| 3481 | team agent | `*` (all interfaces) | LAN-reachable | None verified |
| 3483 | team agent | `*` (all interfaces) | LAN-reachable | None verified |
| 3484 | team agent | `*` (all interfaces) | LAN-reachable | None verified |
| 3471 | underwriter-api | `127.0.0.1` | Localhost only | None — but correctly localhost-bound |
| 3459 | (internal agent) | `127.0.0.1` | Localhost only | N/A |

**Key finding:** 8 of 10 listening ports bind to all interfaces. With the macOS firewall disabled (see Section 3), any device on the same Wi-Fi network can reach these services. A coffee shop, hotel, or compromised home network device could probe these ports directly.

### 2.2 CORS Configuration

| Service | CORS Policy | Risk |
|---------|-------------|------|
| comms-hub | `Access-Control-Allow-Origin: *` | Any webpage can make cross-origin requests to the hub |
| underwriter-api | `Access-Control-Allow-Origin: *` | Same — any origin can query mortgage guidelines |

Wildcard CORS is acceptable for genuinely public APIs. For comms-hub, which controls 9's messaging and state, this is too permissive.

### 2.3 TLS Status

No local service uses HTTPS. All HTTP traffic on the local network is plaintext. The only TLS termination is:
- Cloudflare tunnel (voice-server ingress from public internet)
- Twilio webhooks (outbound HTTPS to Twilio API)
- External API calls (Anthropic, Supabase, etc. — all HTTPS)

Local inter-service communication (e.g., trader9-bot posting to comms-hub at `http://localhost:3457/send`) is unencrypted. On a trusted single-machine setup this is standard practice, but it means any network-level sniffer on the LAN can read all local traffic.

---

## 3. macOS Firewall Status

```
Firewall is disabled. (State = 0)
```

**The macOS Application Firewall is OFF.** This means:
- All listening ports are reachable from any device on the local network
- No inbound connection filtering of any kind
- The MacBook relies entirely on the router's NAT for protection from the public internet

**Impact:** If the MacBook connects to an untrusted network (coffee shop, hotel, airport), all 8 wildcard-bound services are immediately reachable by any device on that network. This includes comms-hub (can read all messages, inject state), voice-server (can trigger voice responses), and team agent health endpoints.

**Mitigation options:**
1. Enable macOS firewall: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on`
2. Set to "Block all incoming connections" mode, then whitelist only what's needed
3. Alternatively, rebind all services to `127.0.0.1` (see recommendations)

---

## 4. SSH Configuration — VPS (161.35.104.126)

**VPS Provider:** DigitalOcean
**IP:** 161.35.104.126 (DO_DROPLET_IP in .env)
**API Token:** `DO_API_TOKEN` in .env — grants full DigitalOcean account control (create/destroy droplets, manage DNS, access console)

**SSH audit result:** Unable to connect via `ssh -o BatchMode=yes root@161.35.104.126` from this machine. This means either:
1. SSH key-based auth is not configured for this Mac (good — it requires explicit key setup)
2. The VPS SSH port is non-standard (good — port obscurity)
3. The VPS has a firewall blocking SSH from this IP

**Known risks regardless of SSH config:**
- `DO_API_TOKEN` in .env grants console access to the droplet via DigitalOcean API — SSH security is moot if the API token leaks
- `DO_PASSWORD` (`DO9Ent2026!Secure`) in .env — if this is a root/user password on the VPS, an attacker with the IP and password can attempt brute force
- No evidence of `fail2ban` or equivalent on the VPS (cannot verify remotely)

**Recommendation:** Verify VPS SSH config independently. Ensure: `PermitRootLogin no`, `PasswordAuthentication no`, `PubkeyAuthentication yes`. Confirm `ufw` or equivalent is active.

---

## 5. API Key Rotation Status

| Credential | Created | Last Rotated | Age | Status |
|------------|---------|-------------|-----|--------|
| `ANTHROPIC_API_KEY` | Unknown (pre-audit) | Never | Unknown | OVERDUE |
| `ANTHROPIC_API_KEY_TC` | Unknown | Never | Unknown | OVERDUE — currently same value as ANTHROPIC_API_KEY |
| `TELEGRAM_BOT_TOKEN` | Unknown | Never | Unknown | OVERDUE |
| `JULES_TELEGRAM_BOT_TOKEN` | Unknown | Never | Unknown | OVERDUE |
| `TWILIO_AUTH_TOKEN` | Unknown | Never | Unknown | OVERDUE |
| `GMAIL_APP_PASSWORD` | Unknown | Never | Unknown | OVERDUE — App Passwords never expire |
| `ALPACA_API_KEY` | Unknown | Never | Unknown | OVERDUE |
| `ALPACA_LIVE_API_KEY` | 2026-04-01 | Never | 8 days | OK for now |
| `ELEVENLABS_API_KEY` | Unknown | Never | Unknown | OVERDUE |
| `SUPABASE_SERVICE_KEY` | Unknown | Never | Unknown | OVERDUE |
| `NEON_DATABASE_URL` | Unknown | Never | Unknown | OVERDUE |
| `CLOUDFLARE_API_TOKEN` | Unknown | Never | Unknown | OVERDUE |
| `DO_API_TOKEN` | Unknown | Never | Unknown | OVERDUE |
| `DNSIMPLE_API_TOKEN` (x2) | Unknown | Never | Unknown | OVERDUE |
| `X_*` (4 tokens) | Unknown | Never | Unknown | LOW PRIORITY — service may not be active |
| `STRIPE_SECRET_KEY` | Unknown | Never | Unknown | LOW PRIORITY — test mode keys |

**No rotation policy exists.** No credential has ever been rotated. No rotation schedule is documented. No automated rotation tooling is in place.

**Key observation:** `ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY_TC` contain identical values. The stated purpose of TC was to separate billing. If they are the same key, the separation provides no value and adds confusion.

---

## 6. Sensitive Data in Source Control

### 6.1 Gitignored but Present on Disk

| Path | Content | Risk |
|------|---------|------|
| `.env` | 90 env vars including all API keys, passwords, MFA secrets | If machine is compromised, all credentials are in one file. Gitignore prevents accidental commit but not local theft. |
| `~/.9-secrets/pii.env` | SSN, AMEX card data, DL info (FORT C-01) | Correctly separated. chmod 600. |
| `data/9-memory.db` | All messages, decisions, tasks, authority rules | NOT gitignored but also not tracked. File permissions are `-rw-r--r--` (world-readable). |
| `scripts/shared-state.json` | Conversation history, session context | Gitignored. Correct. |
| `logs/` | All service logs including comms-hub full message content | Gitignored. Correct. |

### 6.2 Tracked in Git (Committed)

| Path | Content | Risk |
|------|---------|------|
| `data/jules-profile-jasson.json` | Jasson's personal assistant profile | Contains behavioral patterns, preferences. Low sensitivity but PII-adjacent. |
| `data/jules-profile-kylec.json` | Kyle Cabezas profile | Customer data committed to git. GLBA-relevant if mortgage data is present. |
| `data/bengal-pro-memory.txt` | Kids' chat memory | Contains children's names, interests. PII for minors. |

### 6.3 Database File Permissions

`data/9-memory.db` has permissions `-rw-r--r--` (644) — **world-readable**. Any user on the system can read the entire message/decision/task database. Should be `600` (owner-only).

The database was identified by `file` as generic `data` (not `SQLite format 3`), suggesting SQLCipher encryption may be active. However, with the encryption key retrievable from macOS Keychain by the same user, the encryption only protects against physical disk theft with a different user account, not against any process running as the same macOS user.

---

## 7. PCI Concerns

### 7.1 Dominos Card Data (C-01 — Previously Flagged)

**Status: REMEDIATED.** The original `DOMINOS_CARD_*` variables are no longer in `.env`. The FORT remediation on April 5 moved all payment card data to `~/.9-secrets/pii.env` with correct permissions.

### 7.2 AMEX Card Data

**Status: REMEDIATED.** `AMEX_CARD`, `AMEX_CVV`, `AMEX_EXP`, `AMEX_ADDRESS` entries in `.env` are now comments pointing to `~/.9-secrets/pii.env`.

### 7.3 Remaining PCI-Adjacent Concerns

| Finding | Detail |
|---------|--------|
| No PCI DSS Self-Assessment Questionnaire (SAQ) completed | If 9 Enterprises ever processes, stores, or transmits cardholder data for customers (not just internal use), SAQ-A or SAQ-A-EP is required. |
| `~/.9-secrets/pii.env` is not encrypted at rest | The file is permission-restricted but plaintext on disk. Full disk encryption (FileVault) would provide the encryption layer. |
| Stripe keys are test-mode | `mk_` prefix confirms non-production. No PCI obligations until live keys are activated. |

---

## 8. Additional Findings

### 8.1 Rate Limiting

No HTTP service implements rate limiting. A single client can issue unlimited requests to any endpoint. For comms-hub (which triggers Anthropic API calls in autonomous mode), this creates a billing amplification vector — an attacker on the LAN could trigger thousands of API calls by posting to open endpoints.

### 8.2 Logging Sensitive Data

The comms-hub log (`logs/comms-hub.log`) contains full message content including Jasson's Telegram messages. The startup protocol reads the last 200 messages from this log. If this log is ever exfiltrated, it contains the full communication history.

### 8.3 Temp File Hygiene

Multiple services write to `/tmp/` with predictable filenames (`/tmp/9-session-token`, `/tmp/9-incoming-message.jsonl`, `/tmp/telegram_photo_*.jpg`). Any process on the machine can read these. The session token file is particularly sensitive — it could be used to impersonate the terminal connection to the hub.

---

## 9. Prioritized Recommendations

### P0 — Critical (Do This Week)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P0-01 | **Remove plaintext passwords from .env.** Move `ALPACA_PASSWORD`, `DNSIMPLE_PASSWORD`, `DO_PASSWORD`, `PROTON_9E_PASSWORD`, `FANDUEL_AFFILIATE_PASSWORD`, `X9_PROTON_PASSWORD` to `~/.9-secrets/pii.env` or macOS Keychain. These are full login credentials, not API tokens. | 30 min | Eliminates account takeover risk from single file leak |
| P0-02 | **Remove MFA secrets from .env.** `ALPACA_MFA_SECRET` and `ALPACA_MFA_EMERGENCY` negate MFA entirely. Move to macOS Keychain. | 15 min | Restores MFA protection on brokerage account |
| P0-03 | **Enable macOS firewall.** `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on` and set to block incoming. | 5 min | Blocks LAN access to all 8 exposed ports |
| P0-04 | **Rebind comms-hub to 127.0.0.1.** Change `healthServer.listen(HEALTH_PORT, () => {` to `healthServer.listen(HEALTH_PORT, '127.0.0.1', () => {`. Same for voice-server, pilot-server, team agents. | 1 hr | Defense-in-depth — services only reachable from localhost regardless of firewall |
| P0-05 | **Fix 9-memory.db permissions.** `chmod 600 data/9-memory.db`. | 1 min | Prevents other system users/processes from reading message DB |

### P1 — High (Do This Sprint)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P1-01 | **Establish key rotation policy.** Rotate `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TWILIO_AUTH_TOKEN`, `GMAIL_APP_PASSWORD` immediately. Set 90-day rotation calendar. | 2 hr | Limits blast radius of any past credential exposure |
| P1-02 | **Deduplicate .env anomalies.** Fix double `GMAIL_APP_PASSWORD`, double `DNSIMPLE_API_TOKEN`, identical `ANTHROPIC_API_KEY`/`ANTHROPIC_API_KEY_TC`. | 30 min | Eliminates config confusion and silent overwrites |
| P1-03 | **Remove password reuse.** `21Century!!!` and `21Century!` across brokerage and affiliate accounts. Generate unique passwords. | 15 min | Blocks credential stuffing |
| P1-04 | **Restrict CORS on comms-hub.** Replace `Access-Control-Allow-Origin: *` with explicit allowed origins (Command Hub domain only). | 30 min | Prevents cross-origin abuse from arbitrary web pages |
| P1-05 | **Add rate limiting to all HTTP endpoints.** Minimum: IP-based request limit on comms-hub, pilot-server. | 2 hr | Prevents billing amplification and DoS |
| P1-06 | **Move EIN, LLC data to `~/.9-secrets/pii.env`.** Tax ID and state filing numbers are business-sensitive. | 10 min | Reduces .env sensitivity surface |
| P1-07 | **Verify VPS SSH hardening.** Confirm `PermitRootLogin no`, `PasswordAuthentication no`, UFW active on 161.35.104.126. | 30 min | Ensures VPS is not a soft target |

### P2 — Medium (Do Within 30 Days)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P2-01 | **Remove tracked PII from git.** `data/jules-profile-kylec.json` and `data/bengal-pro-memory.txt` contain customer/minor PII. Gitignore and scrub from history if repository is ever made public. | 1 hr | GLBA/COPPA compliance posture |
| P2-02 | **Implement session token file permissions.** `/tmp/9-session-token` should be created with `0600`. | 15 min | Prevents local session hijacking |
| P2-03 | **Clean orphan credentials.** Remove `JULES_RECIPIENT_PHONE`, `MAC_TUNNEL_URL`, `TRIGGER_SENTIMENT`, `FORCE_CLOSE_SENTIMENT` references. Verify X API keys are actively used or revoke. | 1 hr | Reduces attack surface |
| P2-04 | **Add auth to underwriter-api.** Currently no authentication on any endpoint. If ever tunneled or port-forwarded, it becomes a public AI endpoint billed to 9's Anthropic key. | 2 hr | Prevents unauthorized API consumption |
| P2-05 | **Document rotation procedures.** For each critical credential, document: how to rotate, what services to restart, expected downtime. | 2 hr | Enables non-9 operators to perform emergency rotation |
| P2-06 | **Verify FileVault is enabled.** Provides encryption at rest for `.env`, `~/.9-secrets/`, and `data/9-memory.db`. | 5 min | Protects against physical theft |

### P3 — Low (Backlog)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P3-01 | **Evaluate secrets manager.** macOS Keychain works for single-machine. If multi-machine or team deployment is planned, evaluate 1Password CLI, HashiCorp Vault, or AWS Secrets Manager. | Research | Future-proofs credential management |
| P3-02 | **Add TLS to inter-service communication.** Low priority while single-machine, becomes critical if services span multiple hosts. | 4 hr | Encrypts local traffic |
| P3-03 | **Implement credential scanning in CI.** Add `gitleaks` or `trufflehog` to GitHub Actions to catch accidental secret commits. | 1 hr | Prevents future .env-in-git incidents |
| P3-04 | **SOC 2 readiness gap analysis.** If enterprise sales require compliance certification, perform formal gap analysis against SOC 2 Type II Trust Services Criteria. | 40 hr | Required for enterprise customer trust |

---

## Appendix A: FORT Phase B Remediation Status (April 5, 2026)

| Original Finding | FORT Fix | Current Status |
|-----------------|----------|----------------|
| C-01: PCI card data in .env | Moved to `~/.9-secrets/pii.env` | CLOSED — Verified |
| C-02: Supabase service key abuse | Switched to anon key in comms-hub | CLOSED — Verified |
| C-03: SQLite key co-located | Moved to macOS Keychain | CLOSED — Verified |
| C-04: Live trading keys in .env | Acknowledged risk, no move | OPEN — Keys still in .env, now with passwords and MFA secrets too |
| C-05: Telegram token hardcoded | Hardcoded fallback removed from jules-telegram.mjs | CLOSED — Verified (grep confirms no hardcoded tokens in source) |
| C-06: .env.example missing | Created by FORT | CLOSED — Verified (91 vars documented) |
| H-01: Gmail App Password rotation | No action taken | OPEN — Still never rotated |
| H-03: HUB_API_SECRET optional | Changed to fail-closed | CLOSED — Verified in source |

---

## Appendix B: Port Exposure Quick Reference

```
EXPOSED TO LAN (bind *)     LOCALHOST ONLY (bind 127.0.0.1)
─────────────────────────   ────────────────────────────────
3457  comms-hub              3471  underwriter-api
3456  voice-server           3459  (internal agent)
3472  pilot-server
3473  (unidentified)
3480  team agent
3481  team agent
3483  team agent
3484  team agent
```

---

*Part of the 9 Enterprises security and compliance documentation suite.*
*See also: `docs/credential-inventory.md`, `docs/dependency-map.md`, `docs/dependency-map-critical-path.md`*
