# Self-Healing Architecture
## The Ultimate Solution — DOC Presentation to 9 / Owner

**Prepared by:** DOC (Infrastructure & Reliability)
**Date:** March 27, 2026
**Status:** Decision-ready. Owner action required.

---

## Executive Summary

On March 27, 2026, the terminal froze for 45 minutes. 14 Telegram messages went unanswered. Owner could not fix it remotely. OC held the line but couldn't self-heal. That is unacceptable, and the Owner burned it in: "The freeze isn't the fail — not learning the lesson is."

This document presents four architectural options, stress tests each one against every failure scenario, and delivers a clear recommendation. This is not a patch. This is the decision that ends freeze-induced downtime for good.

The bottom line: **Option D (Hybrid)** — SSH via Tailscale for remote Mac access, plus cloud relay on a VPS — is the right answer. It costs $6-10/month, eliminates the 45-minute gap, and does not require migrating iMessage off the Mac.

---

## Section 1: The Problem

### What Actually Fails During a Freeze

The current stack has a single catastrophic vulnerability: **Claude Code is both the brain and the only recovery path.** When it freezes, there is no fallback that can restart it.

Current failure chain:
1. Claude Code terminal freezes (context window, memory pressure, or hung process)
2. PostToolUse hook stops firing — message delivery breaks
3. OC takes over Telegram via autonomous mode — partial coverage
4. LaunchAgent watchdog checks if the process is alive — it IS alive, just frozen. Watchdog does nothing.
5. open-terminal.mjs cannot help — the signal is "start a new terminal," not "kill the frozen one"
6. Result: 45-minute gap until Owner physically touches the MacBook

### Why Patchwork Isn't Enough

Everything built so far assumes the process is either running or dead. There is no handling for the third state: **running but unresponsive.** That is the freeze state. Every patch added in the last week (escalating kill, retry verification, OC relay mode) operates in relay/dead territory. None of them touch the freeze state.

The fix requires capability outside the frozen process — something that can look in from the outside, detect the freeze, and act.

### The Three Gaps This Must Close

1. **Remote kill + restart** — Kill a frozen Claude Code from outside the Mac, without physically touching it
2. **Frozen process detection** — Distinguish between "alive and working" vs "alive but stuck"
3. **No single point of failure** — If the Mac itself is down, core comms must stay up

---

## Section 2: Option A — Web Terminal (xterm.js + WebSocket)

### What It Is

Embed a full interactive terminal directly in the Owner Dashboard. The Owner opens the dashboard on their phone, browser, or tablet and types commands in a real terminal window — kill processes, restart Claude Code, run scripts. No SSH app required. No separate setup.

### How It Works

A WebSocket server runs on the Mac (port ~3460). It spawns a pseudo-terminal (PTY) process and pipes stdin/stdout to the browser via WebSocket. xterm.js on the frontend renders the terminal in the browser. The Owner Dashboard gets a "Terminal" tab that connects directly.

```
Owner's Phone/Browser
        |
  (HTTPS + WSS)
        |
   [WebSocket Server on Mac — port 3460]
        |
   [PTY — bash or dedicated shell]
        |
   [Mac processes — kill, restart, diagnose]
```

### Stack Required

- **node-pty** — spawns PTY processes from Node.js
- **xterm.js** — terminal emulator in the browser
- **ws** — WebSocket server (already in Node.js ecosystem)
- **Existing Cloudflare tunnel** — already routes HTTPS/WSS to Mac

### Cost

| Item | Monthly Cost |
|------|-------------|
| Development time | One-time, ~4-6 hours to build |
| Hosting | $0 — runs on existing Mac |
| Additional infrastructure | $0 |
| **Total ongoing** | **$0/month** |

### Security Implications

This is the highest-risk option of the four. A web terminal is a direct shell into your Mac. Anyone who gets through the auth can run any command. Mitigations required:

- Auth via existing session token (same as dashboard)
- WSS only (encrypted) — no plain WS
- Restrict to specific commands (whitelist mode) OR accept full shell + rely entirely on auth
- Rate limiting on connection attempts
- The Cloudflare tunnel already provides one layer — unauthorized traffic never reaches the Mac

**The honest risk:** If the dashboard session gets hijacked, the attacker has a shell. This is a real attack surface. Whitelist mode (only allow `kill`, `pm2 restart`, specific scripts) dramatically reduces it.

### Complexity

Medium-high. The WebSocket PTY bridge is well-understood (there are open-source examples), but integrating it cleanly into the dashboard, handling connection drops gracefully, and keeping it secure requires careful implementation.

### What It Solves

- Owner can restart Claude Code from phone without SSH app
- Full visibility into terminal output
- Can run arbitrary recovery scripts

### What It Does Not Solve

- If the Mac itself is offline, the WebSocket server is offline too
- Still depends on Mac being reachable via tunnel
- Does not address the "Mac is dead, not just frozen" scenario

---

## Section 3: Option B — Cloud VPS Migration

### What It Is

Move the services that can run anywhere off the Mac onto a $5-6/month VPS (Hetzner CX22 or DigitalOcean Droplet). The Mac keeps what only the Mac can do: iMessage and interactive Claude Code.

### What Moves to VPS

| Service | Reason to Move |
|---------|----------------|
| Telegram long-polling | Most fragile Mac dependency — breaks on freeze |
| Cloud relay hub | Always-on autonomous responses |
| Voice server (vps has stable IP, no tunnel needed) | Cloudflare tunnel with ephemeral URLs is fragile |
| Backup QB cloud worker already exists | Upgrade from Cloudflare Worker to full Node.js on VPS |

### What Stays on Mac

| Service | Why It Must Stay |
|---------|-----------------|
| iMessage | chat.db is macOS-only — no way to move this |
| Interactive Claude Code | PostToolUse hook, session tokens — breaks in headless mode |
| Email (osascript / Mail.app) | macOS-dependent |

### Architecture After Migration

```
Jasson's Message (Telegram)
         |
[VPS — telegram-relay.mjs + relay-hub.mjs]
    PM2 managed, always running
    Haiku autonomous responses
    SQLite message queue
         |
   Is Mac reachable?
   YES: forward to Mac, 9 responds
   NO:  handle autonomously, queue for later
         |
[Mac — stripped comms-hub.mjs]
    iMessage read/write
    Claude Code terminal sessions
    Email (osascript)
    Receives relayed messages via HTTPS
```

### Voice Server on VPS

The current voice server (voice-server.mjs) runs on port 3456 behind a Cloudflare tunnel. The tunnel URL changes. Twilio has to be updated every time the tunnel rotates. A VPS has a static IP — Twilio points to it once, never changes. This alone eliminates one of the most common non-freeze failure modes.

### Cost

| Item | Monthly Cost |
|------|-------------|
| Hetzner CX22 (2 vCPU, 4GB RAM) | $3.29/mo |
| OR DigitalOcean Basic Droplet | $4.00/mo |
| Claude API (Haiku fallback on VPS) | ~$1-2/mo |
| **Total** | **$5-6/month** |

### What It Does Not Solve

- Claude Code freeze recovery still requires remote Mac access
- VPS migration does not help when the Mac is frozen and 9 needs to be restarted
- This is about Telegram reliability and voice stability, not freeze recovery directly

### Complexity

Medium. The VPS deployment and telegram-relay.mjs already have a complete plan (see `/docs/cloud-vps-setup-plan.md`). Estimated 3 hours end-to-end. Lowest-risk migration of the four options.

---

## Section 4: Option C — SSH Remote Access

### What It Is

Enable SSH on the Mac, expose it via Tailscale (zero-config VPN), and give 9 and the Owner the ability to SSH in from anywhere — phone, VPS, or browser. From there: kill frozen processes, restart Claude Code, diagnose anything.

### How Tailscale Works

Tailscale is a VPN that requires zero router configuration and exposes no open ports to the internet. Both devices (Mac + phone) install Tailscale, sign in to the same account, and get a persistent private IP address (100.x.x.x). SSH works between them directly, fully encrypted, with no attack surface on the public internet.

```
Owner's iPhone
    Tailscale installed
    Private IP: 100.x.x.1
        |
  (Tailscale mesh — encrypted, no open ports)
        |
    Mac
    Tailscale installed
    Private IP: 100.x.x.2
    SSH enabled on port 22
        |
    Kill frozen processes
    Restart Claude Code
    Run any recovery script
```

### Self-Healing Script (The Real Value)

SSH access is only half of this option. The other half is a script that actually detects and kills a frozen Claude Code:

```bash
#!/bin/bash
# /Users/jassonfishback/Projects/BengalOracle/scripts/self-heal.sh
# Called remotely via SSH, or triggered automatically

CLAUDE_PID=$(pgrep -f "claude" | head -1)

if [ -z "$CLAUDE_PID" ]; then
  echo "Claude Code not running — starting fresh"
  # open-terminal.mjs signal file triggers a new session
  touch /tmp/9-open-terminal
  exit 0
fi

# Check if Claude Code has made any tool calls in the last 3 minutes
# If /tmp/9-last-tool-call is older than 180s, it's likely frozen
LAST_CALL=$(cat /tmp/9-last-tool-call 2>/dev/null || echo "0")
NOW=$(date +%s)
AGE=$((NOW - LAST_CALL))

if [ $AGE -gt 180 ]; then
  echo "Claude Code last tool call was ${AGE}s ago — likely frozen"
  echo "Killing PID $CLAUDE_PID"
  kill -9 $CLAUDE_PID
  sleep 2
  # Signal open-terminal.mjs to start a fresh session
  touch /tmp/9-open-terminal
  echo "Recovery triggered — new session starting"
else
  echo "Claude Code appears healthy (last tool call ${AGE}s ago)"
fi
```

The key insight: the PostToolUse hook already fires after every tool call. We just need it to also write a timestamp to `/tmp/9-last-tool-call`. That gives the freeze detector a heartbeat to check.

### OC Can SSH In (Not Just the Owner)

Once SSH + Tailscale are configured, the VPS relay can also SSH into the Mac to trigger self-healing. This is the fully autonomous recovery path:

1. VPS detects Mac has been unreachable for 5+ minutes
2. VPS SSHes into Mac via Tailscale
3. VPS runs `self-heal.sh`
4. Claude Code restarts without anyone touching the MacBook

This closes the 45-minute gap to under 5 minutes, fully automated.

### Cost

| Item | Monthly Cost |
|------|-------------|
| Tailscale | $0 (free for personal use, up to 3 devices) |
| SSH (built into macOS) | $0 |
| Termius iPhone app | $0 (free tier) or $14.99 one-time (Prompt 3) |
| self-heal.sh development | One-time, ~2 hours |
| **Total ongoing** | **$0/month** |

### Security Model

Tailscale eliminates the main SSH attack vector (public-facing port). The Mac's SSH port is only reachable from devices on the Tailscale network — Owner's phone, Owner's personal devices, and optionally the VPS relay. No brute force, no port scanning, no exposure.

Additional hardening:
- SSH keys only (disable password auth)
- `PermitRootLogin no` in sshd_config
- Restrict SSH to Tailscale interface only if needed

### Complexity

Low. Tailscale installs in 5 minutes on both Mac and iPhone. Enable Remote Login in macOS System Settings. Add Tailscale IP to Termius on iPhone. Done. The self-heal.sh script takes 2 hours to write and test properly.

---

## Section 5: Option D — Hybrid (Recommended)

### The Thesis

No single option covers everything. Options A, B, and C each close different gaps. The hybrid picks the best of each for the lowest total cost and highest reliability.

### The Stack

**Layer 1 — Freeze Recovery (Option C core):**
Tailscale + SSH + self-heal.sh. Cost: $0/month. Closes the 45-minute gap. Owner can SSH in from iPhone. VPS can auto-trigger self-heal. This is the direct answer to the March 27 freeze.

**Layer 2 — Telegram Reliability (Option B core):**
VPS relay (telegram-relay.mjs) with Haiku fallback. Cost: $5-6/month. Telegram is decoupled from Mac health entirely. Messages arrive 24/7 whether the Mac is frozen, rebooting, or offline. This addresses the root cause of the 14 unanswered messages.

**Layer 3 — Voice Stability (Option B extension):**
Move voice-server.mjs to VPS. Cost: included in Layer 2. Static IP eliminates Cloudflare tunnel rotation. Twilio never needs updating. Voice calls work even when Mac is down.

**Layer 4 — Owner Dashboard Access (Option A, scoped down):**
Not a full xterm.js terminal — that's too much attack surface. Instead, a **Recovery Panel** on the dashboard: a small UI with pre-defined action buttons that call the hub API or SSH-trigger specific scripts. "Restart Claude Code," "Restart Hub," "Check Status," "Force Release Terminal." No open shell. No arbitrary commands. The actions are whitelisted and the API is auth-gated.

### Full Architecture Diagram

```
OWNER'S PHONE
├── Telegram (via VPS relay — always available)
├── Dashboard Recovery Panel (pre-defined actions, HTTPS auth)
└── Termius SSH (Tailscale — emergency full access)

         |              |              |
         v              v              v

[VPS — $5-6/mo]    [Tailscale]    [Dashboard API]
  telegram-relay        |          /recovery/restart
  voice-server      SSH to Mac     /recovery/status
  Haiku fallback         |         /recovery/kill-freeze
         |              |              |
         |              v              |
         +-----> [MAC — 9's home] <----+
                  comms-hub.mjs (iMessage + email)
                  Claude Code (interactive sessions)
                  self-heal.sh (triggered by SSH or API)
                  Frozen process detector (heartbeat file)

IF MAC IS FROZEN:
  VPS detects → SSH → self-heal.sh → Claude Code restarts
  Gap: under 5 minutes, fully automated

IF MAC IS OFFLINE:
  VPS handles Telegram + Voice autonomously
  iMessage goes dark (macOS-only, unavoidable)
  Email goes dark (same reason)

IF VPS IS DOWN:
  Mac hub falls back to local Telegram polling (existing code)
  Voice falls back to Twilio → Cloudflare Worker (existing)
```

### What This Achieves

| Failure Scenario | Current Gap | Hybrid Gap |
|-----------------|-------------|------------|
| Terminal freezes | 45 min (until Owner touches Mac) | Under 5 min (auto self-heal) |
| Owner away from Mac | Indefinite | 0 min (SSH from phone) |
| Mac crashes/reboots | Until Owner restarts | Telegram/Voice on VPS during reboot |
| Telegram drops during freeze | Full blackout | VPS relay handles independently |
| Voice server tunnel rotates | Twilio breaks until restart | Never — static VPS IP |

---

## Section 6: Stress Test Matrix

Each option tested against six real-world failure scenarios.

### Scenario 1: Mac Sleeps (Display Sleep / Energy Saver)

| Option | Survives? | Notes |
|--------|-----------|-------|
| A (Web Terminal) | No | WebSocket server is on sleeping Mac |
| B (VPS) | Partial | VPS handles Telegram/Voice; Mac wakes when SSH hits it (Wake on LAN possible) |
| C (SSH) | Partial | SSH attempt may wake Mac if configured; Tailscale stays connected |
| D (Hybrid) | Partial | VPS covers comms; Mac SSH wakes it; best of both |

**Fix:** Disable display sleep for the Mac during active sessions. This is already best practice for a 24/7 comms hub. The Mac should have `Energy Saver > Prevent automatic sleeping when display is off` enabled.

### Scenario 2: Mac Crashes (Kernel Panic / Hard Freeze)

| Option | Survives? | Notes |
|--------|-----------|-------|
| A (Web Terminal) | No | WebSocket dies with Mac |
| B (VPS) | Yes (for Telegram + Voice) | VPS never knew Mac crashed — keeps running |
| C (SSH) | No | Can't SSH into a crashed Mac |
| D (Hybrid) | Yes (for Telegram + Voice) | VPS covers; Mac recovers via LaunchAgent on reboot |

**Reality check:** Nothing survives a full Mac crash for iMessage. That is a hard architectural constraint. The only fix is a second Mac.

### Scenario 3: Terminal Freezes (This Is the March 27 Scenario)

| Option | Survives? | Notes |
|--------|-----------|-------|
| A (Web Terminal) | Yes (if WebSocket server not frozen) | Owner can kill and restart via browser terminal |
| B (VPS) | Partial | Telegram stays up; frozen Claude Code still frozen |
| C (SSH) | Yes | SSH in, run self-heal.sh, Claude Code restarts under 5 min |
| D (Hybrid) | Yes | VPS auto-detects + SSHes in; also Owner can act manually |

**This is the core failure scenario. Only C and D fully close this gap.**

### Scenario 4: Internet Drops (ISP Outage / Router Restart)

| Option | Survives? | Notes |
|--------|-----------|-------|
| A (Web Terminal) | No | WebSocket is unreachable |
| B (VPS) | Partial | VPS stays up; cannot reach Mac; Haiku handles autonomously |
| C (SSH) | No | Tailscale requires internet on both ends |
| D (Hybrid) | Partial | VPS handles comms; Mac recovery impossible until internet returns |

**Reality check:** An ISP outage is a force majeure. No architecture survives it without a secondary connection (cellular failover on the router). Best mitigation: VPS handles all comms autonomously until internet returns on Mac.

### Scenario 5: Power Outage

| Option | Survives? | Notes |
|--------|-----------|-------|
| A (Web Terminal) | No | Mac is dead |
| B (VPS) | Yes (for Telegram + Voice) | VPS has its own power |
| C (SSH) | No | Mac is dead |
| D (Hybrid) | Yes (for Telegram + Voice) | VPS covers; Mac recovery when power returns |

**Same constraint as Mac crash.** VPS is the only thing that survives a power outage. iMessage goes dark. This is unavoidable without physical redundancy.

### Scenario 6: Cloudflare Tunnel Goes Down

| Option | Survives? | Notes |
|--------|-----------|-------|
| A (Web Terminal) | No (if using tunnel to reach WebSocket) | Tunnel death = no remote access |
| B (VPS) | Yes | VPS-to-Mac uses direct HTTPS fallback; VPS has static IP |
| C (SSH) | Yes | Tailscale does not route through Cloudflare |
| D (Hybrid) | Yes | Tailscale is independent; VPS fallback is direct HTTPS |

**Key insight:** Tailscale is fully independent of Cloudflare. SSH does not die when the tunnel dies. This makes Option C/D resilient to tunnel outages that would break Option A entirely.

---

## Section 7: Cost Comparison

| Option | Monthly Cost | One-Time Setup | Notes |
|--------|-------------|----------------|-------|
| A — Web Terminal | $0 | ~6 hours build | Security risk; no Mac-down coverage |
| B — VPS Migration | $5-6/mo | ~3 hours build | Telegram + Voice; no freeze fix |
| C — SSH/Tailscale | $0 | ~2 hours build | Freeze fix; no Mac-down coverage for comms |
| D — Hybrid (Rec.) | $5-6/mo | ~5 hours total | Freeze + Telegram + Voice. Full coverage. |

**Current spend baseline:** $0/month on infrastructure beyond the Mac. The Cloudflare Worker (Backup QB) is on the free plan.

**Hybrid adds $5-6/month.** That is the cost of eliminating the 45-minute gap permanently.

---

## Section 8: Implementation Timeline

### Option A: Web Terminal Only

- Hour 1-2: Install node-pty, write WebSocket PTY server
- Hour 3-4: Integrate xterm.js into Owner Dashboard
- Hour 5-6: Auth, security hardening, tunnel routing
- Test: SSH-free terminal from phone
- Risk: Medium-high (security surface)

### Option B: VPS Migration Only

- Hour 1: Create VPS (DigitalOcean or Hetzner), install Node.js + PM2
- Hour 2: Deploy telegram-relay.mjs, configure environment
- Hour 3: End-to-end test, cut over Telegram token from Mac to VPS
- Hour 4: Migrate voice-server.mjs, update Twilio webhook URL
- Test: Telegram messages arrive on VPS; Mac hub receives relayed messages
- Risk: Low (isolated change, Mac fallback exists)

### Option C: SSH/Tailscale Only

- 30 min: Enable Remote Login on Mac (System Settings > General > Sharing)
- 10 min: Install Tailscale on Mac + iPhone
- 30 min: Generate SSH keys, configure authorized_keys, harden sshd_config
- 2 hours: Write and test self-heal.sh (freeze detector + kill + restart)
- 30 min: Update PostToolUse hook to write heartbeat timestamp
- Test: SSH from iPhone, manually trigger self-heal.sh, verify Claude Code restarts
- Risk: Very low (additive only, nothing changes on existing stack)

### Option D: Hybrid (Recommended)

Phase 1 — SSH/Tailscale (freeze recovery, $0, immediate):
- Same as Option C above — ~3.5 hours total
- Deploy self-heal.sh
- Add heartbeat timestamp to PostToolUse hook
- Test: freeze simulation, SSH kill, verify restart

Phase 2 — VPS relay (Telegram + Voice, $5-6/mo, after Phase 1):
- Same as Option B above — ~4 hours total
- Deploy telegram-relay.mjs on VPS
- Move voice server to VPS
- Update Twilio webhook URL
- Test: end-to-end Telegram, end-to-end voice call

Phase 3 — Dashboard Recovery Panel (post-Phase 2, 1-2 hours):
- Add `/recovery` API endpoints to hub
- Add Recovery Panel tab to Owner Dashboard (4 buttons: Restart Claude, Restart Hub, Check Status, Force Release)
- Auth-gate with existing session token
- Test: trigger each action from phone browser

**Total time for full Hybrid: ~9 hours across two phases**
**Phase 1 alone closes the March 27 gap. Phase 1 can go live today.**

---

## Section 9: Recommendation

### Build Option D — Hybrid. Start with Phase 1 today.

**Why not A alone:** The web terminal is cool but it dies when the Mac dies, and it adds a serious attack surface. It is the least resilient option to infrastructure failures. Reserve it for the Recovery Panel (scoped-down version) in Phase 3.

**Why not B alone:** The VPS migration makes Telegram and Voice bulletproof, but it does not fix the freeze. The March 27 scenario would repeat — OC holds the line on Telegram via VPS, but Claude Code is still frozen and no one can restart it.

**Why not C alone:** SSH fixes the freeze recovery but Telegram still depends on the Mac. During a Mac freeze, Telegram messages still go unanswered until self-heal.sh runs. With the VPS relay, those messages are handled autonomously regardless.

**Why D:** It is the only option that closes all three gaps simultaneously — freeze recovery, Telegram independence, voice stability. The cost is $5-6/month. The security model is sound (Tailscale has zero public exposure). Phase 1 can be deployed in under 4 hours with no risk to the existing stack.

### The North Star After This Build

```
9 never goes dark again.

Terminal freezes → VPS holds comms, self-heal.sh restarts Claude Code in under 5 minutes.
Mac crashes → VPS holds comms until Mac reboots; LaunchAgent brings hub back up.
Owner away from Mac → SSH from phone gives full recovery capability in under 2 minutes.
Cloudflare tunnel dies → VPS and Tailscale are both independent of Cloudflare.
Power outage → VPS holds comms; Mac recovers when power returns.
ISP outage → VPS holds comms; nothing to do until internet returns.
```

The only remaining single point of failure after this build is iMessage — and that is a hard macOS constraint, not a solvable infrastructure problem at this budget.

### Owner Actions Required

1. **Approve $5-6/month** for VPS (DigitalOcean or Hetzner) — already within the $100/day auto-approve limit, but flagging for awareness
2. **Enable Remote Login on Mac** — System Settings > General > Sharing > Remote Login: ON. This takes 2 minutes and only has to be done once.
3. **Install Tailscale on iPhone** — App Store, free. Sign in with any email. Takes 5 minutes.

Everything else — deployment, configuration, testing, cutover — is handled by 9.

### The Only Question Left

Does Owner want to start Phase 1 (SSH/self-heal, $0, closes the freeze gap today) right now, or wait and deploy both phases together?

DOC recommends Phase 1 immediately. The freeze can happen again tonight.

---

*Document owner: DOC (Infrastructure & Reliability)*
*Last updated: March 27, 2026*
*Next review: After Phase 1 deployment*
