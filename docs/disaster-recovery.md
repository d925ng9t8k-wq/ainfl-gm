# Disaster Recovery Plan — 9 Enterprises Infrastructure
**Version:** 1.0  
**Date:** 2026-04-05  
**Owner:** DOC (Infrastructure Agent)  
**Review cycle:** Monthly  
**Applies to:** All production infrastructure under the 9 Enterprises universe

---

## RTO / RPO Targets

| Tier | Component | RTO (max downtime) | RPO (max data loss) |
|------|-----------|-------------------|---------------------|
| P0 | Comms hub (Telegram) | 2 min | 0 (cloud worker takes over) |
| P0 | Cloud worker failover | 0 (always-on edge) | 0 |
| P1 | Voice server | 5 min | 0 (calls route to cloud fallback) |
| P1 | Cloudflare tunnel | 5 min | 0 |
| P2 | SQLite 9-memory.db | 30 min (restore from backup) | 24 hr (daily backup cadence) |
| P2 | Supabase mirror | 4 hr (Supabase SLA) | 1 hr (sync cadence) |
| P3 | Health monitor | 10 min (LaunchAgent auto-restart) | N/A (no user data) |
| P3 | Anthropic API | N/A (retry/queue) | N/A |

---

## Scenario Runbooks

---

### SCENARIO 1 — Mac Power Loss / Hard Shutdown

**What fails:** Everything local — comms hub, voice server, tunnel, SQLite, all LaunchAgents.  
**What survives:** Cloud worker (Cloudflare edge), Supabase mirror, last synced shared-state.

**Detection:**
- Cloud worker cron (every 2 min) detects Mac heartbeat gap > 5 min
- Worker automatically sets Telegram webhook → cloud worker takes over messaging
- Owner receives Telegram message: "Mac just went offline. Cloud backup is active."
- Health monitor LaunchAgent restarts on Mac boot (RunAtLoad=true, KeepAlive=true)

**Recovery steps:**
1. Mac boots → LaunchAgents auto-start: comms-hub, voice-server, health-monitor
2. Comms hub clears Telegram webhook (resumes polling), announces "Terminal is back"
3. Comms hub calls `/state` on cloud worker to retrieve any queued messages
4. Voice server starts cloudflared tunnel, updates .env with new URL, syncs to Twilio
5. Run system sweep to verify all services are healthy:
   ```bash
   curl -s http://localhost:3457/health
   curl -s http://localhost:3456/health
   curl -s http://localhost:3458/health
   ps aux | grep -E "(comms-hub|voice-server|health-monitor)" | grep -v grep
   ```
6. Check inbox for messages received while down: `curl -s http://localhost:3457/inbox`

**Estimated recovery time:** 3-5 min (automatic), no manual intervention required  
**Verify:** Cloud worker health returns `mode: relay` within 5 min of Mac boot

---

### SCENARIO 2 — Comms Hub Crash (Process Dies)

**What fails:** All 4 channels (Telegram, iMessage, Email, Voice relay), health dashboard proxy, Supabase sync.  
**What survives:** Cloud worker (has heartbeat gap detection), voice server (independent process).

**Detection:**
- Health monitor polls comms-hub every 30s — fires CRITICAL alert to Telegram within 30s
- NOTE: If hub is down, Telegram alert routes via cloud worker (it sets webhook on hub death)
- LaunchAgent com.9.comms-hub auto-restarts within ~10s

**Recovery steps:**
1. LaunchAgent auto-restart handles 95% of crash scenarios within 10s
2. If LaunchAgent fails (check with `launchctl list | grep comms-hub`):
   ```bash
   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.9.comms-hub.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.9.comms-hub.plist
   ```
3. If LaunchAgent is corrupted, start manually:
   ```bash
   nohup /opt/homebrew/bin/node /Users/jassonfishback/Projects/BengalOracle/scripts/comms-hub.mjs > /dev/null 2>&1 & disown
   ```
4. Verify recovery: `curl -s http://localhost:3457/health`
5. Check cloud worker queued messages were delivered: `curl -s http://localhost:3457/inbox`

**Root cause investigation:**
```bash
tail -100 /Users/jassonfishback/Projects/BengalOracle/logs/comms-hub.log
tail -50 ~/Library/Logs/9/comms-hub-stderr.log
```

**Estimated recovery time:** 10-30s (automatic), 2 min (manual)

---

### SCENARIO 3 — Cloudflare Tunnel Failure (Voice Server Unreachable)

**What fails:** Inbound voice calls to 9's Twilio number, external webhook delivery to voice server.  
**What survives:** Comms hub (Telegram/iMessage/Email unaffected), voice server process (local), cloud worker voice fallback.

**Detection:**
- Comms hub tunnel health check (every 30s) detects unreachable tunnel
- Fires alert to Telegram: "Tunnel health check failed"
- Twilio voice fallback URL (configured at cloud worker `/voice-fallback`) handles inbound calls

**Automatic recovery (comms-hub.mjs):**
- Hub detects tunnel failure → kills cloudflared → starts new quick tunnel
- Reads new URL from `/tmp/cloudflared.log`
- Updates `.env` with new TUNNEL_URL
- Auto-updates Twilio webhook via API
- Sends Telegram confirmation with new URL

**Manual recovery (if auto-restart loop fails):**
```bash
pkill -f cloudflared
nohup cloudflared tunnel --url http://localhost:3456 --no-autoupdate > /tmp/cloudflared.log 2>&1 &
sleep 8
NEW_URL=$(grep -o 'https://[a-z-]*.trycloudflare.com' /tmp/cloudflared.log | head -1)
echo "New tunnel: $NEW_URL"
# Update .env
sed -i '' "s|TUNNEL_URL=.*|TUNNEL_URL=$NEW_URL|" /Users/jassonfishback/Projects/BengalOracle/.env
# Update Twilio (using voice server's auto-updater)
curl -s -X POST http://localhost:3457/restart-voice
```

**Known limitation:** Quick tunnels (trycloudflare.com) generate a new hostname on every restart. This means Twilio and any external services that hardcode the URL must be updated. Auto-update logic in comms-hub.mjs handles this for Twilio, but any other consumer of TUNNEL_URL must re-read from .env.

**Permanent fix path:** Create a named Cloudflare tunnel with stable hostname (requires API token with `Cloudflare Tunnel:Edit` permission — request from Jasson via Cloudflare dashboard).

**Estimated recovery time:** 30s-2 min (automatic), 5 min (manual)

---

### SCENARIO 4 — SQLite Corruption (9-memory.db)

**What fails:** All memory reads/writes — agent context, tasks, messages, decisions, health events.  
**What survives:** Comms hub (has in-memory state), Supabase mirror (authoritative remote copy), Telegram functionality.

**Detection:**
- Health monitor runs `PRAGMA integrity_check` every 5 min (slow loop)
- If integrity check fails: CRITICAL alert fires to Telegram immediately
- SQLite WAL mode reduces corruption risk significantly (partial writes don't corrupt)

**Recovery procedure:**

Step 1 — Attempt repair:
```bash
DB=/Users/jassonfishback/Projects/BengalOracle/data/9-memory.db
/usr/bin/sqlite3 $DB "PRAGMA integrity_check;"
# If not "ok", proceed to Step 2
```

Step 2 — Restore from backup (daily backup at 3am):
```bash
# Find latest backup
ls -lh /Users/jassonfishback/Projects/BengalOracle/data/backups/ | tail -5
# Stop processes that use the DB
pkill -f health-monitor.mjs
# Restore
cp /Users/jassonfishback/Projects/BengalOracle/data/backups/9-memory-LATEST.db \
   /Users/jassonfishback/Projects/BengalOracle/data/9-memory.db
# Restart health monitor
nohup /opt/homebrew/bin/node /Users/jassonfishback/Projects/BengalOracle/scripts/health-monitor.mjs > /dev/null 2>&1 & disown
# Verify
/usr/bin/sqlite3 /Users/jassonfishback/Projects/BengalOracle/data/9-memory.db "PRAGMA integrity_check;"
```

Step 3 — If no local backup, restore from Supabase:
```bash
# Pull from Supabase via hub endpoint
curl -s -X POST http://localhost:3457/supabase-restore
# This endpoint triggers a full pull from Supabase mirror
```

Step 4 — Verify row counts after restore:
```bash
/usr/bin/sqlite3 /Users/jassonfishback/Projects/BengalOracle/data/9-memory.db \
  "SELECT 'messages', count(*) FROM messages UNION ALL
   SELECT 'actions', count(*) FROM actions UNION ALL
   SELECT 'memory', count(*) FROM memory UNION ALL
   SELECT 'tasks', count(*) FROM tasks;"
```

**Data loss exposure:** Up to 24 hours of events between last backup and corruption event. Supabase mirror may reduce this if sync was current.

**Estimated recovery time:** 5-15 min

---

### SCENARIO 5 — Supabase Outage

**What fails:** Remote memory mirror sync, any features that query Supabase directly.  
**What survives:** All local functionality — comms hub, voice, SQLite (authoritative local copy), health monitor.

**Detection:**
- Health monitor checks Supabase drift every 5 min (slow loop)
- Hub `/supabase-health` endpoint queried every 5 min
- Drift > 50 rows = CRITICAL alert

**Recovery procedure:**
1. Supabase outages are transient — check status at https://status.supabase.com
2. No immediate action required — SQLite is authoritative
3. Sync will resume automatically when Supabase recovers
4. If sync is stale after recovery, force-sync:
   ```bash
   curl -s -X POST http://localhost:3457/supabase-sync
   ```
5. After extended outage, verify no data divergence:
   ```bash
   curl -s http://localhost:3457/supabase-health
   ```

**SLA note:** Supabase free tier has no uptime SLA. Pro tier = 99.9% SLA. Local SQLite is the fallback — this is by design.

**Estimated recovery time:** 0 (automatic, no action required during outage)

---

### SCENARIO 6 — Cloudflare Outage (Cloud Worker Down)

**What fails:** Cloud worker failover, Polymarket CORS proxy (ainflgm.com), KV state sync, Twilio fallback.  
**What survives:** Mac hub handles all Telegram/iMessage/Email/Voice directly. No Telegram failover during Mac downtime.

**Detection:**
- Health monitor checks cloud worker health every 5 min (slow check via external URL)
- NOTE: If both Mac AND Cloudflare are down simultaneously, no detection path exists (acceptable)
- Cloudflare has 99.99%+ uptime historically — this scenario is extremely rare

**Recovery procedure:**
1. Cloudflare outages are global events — check https://www.cloudflarestatus.com
2. No action required — Mac hub handles all channels directly
3. Voice calls fail to cloud worker → Twilio's last-resort is voicemail (built in)
4. When Cloudflare recovers, cloud worker auto-resumes (no state lost in KV — it's edge-cached)
5. Verify recovery: `curl -s https://9-cloud-standin.789k6rym8v.workers.dev/health`

**Estimated recovery time:** 0 (passive), dependent on Cloudflare SLA for full restoration

---

### SCENARIO 7 — Anthropic API Key Death

**What fails:** All Claude API calls — comms hub autonomous responses, health monitor API check, any agent AI calls.  
**What survives:** Comms hub routing/relay, all non-AI infrastructure, message delivery.

**Detection:**
- Health monitor probes API key every 15 min (cached to avoid rate limits)
- CRITICAL alert fires on Telegram if key check returns non-200/529
- Hub enters "offline response" mode — acknowledges messages, explains situation
- Hub requests terminal open for diagnosis

**Recovery procedure:**

Step 1 — Diagnose:
```bash
# Verify key status
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $(grep ANTHROPIC_API_KEY_TC /Users/jassonfishback/Projects/BengalOracle/.env | cut -d= -f2)" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":5,"messages":[{"role":"user","content":"ok"}]}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('status:', d.get('type'), d.get('error',{}).get('type','ok'))"
```

Step 2a — If billing issue (HTTP 529 or payment_required):
- Go to console.anthropic.com/settings/billing
- Top up credits or update payment method
- Key recovers automatically on billing resolution

Step 2b — If key revoked (HTTP 401):
- Go to console.anthropic.com/settings/api-keys
- Create new key
- Update both `ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY_TC` in `.env`
- Restart comms hub: `pkill -f comms-hub && nohup node scripts/comms-hub.mjs > /dev/null 2>&1 & disown`

Step 3 — Verify:
```bash
curl -s http://localhost:3457/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('api:', d.get('api','unknown'))"
```

**Estimated recovery time:** 5-15 min (billing), 10 min (new key)

---

## System Architecture Overview (for DR context)

```
                    ALWAYS-ON EDGE
                 ┌──────────────────┐
                 │  Cloudflare      │
                 │  Worker          │
                 │  (Backup QB)     │
                 │  Cron: 2min      │
                 └────────┬─────────┘
                          │ heartbeat
                          │ failover
                 ┌────────▼─────────┐
                 │   Mac (primary)  │
                 │                  │
                 │  comms-hub:3457  │◄── Telegram polling
                 │  voice-srv:3456  │◄── Twilio calls
                 │  health-mon:3458 │
                 │  cloudflared     │──► trycloudflare.com
                 │  SQLite DB       │◄──► Supabase mirror
                 └──────────────────┘
```

**LaunchAgents (auto-restart on death):**
- com.9.comms-hub — Hub main process
- com.9.voice-server — Voice + cloudflared tunnel
- com.9.health-monitor — Health monitoring daemon
- com.9.claude-watchdog — Claude Code session monitor
- com.9.freeze-watchdog — Freeze detection
- com.9.memory-archive — SQLite archival
- com.9.memory-autocommit — Git auto-commit for memory
- com.9.terminal-opener — Signal file watcher

---

## Backup Schedule

| Asset | Method | Frequency | Retention | Location |
|-------|--------|-----------|-----------|----------|
| 9-memory.db | scripts/backup-memory.mjs | Daily 3am ET | 30 days local, 90 days Supabase Storage | data/backups/ + Supabase |
| shared-state.json | Cloud worker KV sync | Every 60s | KV TTL (30 days) | Cloudflare KV |
| memory/ dir (markdown) | git auto-commit | On change | Indefinite (git history) | GitHub |
| logs/ | Log rotation (hub built-in) | 7-day rotation | 7 days | Local only |

---

## Contacts / Escalation

| Scenario | First responder | Escalation |
|----------|----------------|------------|
| Any infrastructure alert | 9 (health monitor → Telegram) | Jasson via Telegram |
| Billing / API key | 9 diagnoses, Jasson authorizes payment | console.anthropic.com |
| Cloudflare account | Jasson (account owner) | Cloudflare support |
| Twilio | 9 (auto-update via API) | console.twilio.com |
| Supabase | 9 (monitor drift, auto-sync) | status.supabase.com |

---

## Testing Protocol (quarterly)

1. **Tunnel restart drill** — kill cloudflared, verify auto-restart and Twilio URL update within 5 min
2. **Hub crash drill** — `kill -9 $(pgrep -f comms-hub)`, verify LaunchAgent restarts within 15s
3. **DB restore drill** — restore from latest backup to temp file, run integrity check
4. **Cloud failover drill** — verify cloud worker `/health` shows `mode: relay`; confirm voice fallback responds

---

*Last verified: 2026-04-05. Next review: 2026-05-05.*
