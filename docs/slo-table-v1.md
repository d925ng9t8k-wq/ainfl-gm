# SLO Table v1 — 9 Enterprises Infrastructure
**Author:** WATCH, Observability Lead, 9 Enterprises  
**Date:** 2026-04-05  
**Version:** 1.0  
**Purpose:** Commitment table for the top 10 components from the dependency map. Scaffolding for JUDGE's WWKD dry-run. Measurements begin accruing from this date.

---

## How to Read This

- **Availability target**: % of 30-day window the component must be healthy/running
- **Latency target**: response time for health endpoints or Telegram message round-trip
- **Error budget**: how many minutes per 30 days can be spent in outage before SLO breaches
- **Alert threshold**: the trip wire that pages us — firing this means we are burning error budget
- **Who gets paged**: who sees the alert (via Telegram health monitor or WATCH canary)
- **Current status**: green/yellow/red as of Apr 5, 2026

---

## SLO Table

### 1. Comms Hub (comms-hub.mjs, port 3457)

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 99.5% | 216 min/month | HTTP non-200 for >30s |
| p50 response | <200ms | — | >500ms for 3 consecutive checks |
| p95 response | <500ms | — | >2000ms |
| p99 response | <2000ms | — | >5000ms |
| Error rate | <0.5% | — | >2% over any 5-min window |

**Who gets paged:** 9 (Telegram), Jasson (Telegram if hub is down >2 min via cloud worker)  
**Current status:** GREEN — HTTP 200, uptime 1269683s (~14.7 days)  
**Notes:** LaunchAgent provides ~10s auto-restart. Single process handles all 4 channels — single failure propagates to all. CIO-grade improvement: split into channel-isolated processes (backlog).

---

### 2. Cloud Worker (9-cloud-standin.workers.dev)

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 99.9% | 43 min/month | HTTP non-200 for >2 min |
| p50 latency | <300ms | — | >1000ms for 3 checks |
| p95 latency | <800ms | — | >2000ms |
| Heartbeat gap | <7 min to detect Mac-down | — | gap >10 min |
| Mode accuracy | relay when Mac up, autonomous when Mac down | — | mode mismatch for >5 min |

**Who gets paged:** WATCH (health monitor Telegram alert), 9  
**Current status:** GREEN — mode: relay, 107ms latency, Mac heartbeat fresh  
**Notes:** Cloudflare edge SLA is 99.99%. Our SLO is 99.9% to account for worker code bugs. Cron every 2 min = max 7-min failover gap (acceptable).

---

### 3. Voice Server (voice-server.mjs, port 3456)

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 99.0% | 432 min/month | HTTP non-200 for >1 min |
| p50 call latency | <3s (TTS + response) | — | >8s |
| Tunnel stability | <2 restarts/day | — | >5 restarts/day |
| Twilio webhook sync | <5 min after tunnel restart | — | >10 min out-of-sync |

**Who gets paged:** 9 (health monitor Telegram)  
**Current status:** GREEN — HTTP 200, tunnel healthy (1 restart today), uptime continuous  
**Notes:** Ephemeral tunnel URL is a known gap (S#7 in SCOUT top-20). URL changes on every restart, requiring auto-update of Twilio webhook. Auto-update is implemented in comms-hub. Permanent fix: named Cloudflare tunnel.

---

### 4. Health Monitor (health-monitor.mjs, port 3458)

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 99.5% | 216 min/month | HTTP non-200 for >1 min (canary alert) |
| SQLite write cadence | write every <5 min | — | stale >5 min (monitor-canary trips) |
| Alert latency | <2 min from failure to Telegram | — | >5 min |
| False positive rate | <1 noisy alert/day | — | >5 alerts/day with no real outage |

**Who gets paged:** WATCH canary (separate process) → hub → Telegram  
**Current status:** GREEN — running PID 85875, SQLite writes current (verified by canary)  
**Notes:** Was DOWN during SCOUT's Apr 5 audit. LaunchAgent now confirmed. Monitor-canary (new today) provides secondary detection channel.

---

### 5. SQLite Database (data/9-memory.db)

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Integrity | 100% (zero corruption) | 0 min | integrity_check fails (immediate alert) |
| Backup freshness | <25h since last backup | — | backup age >26h |
| Write availability | 99.9% | 43 min/month | write failure logged by comms-hub |
| Recovery RTO | <30 min from corruption to restore | — | >45 min (breach) |
| Recovery RPO | <24h data loss | — | >26h (backup missed) |

**Who gets paged:** 9 (health monitor slow loop, every 5 min integrity check)  
**Current status:** GREEN — integrity: ok, latest backup 9-memory-2026-04-05-160935.sql.gz (1h ago)  
**Notes:** No automated backup existed before Apr 5. Daily backup at 3am now live. Supabase mirror provides partial RPO improvement. Encryption key (SQLITE_ENCRYPTION_KEY) co-located with DB in .env — FORT must address (C-03 backlog).

---

### 6. Cloudflare Tunnel (cloudflared, ephemeral trycloudflare.com)

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 95.0% | 2160 min/month | tunnel unreachable for >2 min |
| Restart → Twilio sync | <2 min | — | >5 min out-of-sync |
| Tunnel URL drift events | <5/week | — | >3/day |

**Who gets paged:** 9 (comms-hub tunnel watchdog → Telegram)  
**Current status:** YELLOW — functional but ephemeral URL is a design risk  
**Notes:** Lower availability target (95%) reflects known instability of trycloudflare.com quick tunnels. CIO-grade fix: named tunnel with stable hostname. SCOUT ranks this S#7. Target for Week 2. Voice fallback to cloud worker mitigates impact during tunnel outage.

---

### 7. Telegram Bot API

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 99.0% | 432 min/month | polling failure for >2 min |
| Message delivery | <30s poll lag | — | last activity >5 min ago |
| Send success rate | >99% | — | 3 consecutive send failures |

**Who gets paged:** 9 (hub internal logging; no external fallback alerting yet)  
**Current status:** GREEN — lastActivity 2026-04-05T16:46:24Z, 2906 messages handled  
**Notes:** No automatic channel failover to iMessage when Telegram is down. If Telegram fails, 9 cannot notify Jasson to switch channels. This is a design gap (SCOUT top-20). Mitigation: iMessage is available as manual fallback.

---

### 8. Anthropic Claude API

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 99.0% | 432 min/month | API probe non-200 for >10 min |
| Response latency | <30s p95 | — | >60s p95 |
| Key validity | 100% | 0 min | any 401 response |
| Billing headroom | >$10 remaining | — | <$10 balance |

**Who gets paged:** 9 (health monitor slow loop probe, every 15 min), Jasson via Telegram + iMessage + email on failure  
**Current status:** GREEN — API key valid, HTTP 200  
**Notes:** Zero AI provider redundancy — entire system depends on Anthropic. Anthropic's stated SLA is 99.9% for API. Our effective SLA is lower because billing cascade can take down the key without an outage. Week 2: research fallback provider (OpenAI/Gemini).

---

### 9. RAM Watch Agent (ram-watch-agent.mjs, port 3459)

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 99.0% | 432 min/month | HTTP non-200 for >2 min |
| Sample cadence | 1 sample / 30s ±5s | — | no sample for >5 min |
| Memory pressure alert | <75% RAM used (normal pressure) | — | pressure=warning or >80% used |
| Leak detection | flag any process growing >50MB/hr | — | leak_suspects > 0 |

**Who gets paged:** 9 (health monitor fast loop — polls port 3459 every 30s)  
**Current status:** GREEN — running PID 81280, 19 samples, system at 42.6% RAM, 0 leaks  
**Notes:** Built Apr 5 per Kyle Shea's guidance. Rolling stats (1m/5m/1hr) now exposed in /health-dashboard. First Kyle-endorsed instrumentation artifact.

---

### 10. Supabase Cloud Mirror

| Metric | Target | Error Budget (30d) | Alert Threshold |
|--------|--------|-------------------|-----------------|
| Availability | 95.0% (free tier, no SLA) | 2160 min/month | sync failure for >1 hr |
| Sync drift | <50 rows behind SQLite | — | drift >10 rows (hub watchdog) |
| Write latency | <5s per sync call | — | >30s (timeout) |

**Who gets paged:** 9 (hub Supabase watchdog, 1hr cooldown)  
**Current status:** GREEN — max_drift: 2, status: minor_drift  
**Notes:** Non-blocking by design — hub never fails due to Supabase issues. Correct architecture. Free tier has no uptime SLA; upgrade to Pro ($25/mo) for 99.9% SLA when Phase 2 revenue starts.

---

## Summary Dashboard

| # | Component | Availability Target | Current Status | CIO-Grade? |
|---|-----------|--------------------|--------------|----|
| 1 | Comms Hub | 99.5% | GREEN | Partial |
| 2 | Cloud Worker | 99.9% | GREEN | YES |
| 3 | Voice Server | 99.0% | GREEN | NO (tunnel) |
| 4 | Health Monitor | 99.5% | GREEN | Partial |
| 5 | SQLite DB | 100% integrity | GREEN | Partial |
| 6 | Cloudflare Tunnel | 95.0% | YELLOW | NO |
| 7 | Telegram API | 99.0% | GREEN | Partial |
| 8 | Anthropic API | 99.0% | GREEN | NO (no fallback) |
| 9 | RAM Watch Agent | 99.0% | GREEN | YES |
| 10 | Supabase Mirror | 95.0% | GREEN | YES |

**Components at target or better: 9/10**  
**Components CIO-grade: 3/10** (Cloud Worker, RAM Watch, Supabase)  
**Components needing uplift: 7/10** (path documented above)

---

## Measurement Baseline

Measurement starts Apr 5, 2026. First SLO compliance report will cover Apr 5 → May 5 (30 days). Reported every Friday per WATCH weekly cadence.

**Target for Day-30 (May 5):** All 10 components green against their targets. At least 5 CIO-grade.

---

*— WATCH, Observability Lead, 9 Enterprises*
