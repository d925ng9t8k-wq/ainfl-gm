# 9 Enterprises — Critical Path Analysis

**Generated:** 2026-04-05
**Author:** Tee (Engineering Team Lead)
**Purpose:** "If THIS goes down, what else breaks" chains for the top 10 components. Designed for CIO-level incident response and risk assessment.

---

## How to Read This

Each entry answers: **what is the blast radius?** When X fails, what exactly stops working, degrades, or goes silent — and can Jasson still reach 9?

Severity scale:
- **P0 — BLACKOUT:** Jasson cannot reach 9 on any channel
- **P1 — CRITICAL:** Primary communication path lost, degraded fallback only
- **P2 — MAJOR:** One or more products/services down, comms intact
- **P3 — DEGRADED:** Reduced functionality, no user-facing outage
- **P4 — MINOR:** Internal tooling affected, no user impact

---

## 1. MacBook Pro (The Hardware)

**Failure modes:** crash, sleep, power loss, hardware failure, macOS update reboot

**Blast radius — P0 BLACKOUT:**

Everything running on the Mac dies simultaneously:

- Comms Hub (port 3457) — DOWN. All 4 channels stop routing.
- Voice Server (port 3456) — DOWN. Voice calls get no response.
- Jules Telegram — DOWN. Jasson's personal assistant goes silent.
- Kids Mentor — DOWN. Bengal Pro goes silent.
- Trader9 — DOWN. Trading stops silently. Open positions not monitored.
- Trinity — DOWN. No discovery scanning.
- Pilot Server — DOWN. Kyle Cabezas gets no SMS responses.
- AI Underwriter — DOWN. No mortgage Q&A.
- Health Monitor — DOWN. No alerting.
- Open Terminal — DOWN. Cannot remotely auto-recover.
- iMessage read — DOWN. Apple Messages DB inaccessible.

**What survives Mac downtime:**
- ainflgm.com — stays up (GitHub Pages, no Mac dependency)
- Cloud Worker (IF deployed) — would handle Telegram autonomously. Currently NOT deployed.

**Current state:** Cloud Worker is built but never deployed. Mac down = P0 blackout with no fallback for 100% of real-time services.

**CIO verdict:** This is the highest-priority SPOF. A single MacBook Pro as the sole infrastructure for a multi-product, multi-user system is not enterprise-grade by any standard. Kyle will flag this immediately.

**Mitigation path:** Deploy Cloud Worker (1-2 hours). Move persistent services to VPS (estimated 1-2 days). Mac becomes development/management layer, not production infrastructure.

---

## 2. Comms Hub Process (comms-hub.mjs)

**Failure modes:** Node process crash, unhandled exception, OOM, port conflict, LaunchAgent restart loop

**Blast radius — P1 CRITICAL:**

- Telegram channel — DOWN immediately (hub is the sole polling process)
- iMessage channel — DOWN (hub reads Messages DB)
- Email channel — DOWN (hub sends via nodemailer)
- Voice call routing — DEGRADED (voice-server still up but hub no longer coordinates)
- Freeze watchdog — DOWN (freeze detection runs inside hub)
- Terminal recovery — DOWN (hub writes the signal file; open-terminal is waiting but hub is the trigger)
- Cloud sync — DOWN (no state pushed to Cloudflare KV)
- Health monitor alerting — DEGRADED (health-monitor still polls but has no send path to Jasson)
- Supabase sync — DOWN (post-write hooks in hub)
- Trader9 trade notifications — SILENTLY DROPPED (hub /send endpoint unreachable)

**LaunchAgent mitigation:** com.9.comms-hub restarts the process within ~10 seconds of a crash. In practice the gap is 10–30 seconds. If the process is crash-looping (e.g., bad code deploy), LaunchAgent throttle means ~10-second restart delay per attempt — messages received during loops may be dropped.

**What survives:**
- Voice server continues accepting Twilio calls independently
- ainflgm.com unaffected
- Pilot server continues (no hub dependency)

**CIO verdict:** Single process handling all 4 channels is a design risk. A crash in the email processing code takes down Telegram. These channels should be isolated processes.

---

## 3. Anthropic Claude API

**Failure modes:** API outage, rate limit, billing failure, key revocation, model deprecation

**Blast radius — P1 CRITICAL:**

All intelligent response capability across the entire system goes offline:

- Comms Hub autonomous OC mode — DOWN. Hub switches to pre-scripted offline responses only.
- Voice Server — DOWN. Twilio calls answered with "service unavailable" TwiML.
- Jules Telegram — DOWN. No assistant responses.
- Kids Mentor — DOWN. No mentor responses.
- Pilot Server (FreeAgent9) — DOWN. Kyle Cabezas gets no responses.
- Trinity Agent — DOWN. No discovery scan analysis.
- AI Underwriter — DOWN. No mortgage Q&A.
- Cloud Worker (if deployed) — DOWN.

**What survives:** ainflgm.com (static, no API calls at runtime), trader9 market data and execution (uses Alpaca API, not Anthropic)

**Current monitoring:** Hub probes API every 10 minutes. Alerts via Telegram, iMessage, and email on failure. But if Telegram is also down (billing cascade), alert delivery is uncertain.

**CIO verdict:** Zero AI provider redundancy. Every intelligent function in the system depends on a single third-party API. No fallback, no graceful degradation to rule-based responses, no second provider. This would be flagged in any vendor risk review.

**Mitigation path:** Add OpenAI or Gemini as fallback. Implement offline rule-based responses for common patterns (daily briefings, simple acknowledgments) that don't require API calls.

---

## 4. SQLite Memory Database (data/9-memory.db)

**Failure modes:** disk corruption, accidental deletion, WAL file inconsistency, permissions change, filesystem full

**Blast radius — P2 MAJOR:**

- All message/action logging — STOPS
- Task and decision persistence — LOST
- Authority matrix — UNLOADABLE
- Supabase sync — FAILS (nothing to sync from)
- Health monitor historical data — UNREADABLE
- Any comms-hub startup check against memory — FAILS or returns empty

**Hub behavior on DB failure:** memory-db.mjs import is try/catch'd. Hub logs the error and continues without DB logging. Messages are still routed. State is held in `shared-state.json` in-process but not persisted beyond restart.

**Data recovery option:** Supabase cloud mirror has `messages` and `actions` tables. Neon has `conversations`. A recovery import is possible but requires manual work.

**No automated backup exists.** No scheduled dump to S3, no cron backup, no offsite copy.

**CIO verdict:** Primary source of truth with no automated backup is a data governance failure. Any enterprise vendor must demonstrate automated, verified backups with documented RTO/RPO. Current state: neither exists.

---

## 5. cloudflared Tunnel

**Failure modes:** process crash, Cloudflare network issue, tunnel URL change on restart

**Blast radius — P2 MAJOR:**

- Inbound voice calls — DEAD. Twilio cannot reach the voice webhook.
- All voice calls answered with Twilio's default error TwiML.
- Voice-server process continues running but is unreachable from internet.
- All other channels unaffected.

**Specific compounding failure:** Tunnel is ephemeral. Every time voice-server or cloudflared restarts, the tunnel URL changes. Twilio's webhook config still points to the old URL. Voice calls fail until someone manually updates Twilio's voice webhook URL.

**Detection:** Comms-hub logs voice-server restart events. No automated Twilio URL update exists.

**CIO verdict:** Ephemeral tunnel URLs as a production dependency is unacceptable for enterprise. The correct pattern is a dedicated domain with a stable DNS entry pointing to a stable tunnel or direct server endpoint. This is a known gap — cloud VPS research has been done but not deployed.

---

## 6. Telegram Bot API

**Failure modes:** Telegram outage, bot token revocation, rate limiting, account suspension

**Blast radius — P2 MAJOR:**

- All Telegram messages from Jasson — UNDELIVERABLE
- All Telegram responses from 9 — FAIL silently (hub logs error)
- Jules personal assistant — DOWN
- Cloud Worker failover (if deployed) — also DOWN (same Telegram API)
- Trinity findings delivery — DOWN

**What survives:** iMessage, email channels unaffected. Voice calls unaffected.

**Current monitoring:** Hub logs Telegram send failures. No automatic channel failover to iMessage when Telegram is unreachable.

**CIO verdict:** No automatic channel failover. If Telegram is down, 9 cannot notify Jasson to switch to iMessage. A properly designed system would auto-escalate to next available channel.

---

## 7. Twilio

**Failure modes:** Twilio outage, account suspension, number suspension, A2P registration failure, webhook delivery failure

**Blast radius — P2 MAJOR:**

- Voice calls — DOWN. No inbound call routing.
- iMessage bridging via Twilio number — DOWN
- Pilot Server (Kyle Cabezas SMS) — DOWN. FreeAgent9 pilot goes silent.
- Voice-server continues running but Twilio delivers no calls.

**What survives:** Telegram, email channels. ainflgm.com.

---

## 8. ElevenLabs TTS

**Failure modes:** API outage, quota exhaustion, rate limiting, model deprecation

**Blast radius — P3 DEGRADED:**

- Voice calls answered — CONTINUE but with no audio response (TTS conversion fails)
- Caller hears silence or Twilio's fallback error

**Voice-server behavior on ElevenLabs failure:** error logged, empty audio response to Twilio. Call quality degrades to unintelligible rather than graceful "service unavailable" message.

**Mitigation path:** Add fallback TTS provider (AWS Polly, Google TTS). Implement "service unavailable" graceful TwiML response when TTS fails.

---

## 9. Health Monitor Process (health-monitor.mjs)

**Failure modes:** process crash, port conflict, LaunchAgent not restarting

**Status note:** Health monitor was NOT running at audit time despite having a LaunchAgent plist.

**Blast radius — P3 DEGRADED:**

- All active health alerting — STOPS
- `health_events` table in SQLite — no new writes
- Comms-hub logs "health monitor down" every 5 minutes (own watchdog)
- Comms-hub continues routing — no functional impact

**What this means in practice:** If voice-server, pilot-server, or another component goes down silently, health monitor would catch it and alert Jasson. Without it running, silent failures accumulate until Jasson notices manually.

**Compounding risk:** Health monitor is the early warning system. Its absence means the failure detection window for other components is extended from 30 seconds (health monitor poll) to "whenever Jasson notices."

---

## 10. Supabase Cloud Mirror

**Failure modes:** Supabase outage, quota exceeded, wrong API key, schema drift

**Blast radius — P4 MINOR:**

- Cloud DB sync — STOPS
- Message/action history in Supabase — LAGS behind SQLite
- Command Hub dashboard (if deployed) — shows stale or no data
- Hub continues routing messages — unaffected
- Hub logs Supabase sync failures as non-fatal errors

**Design note:** Supabase is non-blocking by design. All Supabase sync calls are fire-and-forget with `.catch(() => {})`. Hub never fails due to Supabase issues. This is correct architecture.

---

## Bonus: Data Dependency Chain — "What reads what"

Understanding the read-dependency chain is important for data consistency:

```
.env file
  → comms-hub.mjs (dotenv)
  → voice-server.mjs (manual parse)
  → jules-telegram.mjs (manual parse)
  → kids-mentor.mjs (manual parse)
  → pilot-server.mjs (manual parse)
  → trinity-agent.mjs (manual parse)
  → underwriter-api.mjs (manual parse)
  → memory-db.mjs (dotenv)
  → trader9-bot.mjs (custom loadEnvEarly())

data/9-memory.db (SQLite)
  → comms-hub.mjs (via memory-db.mjs import)
  → health-monitor.mjs (direct better-sqlite3)
  → [mirrored to] Supabase (messages, actions)
  → [mirrored to] Neon (conversations)

scripts/shared-state.json
  → comms-hub.mjs (in-process R/W, crash-survivable via JSON)

~/Library/Messages/chat.db (Apple system DB)
  → comms-hub.mjs (iMessage read — requires FDA)
  → kids-mentor.mjs (group chat read — requires FDA)

data/jules-profile-jasson.json
  → jules-telegram.mjs (R/W)

data/jules-profile-kylec.json
  → pilot-server.mjs (R/W)

data/bengal-pro-memory.txt
  → kids-mentor.mjs (R/W)
```

---

## Summary — Risk Matrix

| Component | Failure Severity | Current Mitigation | CIO-Grade? |
|-----------|-----------------|-------------------|------------|
| MacBook Pro | P0 BLACKOUT | None (Cloud Worker undeployed) | NO |
| Comms Hub process | P1 CRITICAL | LaunchAgent restart (10s gap) | Partial |
| Anthropic API | P1 CRITICAL | Hub offline mode (no AI) | NO |
| SQLite memory DB | P2 MAJOR | Supabase mirror (partial) | NO |
| cloudflared tunnel | P2 MAJOR | None (manual Twilio update) | NO |
| Telegram API | P2 MAJOR | iMessage/email fallback (no auto-switch) | NO |
| Twilio | P2 MAJOR | Telegram/email unaffected | Partial |
| ElevenLabs | P3 DEGRADED | None (silent failure) | NO |
| Health Monitor | P3 DEGRADED | Hub watchdog logs it | Partial |
| Supabase | P4 MINOR | Non-blocking design | YES |

**Components with zero enterprise-grade mitigation: 6 of 10.**

---

*Part of the 9 Enterprises dependency map suite. See also:*
*`docs/dependency-map.json` — machine-parseable canonical*
*`docs/dependency-map.md` — full component reference*
*`docs/credential-inventory.md` — credential hygiene*
