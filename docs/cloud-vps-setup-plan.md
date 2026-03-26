# Cloud VPS Setup — Fix Gram Forever
**Date:** March 26, 2026
**Goal:** Telegram reliability. Period.

---

## The Problem

Every gram issue tonight traces to one root cause: Telegram message detection depends on my terminal session being alive and making tool calls. When the session dies, messages pile up. When I restart the hub, OC fires spam. When I'm between tool calls, there's a gap.

The fix is architectural, not another patch: **put a dedicated relay on a cloud server that never sleeps.**

---

## The Solution

A $4/month DigitalOcean droplet running a lightweight Telegram relay. This relay:
- Polls Telegram 24/7 (independent of the Mac)
- Instantly forwards messages to 9 on the Mac (when terminal is active)
- Handles simple responses autonomously (when terminal is down)
- Never spams, never freezes, never needs a hub restart

---

## Architecture

```
Jasson's Telegram
       ↓
[Cloud VPS — $4/mo DigitalOcean]
  telegram-relay.mjs
  - Polls Telegram API (long-polling)
  - Receives ALL messages instantly
  - Routes to Mac via tunnel or webhook
  - Falls back to Haiku responses when Mac is unreachable
       ↓ (when Mac is up)
[Mac — comms-hub.mjs]
  - Receives relayed messages
  - 9 processes and responds
  - Response goes back through relay → Telegram
       ↓ (when Mac is down)
[Cloud VPS handles it]
  - Haiku-powered responses
  - Queues complex requests for when Mac comes back
  - Never tells Jasson "terminal is down" — just handles it
```

---

## Setup Steps

### 1. Create DigitalOcean Droplet ($4/month)
- Region: NYC (closest to Cincinnati for latency)
- Image: Ubuntu 24.04 LTS
- Size: Basic, 1 vCPU, 512MB RAM, 10GB SSD
- Use 1-Click Node.js image (comes with Node, NPM, Nginx, PM2)

### 2. Deploy telegram-relay.mjs
```
Components:
- Telegram long-polling loop (25s timeout)
- Mac health check (ping hub every 30s)
- Message queue (SQLite for persistence)
- Haiku fallback (Claude API for autonomous responses)
- PM2 process manager (auto-restart on crash)
```

### 3. Migrate Telegram Token
- Move TELEGRAM_BOT_TOKEN to cloud relay
- Mac hub no longer polls Telegram directly
- Hub receives messages via internal webhook from cloud relay
- This eliminates the entire relay/signal-file/hook chain that's been breaking

### 4. Update Mac Hub
- Remove Telegram polling from comms-hub.mjs
- Add /relay-message endpoint (receives from cloud)
- Remove freeze detector, PID watchdog for Telegram
- Keep iMessage, email, voice on Mac (those need macOS)

### 5. DNS/Networking
- Cloud relay → Mac: via Cloudflare tunnel (already exists)
- Mac → Cloud relay: direct HTTPS (DigitalOcean provides a static IP)

---

## What Changes for Jasson

**Nothing.** He texts the same Telegram bot. Responses come from the same place. He'll just notice they're faster and never miss.

---

## What Changes for 9

Everything about Telegram gets simpler:
- No more signal files
- No more PostToolUse hooks for message delivery
- No more freeze detector
- No more relay timeouts
- No more OC spam during restarts
- Messages arrive via a clean webhook, not a janky file watcher

---

## Cost

| Item | Monthly Cost |
|------|-------------|
| DigitalOcean Droplet | $4.00 |
| Domain/SSL | $0 (use existing or DigitalOcean free) |
| Claude API (Haiku fallback) | ~$1-2 |
| **Total** | **~$5-6/month** |

---

## Timeline

- Hour 1: Create droplet, install Node.js, deploy relay script
- Hour 2: Test end-to-end (Telegram → cloud → Mac → response)
- Hour 3: Cut over from Mac-based Telegram polling to cloud relay
- Verification: Send test messages, verify latency, verify failover

**Total: 3 hours.** Can be done tonight.

---

## Risk Mitigation

- If cloud relay fails: Mac hub can re-enable local Telegram polling as fallback
- If tunnel is down: Cloud relay handles autonomously until tunnel recovers
- PM2 auto-restarts the relay process on crash
- DigitalOcean has 99.99% uptime SLA

---

## Owner Approval Needed

- DigitalOcean account creation (email + credit card)
- $4/month spend authorization
- OR: Jasson can create the account and give 9 the API key

---

## Next Steps

1. Owner approves DigitalOcean spend ($4/month)
2. Create account + droplet
3. Write and deploy telegram-relay.mjs
4. Test end-to-end
5. Cut over
6. Gram is fixed forever
