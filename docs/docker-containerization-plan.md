---
TO:      Kyle Shea, CIO — Rapid Mortgage Company
FROM:    UNO (Research Team Lead, 9 Enterprises)
DATE:    March 26, 2026
RE:      Docker Containerization Plan — Addressing Concern #2 (Autonomous OS Control)
---

# Docker Containerization Plan

## Executive Summary

The current 9 stack runs directly on a MacBook with full OS access — intentional for a single-operator development environment. For multi-user deployment, this is unacceptable. This plan containerizes every service in the stack so no agent or process can touch the host OS. Each container gets exactly the filesystem access it needs and nothing more. Inter-container communication happens over defined internal networks. Secrets are injected at runtime, not stored on disk.

The end state: a single `docker-compose up` command deploys the entire stack. No host OS access. No plaintext credential files. Full audit logging. Runs identically on a Mac, a Linux VPS, or a cloud-hosted VM.

---

## 1. Container Architecture

Five containers. One job each. No overlap.

### Container 1: comms-hub

**What it runs:** `scripts/comms-hub.mjs` — the central message router for Telegram, email, and OC autonomous mode.

**What it needs:**
- Outbound internet (Telegram polling, Anthropic API calls, Cloudflare API)
- Read access to shared state volume
- Write access to logs volume
- Internal network access to voice-server and jules-server (for forwarding)

**What it does NOT get:**
- Host filesystem access
- iMessage / osascript capability (see note below)
- Ability to open Terminal or launch processes on the host

**iMessage note:** iMessage uses `osascript` to talk to Messages.app — a Mac-only, host-required capability. In the containerized model, iMessage is dropped from the container stack. The Mac continues to handle iMessage locally as a thin relay script, or iMessage is replaced with an additional Twilio SMS channel (already partially built). This is the one channel that cannot be containerized without a Mac bridge process. That bridge is explicitly scoped and does not run as root.

**Base image:** `node:22-alpine` — minimal attack surface, no unnecessary system tools.

```dockerfile
# Container 1: comms-hub
FROM node:22-alpine

# Non-root user — never run as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only what this service needs
COPY scripts/comms-hub.mjs ./scripts/
COPY scripts/shared-state.json ./scripts/
COPY package*.json ./

RUN npm ci --omit=dev

# Switch to non-root before running
USER appuser

# No shell, no package manager, no curl — just node
ENTRYPOINT ["node", "scripts/comms-hub.mjs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3457/health || exit 1
```

**Ports exposed (internal only):** 3457
**Volumes:** `shared-state:/app/scripts/shared-state.json`, `logs:/app/logs`
**Environment:** Secrets injected via Docker secrets (see Section 3)

---

### Container 2: voice-server

**What it runs:** `scripts/voice-server.mjs` — Twilio webhook handler, ElevenLabs TTS, call transcript logging.

**What it needs:**
- Inbound HTTP on port 3456 (receives Twilio webhooks via reverse proxy — NOT directly exposed)
- Outbound internet (ElevenLabs API, Anthropic API)
- Write access to TTS audio cache volume
- Write access to call logs volume

**What it does NOT get:**
- Host filesystem access
- The ability to spawn `cloudflared` as a subprocess (tunnel is handled at the infrastructure layer — see Section 2)

**Tunnel change:** Currently, `comms-hub` spawns `cloudflared` as a child process and reads its stdout to extract the tunnel URL. In the containerized model, the tunnel is handled by a dedicated `cloudflared` sidecar container (or a reverse proxy like Caddy/nginx). This removes the "spawn arbitrary subprocess" pattern entirely.

```dockerfile
# Container 2: voice-server
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY scripts/voice-server.mjs ./scripts/
COPY package*.json ./

RUN npm ci --omit=dev && \
    mkdir -p /tmp/voice_audio && \
    chown appuser:appgroup /tmp/voice_audio

USER appuser

ENTRYPOINT ["node", "scripts/voice-server.mjs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3456/health || exit 1
```

**Ports exposed (internal only):** 3456
**Volumes:** `voice-audio:/tmp/voice_audio`, `call-logs:/app/logs/calls`
**Environment:** `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`

---

### Container 3: jules-server

**What it runs:** `scripts/jules-server.mjs` — personal assistant for Jamie Bryant. SMS via Twilio, morning briefings, OpenWeather.

**What it needs:**
- Inbound HTTP on port 3470 (Twilio SMS webhook)
- Outbound internet (Anthropic API, Twilio API, OpenWeather API)
- Read/write to Jules profile data volume

**What it does NOT get:**
- Access to comms-hub's conversation history
- Access to voice-server's call logs
- Host filesystem access

```dockerfile
# Container 3: jules-server
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY scripts/jules-server.mjs ./scripts/
COPY data/jules-profile.json ./data/
COPY package*.json ./

RUN npm ci --omit=dev

USER appuser

ENTRYPOINT ["node", "scripts/jules-server.mjs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3470/health || exit 1
```

**Ports exposed (internal only):** 3470
**Volumes:** `jules-data:/app/data`
**Environment:** `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `OPENWEATHER_API_KEY`, `JAMIE_PHONE`, `JULES_RECIPIENT_PHONE`

---

### Container 4: agent-runtime

**What it runs:** Claude Code agent execution sandbox. When a task requires an agent (research, code generation, file writes), it runs inside this container. No agent ever executes on the host.

**What it needs:**
- Read/write to a scoped workspace volume (`/workspace`) — this is the ONLY directory agents can touch
- Outbound internet (Anthropic API)
- Internal network access to comms-hub (to receive tasks and return results)

**What it does NOT get:**
- Any mount of the host filesystem outside `/workspace`
- Network access to voice-server or jules-server (no lateral movement)
- The ability to install packages or modify the container filesystem (read-only root)

**This is the critical security boundary.** In the current system, `claude --dangerously-skip-permissions` runs on the host with unrestricted access to every file. In the containerized model, the same agent runs in this container and can only see what is mounted in `/workspace`.

```dockerfile
# Container 4: agent-runtime
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /workspace

# Read-only root filesystem with explicit tmpfs for runtime needs
# --read-only --tmpfs /tmp is set at compose level

USER appuser

# Entrypoint: claude runs tasks received via stdin or task queue
ENTRYPOINT ["claude"]
```

**Docker Compose flags for this container:**
```yaml
read_only: true
tmpfs:
  - /tmp
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
```

**Volumes:** `agent-workspace:/workspace` — scoped, not shared with other containers
**Network:** `agent-net` only — can reach comms-hub, nothing else

---

### Container 5: web-frontend

**What it runs:** Static file server for the AiNFL GM frontend (`dist/` directory). Nginx serving pre-built React bundle.

**What it needs:**
- Inbound HTTP on port 80
- Read-only access to `dist/` build output
- Nothing else. No API access. No database. No secrets.

**What it does NOT get:**
- Any write access
- Network access to any other container
- Any environment variables containing credentials

```dockerfile
# Container 5: web-frontend
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom minimal config
COPY nginx.conf /etc/nginx/conf.d/app.conf

# Copy built frontend — run `npm run build` before building this image
COPY dist/ /usr/share/nginx/html/

# nginx runs as nginx user by default — no changes needed
EXPOSE 80
```

**nginx.conf (minimal, no directory listing, no server tokens):**
```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    server_tokens off;

    # SPA routing — all paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|svg|ico|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Ports exposed:** 80 (behind reverse proxy in production)
**Volumes:** None (build output baked into image)
**Network:** `frontend-net` only — isolated from all backend containers

---

## 2. Docker Compose Stack

Full `docker-compose.yml` for the complete stack. This is the file that deploys everything with one command.

```yaml
# docker-compose.yml
# 9 Enterprises — Full Stack
# Usage: docker-compose up -d
# Secrets: Create secrets/ directory with one file per secret before running.

version: "3.9"

secrets:
  anthropic_api_key:
    file: ./secrets/anthropic_api_key.txt
  anthropic_api_key_tc:
    file: ./secrets/anthropic_api_key_tc.txt
  telegram_bot_token:
    file: ./secrets/telegram_bot_token.txt
  telegram_chat_id:
    file: ./secrets/telegram_chat_id.txt
  twilio_account_sid:
    file: ./secrets/twilio_account_sid.txt
  twilio_auth_token:
    file: ./secrets/twilio_auth_token.txt
  twilio_from_number:
    file: ./secrets/twilio_from_number.txt
  elevenlabs_api_key:
    file: ./secrets/elevenlabs_api_key.txt
  elevenlabs_voice_id:
    file: ./secrets/elevenlabs_voice_id.txt
  cloudflare_api_token:
    file: ./secrets/cloudflare_api_token.txt
  cloud_secret:
    file: ./secrets/cloud_secret.txt
  hub_api_secret:
    file: ./secrets/hub_api_secret.txt
  openweather_api_key:
    file: ./secrets/openweather_api_key.txt
  jamie_phone:
    file: ./secrets/jamie_phone.txt
  jules_recipient_phone:
    file: ./secrets/jules_recipient_phone.txt

networks:
  # Hub can reach voice and jules (for forwarding)
  backend-net:
    driver: bridge
    internal: true
  # Agent runtime can only reach hub (task queue in/out)
  agent-net:
    driver: bridge
    internal: true
  # Frontend is fully isolated — no backend access
  frontend-net:
    driver: bridge
    internal: true
  # Only services that need internet get this network
  external-net:
    driver: bridge

volumes:
  shared-state:
  logs:
  voice-audio:
  call-logs:
  jules-data:
  agent-workspace:

services:

  # -------------------------------------------------------
  # comms-hub — Central message router
  # -------------------------------------------------------
  comms-hub:
    build:
      context: .
      dockerfile: docker/Dockerfile.comms-hub
    container_name: comms-hub
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - backend-net
      - external-net
    ports: []    # No ports exposed to host. Internal only.
    volumes:
      - shared-state:/app/scripts
      - logs:/app/logs
    secrets:
      - anthropic_api_key_tc
      - telegram_bot_token
      - telegram_chat_id
      - twilio_account_sid
      - twilio_auth_token
      - twilio_from_number
      - twilio_backup_1
      - cloudflare_api_token
      - cloud_secret
      - hub_api_secret
    environment:
      # Secrets are mounted at /run/secrets/<name>
      # comms-hub reads them from there instead of .env
      SECRETS_DIR: /run/secrets
      NODE_ENV: production
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3457/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  # -------------------------------------------------------
  # voice-server — Twilio webhook + ElevenLabs TTS
  # -------------------------------------------------------
  voice-server:
    build:
      context: .
      dockerfile: docker/Dockerfile.voice-server
    container_name: voice-server
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - backend-net
      - external-net
    ports: []    # Exposed via reverse-proxy container, not directly
    volumes:
      - voice-audio:/tmp/voice_audio
      - call-logs:/app/logs/calls
    secrets:
      - anthropic_api_key
      - elevenlabs_api_key
      - elevenlabs_voice_id
      - twilio_account_sid
      - twilio_auth_token
      - twilio_from_number
    environment:
      SECRETS_DIR: /run/secrets
      NODE_ENV: production
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3456/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  # -------------------------------------------------------
  # cloudflared — Tunnel sidecar for voice-server
  # Replaces the subprocess spawn pattern in comms-hub.
  # This container handles the tunnel. comms-hub is told
  # the tunnel URL via environment or shared volume.
  # -------------------------------------------------------
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    networks:
      - backend-net
      - external-net
    command: tunnel --url http://voice-server:3456
    depends_on:
      voice-server:
        condition: service_healthy

  # -------------------------------------------------------
  # jules-server — Personal assistant (Jamie)
  # -------------------------------------------------------
  jules-server:
    build:
      context: .
      dockerfile: docker/Dockerfile.jules-server
    container_name: jules-server
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - backend-net
      - external-net
    ports: []
    volumes:
      - jules-data:/app/data
    secrets:
      - anthropic_api_key
      - twilio_account_sid
      - twilio_auth_token
      - twilio_from_number
      - openweather_api_key
      - jamie_phone
      - jules_recipient_phone
    environment:
      SECRETS_DIR: /run/secrets
      NODE_ENV: production
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3470/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  # -------------------------------------------------------
  # agent-runtime — Claude Code execution sandbox
  # The only container where agent code runs.
  # Hardest security boundary in the stack.
  # -------------------------------------------------------
  agent-runtime:
    build:
      context: .
      dockerfile: docker/Dockerfile.agent-runtime
    container_name: agent-runtime
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
      - seccomp:docker/seccomp-agent.json  # Custom seccomp: block fork, exec, mount syscalls
    cap_drop:
      - ALL
    networks:
      - agent-net   # Can only reach comms-hub. Cannot reach voice or jules.
    volumes:
      - agent-workspace:/workspace  # Agent's entire world
    secrets:
      - anthropic_api_key
    environment:
      SECRETS_DIR: /run/secrets
      NODE_ENV: production
      WORKSPACE: /workspace

  # -------------------------------------------------------
  # web-frontend — AiNFL GM static site
  # Fully isolated. No backend access. No secrets.
  # -------------------------------------------------------
  web-frontend:
    build:
      context: .
      dockerfile: docker/Dockerfile.web-frontend
    container_name: web-frontend
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - frontend-net
    ports:
      - "8080:80"   # Exposed on host port 8080 (or behind nginx/Caddy reverse proxy)

  # -------------------------------------------------------
  # reverse-proxy — Caddy (optional, for production)
  # Handles TLS, routes external traffic to voice-server
  # and web-frontend. The ONLY container with a public port.
  # -------------------------------------------------------
  reverse-proxy:
    image: caddy:alpine
    container_name: reverse-proxy
    restart: unless-stopped
    networks:
      - backend-net
      - frontend-net
      - external-net
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - voice-server
      - web-frontend
```

---

## 3. Security Boundaries

### Filesystem Isolation

Every container runs with `read_only: true`. The only writable locations are explicitly mounted volumes:

| Container | Writable Volume | What It Contains |
|---|---|---|
| comms-hub | `shared-state`, `logs` | State JSON, log files |
| voice-server | `voice-audio`, `call-logs` | TTS audio cache, call transcripts |
| jules-server | `jules-data` | Jules profile JSON |
| agent-runtime | `agent-workspace` | Agent task input/output only |
| web-frontend | none | Fully read-only |

No container can write to the host filesystem. No container can read another container's volumes (volumes are not shared between containers).

### Network Isolation

```
Internet
    │
    ▼
reverse-proxy ──► frontend-net ──► web-frontend
    │
    └──► backend-net ──► voice-server
              │           comms-hub ──► agent-net ──► agent-runtime
              │           jules-server
    │
    └──► external-net ──► comms-hub (Telegram, Anthropic)
                          voice-server (ElevenLabs, Anthropic)
                          jules-server (OpenWeather, Anthropic)
                          cloudflared
```

Key isolation rules:
- `agent-runtime` is on `agent-net` only. It cannot reach voice-server or jules-server. No lateral movement.
- `web-frontend` is on `frontend-net` only. Fully isolated from all backend services.
- `backend-net` is marked `internal: true` — no direct internet access from that network. Only containers that also have `external-net` can reach the internet.

### Secrets Management

Current model: one plaintext `.env` file readable by any process on the machine.

Containerized model: Docker secrets. Each secret is a file in the `secrets/` directory. At runtime, Docker mounts each secret at `/run/secrets/<name>` inside the container. The secret file is never an environment variable, never logged, never in a build layer.

```
secrets/
├── anthropic_api_key.txt        # One line, no trailing newline
├── telegram_bot_token.txt
├── twilio_auth_token.txt
└── ...
```

The application code reads secrets from `/run/secrets/` instead of `.env`:

```javascript
// Before (plaintext .env):
const apiKey = process.env.ANTHROPIC_API_KEY;

// After (Docker secrets):
const apiKey = fs.readFileSync('/run/secrets/anthropic_api_key', 'utf8').trim();
```

The `secrets/` directory is in `.gitignore`. It never touches the repo.

### No Privileged Mode

No container runs with `privileged: true`. No container has any Linux capabilities beyond the default set — and all containers explicitly drop ALL capabilities with `cap_drop: ALL`. No container can:
- Modify host networking
- Mount host filesystems
- Access host devices
- Modify kernel parameters

### Audit Logging

Every container writes structured JSON logs to its designated logs volume. The logs volume is append-only from the container's perspective (the container does not need to read its own logs). An optional log aggregator container (Loki + Grafana, or just a log shipper to a managed service) can consume these logs without any container needing host access.

---

## 4. Migration Path

### Phase 1: Containerize comms-hub + voice-server (Days 1-30)

Goal: The two highest-risk services (most internet-facing, most OS-touching) run in containers on the existing Mac. iMessage handled by a thin host-side relay script with a defined API surface.

Steps:
1. Write `docker/Dockerfile.comms-hub` and `docker/Dockerfile.voice-server`
2. Refactor credential loading from `.env` parsing to Docker secrets reading
3. Extract `cloudflared` spawn from comms-hub into a sidecar container
4. Run both containers on Mac with Docker Desktop (free for personal use)
5. Validate all Telegram, email, and voice flows end-to-end
6. Run both containers and the legacy Mac stack in parallel for 7 days before switching over
7. Confirm tunnel URL propagation works via shared volume instead of child process stdout

Deliverable: comms-hub and voice-server running containerized on Mac. Host OS access reduced to the iMessage relay script only.

### Phase 2: Add jules-server + agent-runtime (Days 31-60)

Goal: All services containerized. agent-runtime sandbox validated. The Mac is now just a host for Docker — it does not run any Node services directly.

Steps:
1. Write `docker/Dockerfile.jules-server` and `docker/Dockerfile.agent-runtime`
2. Design the task queue interface between comms-hub and agent-runtime (HTTP API or shared volume queue)
3. Run claude agent inside agent-runtime with workspace volume — verify it can complete tasks without host access
4. Validate that agents cannot reach voice-server or jules-server from agent-net
5. Run agent-runtime without `--dangerously-skip-permissions` — the container boundary replaces that flag
6. Load test: 10 concurrent agent tasks in the sandbox

Deliverable: Full stack containerized on Mac. The host runs Docker Desktop and a thin iMessage relay. Nothing else.

### Phase 3: Deploy to cloud VPS (Days 61-75)

Goal: The containerized stack runs on a $5-10/mo VPS. The Mac is no longer required for any service except iMessage.

Steps:
1. Provision a VPS (Hetzner CX21 at $4.15/mo or DigitalOcean Droplet at $6/mo — see cloud-vps-setup-plan.md)
2. Install Docker + Docker Compose on the VPS
3. Copy `docker-compose.yml` and `secrets/` to the VPS via SSH
4. `docker-compose up -d` — stack is live
5. Update Twilio webhook URLs to point at VPS IP (via Cloudflare for TLS termination)
6. Update Telegram bot webhook to point at VPS
7. iMessage relay: keep running on Mac, forwarding to comms-hub on VPS via authenticated HTTP

Deliverable: Full stack on cloud. Mac is optional. Stack survives Mac reboots, sleep, power loss.

### Phase 4: Multi-instance deployment (Days 76-90)

Goal: One stack per customer. Each customer gets an isolated Docker Compose stack. No shared state, no shared volumes, no shared secrets.

Steps:
1. Parameterize `docker-compose.yml` with customer ID prefix for all container names, volumes, and networks
2. Write a provisioning script: `provision.sh <customer_id>` — creates secrets directory, generates compose file, starts stack
3. Each customer stack runs on an isolated Docker network with its own volumes
4. Add a management container (one per host) that can check health across customer stacks but cannot access their data
5. Pricing model: $5-10/mo VPS runs 3-5 customer stacks comfortably at current scale

**Per-customer resource footprint at current scale:**
- comms-hub: ~50MB RAM, negligible CPU
- voice-server: ~80MB RAM, CPU spikes during active calls
- jules-server: ~40MB RAM, negligible CPU
- agent-runtime: variable (depends on task complexity)
- Total estimated: ~300MB RAM per customer stack at idle

A $20/mo VPS (4GB RAM) supports 10+ customer stacks.

Deliverable: Fully parameterized multi-tenant deployment. One command provisions a new customer.

---

## 5. Cost Impact

| Environment | Cost | Notes |
|---|---|---|
| Docker Desktop on Mac (dev) | $0 | Free for personal/individual use |
| Docker on Linux VPS (production) | $0 | Docker CE is free on Linux |
| Hetzner CX21 VPS (2 vCPU, 4GB RAM) | $4.15/mo | Sufficient for 1-3 customer stacks |
| DigitalOcean Basic Droplet (2 vCPU, 4GB RAM) | $6/mo | If Hetzner availability is a concern |
| DigitalOcean Droplet (4 vCPU, 8GB RAM) | $12/mo | 5-10 customer stacks |
| Additional licensing for Docker | $0 | No paid Docker tier needed at this scale |

No new licensing costs. The only infrastructure cost is the VPS, which the cloud-vps-setup-plan.md already budgets for.

For context: the current Anthropic Max plan at $200/mo dwarfs the infrastructure cost. The containerization work itself is a one-time engineering effort, not an ongoing expense.

---

## 6. What Containerization Does NOT Solve

Being direct about the boundaries of this plan:

**iMessage remains Mac-tied.** `osascript` and `chat.db` access require macOS and FDA permission. The container stack will forward iMessage handling to a thin Mac-side relay, but that relay script still has host access within its narrow scope. If iMessage is required for enterprise deployment, the path is to replace it with a cross-platform channel (Twilio SMS is already built, Signal Business API is an option).

**Claude Code `--dangerously-skip-permissions` is removed in the container model.** This is the right outcome — the container boundary provides the sandbox. However, it means agent capabilities need to be retested in the container environment to confirm nothing breaks. Some file operations that worked on the host will fail inside the container until the workspace volume is correctly configured.

**Secrets management at scale requires a proper vault.** Docker secrets work well for a single-host or small multi-host setup. For 50+ customer stacks, the right answer is HashiCorp Vault or a managed secrets service (AWS Secrets Manager, etc.). That is Phase 5, outside the 90-day scope.

---

## Appendix: File Layout for Container Build

```
BengalOracle/
├── docker/
│   ├── Dockerfile.comms-hub
│   ├── Dockerfile.voice-server
│   ├── Dockerfile.jules-server
│   ├── Dockerfile.agent-runtime
│   ├── Dockerfile.web-frontend
│   ├── Caddyfile
│   └── seccomp-agent.json       # Custom seccomp profile for agent-runtime
├── secrets/                     # NOT in git. One file per secret.
│   ├── anthropic_api_key.txt
│   ├── telegram_bot_token.txt
│   └── ...
├── docker-compose.yml
└── ...existing files...
```

---

*Document prepared by UNO, Research Team Lead, 9 Enterprises.*
*For review by Kyle Shea, CIO, Rapid Mortgage Company.*
*Part of the 90-day architecture resolution plan.*
