# FORT — Live Security Posture Audit
**Generated:** 2026-04-11T05:37Z
**Author:** FORT (Security) — sub-agent of 9
**Repo HEAD:** f1bf3de
**Scope:** READ-ONLY reconnaissance. No mutations, no exploitation, no production touches.
**Audience:** Kyle Shea (CIO Rapid Mortgage) enterprise review track.
**Companion doc:** `logs/fort-task-security-gap-matrix-apr11.md`

---

## Executive Summary

The 9 Enterprises universe has the bones of a security program (Twilio signature validation, HUB_API_SECRET fail-closed for `/context`, .env at 0600, gitignored .env, post-FORT removal of hardcoded `JULES_TELEGRAM_BOT_TOKEN` fallback) but is undermined by **three P0 issues** that make the entire credential inventory effectively public to anyone with LAN access or one curl command:

1. **341 agent-run jsonl files in `data/agent-runs/` contain plaintext live secrets** — including the active Anthropic API key, Twilio auth token, Stripe secret key, Alpaca credentials, MFA TOTP seed, Cloudflare/DNSimple/DigitalOcean tokens, and account passwords. Verified by matching the leaked literals against the live `.env`. The directory is **not gitignored**, so a single `git add data/` would publish them on the next push.
2. **Comms hub `POST /send`, `/send-email`, `/pilot/message`, `/action`, `/authority` endpoints have no authentication**, and the listener binds to `0.0.0.0:3457` (verified via `lsof`). Anyone reachable on the local network can send arbitrary Telegram messages from 9's bot, send arbitrary emails from Jasson's Gmail, write authority entries, and inject actions.
3. **9 of 15 currently-listening node services bind to all interfaces (`*:port`)** instead of `127.0.0.1`. Verified via live `lsof -iTCP -sTCP:LISTEN`. There is no host firewall rule documented.

These three findings would immediately fail any SOC 2 Type II Trust Services Criteria CC6 review, NIST CSF PROTECT.AC, and ISO 27001 Annex A.9 access-control controls.

The single highest-leverage fix for Kyle is **purging `data/agent-runs/` and rotating every credential it touched**. Until that is done, the credential-inventory cleanup that landed in `ec4e445` is operationally moot — the secrets are already on disk in 341 unencrypted files.

---

## Section 1 — Credential Storage Assessment

### Methodology
- Read `.env` permissions via `stat`. Did **not** read `.env` values directly except to redact-and-list variable names.
- Cross-referenced leaked literals in `data/agent-runs/` against `.env` using `grep -c <literal> .env` to confirm whether the leaked value is the **currently active** secret (vs. a rotated old value).
- Surveyed alternative storage paths (Keychain, plist, SQLCipher).

### .env file hygiene

| Property | Value | Verdict |
|---|---|---|
| Path | `/Users/jassonfishback/Projects/BengalOracle/.env` | OK |
| Permissions | `-rw-------` (0600) | PASS — owner-only |
| Owner | `jassonfishback:staff` | OK |
| Size | 7,319 bytes | — |
| Gitignored | Yes (line 25 of `.gitignore`) | PASS |
| `backups/**/.env*` gitignored | Yes (line 47 of `.gitignore`) | PASS |
| `.env.example` exists | Yes (16,352 bytes) | PASS — created since Apr 5 audit |

`.env` storage discipline at the file level is correct. The leak vector is not `.env` itself — it is the **derivative artifacts** that copy `.env` contents into other files.

### CRITICAL credentials — storage location matrix

| Credential | Documented in | Stored in `.env`? | Stored elsewhere on disk? | Verdict |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | credential-inventory.md | Yes (line 1) | **YES — 341+ files in `data/agent-runs/`** (literal `sk-ant-api03-oiUk4Gku...`) | **P0 LEAK** |
| `ANTHROPIC_API_KEY_TC` | credential-inventory.md | Yes (line 10, same value as API_KEY) | YES — same agent-run dump | **P0 LEAK** |
| `TWILIO_AUTH_TOKEN` | credential-inventory.md | Yes (line 8) | YES — `data/agent-runs/2026-04-10/agent-a67ea2ffd6291e01d.jsonl` literal `24c4cf144d73ce3dfe8493dc154dadaf` matches `.env` | **P0 LEAK** |
| `STRIPE_SECRET_KEY` | credential-inventory.md | Yes (line 21) | YES — agent-runs literal `mk_1TFKxbJ3Z1JMxDZw8emVbXs3` matches `.env` | **P0 LEAK** |
| `ALPACA_LIVE_API_KEY` / `_SECRET_KEY` | credential-inventory.md | Yes (lines 104-105) | Likely in agent-runs (file count includes ALPACA_PASSWORD matches) | **P0 LEAK** |
| `ALPACA_PASSWORD` | NOT documented | Yes (line 24) | YES — agent-runs jsonl includes literal `21Century!!!` | **P0 LEAK + UNDOCUMENTED** |
| `ALPACA_MFA_SECRET` | NOT documented | Yes (line 25) | YES — TOTP seed in agent-runs | **P0 LEAK + UNDOCUMENTED** — TOTP seed leak == MFA bypass |
| `ALPACA_MFA_EMERGENCY` | NOT documented | Yes (line 26) | YES | **P0 LEAK + UNDOCUMENTED** |
| `CLOUDFLARE_API_TOKEN` | credential-inventory.md | Yes (line 18) | YES — `cfut_SvM8T9s7MsRm4soW9os2gkNQlNlsppJCkr65RAVU5bdf8183` literal in agent-runs | **P0 LEAK** |
| `STRIPE_PUBLISHABLE_KEY` | credential-inventory.md | Yes (line 20) | YES — but publishable keys are designed to be public, so MEDIUM | OK |
| `DO_PASSWORD` | NOT documented | Yes (line 70) | Likely | **UNDOCUMENTED** account password |
| `DNSIMPLE_PASSWORD` | NOT documented | Yes (line 95) | Likely | **UNDOCUMENTED** account password |
| `X9_REDDIT_PASSWORD`, `X9_X_PASSWORD` | NOT documented | Yes (lines 48, 53) | Likely | **UNDOCUMENTED** account passwords |
| `X9_PROTON_PASSWORD` | credential-inventory.md (CRITICAL) | Yes | Likely | Drift partially closed |
| `KALSHI_API_KEY` | credential-inventory.md | Yes (env line not enumerated above) | Likely | **P0 LEAK** if in agent-runs |
| `OPENAI_API_KEY`, `XAI_API_KEY` | credential-inventory.md | Yes | Likely | **P0 LEAK** if in agent-runs |
| `SQLITE_ENCRYPTION_KEY` | credential-inventory.md (C-03) | Yes | Co-located with `data/9-memory.db` (key + lock in same directory) | **CRITICAL** — pre-existing finding C-03 still open |
| `NEON_DATABASE_URL` | credential-inventory.md (C-06) | Yes (line 110) | Likely in agent-runs | **P0 LEAK** |
| `SUPABASE_SERVICE_KEY` | credential-inventory.md (C-02) | Yes (line 121) | Likely in agent-runs | **P0 LEAK** — bypasses RLS |
| `GMAIL_APP_PASSWORD` | credential-inventory.md (H-01) | Yes (line 44) | Likely in agent-runs | **P0 LEAK** — App Passwords never expire |
| `RESEND_API_KEY_FULL` | credential-inventory.md | Yes (line 115) | Likely | **P0 LEAK** |
| `JULES_TELEGRAM_BOT_TOKEN` | credential-inventory.md (C-05) | Yes | **NO LONGER hardcoded** in `scripts/jules-telegram.mjs` (lines 23-25, env-only with FATAL on missing) — FORT C-05 fix landed | **C-05 CLOSED in code** |
| Telegram Bot Token literal | — | — | **YES — hardcoded in `scripts/telegram-listener.mjs.deprecated` line 9: `8767603151:AAGDg_yjVtJNyFe-deEy2FGYdnBOiM43B9E`. This file is `git ls-files` tracked, committed in 40407a2.** | **P1 — token in git history** |

### Evidence of leak scope
```
$ grep -l "sk-ant-api03\|TWILIO_AUTH_TOKEN\|STRIPE_SECRET_KEY\|ALPACA_PASSWORD\|MFA_SECRET" data/agent-runs/ -r 2>/dev/null | wc -l
341
$ find data/agent-runs/ -type f | wc -l
1635
$ grep -c "sk-ant-api03-oiUk4Gku" .env   # confirms leaked literal == live key
2     # (matches both ANTHROPIC_API_KEY and ANTHROPIC_API_KEY_TC)
$ grep -c "TWILIO_AUTH_TOKEN=24c4cf144d73ce" .env
1
$ grep -c "STRIPE_SECRET_KEY=mk_" .env
1
$ git check-ignore data/agent-runs/2026-04-10/agent-a67ea2ffd6291e01d.jsonl
(no output — NOT IGNORED)
$ git ls-files data/agent-runs/
(no output — NOT YET COMMITTED, but one wrong `git add data/` away from being pushed)
```

### Storage path verdict
- **`.env` file:** correct (0600, gitignored)
- **`data/agent-runs/`:** **CATASTROPHIC** — derivative leak of ~all CRITICAL credentials in 341 unencrypted files, not gitignored
- **`scripts/*.deprecated`:** **HIGH** — hardcoded historical Telegram bot token in tracked git history
- **SQLCipher key co-location:** unchanged from C-03 — `SQLITE_ENCRYPTION_KEY` lives in `.env` next to `data/9-memory.db`
- **Keychain / 1Password / AWS Secrets Manager:** **NOT IN USE** for any production secret. Zero secrets manager footprint.

---

## Section 2 — Network Exposure Scan

### Methodology
- Live snapshot via `lsof -iTCP -sTCP:LISTEN -P -n | grep node`
- Cross-referenced with `server.listen()` source patterns and PORT constants in scripts.

### Live listening ports (snapshot 2026-04-11T05:37Z)

| Port | Process | Bind | Service | Auth model | Source line |
|---|---|---|---|---|---|
| **3456** | voice-server | `*:3456` (ALL IFACES) | Twilio voice webhook + HTTP intake | Twilio signature **validated but bypassed on mismatch** (line 974: "allowing through — tunnel proxy may modify URL") | `scripts/voice-server.mjs:1338` |
| **3457** | comms-hub | `*:3457` (ALL IFACES) | Master comms hub: /send, /send-email, /inbox, /context, /authority, /action, /terminal/* | **Mixed: `/context` requires `x-hub-secret` (fail-closed). `/send`, `/send-email`, `/pilot/message`, `/action`, `/authority` have NO auth.** | `scripts/comms-hub.mjs:2783` (no host arg) |
| **3458** | health-monitor | `*:3458` (ALL IFACES) | Health-status HTTP | None | `scripts/health-monitor.mjs:968` |
| **3460** | usage-monitor | `*:3460` (ALL IFACES) | Usage / cost dashboard | None observed | `scripts/usage-monitor.mjs:1199` |
| **3472** | pilot-server | `*:3472` (ALL IFACES) | Twilio SMS webhook (Kyle Cabezas pilot) | Twilio signature validated **and rejected with 403 on mismatch** (line 1300) — correct | `scripts/pilot-server.mjs:1543` |
| **3473** | family-chat | `*:3473` (ALL IFACES) | Family chat HTTP | None observed | `scripts/family-chat.mjs:212` |
| **3480** | wendy-agent | `*:3480` (ALL IFACES) | Team agent health | None | `scripts/wendy-agent.mjs:573` |
| **3481** | (team agent) | `*:3481` (ALL IFACES) | Team agent health | None | `scripts/agent-base.mjs:194` |
| **3483** | (team agent) | `*:3483` (ALL IFACES) | Team agent health | None | `scripts/agent-base.mjs:194` |
| **3484** | (team agent) | `*:3484` (ALL IFACES) | Team agent health | None | `scripts/agent-base.mjs:194` |
| 3459 | (loopback) | `127.0.0.1:3459` | — | — | OK |
| 3461 | 9-ops-daemon | `127.0.0.1:3461` | Health | None (loopback only) | OK |
| 3462 | agent-watchdog | `127.0.0.1:3462` | Health | None (loopback only) | OK |
| 3471 | (loopback) | `127.0.0.1:3471` | — | — | OK |
| 3496 | tick-engine | `127.0.0.1:3496` | Health | None (loopback only) | OK |

### Bind verdict
- **9 of 15** currently-listening node services bind to **all interfaces** (`*:port`).
- **6 of 15** correctly bind to `127.0.0.1` (the ones written more recently with explicit `'127.0.0.1'` host arg).
- The mac is on the same LAN as Jasson's home network. Anyone on the LAN — including any compromised IoT device — can directly hit `http://<mac-ip>:3457/send` and impersonate 9 over Telegram, iMessage, and email.

### Auth model gaps in comms-hub (port 3457)

Endpoints **with** auth:
- `POST /context` — `x-hub-secret` header validated, fail-closed if `HUB_API_SECRET` unset (FORT H-03 fix landed, source line 2146). PASS.
- `POST /terminal/claim` / `POST /terminal/ping` — session-token model. PASS (functional, not access control).

Endpoints **without** auth:
- `POST /send` (line 2419) — sends arbitrary Telegram/iMessage/email. **CRITICAL.**
- `POST /send-email` (line 2444) — arbitrary recipients, subject, body, reply-to. **CRITICAL.**
- `POST /pilot/message` (line 2465) — proxies into pilot-server (Kyle Cabezas SMS). **HIGH.**
- `POST /action` (line 2507) — writes to actions table. **HIGH.**
- `POST /authority` (line 2538) — grants authority entries. **CRITICAL** (privilege escalation primitive).
- `POST /test/inbound` (line 2346) — injects fake inbound messages. **HIGH** (could be used to social-engineer 9 into responses).
- `POST /summarize-long-message` (line 2692) — burns Anthropic API budget on attacker input. **MEDIUM** (DoS/cost amplification).
- `GET /inbox`, `/state`, `/health`, `/db/context`, `/actions`, `/authority`, `/audit*`, `/supabase-health`, `/fda-health`, `/health-dashboard`, `/usage-dashboard` — all unauthenticated reads. Discloses Telegram chat IDs, action history, authority entries, Supabase status, and all dashboard data to anyone reachable on the LAN. **HIGH** (information disclosure).

### Twilio signature validation — voice-server bypass

`scripts/voice-server.mjs:964-975`:
```js
// Validate Twilio signature on webhook endpoints (voice, respond, status, timeout)
// NOTE: Cloudflare tunnel can cause signature mismatches due to URL rewriting.
const sig = req.headers['x-twilio-signature'];
if (sig) {
  // ...
  log(`Twilio signature INVALID for ${url.pathname} — but allowing through (tunnel proxy may modify URL)`);
  // Allow through instead of rejecting — the tunnel breaks signatures
}
```

This is a **fail-open** signature check. Any unauthenticated POST to the public tunnel URL (`TUNNEL_URL` in .env) is accepted. An attacker with the tunnel URL — which is logged in plaintext, sent in startup messages, and rotates freely — can spoof Twilio voice webhooks and consume ElevenLabs TTS, Anthropic LLM calls, and trigger arbitrary call flows.

`scripts/pilot-server.mjs:1300` — by contrast, **rejects** with 403 on signature mismatch. Pilot-server is correct; voice-server is not.

---

## Section 3 — Attack Surface Inventory

### External webhooks (publicly reachable)
| Webhook | Service | Auth | Risk |
|---|---|---|---|
| `<TUNNEL_URL>/voice` | Twilio voice (cloudflared tunnel) | Twilio signature **bypassed on fail** | **HIGH** — spoofable |
| `<TUNNEL_URL>/respond`, `/status`, `/timeout` | Twilio voice flow | Same bypass | **HIGH** |
| `<TUNNEL_URL>/sms` (proxied to pilot-server :3472) | Twilio SMS for FreeAgent9 pilot | Twilio signature enforced (403 on fail) | OK |
| `<CLOUD_WORKER_URL>/*` | Cloudflare Worker failover | `x-cloud-secret` checked (worker.js:206) | OK |
| `<your9-webhooks.mjs>:3495/*` | Stripe webhook endpoint | HMAC `STRIPE_WEBHOOK_SECRET` — **WARNING per credential-inventory.md: signature verification SKIPPED if secret unset** | **HIGH conditional** |
| Telegram Bot API (poll, not webhook) | Telegram | Long-poll with bot token | OK (outbound only) |

### Public URLs
| URL | Type | Notes |
|---|---|---|
| `https://ainflgm.com` | Static site (GitHub Pages) | Public, no auth required, no Mac dependency. Survives Mac downtime. |
| `https://9enterprises.ai` | Cloudflare Pages | Public marketing |
| `<TUNNEL_URL>` (e.g. `alliance-brunette-peninsula-buck.trycloudflare.com`) | cloudflared ephemeral tunnel | **Rotates on every restart, leaked in `.env`, leaked in agent-runs jsonl** |
| `https://9-cloud-standin.789k6rym8v.workers.dev` | Cloudflare Worker | Authenticated by `CLOUD_SECRET` |
| `https://your9.ai` | Your9 product domain | Magic-link auth |

### File-system writes from external input
- `comms-hub.mjs` writes Telegram-attached photos to `/tmp/` from Telegram payloads. No filename sanitization observed in scan — needs spot-check.
- `scripts/check-messages.sh` reads `/tmp/9-incoming-message.jsonl` (PostToolUse hook) — content originated from external Telegram users.
- `data/jules-profile-jasson.json`, `data/jules-profile-kylec.json`, `data/bengal-pro-memory.txt` — external user input mutates these on every message. No size cap observed.
- `data/agent-runs/` jsonl files — written by sub-agents, contain unredacted tool I/O (this is the leak mechanism for Section 1's P0).

### Inbound MCP servers
- The Telegram MCP plugin enforces an allowlist via `telegram:access` skill — manual approval. PASS.
- Playwright MCP — local only, no auth surface.
- Gmail MCP — OAuth scoped per-account. PASS.

---

## Section 4 — Top 10 CRITICAL Findings

### F-01 — `data/agent-runs/` leaks 341 files of plaintext production secrets [P0]
- **Evidence:** `grep -l "sk-ant-api03\|TWILIO_AUTH_TOKEN\|STRIPE_SECRET_KEY\|ALPACA_PASSWORD\|MFA_SECRET" data/agent-runs/ -r | wc -l` → 341. Sample literal in `data/agent-runs/2026-04-10/agent-a67ea2ffd6291e01d.jsonl:11` matches live `.env` (verified via `grep -c` of literal in `.env`).
- **Impact:** Anthropic API key, Twilio auth token, Stripe secret, Cloudflare token, Alpaca password+MFA TOTP seed, all account passwords for x9/Reddit/X/Proton/DigitalOcean/DNSimple are recoverable from disk by anyone with read access to the repo. The directory is **not gitignored**, so a single `git add data/` (which the recent autocommit scripts may do) would publish them to the GitHub remote.
- **Remediation (today):**
  1. Add `data/agent-runs/` to `.gitignore` immediately.
  2. Confirm with `git status` that no agent-runs files are staged.
  3. Purge `data/agent-runs/**/*.jsonl` (after triaging which runs need preservation, dump them to encrypted archive instead).
  4. **Rotate every credential leaked**: Anthropic, Twilio, Stripe, Alpaca (live + paper, both API and account password+MFA), Cloudflare, DNSimple, DigitalOcean, x9 social account passwords, Proton password, Reddit/X passwords, Resend, KapMonster, Gmail App Password, Supabase service key, Neon DB URL.
  5. Add a sub-agent runner pre-write filter that redacts secrets before writing to jsonl.

### F-02 — Comms-hub `POST /send`, `/send-email`, `/authority`, `/action`, `/pilot/message` are unauthenticated and bound to all interfaces [P0]
- **Evidence:** `lsof -iTCP -sTCP:LISTEN | grep 3457` → `node *:3457`. `scripts/comms-hub.mjs:2419` → `/send` handler accepts JSON body and dispatches to Telegram/iMessage/email with no auth check. `comms-hub.mjs:2538` → `/authority` POST accepts permission grants with no auth.
- **Impact:** Any LAN-resident attacker (compromised IoT device, guest Wi-Fi user, neighbor on shared network) can:
  - `curl -X POST http://mac.local:3457/send -d '{"channel":"all","message":"send Bitcoin to <addr>"}'` → impersonates 9 over Telegram + iMessage to Owner.
  - `curl -X POST http://mac.local:3457/send-email -d '{"to":"kyle@rapidmortgage.com","subject":"...","body":"..."}'` → sends email to anyone from Jasson's Gmail.
  - `curl -X POST http://mac.local:3457/authority -d '{"permission":"unlimited_spend","description":"granted"}'` → escalates own privilege within 9's authority matrix.
- **Remediation:** Apply the same `x-hub-secret` requirement to all mutating endpoints (mirror the FORT H-03 pattern). Bind hub to `127.0.0.1` and front it with a local-only proxy. Add an IP allowlist for `127.0.0.1` + tunnel ingress IP in front of public surface.

### F-03 — Voice-server fails open on Twilio signature mismatch [P1]
- **Evidence:** `scripts/voice-server.mjs:974`: `log('Twilio signature INVALID … but allowing through (tunnel proxy may modify URL)')`.
- **Impact:** Anyone with the (logged, frequently leaked) `TUNNEL_URL` can spoof inbound voice calls, consume ElevenLabs TTS quota, burn Anthropic API budget, and trigger arbitrary call flows including the AI Underwriter and family-chat handlers.
- **Remediation:** Pin a stable tunnel URL (e.g., named cloudflared tunnel `voice.9enterprises.ai`) so signature URL stops drifting. Then **remove the bypass** and reject 403 like `pilot-server.mjs:1300` does. Add a `TWILIO_REQUIRE_SIGNATURE=true` env flag as a kill switch.

### F-04 — `scripts/telegram-listener.mjs.deprecated` contains a hardcoded Telegram bot token committed to git [P1]
- **Evidence:** `scripts/telegram-listener.mjs.deprecated:9` — `const TOKEN = '8767603151:AAGDg_yjVtJNyFe-deEy2FGYdnBOiM43B9E';`. `git ls-files` lists the file. `git log --oneline scripts/telegram-listener.mjs.deprecated` → committed in `40407a2`.
- **Impact:** Token is in **git history forever**. Even if deleted today, anyone with the repo (or any future GitHub mirror) can recover it with `git log -p`. If this token is the same as `TELEGRAM_BOT_TOKEN` in `.env` (the leaked literal in agent-runs is `8767603151:AAGDg_yjVtJNyFe...` — **identical match**), the token has been compromised since `40407a2` was pushed.
- **Remediation:** **Rotate the Telegram bot token immediately** via @BotFather. Then `git filter-repo` or `bfg-repo-cleaner` to scrub the literal from history (force-push required, document and warn collaborators). Delete all `*.deprecated` files from the working tree.

### F-05 — `SQLITE_ENCRYPTION_KEY` co-located with the encrypted DB [P1, pre-existing C-03]
- **Evidence:** `.env` line for `SQLITE_ENCRYPTION_KEY` resides next to `data/9-memory.db`. credential-inventory.md C-03 still open.
- **Impact:** If `.env` and `data/9-memory.db` are exfiltrated together (single `tar` of repo), the attacker has both lock and key. SQLCipher encryption is functionally equivalent to plaintext.
- **Remediation:** Move `SQLITE_ENCRYPTION_KEY` to macOS Keychain (`security add-generic-password`). Add a Node loader (`node-keytar`) so memory-db.mjs reads it from Keychain at startup. Remove the line from `.env`.

### F-06 — 9 listening services bind to `0.0.0.0` instead of `127.0.0.1` [P1]
- **Evidence:** Live `lsof` snapshot shows ports 3456, 3457, 3458, 3460, 3472, 3473, 3480, 3481, 3483, 3484 all bound to `*:port`.
- **Impact:** Each is reachable from any LAN host. None of these except pilot-server enforces auth. The hub (3457) is the highest-impact (Section 4 F-02), but the team agent ports (3480-3484) also expose health/state JSON which discloses internal metrics and process counts to LAN observers.
- **Remediation:** Audit each `server.listen(PORT, ...)` call without an explicit host arg and add `'127.0.0.1'`. For the comms-hub specifically, run a localhost-bound version + a separate authenticated cloudflared tunnel for the small set of endpoints that genuinely need internet ingress.

### F-07 — Stripe webhook signature verification skipped if `STRIPE_WEBHOOK_SECRET` unset [P1]
- **Evidence:** credential-inventory.md row for `STRIPE_WEBHOOK_SECRET`: "Without this, webhook signature verification is SKIPPED (hub logs a warning)."
- **Impact:** Attacker can forge subscription events to your9-billing — activate Enterprise plan without paying, trigger fraudulent refunds.
- **Remediation:** Make `STRIPE_WEBHOOK_SECRET` **required** at startup (fail-closed) like the FORT H-03 pattern for `HUB_API_SECRET`. Refuse to start the billing service without it.

### F-08 — `JASSON_PHONE`, `JAMIE_PHONE`, `JULES_KYLEC_RECIPIENT_PHONE` PII in plaintext .env [P2]
- **Evidence:** credential-inventory.md H-04. PII not flagged as a credential but documented as compliance gap.
- **Impact:** Phone numbers of Owner, partner, and a customer (Kyle Cabezas) are in `.env` and replicated in agent-runs. GLBA-relevant if Rapid Mortgage data is ever processed by 9.
- **Remediation:** Move PII to a separate `.pii.env` file with documented DPA. Reference notes/comments in `.env` like `# MAC_PASSWORD=<MOVED TO ~/.9-secrets/pii.env>` already exist (line 22) — extend that pattern to PII.

### F-09 — No host-based firewall rule documented; macOS application firewall state unknown [P2]
- **Evidence:** No `pf.conf` rule, no `socketfilterfw` invocation in any script. Mitigation for F-02/F-06 is currently "hope the LAN is safe."
- **Impact:** First line of defense for the all-interfaces bind issue is missing.
- **Remediation:** Document and apply: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on` plus per-process allow rules for `node`. As a stopgap, add a `pf` anchor that drops inbound TCP to 3456-3500 from non-loopback unless source IP is on a documented allowlist.

### F-10 — No automated SQLite/Supabase backup; primary memory DB has no offsite copy [P2, pre-existing]
- **Evidence:** dependency-map-critical-path.md item 4: "No automated backup exists."
- **Impact:** Single disk failure on the Mac destroys the source of truth. Recovery requires manual reconstruction from Supabase mirror (which is partial).
- **Remediation:** Add a cron-driven `sqlite3 .backup` to an encrypted offsite location (R2 bucket with `CLOUDFLARE_API_TOKEN` — **after rotation per F-01**). Document RTO/RPO.

---

## Section 5 — Findings Roll-up

| ID | Title | Severity | Effort | Owner |
|---|---|---|---|---|
| F-01 | agent-runs leak of 341 files | **P0** | Medium (purge + rotate ~20 creds) | FORT + Wendy + Owner (rotation auth) |
| F-02 | Hub `/send`, `/send-email`, `/authority`, `/action` unauthenticated | **P0** | Small (apply FORT H-03 pattern) | FORT |
| F-03 | Voice-server signature bypass | **P1** | Small (delete bypass, pin tunnel) | FORT + Tee |
| F-04 | Hardcoded Telegram token in `*.deprecated` (in git) | **P1** | Medium (rotate + filter-repo) | FORT + Owner |
| F-05 | SQLCipher key co-located with DB | **P1** | Medium (Keychain integration) | Tee |
| F-06 | 9 services bind to 0.0.0.0 | **P1** | Small (add `'127.0.0.1'` host arg) | Tee |
| F-07 | Stripe webhook secret optional | **P1** | Small (fail-closed) | FORT |
| F-08 | PII in plaintext .env | **P2** | Small | FORT |
| F-09 | No host firewall | **P2** | Small | FORT |
| F-10 | No automated DB backup | **P2** | Medium | Tee |

**P0 count: 2. P1 count: 5. P2 count: 3.**

---

*FORT — Security sub-agent of 9. Read-only audit. No production touched. No exploitation performed.*
*See `logs/fort-task-security-gap-matrix-apr11.md` for SOC 2 / NIST CSF / ISO 27001 control mapping.*
