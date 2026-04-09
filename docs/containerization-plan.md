# 9 Enterprises — Containerization Plan

**Version:** 1.0
**Date:** 2026-04-09
**Author:** Tee (Engineering Team Lead, 9 Enterprises)
**Status:** APPROVED FOR IMPLEMENTATION
**Supersedes:** `docs/docker-containerization-plan.md` (March 26, 2026 — pre-audit, incomplete service inventory)

---

## Executive Summary

The 9 Enterprises universe currently runs 11 services directly on a single MacBook Pro — no process isolation, no network segmentation, no secrets management, one plaintext credential file with 44 environment variables including live trading keys and payment card data. Every service dies when the Mac sleeps.

This plan containerizes the entire stack using Docker, eliminates the Mac as a single point of failure, enforces strict network and filesystem isolation per service, and migrates secrets from a plaintext `.env` file to Docker-managed secrets. The end state is a portable, cloud-deployable stack that starts with `docker-compose up` on any Linux host.

Timeline: 75 days across three phases. No new licensing costs. Infrastructure cost: $6-12/month on a VPS.

---

## 1. Current State Assessment

### 1.1 Live Service Inventory (as of April 5, 2026 audit)

| Service | Script | Port | Launch Method | Auto-restart | Status |
|---------|--------|------|---------------|--------------|--------|
| comms-hub | `scripts/comms-hub.mjs` | 3457 | LaunchAgent | Yes | LIVE |
| voice-server | `scripts/voice-server.mjs` | 3456 | LaunchAgent | Yes | LIVE |
| pilot-server | `scripts/pilot-server.mjs` | 3472 | LaunchAgent | Yes | LIVE |
| health-monitor | `scripts/health-monitor.mjs` | 3458 | LaunchAgent plist | Yes (plist) | NOT RUNNING |
| jules-telegram | `scripts/jules-telegram.mjs` | — | Manual | No | LIVE |
| kids-mentor | `scripts/kids-mentor.mjs` | — | Manual | No | LIVE |
| trader9-bot | `scripts/trader9-bot.mjs` | — | Manual | No | LIVE |
| trinity-agent | `scripts/trinity-agent.mjs` | — | Manual | No | LIVE |
| underwriter-api | `scripts/underwriter-api.mjs` | 3471 | Manual | No | LIVE |
| cloud-worker | `cloud-worker/src/worker.js` | — | Cloudflare Edge | Always-on | NOT DEPLOYED |
| command-hub | `command-hub/` (Next.js) | — | None | No | BUILT, NOT SERVING |

**Five of eleven services have no auto-restart.** A single Mac crash or reboot silently stops all trading, all agent discovery, and the personal assistant for the pilot user — with no alert.

### 1.2 Dependency Structure

All services share a single Mac host. The critical dependency chain:

```
MacBook Pro (SPOF)
    ├── comms-hub:3457          ← central orchestrator
    │   ├── Anthropic API
    │   ├── Telegram Bot API
    │   ├── Twilio (iMessage bridge)
    │   ├── Gmail SMTP
    │   ├── Supabase (cloud mirror)
    │   ├── Neon PostgreSQL (backup)
    │   └── data/9-memory.db (SQLite)
    ├── voice-server:3456        ← Twilio webhook
    │   ├── Anthropic API
    │   ├── ElevenLabs TTS
    │   └── cloudflared (subprocess, ephemeral URL)
    ├── pilot-server:3472        ← FreeAgent9 (Kyle Cabezas)
    │   ├── Anthropic API
    │   ├── Twilio SMS
    │   └── OpenWeatherMap
    ├── underwriter-api:3471     ← Mortgage Q&A, NO AUTH
    │   └── Anthropic API
    ├── jules-telegram            ← Jasson personal assistant
    ├── kids-mentor               ← Bengal Pro (iMessage, requires FDA)
    ├── trader9-bot               ← Alpaca trading ($333 paper + live keys present)
    └── trinity-agent             ← 15-min discovery scan
```

**Mac = P0 BLACKOUT.** Every service listed above dies on Mac power loss, kernel panic, or hard reboot. The cloud-worker (not deployed) is the only mitigation, and it is not live.

### 1.3 Credential Exposure Summary

The `.env` file contains 44 environment variables, loaded by every service on the same host. Notable risks from the April 5 credential audit:

| Severity | Issue | Vars |
|----------|-------|------|
| CRITICAL | Payment card data in `.env` (PCI violation) | `DOMINOS_CARD_NUMBER`, `DOMINOS_CARD_CVV`, `DOMINOS_CARD_EXPIRY`, `DOMINOS_CARD_ZIP` |
| CRITICAL | Live trading keys activate automatically when present | `ALPACA_LIVE_API_KEY`, `ALPACA_LIVE_SECRET_KEY` |
| CRITICAL | Supabase service key bypasses all Row Level Security | `SUPABASE_SERVICE_KEY` |
| CRITICAL | Telegram bot token hardcoded in source file | `JULES_TELEGRAM_BOT_TOKEN` in `jules-telegram.mjs` |
| CRITICAL | SQLite encryption key co-located with the encrypted database | `SQLITE_ENCRYPTION_KEY` |
| HIGH | No `.env.example` exists — deployment requires reading all 44 vars from source code | All |
| HIGH | `HUB_API_SECRET` is optional; if unset, `/context` endpoint is open | `HUB_API_SECRET` |

Containerization directly solves the first three classes: secrets are no longer a flat file readable by every process on the machine. Each container receives only the secrets it needs, mounted read-only at runtime.

### 1.4 What Containerization Cannot Solve (Scoped Honestly)

**iMessage (kids-mentor, comms-hub).** Apple Messages requires `osascript` and Full Disk Access to `~/Library/Messages/chat.db`. These are macOS host capabilities that cannot be containerized. The containerization plan handles iMessage via a thin Mac-side bridge process with a defined, narrow API surface. If iMessage must survive a Mac-to-VPS migration entirely, the replacement path is Twilio SMS (already partially built in comms-hub) or a cross-platform messaging channel.

**Cloudflare tunnel ephemeral URL.** The current pattern has comms-hub spawn cloudflared as a child process and parse its stdout for the tunnel URL. Containerization replaces this with a dedicated cloudflared sidecar container. The ephemeral URL problem (every restart = new subdomain) is not solved by containerization — that requires a named Cloudflare tunnel (stable hostname). Named tunnel setup is noted in Phase 2.

**Claude Code terminal integration.** The `open-terminal.mjs` signal file watcher and the Claude Code CLI process are host-level Mac integrations. These are not containerized — they are scoped out of this plan and documented as Mac-only infrastructure.

---

## 2. Containerization Strategy

### 2.1 Approach: Docker First, Kubernetes Later

**Docker Compose is the correct tool for this stage.** The universe runs 11 services with modest resource requirements (~300MB RAM per tenant stack at idle). Kubernetes adds significant operational complexity (cluster management, YAML sprawl, scheduler overhead) that is not justified until the stack is running for 10+ tenants.

The architecture decision:

| Tool | When to use it |
|------|---------------|
| Docker Compose | Now through Phase 3. Single host (Mac or VPS). One operator. |
| Docker Swarm | Optional bridge if multi-host is needed before K8s readiness. |
| Kubernetes | When multi-tenant scale requires per-service autoscaling or the team exceeds 5 engineers maintaining the stack. Not before. |

All Dockerfiles and Compose configuration written now will translate directly to Kubernetes manifests when that threshold is reached. The migration cost is writing Deployment/Service/Secret YAML — the container images are identical.

### 2.2 Design Principles

1. **One container, one job.** No service bundles. comms-hub does not spawn voice-server. cloudflared is a sidecar, not a child process.

2. **Least privilege by default.** Every container: `read_only: true`, `cap_drop: ALL`, `no-new-privileges: true`, non-root user. Writable surfaces are explicit named volumes only.

3. **Secrets never in environment variables.** Docker secrets mount at `/run/secrets/<name>`. Application code reads from there, not `process.env`. Nothing is logged, nothing appears in `docker inspect`.

4. **Network segmentation enforced at the compose layer.** Services that do not need to communicate are on different networks with no shared bridge. The underwriter API (currently unauthenticated) gets no network path to the trading bot.

5. **Health checks on every service.** Docker restarts unhealthy containers. `comms-hub` and `voice-server` already expose `/health` endpoints — these map directly to Docker HEALTHCHECK directives.

6. **Portable by construction.** The final `docker-compose.yml` plus a populated `secrets/` directory is the complete deployment artifact. It runs identically on a Mac (Docker Desktop), a Linux VPS, or any cloud VM.

---

## 3. Containerization Priority Order

Priority is determined by three factors: security risk of current state, operational criticality, and migration complexity.

### Priority 1 — comms-hub + voice-server (Days 1-25)

**Why first:**
- comms-hub is the central orchestrator. It holds 15+ credentials including Supabase service key, Neon connection string, and Telegram token. It is the highest-value target if `.env` leaks.
- voice-server spawns cloudflared as a child process — the "subprocess spawning arbitrary binaries" pattern is the most significant OS-coupling to break.
- Both services have existing `/health` endpoints — HEALTHCHECK configuration is trivial.
- Both services have LaunchAgents (auto-restart already exists) — the Docker `restart: unless-stopped` policy is a direct equivalent.

**Migration complexity: Medium.** The primary work is refactoring credential loading from `process.env` (dotenv) to reading from `/run/secrets/`. The cloudflared spawn pattern requires extracting to a sidecar container.

### Priority 2 — pilot-server + underwriter-api (Days 26-40)

**Why second:**
- `pilot-server` (FreeAgent9) serves an active paying pilot user (Kyle Cabezas). It has Twilio HMAC-SHA1 webhook validation correctly implemented — the containerized version must preserve this. Priority is elevated because a crash here directly impacts a user relationship.
- `underwriter-api` is the most exposed unauthenticated service in the universe. Port 3471 is open with no auth on any endpoint. Containerizing it onto an internal-only Docker network with no external port binding eliminates the risk of accidental exposure through any future tunnel or proxy misconfiguration.

**Migration complexity: Low.** Both services have narrow dependency sets. `underwriter-api` reads static markdown files — these become a read-only volume mount.

### Priority 3 — trader9-bot + trinity-agent (Days 41-55)

**Why third:**
- `trader9-bot` carries live trading keys (`ALPACA_LIVE_API_KEY`) that currently auto-activate when the key is present in `.env`. In the containerized model, the live key is a separate Docker secret that is only populated in an explicitly configured "live trading" stack. Paper and live trading become distinct deployment configurations, not an implicit environment variable presence check.
- `trinity-agent` is lower risk (Anthropic API key only, no user-facing surface) but is a manual-start service with no auto-restart. Containerization brings it under `restart: unless-stopped` policy.

**Migration complexity: Low for trinity. Medium for trader9.** Trader9 requires designing the "live vs paper" secret split and validating that the circuit breaker file (`data/trader9-halt-until.txt`) persists correctly across container restarts via a named volume.

### Priority 4 — jules-telegram + kids-mentor (Days 56-65)

**Why fourth:**
- `jules-telegram` has a hardcoded bot token fallback in source code (C-05 from credential audit). Container migration requires removing the hardcoded fallback and enforcing secret-only credential loading. This is a code change, not just a Docker config change.
- `kids-mentor` has the iMessage/FDA dependency. It cannot be fully containerized. The container for this service runs the AI and file-writing logic; the iMessage read path stays as a Mac-side bridge process that feeds messages to the container via HTTP. This is the most architecturally complex migration in the stack.

**Migration complexity: Medium for jules-telegram. High for kids-mentor.**

### Priority 5 — health-monitor + command-hub (Days 66-75)

**Why last:**
- `health-monitor` is not currently running at all (LaunchAgent plist exists but process was not live at audit). Containerizing it during Phase 3 gives it a clean start under Docker's restart policy — no need to debug the LaunchAgent configuration.
- `command-hub` (Next.js dashboard) is built but not serving. It has no production deployment target. Containerizing it and deploying it behind the reverse proxy gives it its first production home.

**Migration complexity: Low for health-monitor. Medium for command-hub** (requires configuring Next.js for production, connecting to Supabase from inside the container network, and adding authentication before exposing externally).

---

## 4. Dockerfile Specifications — Top 5 Services

All images use `node:22-alpine` as the base: minimal attack surface, no shell utilities included by default, ~50MB base layer. All containers run as a non-root user created at build time.

---

### 4.1 comms-hub

```dockerfile
# docker/Dockerfile.comms-hub
FROM node:22-alpine

# Non-root user — never run as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependency manifests first (cache layer)
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy only the files this service needs
COPY scripts/comms-hub.mjs ./scripts/
COPY scripts/memory-db.mjs ./scripts/

# Create log directory with correct ownership
RUN mkdir -p /app/logs && chown -R appuser:appgroup /app/logs

# Switch to non-root
USER appuser

EXPOSE 3457

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3457/health || exit 1

ENTRYPOINT ["node", "scripts/comms-hub.mjs"]
```

**Runtime dependencies:** `dotenv`, `nodemailer`, `pg`, `@supabase/supabase-js`, `better-sqlite3`

**Secrets required (Docker secrets, mounted at `/run/secrets/`):**
`anthropic_api_key_tc`, `telegram_bot_token`, `telegram_chat_id`, `twilio_account_sid`, `twilio_auth_token`, `twilio_from_number`, `gmail_app_password`, `neon_database_url`, `supabase_url`, `supabase_anon_key`, `supabase_service_key`, `hub_api_secret`, `cloud_secret`, `cloud_worker_url`

**Code change required:** Replace all `process.env.VAR` reads with `/run/secrets/` reads. Create a `loadSecrets()` utility function that reads from the secrets directory — all scripts call this instead of `dotenv`. This is a one-time refactor shared across all services.

---

### 4.2 voice-server

```dockerfile
# docker/Dockerfile.voice-server
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts/voice-server.mjs ./scripts/

# voice-server uses only Node built-ins — no npm runtime deps
# Audio files land in a named volume, not /tmp, for persistence across restarts
RUN mkdir -p /app/voice_audio && chown -R appuser:appgroup /app/voice_audio

USER appuser

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3456/health || exit 1

ENTRYPOINT ["node", "scripts/voice-server.mjs"]
```

**Secrets required:** `anthropic_api_key`, `elevenlabs_api_key`, `elevenlabs_voice_id`, `twilio_account_sid`, `twilio_auth_token`

**Architecture change:** The current cloudflared spawn pattern (comms-hub spawns cloudflared as a child process, parses stdout for tunnel URL) is replaced by a dedicated `cloudflared` sidecar container (see Section 5). The tunnel URL is written to a shared volume that voice-server and comms-hub both mount read-only.

---

### 4.3 pilot-server (FreeAgent9)

```dockerfile
# docker/Dockerfile.pilot-server
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts/pilot-server.mjs ./scripts/

# Profile data persists via named volume — pre-populate from current data/jules-profile-kylec.json
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

USER appuser

EXPOSE 3472

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3472/health || exit 1

ENTRYPOINT ["node", "scripts/pilot-server.mjs"]
```

**Secrets required:** `anthropic_api_key`, `twilio_account_sid`, `twilio_auth_token`, `twilio_phone_number`, `jules_kylec_recipient_phone`, `openweather_api_key`

**Note on Twilio HMAC validation:** `pilot-server` correctly validates Twilio webhook signatures. The containerized version must receive the raw request body before any middleware parsing — this is preserved as-is in the Node.js HTTP handler. No changes required to the validation logic.

---

### 4.4 underwriter-api

```dockerfile
# docker/Dockerfile.underwriter-api
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts/underwriter-api.mjs ./scripts/

# Mortgage guidelines are static read-only files — baked into the image
# They do not contain credentials or PII
COPY mortgage-ai/ ./mortgage-ai/

USER appuser

EXPOSE 3471

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3471/health || exit 1

ENTRYPOINT ["node", "scripts/underwriter-api.mjs"]
```

**Secrets required:** `anthropic_api_key`

**Critical security note:** `underwriter-api` currently has no authentication on any endpoint. In the containerized deployment, it is bound to the internal Docker network only — no external port is published to the host. Access requires going through the reverse proxy, which is where authentication middleware (API key header, IP allowlist, or mTLS) must be added before this service is considered production-ready.

**Port binding:** `3471:3471` in the compose file is explicitly removed. Internal network only. The reverse proxy is the only entry point.

---

### 4.5 trader9-bot

```dockerfile
# docker/Dockerfile.trader9
FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts/trader9-bot.mjs ./scripts/

# Circuit breaker file and logs persist via named volume
RUN mkdir -p /app/data /app/logs && chown -R appuser:appgroup /app/data /app/logs

USER appuser

# No port — trader9 is outbound-only (Alpaca API + comms-hub notifications)

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=2 \
  CMD node -e "require('fs').accessSync('/app/data/trader9-halt-until.txt') || process.exit(0)" || exit 1

ENTRYPOINT ["node", "scripts/trader9-bot.mjs"]
```

**Secrets required (paper mode):** `alpaca_api_key`, `alpaca_secret_key`

**Secrets required (live mode — separate deployment config):** `alpaca_live_api_key`, `alpaca_live_secret_key`

**Live vs. paper separation:** The current model auto-activates live trading when `ALPACA_LIVE_API_KEY` is present in `.env`. In the containerized model, there are two distinct secret sets: `secrets/paper/` and `secrets/live/`. The compose file for paper trading does not include the live secrets. Live trading requires an explicit `docker-compose -f docker-compose.trader9-live.yml up` — an operator must consciously deploy the live config. No accidental activation.

---

## 5. Docker Compose — Local Development

This is the canonical `docker-compose.yml` for running the full stack locally (Mac with Docker Desktop) or on a VPS.

```yaml
# docker-compose.yml
# 9 Enterprises — Full Stack
# Usage: docker-compose up -d
# Prerequisites: Populate secrets/ directory (one file per secret, no trailing newlines)

version: "3.9"

# -------------------------------------------------------
# SECRETS
# Each secret is a file in ./secrets/
# Never committed to git. Listed in .gitignore.
# -------------------------------------------------------
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
  twilio_phone_number:
    file: ./secrets/twilio_phone_number.txt
  twilio_from_number:
    file: ./secrets/twilio_from_number.txt
  elevenlabs_api_key:
    file: ./secrets/elevenlabs_api_key.txt
  elevenlabs_voice_id:
    file: ./secrets/elevenlabs_voice_id.txt
  gmail_app_password:
    file: ./secrets/gmail_app_password.txt
  neon_database_url:
    file: ./secrets/neon_database_url.txt
  supabase_url:
    file: ./secrets/supabase_url.txt
  supabase_anon_key:
    file: ./secrets/supabase_anon_key.txt
  supabase_service_key:
    file: ./secrets/supabase_service_key.txt
  hub_api_secret:
    file: ./secrets/hub_api_secret.txt
  cloud_secret:
    file: ./secrets/cloud_secret.txt
  cloud_worker_url:
    file: ./secrets/cloud_worker_url.txt
  sqlite_encryption_key:
    file: ./secrets/sqlite_encryption_key.txt
  jules_kylec_recipient_phone:
    file: ./secrets/jules_kylec_recipient_phone.txt
  jules_telegram_bot_token:
    file: ./secrets/jules_telegram_bot_token.txt
  openweather_api_key:
    file: ./secrets/openweather_api_key.txt
  alpaca_api_key:
    file: ./secrets/alpaca_api_key.txt
  alpaca_secret_key:
    file: ./secrets/alpaca_secret_key.txt

# -------------------------------------------------------
# NETWORKS
# Internal networks have no external route.
# Only services that need internet get external-net.
# -------------------------------------------------------
networks:
  # Main backend bus — hub, voice, pilot, underwriter can communicate
  backend-net:
    driver: bridge
    internal: true
  # Internet access — only services with external API calls get this
  external-net:
    driver: bridge
  # Trader9 gets its own network — isolated from all backend HTTP services
  trading-net:
    driver: bridge
    internal: true
  # Frontend-only network — no backend access
  frontend-net:
    driver: bridge
    internal: true

# -------------------------------------------------------
# VOLUMES
# All writable surfaces are named volumes.
# No host filesystem mounts except for local dev overrides.
# -------------------------------------------------------
volumes:
  sqlite-data:        # data/9-memory.db
  shared-state:       # scripts/shared-state.json
  comms-logs:         # logs/comms-hub.log
  voice-audio:        # /tmp/voice_audio (TTS cache)
  voice-logs:         # logs/calls
  pilot-data:         # data/jules-profile-kylec.json
  trinity-logs:       # logs/trinity.log + trinity-findings.json
  trader9-data:       # data/trader9-halt-until.txt
  trader9-logs:       # logs/trader9.log
  jules-data:         # data/jules-profile-jasson.json
  tunnel-url:         # Shared volume: cloudflared writes URL, hub reads it
  caddy-data:
  caddy-config:

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
    volumes:
      - sqlite-data:/app/data
      - shared-state:/app/scripts/state
      - comms-logs:/app/logs
      - tunnel-url:/app/tunnel:ro    # Read the tunnel URL written by cloudflared sidecar
    secrets:
      - anthropic_api_key_tc
      - telegram_bot_token
      - telegram_chat_id
      - twilio_account_sid
      - twilio_auth_token
      - twilio_from_number
      - gmail_app_password
      - neon_database_url
      - supabase_url
      - supabase_anon_key
      - supabase_service_key
      - hub_api_secret
      - cloud_secret
      - cloud_worker_url
      - sqlite_encryption_key
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3457/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    depends_on:
      - health-monitor

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
    volumes:
      - voice-audio:/app/voice_audio
      - voice-logs:/app/logs/calls
    secrets:
      - anthropic_api_key
      - elevenlabs_api_key
      - elevenlabs_voice_id
      - twilio_account_sid
      - twilio_auth_token
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3456/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  # -------------------------------------------------------
  # cloudflared — Tunnel sidecar for voice-server
  # Replaces the subprocess spawn pattern in comms-hub.
  # Writes the tunnel URL to a shared volume.
  # -------------------------------------------------------
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    networks:
      - backend-net
      - external-net
    command: >
      tunnel --url http://voice-server:3456
      --no-autoupdate
      --logfile /tunnel/cloudflared.log
    volumes:
      - tunnel-url:/tunnel    # comms-hub reads cloudflared.log to extract URL
    depends_on:
      voice-server:
        condition: service_healthy

  # -------------------------------------------------------
  # pilot-server — FreeAgent9 (Kyle Cabezas SMS)
  # -------------------------------------------------------
  pilot-server:
    build:
      context: .
      dockerfile: docker/Dockerfile.pilot-server
    container_name: pilot-server
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
    volumes:
      - pilot-data:/app/data
    secrets:
      - anthropic_api_key
      - twilio_account_sid
      - twilio_auth_token
      - twilio_phone_number
      - jules_kylec_recipient_phone
      - openweather_api_key
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3472/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  # -------------------------------------------------------
  # underwriter-api — Mortgage Q&A (INTERNAL ONLY)
  # No external port binding. Internal network only.
  # -------------------------------------------------------
  underwriter-api:
    build:
      context: .
      dockerfile: docker/Dockerfile.underwriter-api
    container_name: underwriter-api
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - backend-net    # Internal only — no external-net
      - external-net   # Needs Anthropic API
    # NO ports mapping to host — internal access only via reverse proxy with auth
    secrets:
      - anthropic_api_key
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3471/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  # -------------------------------------------------------
  # trader9-bot — Algorithmic trading (Alpaca paper)
  # Isolated on trading-net — cannot reach other services
  # except comms-hub for notifications.
  # -------------------------------------------------------
  trader9-bot:
    build:
      context: .
      dockerfile: docker/Dockerfile.trader9
    container_name: trader9-bot
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - trading-net    # Isolated — can only reach comms-hub for notifications
      - external-net   # Needs Alpaca API
    volumes:
      - trader9-data:/app/data
      - trader9-logs:/app/logs
    secrets:
      - alpaca_api_key
      - alpaca_secret_key
      # Note: alpaca_live_api_key and alpaca_live_secret_key are NOT included here.
      # Live trading requires docker-compose.trader9-live.yml — explicit operator action.
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets

  # -------------------------------------------------------
  # trinity-agent — Discovery agent (15-min scan cycle)
  # -------------------------------------------------------
  trinity-agent:
    build:
      context: .
      dockerfile: docker/Dockerfile.trinity
    container_name: trinity-agent
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
    volumes:
      - trinity-logs:/app/logs
    secrets:
      - anthropic_api_key
      - hub_api_secret
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets

  # -------------------------------------------------------
  # jules-telegram — Jasson personal assistant (Telegram)
  # -------------------------------------------------------
  jules-telegram:
    build:
      context: .
      dockerfile: docker/Dockerfile.jules-telegram
    container_name: jules-telegram
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - external-net
    volumes:
      - jules-data:/app/data
    secrets:
      - jules_telegram_bot_token    # Replaces the hardcoded fallback in source
      - anthropic_api_key
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets

  # -------------------------------------------------------
  # health-monitor — Service health polling + alerting
  # -------------------------------------------------------
  health-monitor:
    build:
      context: .
      dockerfile: docker/Dockerfile.health-monitor
    container_name: health-monitor
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
    volumes:
      - sqlite-data:/app/data:ro    # Read-only access to check DB health
    secrets:
      - hub_api_secret
    environment:
      NODE_ENV: production
      SECRETS_DIR: /run/secrets

  # -------------------------------------------------------
  # reverse-proxy — Caddy (TLS termination + routing)
  # The ONLY container with public-facing ports.
  # -------------------------------------------------------
  reverse-proxy:
    image: caddy:2-alpine
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
      - pilot-server
```

---

## 6. Migration Path — Mac to Containerized

### Phase 1: Containerize Core Infrastructure on Mac (Days 1-25)

**Target services:** comms-hub, voice-server, cloudflared sidecar

**Goal:** The two highest-credential services run containerized on the existing Mac alongside Docker Desktop. iMessage channel continues via a thin host-side relay process (not containerized) with a defined HTTP API surface.

**Steps:**

1. Install Docker Desktop on Mac (free for personal/individual use)
2. Create `docker/` directory with Dockerfiles for comms-hub and voice-server
3. Write `loadSecrets()` utility — reads from `/run/secrets/` instead of `process.env`. This is the one-time credential refactor shared across all services.
4. Update `comms-hub.mjs` and `voice-server.mjs` to call `loadSecrets()` instead of `dotenv`
5. Remove hardcoded bot token fallback from `jules-telegram.mjs` (C-05 fix, included here as a prerequisite)
6. Populate `secrets/` directory from current `.env` values (this is done once, locally — `.gitignore` already excludes it)
7. Build images: `docker build -f docker/Dockerfile.comms-hub -t comms-hub:v1 .`
8. Run containers alongside existing Mac processes for 7-day parallel operation
9. Validate all Telegram, email, voice, and Supabase sync flows end-to-end
10. Cut over: stop LaunchAgents for comms-hub and voice-server, `docker-compose up -d`

**Success criteria:** All existing comms-hub health checks pass. Telegram polling, iMessage relay, voice calls, and Supabase sync confirmed working through the container stack. No degradation versus the bare-metal baseline over 72 hours.

**Risk:** iMessage relay architecture change. The current pattern has comms-hub read `~/Library/Messages/chat.db` directly (requires FDA). In the container, comms-hub cannot reach the host filesystem. A thin Mac-side script (`scripts/imessage-bridge.mjs`) reads chat.db and forwards new messages to comms-hub's HTTP API via `POST /imessage-inbound`. This script is intentionally not containerized — it is the documented Mac dependency.

---

### Phase 2: Services 3-7 + Named Tunnel (Days 26-55)

**Target services:** pilot-server, underwriter-api, trader9-bot, trinity-agent, jules-telegram

**Goal:** All seven runtime services containerized on Mac. The cloudflared quick tunnel (ephemeral URL problem) is replaced with a named Cloudflare tunnel (stable hostname — one-time setup with a Cloudflare API token).

**Named tunnel setup (resolves the ephemeral URL problem permanently):**
```bash
# Run once — creates a named tunnel with a stable subdomain
cloudflare tunnel login
cloudflare tunnel create 9-voice
cloudflare tunnel route dns 9-voice voice.9enterprises.ai
```
The named tunnel is configured in the cloudflared sidecar container via `cloudflared.yaml` — no more dynamic URL parsing, no more Twilio webhook updates on every restart.

**Trader9 live/paper separation:** Create `docker-compose.trader9-live.yml` as a compose override file. The base `docker-compose.yml` contains paper trading secrets only. To run live trading, an operator runs `docker-compose -f docker-compose.yml -f docker-compose.trader9-live.yml up -d trader9-bot`. The live keys are never present in the default stack.

**Success criteria:** All services running containerized on Mac. `docker ps` shows all containers healthy. `docker stats` shows total RAM usage < 1GB idle. Trader9 paper trading cycle completes normally. Jules-telegram responds to messages. Trinity agent posts findings to comms-hub.

---

### Phase 3: VPS Migration + Production Hardening (Days 56-75)

**Goal:** The containerized stack runs on a $6-12/month cloud VPS. The Mac is no longer required for any service except iMessage bridging. The Mac becomes optional infrastructure.

**VPS provisioning:**
- Recommended: DigitalOcean Basic Droplet — 2 vCPU, 4GB RAM, $12/mo (supports 5+ tenant stacks)
- Alternative: Hetzner CX22 — 2 vCPU, 4GB RAM, $4.15/mo (European data center)
- Requirement: Ubuntu 22.04 LTS, Docker CE + Docker Compose Plugin, UFW firewall

**Migration steps:**

1. Provision VPS. Configure UFW: allow 22 (SSH), 80 (HTTP), 443 (HTTPS), deny all else.
2. Copy deployment artifacts to VPS via SSH: `docker-compose.yml`, `docker/` Dockerfiles, `secrets/` directory
3. Build images on VPS: `docker-compose build`
4. Start stack: `docker-compose up -d`
5. Configure Caddy reverse proxy with TLS for voice and pilot-server endpoints
6. Update Twilio webhook URLs from quick tunnel to named tunnel stable hostname (one-time, permanent)
7. Update Telegram bot webhook (if using webhook mode instead of polling)
8. Update iMessage bridge: `imessage-bridge.mjs` on Mac forwards to VPS IP instead of localhost
9. Run 7-day parallel operation: both Mac (legacy) and VPS (container) stacks active
10. Cut over: `launchctl unload` all LaunchAgents on Mac. Docker stack on VPS is the system of record.

**Success criteria:** All services running on VPS for 72 hours with no degradation. comms-hub health endpoint returns healthy. Voice calls connect via named tunnel. Trader9 paper cycle completes. iMessage relay forwarding works from Mac to VPS. DR plan Scenario 1 (Mac power loss) retested — comms-hub on VPS survives Mac shutdown with no service interruption.

---

## 7. Security Considerations

### 7.1 Secrets Management

**Current state:** One `.env` file. 44 variables. Every service reads all of them. A single file compromise exposes live trading keys, Supabase service key, payment card data, and full email access simultaneously.

**Containerized state:** Docker secrets. Each secret is a separate file mounted at `/run/secrets/<name>` inside the container that needs it. Container isolation means:
- `trader9-bot` can only read Alpaca keys — it cannot read the Telegram token
- `underwriter-api` can only read the Anthropic key — it cannot read Supabase credentials
- `web-frontend` (AiNFLGM) reads no secrets at all

**Secret population procedure:**
```bash
# One-time setup: populate secrets/ from current .env
# Run this on the machine with the .env file. Never commit secrets/ to git.
mkdir -p secrets
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  echo -n "$value" > "secrets/${key,,}.txt"
done < .env
```

**What to do with the existing `.env`:** After secrets are populated and the container stack is validated, the `.env` file should be moved out of the project directory and stored in 1Password or an equivalent vault. It should not exist in the project directory on a production VPS.

**At scale (10+ tenants):** Docker secrets are adequate for single-host and small multi-host deployments. At 10+ tenants, migrate to HashiCorp Vault or AWS Secrets Manager. This is out of scope for the current 75-day plan but the container-native secrets reading pattern (`/run/secrets/`) makes this migration straightforward — only the secret provider changes, not the application code.

### 7.2 Network Isolation

The Docker network model enforces service boundaries that currently do not exist:

| Service | Can Reach | Cannot Reach |
|---------|-----------|-------------|
| comms-hub | voice-server, pilot-server, health-monitor, Anthropic, Telegram | trader9 internals, underwriter data |
| voice-server | Anthropic, ElevenLabs, Twilio | comms-hub's SQLite data, trader9 |
| trader9-bot | Alpaca API, comms-hub (notifications only) | voice-server, underwriter-api, pilot data |
| underwriter-api | Anthropic API | All other services, all user data |
| jules-telegram | Telegram API, Anthropic API | All other services |

`internal: true` on backend-net and trading-net means those networks have no default route to the internet — only containers that also join `external-net` can make outbound API calls.

### 7.3 Container Hardening

Applied to every container in the stack:

```yaml
read_only: true                    # Container filesystem is read-only
tmpfs:
  - /tmp                           # Ephemeral /tmp in RAM only
security_opt:
  - no-new-privileges:true         # No setuid/setgid escalation
cap_drop:
  - ALL                            # Drop all Linux capabilities
user: appuser                      # Non-root execution
```

No container runs as root. No container can gain capabilities it was not started with. No container can write to the host filesystem.

### 7.4 Credential Hygiene Fixes Bundled with Migration

The following items from the April 5 credential audit are resolved during the migration:

| Issue | Resolution | Phase |
|-------|-----------|-------|
| C-01: Payment card data in `.env` | Remove `DOMINOS_*` vars from `.env` immediately. Do not migrate to secrets. | Before Phase 1 |
| C-04: Live trading keys auto-activate | Live keys moved to separate compose override. Not present in default stack. | Phase 2 |
| C-05: Telegram token hardcoded in source | Remove hardcoded fallback from `jules-telegram.mjs`. Secret-only loading. | Phase 1 |
| H-02: No `.env.example` exists | Create `.env.example` documenting all 44 vars. Generated during secrets population step. | Phase 1 |
| H-03: `HUB_API_SECRET` optional | Made required in container config. Compose file fails to start if secret file is missing. | Phase 1 |
| C-03: SQLite key co-located with DB | `SQLITE_ENCRYPTION_KEY` moved to Docker secret. SQLite DB stays in named volume. Key never on same filesystem as DB in production. | Phase 1 |

---

## 8. Timeline Estimate

| Phase | Duration | Services | Key Milestone |
|-------|----------|----------|---------------|
| Phase 1 | Days 1-25 | comms-hub, voice-server, cloudflared sidecar | Credential refactor complete. Core services containerized on Mac. iMessage bridge defined. |
| Phase 2 | Days 26-55 | pilot-server, underwriter-api, trader9-bot, trinity-agent, jules-telegram | All runtime services containerized. Named Cloudflare tunnel live. Live/paper trading split enforced. |
| Phase 3 | Days 56-75 | health-monitor, command-hub, full VPS migration | Stack running on VPS. Mac is optional. DR Scenario 1 retested and passing. |

**Total calendar time:** 75 days

**Engineering effort estimate:**
- Phase 1: ~40 hours (credential refactor is the heavyweight task — all subsequent services benefit from it)
- Phase 2: ~25 hours (Dockerfiles + compose config, trader9 live/paper split, named tunnel)
- Phase 3: ~15 hours (VPS provisioning, Caddy config, cutover, DR retest)

**Dependencies:** Phase 3 requires a Cloudflare API token with `Cloudflare Tunnel: Edit` permission (for named tunnel setup). This is a Jasson-owned Cloudflare account action.

---

## 9. Portability: Mac to VPS to Any Cloud

The containerization architecture is the portability layer. Once the stack runs in Docker Compose, the migration path to any target is:

```
Mac (current)
    │
    ▼ docker-compose.yml + secrets/ directory
    │
    ├── Linux VPS (Phase 3 target — $6-12/mo)
    │       docker-compose up -d
    │
    ├── AWS EC2 / Azure VM / Google Cloud Compute
    │       Identical — Docker CE + same compose file
    │
    ├── AWS ECS / Azure Container Instances
    │       Compose file translates via docker compose ecs
    │       Secrets migrate to AWS Secrets Manager / Azure Key Vault
    │
    └── Kubernetes (when scale justifies it)
            kompose convert generates K8s manifests from docker-compose.yml
            Secrets migrate to K8s Secrets or an external vault
```

**What remains Mac-specific after containerization:**
1. `imessage-bridge.mjs` — reads `~/Library/Messages/chat.db`, forwards to comms-hub HTTP API. This is the only remaining Mac dependency.
2. `open-terminal.mjs` — opens Terminal.app + Claude Code. This is 9's operator tooling, not a user-facing service. It stays on Mac by design.

Every other service in the universe is cloud-portable once containerized.

---

## Appendix A: File Layout After Containerization

```
BengalOracle/
├── docker/
│   ├── Dockerfile.comms-hub
│   ├── Dockerfile.voice-server
│   ├── Dockerfile.pilot-server
│   ├── Dockerfile.underwriter-api
│   ├── Dockerfile.trader9
│   ├── Dockerfile.trinity
│   ├── Dockerfile.jules-telegram
│   ├── Dockerfile.health-monitor
│   ├── Dockerfile.command-hub
│   ├── Caddyfile
│   └── cloudflared.yaml          # Named tunnel configuration
├── secrets/                       # NOT in git (.gitignore)
│   ├── anthropic_api_key.txt
│   ├── telegram_bot_token.txt
│   └── ...                        # One file per secret, no trailing newlines
├── docker-compose.yml             # Full stack (paper trading)
├── docker-compose.trader9-live.yml  # Override: activates live trading keys
├── .env.example                   # NEW: documents all 44 vars (no real values)
└── scripts/
    ├── imessage-bridge.mjs        # Mac-side bridge (not containerized)
    ├── loadSecrets.mjs            # NEW: shared utility — reads /run/secrets/
    └── ...existing scripts (refactored to use loadSecrets)
```

---

## Appendix B: .env.example (Required — Create in Phase 1)

```bash
# 9 Enterprises — Environment Variables
# Copy this file to create secrets/ directory (see containerization-plan.md)
# NEVER put real values in this file.

# ── Anthropic ──────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...         # Required. Used by: voice-server, jules-telegram, kids-mentor, pilot-server, trinity-agent, underwriter-api
ANTHROPIC_API_KEY_TC=sk-ant-...      # Required. Used by: comms-hub only. Separate key for terminal control mode.

# ── Telegram ───────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=...               # Required. Used by: comms-hub. Main 9 bot.
TELEGRAM_CHAT_ID=...                 # Required. Used by: comms-hub. Jasson's Telegram user ID.
JULES_TELEGRAM_BOT_TOKEN=...         # Required. Used by: jules-telegram. Separate personal assistant bot.

# ── Twilio ─────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=AC...             # Required. Used by: comms-hub, voice-server, pilot-server.
TWILIO_AUTH_TOKEN=...                # Required. Used by: comms-hub, voice-server, pilot-server.
TWILIO_FROM_NUMBER=+1...             # Required. Used by: comms-hub (iMessage bridge outbound).
TWILIO_PHONE_NUMBER=+1...            # Required. Used by: pilot-server (Kyle Cabezas SMS).

# ── ElevenLabs ─────────────────────────────────────────────────────────────
ELEVENLABS_API_KEY=...               # Required. Used by: voice-server.
ELEVENLABS_VOICE_ID=...              # Required. Used by: voice-server. Defaults to 4XMC8Vdi6YFsmti2NFdp if unset.

# ── Email ──────────────────────────────────────────────────────────────────
GMAIL_APP_PASSWORD=...               # Required. Used by: comms-hub. Gmail App Password (not account password).

# ── Database ───────────────────────────────────────────────────────────────
NEON_DATABASE_URL=postgresql://...   # Required. Used by: comms-hub. Full connection string with credentials.
SUPABASE_URL=https://...             # Required. Used by: comms-hub, command-hub.
SUPABASE_ANON_KEY=eyJ...             # Required. Used by: comms-hub, command-hub. Limited RLS access.
SUPABASE_SERVICE_KEY=eyJ...          # Required. Used by: comms-hub only. Bypasses RLS — treat as admin credential.
SQLITE_ENCRYPTION_KEY=...            # Optional. Used by: memory-db. If unset, SQLite runs unencrypted.

# ── Internal Auth ──────────────────────────────────────────────────────────
HUB_API_SECRET=...                   # Required (enforced in container). Protects /context endpoint.
CLOUD_SECRET=...                     # Required. Mutual auth between comms-hub and cloud worker.
CLOUD_WORKER_URL=https://...         # Required. URL of Cloudflare Worker backup.

# ── PII (phone numbers) ────────────────────────────────────────────────────
JASSON_PHONE=+1...                   # Required. Used by: comms-hub. PII — handle per GLBA if Rapid data involved.
JAMIE_PHONE=+1...                    # Required. Used by: comms-hub. PII.
JULES_KYLEC_RECIPIENT_PHONE=+1...    # Required. Used by: pilot-server. Customer PII.

# ── Trading ────────────────────────────────────────────────────────────────
ALPACA_API_KEY=...                   # Required. Used by: trader9-bot. Paper trading.
ALPACA_SECRET_KEY=...                # Required. Used by: trader9-bot. Paper trading.
ALPACA_LIVE_API_KEY=...              # DANGER: Only set this in docker-compose.trader9-live.yml. Activates real money trading.
ALPACA_LIVE_SECRET_KEY=...           # DANGER: Same as above.

# ── External APIs ──────────────────────────────────────────────────────────
OPENWEATHER_API_KEY=...              # Required. Used by: pilot-server. Weather briefings.

# ── Cloudflare Tunnel ──────────────────────────────────────────────────────
TUNNEL_URL=https://...               # Auto-managed after named tunnel setup. Do not set manually.
```

---

*Prepared by Tee, Engineering Team Lead, 9 Enterprises.*
*Source documents: `docs/dependency-map.md` (v2.0.0), `docs/dependency-map.json` (v2.0.0), `docs/credential-inventory.md`, `docs/disaster-recovery.md` (v1.0).*
*Part of the April 9, 2026 Foundation Hardening Sprint.*
