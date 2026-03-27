# VPS Deployment Plan — DigitalOcean

**Version:** 1.0
**Date:** March 26, 2026
**Classification:** Owner Eyes Only

---

## Overview

Move always-on infrastructure off the Mac and onto a $6/mo DigitalOcean droplet. The Mac stays as the brain (Claude Code terminal, browser automation, iMessage, screenshots). The VPS becomes the tireless relay that never sleeps.

**Why now:** Every Telegram reliability issue traces back to the Mac dependency. When the Mac sleeps, reboots, or the terminal dies, messages pile up. A VPS running 24/7 eliminates this entirely.

---

## Recommended Droplet

| Spec | Value |
|------|-------|
| **Plan** | Basic (Regular Intel) |
| **Price** | $6/month |
| **vCPUs** | 1 |
| **RAM** | 1 GB |
| **Disk** | 25 GB SSD |
| **Transfer** | 1 TB/month |
| **Region** | San Francisco 3 (SFO3) |
| **OS** | Ubuntu 24.04 LTS |
| **Hostname** | `9-relay` |

**Why $6 instead of $4:** The $4 tier (512MB RAM) is tight for Node.js + PM2 + potential future services. The $6 tier (1GB RAM) gives headroom for running the relay, monitoring scripts, cron jobs, and a small SQLite queue without hitting swap. The extra $2/mo buys real stability.

**Why San Francisco:** DigitalOcean SFO3 has excellent peering and the Cloudflare tunnel to the Mac routes through West Coast POPs efficiently. Latency to Telegram API (global CDN) is equivalent from any US region.

---

## What Moves to VPS

| Service | Current Location | VPS Role |
|---------|-----------------|----------|
| **Telegram relay** | Mac (comms-hub.mjs polls Telegram) | `telegram-relay.mjs` polls Telegram 24/7, forwards to Mac via tunnel |
| **Cloud worker backup** | Cloudflare Worker (Backup QB) | Backup QB logic can consolidate here (simpler than Workers for stateful ops) |
| **trader9 monitoring** | Mac (on-demand script) | Cron job checks positions, P&L, alerts. Trading bot still runs on Mac for now |
| **Cron jobs** | Mac (LaunchAgents) | Heartbeat watchdog, state sync, log rotation, scheduled tasks |
| **Health monitoring** | Mac (hub self-check) | Independent health checks on all services, alerts if Mac goes dark |

### VPS Services Detail

```
9-relay VPS ($6/mo)
|
+-- telegram-relay.mjs (PM2, always running)
|   +-- Long-polls Telegram API (25s timeout)
|   +-- Forwards to Mac hub via Cloudflare tunnel
|   +-- Falls back to Haiku autonomous responses when Mac is unreachable
|   +-- SQLite message queue (survives restarts)
|
+-- health-monitor.sh (cron, every 2 min)
|   +-- Pings Mac hub via tunnel
|   +-- Checks Telegram API reachability
|   +-- Checks Anthropic API health
|   +-- Alerts via Telegram if anything is down
|
+-- trader9-monitor.sh (cron, every 15 min during market hours)
|   +-- Checks Alpaca portfolio status
|   +-- Monitors P&L vs daily limits
|   +-- Alerts if 5% daily loss threshold approached
|
+-- state-sync.sh (cron, every 60s)
|   +-- Pulls shared-state.json from Mac
|   +-- Stores local copy for autonomous mode
|
+-- log-rotate.sh (cron, daily at midnight)
    +-- Rotates PM2 logs
    +-- Compresses old logs
    +-- Keeps 7 days
```

---

## What Stays on Mac

| Service | Why It Stays |
|---------|-------------|
| **Claude Code terminal (9)** | Needs Claude Code CLI, local file system, git, all dev tools |
| **Browser automation** | Needs a real browser (Puppeteer, screenshots) |
| **iMessage monitor** | Requires macOS + Full Disk Access to read chat.db |
| **Email monitor** | Uses osascript (macOS Mail.app) |
| **Voice server (Headset)** | Twilio webhook via Cloudflare tunnel, low latency needed |
| **Jules server** | SMS via Twilio, currently Mac-bound |
| **Training Staff** | LaunchAgent that opens Terminal.app |
| **Screenshots/captures** | Requires macOS screen access |

---

## Docker vs Bare Node.js

**Recommendation: Bare Node.js with PM2.**

| Factor | Docker | Bare Node.js + PM2 |
|--------|--------|-------------------|
| Memory overhead | ~100-200MB for Docker daemon | ~0 (PM2 is ~30MB) |
| On 1GB RAM | Tight, may need swap | Comfortable |
| Complexity | Dockerfile, compose, volumes, networking | `npm install && pm2 start` |
| Debugging | `docker logs`, `docker exec` | Direct file access, standard tools |
| Updates | Rebuild image, redeploy | `git pull && pm2 restart` |
| Number of services | 1-2 | 1-2 |

At this scale (one Node.js process + cron jobs), Docker adds complexity without meaningful benefit. If we grow to 5+ services or need reproducible multi-machine deploys, revisit Docker then.

---

## Step-by-Step Setup

### Phase 1: Account and Droplet (5 minutes)

1. **Create DigitalOcean account**
   - Go to digitalocean.com
   - Sign up with emailfishback@gmail.com
   - Add payment method (credit card or PayPal)
   - New accounts get $200 free credit for 60 days

2. **Create the droplet**
   - Create > Droplets
   - Region: San Francisco 3 (SFO3)
   - Image: Ubuntu 24.04 LTS
   - Size: Basic > Regular > $6/mo (1 vCPU, 1GB RAM, 25GB SSD)
   - Authentication: **SSH Keys** (not password — see Security section)
   - Hostname: `9-relay`
   - Enable monitoring (free)
   - Create Droplet
   - Note the IP address

3. **Add SSH key**
   - On the Mac, generate a key if needed: `ssh-keygen -t ed25519 -C "9-relay"`
   - Copy public key: `cat ~/.ssh/id_ed25519.pub`
   - Paste into DigitalOcean SSH key field during droplet creation
   - Or add later via Settings > Security > SSH Keys

### Phase 2: Server Hardening (10 minutes)

SSH into the droplet:
```bash
ssh root@<DROPLET_IP>
```

Run the deployment script (see `scripts/deploy-to-vps.sh`), which automates all of the following:

**2a. System updates**
```bash
apt update && apt upgrade -y
```

**2b. Create non-root user**
```bash
adduser deploy --disabled-password --gecos ""
usermod -aG sudo deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

**2c. SSH hardening**
```bash
# /etc/ssh/sshd_config changes:
# PermitRootLogin no
# PasswordAuthentication no
# PubkeyAuthentication yes
# MaxAuthTries 3
# LoginGraceTime 30
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

**2d. Firewall (ufw)**
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 3460/tcp comment 'Telegram relay health endpoint'
ufw --force enable
```

**2e. fail2ban**
```bash
apt install -y fail2ban
cat > /etc/fail2ban/jail.local << 'JAIL'
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
JAIL
systemctl enable fail2ban
systemctl start fail2ban
```

### Phase 3: Application Setup (10 minutes)

```bash
# As deploy user
su - deploy

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Clone the repo (deploy key or HTTPS)
git clone https://github.com/jassonfishback/BengalOracle.git /home/deploy/bengal-oracle
cd /home/deploy/bengal-oracle

# Create .env with required secrets
cat > .env << 'ENV'
TELEGRAM_BOT_TOKEN=<from the Locker>
TELEGRAM_CHAT_ID=<from the Locker>
ANTHROPIC_API_KEY=<from the Locker>
MAC_TUNNEL_URL=<current Cloudflare tunnel URL>
PORT=3460
ENV

# Install dependencies (if package.json exists, otherwise none needed)
npm install 2>/dev/null || true

# Start the relay with PM2
pm2 start scripts/telegram-relay.mjs --name telegram-relay
pm2 save
pm2 startup  # Follow the instructions to enable on boot
```

### Phase 4: Cron Jobs (5 minutes)

```bash
# As deploy user
crontab -e

# Add these entries:
# Health monitor — every 2 minutes
*/2 * * * * /home/deploy/bengal-oracle/scripts/vps-health-monitor.sh >> /home/deploy/logs/health.log 2>&1

# trader9 monitor — every 15 min during market hours (9:30-16:00 ET, Mon-Fri)
*/15 13-20 * * 1-5 /home/deploy/bengal-oracle/scripts/trader9-monitor-cron.sh >> /home/deploy/logs/trader9.log 2>&1

# State sync — every 60 seconds
* * * * * /home/deploy/bengal-oracle/scripts/state-sync.sh >> /home/deploy/logs/sync.log 2>&1

# Log rotation — daily at midnight UTC
0 0 * * * /home/deploy/bengal-oracle/scripts/log-rotate.sh >> /home/deploy/logs/rotate.log 2>&1
```

### Phase 5: Update Mac Hub (15 minutes)

1. **Remove Telegram polling from comms-hub.mjs**
   - Comment out/remove the Telegram long-polling loop
   - Add `/relay-message` POST endpoint (receives forwarded messages from VPS)
   - The hub still handles iMessage, email, voice, terminal management

2. **Update Cloudflare tunnel config**
   - Ensure the tunnel exposes the hub's `/relay-message` endpoint
   - VPS relay calls this to forward Telegram messages

3. **Test end-to-end**
   - Send a Telegram message
   - Verify: VPS receives it, forwards to Mac, 9 responds, response goes back through relay

### Phase 6: Verification (10 minutes)

```bash
# From VPS
pm2 status                                    # telegram-relay should be "online"
curl -s http://localhost:3460/health           # Should return OK
pm2 logs telegram-relay --lines 20            # Check for errors

# From Mac
curl -s http://<DROPLET_IP>:3460/health       # Should return OK

# End-to-end test
# 1. Send "test" via Telegram
# 2. Verify response arrives within 3 seconds
# 3. Stop Mac hub, send another message
# 4. Verify VPS Haiku fallback responds within 5 seconds
# 5. Restart Mac hub, verify relay reconnects
```

---

## Security Checklist

| Item | Status | Notes |
|------|--------|-------|
| SSH key auth only | Required | No password auth |
| Root login disabled | Required | Use `deploy` user |
| ufw firewall enabled | Required | Only ports 22 and 3460 open |
| fail2ban installed | Required | 3 strikes = 1 hour ban |
| .env not in git | Required | Secrets stay in The Locker |
| Non-root process user | Required | PM2 runs as `deploy`, not root |
| Automatic security updates | Recommended | `apt install unattended-upgrades` |
| DigitalOcean monitoring | Recommended | Free, shows CPU/RAM/disk |

### Credential Flow

```
The Locker (.env on Mac)
       |
       | (9 deploys via SSH, writes .env on VPS)
       v
VPS .env (minimal set)
  - TELEGRAM_BOT_TOKEN
  - TELEGRAM_CHAT_ID
  - ANTHROPIC_API_KEY (for Haiku fallback)
  - MAC_TUNNEL_URL

9 is the ONLY entity that touches credentials on both machines.
No agent, no script, no cron job ever reads The Locker directly.
```

---

## Monitoring and Alerts

### What Gets Monitored

| Check | Frequency | Alert Channel | Threshold |
|-------|-----------|---------------|-----------|
| VPS telegram-relay process | Every 2 min | Telegram (via Haiku fallback) | Process not running |
| Mac hub reachability | Every 2 min | Telegram | 3 consecutive failures |
| Telegram API health | Every 2 min | Email (if Telegram is down) | Any failure |
| Anthropic API health | Every 10 min | Telegram + Email | Any failure |
| VPS disk usage | Every hour | Telegram | >80% |
| VPS memory usage | Every hour | Telegram | >85% |
| trader9 daily P&L | Every 15 min (market hours) | Telegram | -3% warning, -5% stop |
| PM2 restart count | Every hour | Telegram | >3 restarts/hour |

### Alert Escalation

```
Level 1: Telegram message to Jasson
  (VPS can send directly via Telegram API, no Mac needed)

Level 2: Email to emailfishback@gmail.com
  (if Telegram itself is down)

Level 3: SMS via Twilio
  (if both Telegram and email fail — requires Mac or separate Twilio integration on VPS)
```

### DigitalOcean Built-in Monitoring

- Enable during droplet creation (free)
- CPU, RAM, disk, bandwidth graphs in the DO dashboard
- Set up DO Alerts: email on CPU > 90% for 5 min, disk > 85%

---

## Migration Checklist

### Pre-Migration

- [ ] DigitalOcean account created
- [ ] SSH key generated on Mac (`~/.ssh/id_ed25519`)
- [ ] SSH key added to DigitalOcean account
- [ ] Droplet created ($6/mo, SFO3, Ubuntu 24.04)
- [ ] Droplet IP noted

### Server Setup

- [ ] SSH into droplet as root
- [ ] Run `scripts/deploy-to-vps.sh` (or manual steps from Phase 2-3)
- [ ] `deploy` user created with SSH key
- [ ] Root login disabled
- [ ] ufw firewall enabled (ports 22, 3460)
- [ ] fail2ban installed and running
- [ ] Node.js 22 LTS installed
- [ ] PM2 installed globally
- [ ] Repository cloned to `/home/deploy/bengal-oracle`
- [ ] `.env` created with credentials from The Locker
- [ ] `telegram-relay.mjs` running via PM2
- [ ] PM2 startup configured (survives reboot)
- [ ] Cron jobs installed

### Mac-Side Changes

- [ ] Telegram polling removed from comms-hub.mjs
- [ ] `/relay-message` endpoint added to hub
- [ ] Cloudflare tunnel config updated
- [ ] Hub restarted with new config

### Verification

- [ ] VPS health endpoint responds: `curl http://<IP>:3460/health`
- [ ] Telegram message reaches VPS (check PM2 logs)
- [ ] Message forwards to Mac hub successfully
- [ ] Response flows back through relay to Telegram
- [ ] Mac offline: VPS Haiku fallback responds
- [ ] Mac back online: relay reconnects, queued messages delivered
- [ ] Cron jobs firing (check /home/deploy/logs/)
- [ ] fail2ban active: `sudo fail2ban-client status sshd`

### Post-Migration

- [ ] Monitor for 24 hours — no missed messages
- [ ] Remove old Telegram polling code from comms-hub.mjs (clean up, not just comment out)
- [ ] Update `docs/9-enterprises-architecture.md` with new architecture diagram
- [ ] Update `CLAUDE.md` if startup protocol changes
- [ ] Update Cloudflare Worker (Backup QB) — may be partially redundant now

---

## Cost Summary

| Item | Monthly | Notes |
|------|---------|-------|
| DigitalOcean Droplet | $6.00 | 1 vCPU, 1GB RAM, 25GB SSD |
| Anthropic API (Haiku fallback) | ~$1-2 | Only when Mac is offline |
| **Total new spend** | **~$7-8/mo** | |
| **Potential savings** | -$5/mo | Can reduce Cloudflare Worker usage (Backup QB partially replaced) |
| **Net impact** | **~$2-3/mo** | |

First 60 days: $0 (DigitalOcean $200 free credit for new accounts).

---

## Future Expansion

Once the VPS is stable, consider moving more services:

| Service | Feasibility | Notes |
|---------|------------|-------|
| Jules server | Easy | SMS via Twilio, no macOS dependency |
| Cloudflare Worker consolidation | Medium | Move Backup QB logic to VPS, simplify |
| trader9 full execution | Medium | API-only, no macOS dependency |
| Voice server (Headset) | Hard | Needs low latency, Cloudflare tunnel routing works from Mac |
| underwriter9 API | Easy | RAG + API, no macOS dependency |

The VPS becomes the "always-on compute layer" and the Mac becomes the "intelligence + macOS-specific layer."

---

*Who Dey.*
