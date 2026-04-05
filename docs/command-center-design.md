# 9 Command Center — Design & Architecture Document
**Version:** 1.0  
**Author:** CANVAS (Design & Brand Agent)  
**Date:** 2026-04-05  
**Status:** Ready for engineering handoff

---

## 1. Mission Statement

The Command Center is Owner's remote nervous system for the entire 9 Enterprises universe. It provides full two-way control — read, respond, and execute — from any device, anywhere, as if sitting at the Mac running Terminal. It is built on top of the live health monitoring (`/health-dashboard`) and persistent memory (`9-memory.db`) systems, not around them.

**The benchmark:** Kyle Shea (CIO, Rapid Mortgage) looks at this and says "this is what enterprise software looks like."

---

## 2. Architecture

### 2.1 System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     OWNER'S DEVICES                          │
│         iPhone / iPad / MacBook (any browser)                │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Command Center Web App                     │    │
│  │         (React SPA — static build)                   │    │
│  │                                                      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐  │    │
│  │  │Dashboard │ │  Chat    │ │ Terminal │ │ Tasks │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────┘  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │    │
│  │  │  Memory  │ │  Audit   │ │ Settings │            │    │
│  │  └──────────┘ └──────────┘ └──────────┘            │    │
│  └─────────────────────┬───────────────────────────────┘    │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTPS (auth token in header)
                         │ WebSocket for real-time push
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE LAYER                            │
│                                                              │
│  ┌─────────────────────┐   ┌──────────────────────────┐     │
│  │  Cloudflare Pages   │   │   Cloudflare Worker      │     │
│  │  (static SPA host)  │   │   (API proxy + auth)     │     │
│  │                     │   │                          │     │
│  │  - Serves React app │   │  - Validates JWT/token   │     │
│  │  - CDN-cached assets│   │  - Proxies to hub        │     │
│  │  - Auto-deploys from│   │  - Rate limits            │     │
│  │    git main branch  │   │  - Blocks unauthenticated│     │
│  └─────────────────────┘   └─────────────┬────────────┘     │
└────────────────────────────────────────────┼─────────────────┘
                                             │ HTTPS via Cloudflare Tunnel
                                             │ (existing tunnel, port 3457)
                                             ▼
┌──────────────────────────────────────────────────────────────┐
│                   MAC — 9's EXECUTION LAYER                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              comms-hub.mjs (port 3457)               │   │
│  │                                                      │   │
│  │  Existing endpoints:                                 │   │
│  │    GET  /health           - system health            │   │
│  │    GET  /health-dashboard - component status + events│   │
│  │    GET  /state            - full hub state           │   │
│  │    GET  /inbox            - unread messages          │   │
│  │    POST /send             - send on any channel      │   │
│  │    POST /context          - update session context   │   │
│  │    GET  /db/context       - 24hr memory snapshot     │   │
│  │                                                      │   │
│  │  NEW endpoints (Phase 2):                            │   │
│  │    POST /command/run      - execute shell command    │   │
│  │    GET  /command/stream   - SSE stream for output    │   │
│  │    GET  /messages/history - paginated msg history    │   │
│  │    GET  /tasks            - task list from SQLite    │   │
│  │    POST /tasks/:id        - update task              │   │
│  │    GET  /memory/search    - search memory files      │   │
│  │    GET  /events/stream    - SSE for all live events  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌────────────────────────┐  ┌────────────────────────┐     │
│  │    9-memory.db         │  │   health-monitor       │     │
│  │    (SQLite — local)    │  │   (port 3458)          │     │
│  │    synced → Supabase   │  │   events + component   │     │
│  └────────────────────────┘  │   status               │     │
│                               └────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Tech Stack Decision

**Frontend: React (Vite) — plain React, NOT Next.js**

Rationale:
- Command Center is Owner-only, not a public site. SSR and SEO have zero value here.
- Vite builds a static bundle that deploys directly to Cloudflare Pages in seconds.
- No server-side runtime means no cold starts, no Node on Cloudflare Workers to manage.
- Next.js adds complexity (routing conventions, API routes, edge runtime concerns) that provide nothing here and increase engineering time.
- Result: faster to build, faster to deploy, simpler to debug.

**Styling: Plain CSS with CSS custom properties — same approach as 9enterprises.html**

Rationale: Eliminates build-time stylesheet complexity. Inter font via Google Fonts. No Tailwind, no CSS-in-JS, no external component libraries. Every pixel is ours to control.

**Real-time: Server-Sent Events (SSE) over WebSocket**

Rationale: Owner's use case is primarily read-heavy monitoring with occasional writes. SSE is unidirectional push (server to client), requires no WebSocket upgrade handshake, works cleanly through Cloudflare's proxy layer without sticky sessions, and is natively supported in all modern browsers. For sends and command execution (client to server) we use standard HTTP POST. This hybrid — SSE for push, HTTP for action — is simpler than bidirectional WebSocket and sufficient for the use case.

**Auth: TOTP (Time-based One-Time Password) — no passwords, no magic link dependency**

Rationale: Magic links require email delivery which adds an external dependency that can fail. TOTP (Google Authenticator / Authy style) is: offline-capable on the app, no email required, works on dead internet (phone only needs the app), and is a recognized enterprise auth pattern. Implementation: a single TOTP secret stored in `.env` on the Mac, validated by the Cloudflare Worker before any proxied request reaches the hub. No user database required.

**Hosting: Cloudflare Pages (frontend) + Cloudflare Worker (auth proxy)**

Rationale: Pages is free, globally CDN-distributed, auto-deploys from git, and pairs natively with Workers for edge auth. The existing Cloudflare Tunnel (already running) carries the Worker-to-hub traffic over HTTPS with no new infrastructure required.

### 2.3 Authentication Flow

```
Owner opens Command Center URL
         │
         ▼
React app loads (public static bundle — no sensitive data)
         │
         ▼
App checks localStorage for existing session token
    ├── Token exists + not expired → go to dashboard
    └── No token / expired → show TOTP login screen
              │
              ▼
         Owner enters 6-digit TOTP code
              │
              ▼
POST /auth/verify → Cloudflare Worker
    - Worker validates TOTP against secret in env
    - If valid: Worker generates signed JWT (24hr expiry)
    - JWT stored in localStorage on client
    - All subsequent API calls: Authorization: Bearer <jwt>
              │
              ▼
Cloudflare Worker validates JWT on every request
    └── If invalid or expired: 401 → client clears token, redirects to login
```

### 2.4 Real-Time Event Stream Architecture

```
React app connects to /events/stream via SSE (EventSource API)
         │
         ▼
Cloudflare Worker proxies SSE connection → hub tunnel
         │
         ▼
Hub /events/stream endpoint (NEW — Phase 2):
    - Writes to all connected SSE clients when:
        • New message arrives (Telegram in/out, iMessage, email)
        • Health event fires (component up/down/degraded)
        • Terminal state changes (relay ↔ autonomous)
        • Task created/updated/completed
        • 9 updates session context
    - Sends keepalive comment ": ping" every 20s
    - Client auto-reconnects on disconnect (browser SSE behavior)
```

### 2.5 Command Execution Security Model (Phase 2)

Remote terminal execution is the most sensitive surface in this system. The security model is explicit:

- All command execution requests require a valid JWT (same auth as everything else)
- Commands are executed via Node `child_process.exec()` inside the hub process — NOT a shell spawned from the web
- Output is streamed back via SSE on `/command/stream/:jobId`
- Hard blocklist of prohibited command patterns: `rm -rf /`, `curl *| bash`, `sudo`, credential file reads. Enforced server-side in the hub.
- Every command is logged to `9-memory.db` actions table with timestamp, command text, exit code, and truncated output
- Rate limit: max 1 concurrent command execution, 30 commands per hour

---

## 3. Visual Identity

### 3.1 Brand Foundation

**Bengals orange and black throughout.** This is not a stylistic choice — it is a brand mandate from Owner (March 28, 2026). The Command Center is a 9 Enterprises product. It carries the same brand identity as every holding under the LLC.

**Tone:** Enterprise operations software. Not startup dashboard, not hackathon project. The aesthetic reference is a Bloomberg Terminal crossed with a modern SaaS ops tool — purposeful density, zero decoration.

### 3.2 Color System

```
--color-bg-primary:      #0a0a0a     /* true black — main canvas */
--color-bg-surface:      #111111     /* card backgrounds */
--color-bg-elevated:     #1a1a1a     /* modals, dropdowns */
--color-bg-hover:        #222222     /* hover states */

--color-accent-primary:  #FB4F14     /* Bengals orange — primary actions, key metrics */
--color-accent-hover:    #ff6a2f     /* orange on hover */
--color-accent-dim:      rgba(251, 79, 20, 0.15)   /* accent backgrounds, badges */

--color-status-green:    #22c55e     /* healthy / online */
--color-status-amber:    #f59e0b     /* warning / degraded */
--color-status-red:      #ef4444     /* critical / offline */
--color-status-blue:     #3b82f6     /* informational */

--color-text-primary:    #ffffff     /* headings, labels */
--color-text-secondary:  #a1a1aa     /* body copy, descriptions */
--color-text-muted:      #52525b     /* timestamps, metadata */

--color-border:          #2a2a2a     /* dividers, card borders */
--color-border-accent:   rgba(251, 79, 20, 0.3)   /* focused inputs, active nav */
```

### 3.3 Typography

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* Scale */
--text-xs:   11px / 16px   /* timestamps, metadata */
--text-sm:   13px / 20px   /* body, table rows */
--text-base: 15px / 24px   /* default body */
--text-lg:   18px / 28px   /* section headers */
--text-xl:   22px / 32px   /* page titles */
--text-2xl:  28px / 36px   /* KPI numbers */
--text-3xl:  36px / 44px   /* hero metrics */

/* Weights */
400 — body copy
500 — labels, nav items
600 — section headers, card titles
700 — KPI values, page titles
```

Monospace for terminal output and code:
```css
font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
font-size: 13px;
line-height: 20px;
```

### 3.4 Component Library

No external component library. Hand-built components using CSS custom properties. This is not inefficiency — it is brand control. An external library (Radix, Shadcn, MUI) would fight the dark orange-black aesthetic at every turn and leave fingerprints that make the product look like a template.

Core components to build once, reuse everywhere:

- `StatusBadge` — green/amber/red dot + label. Used in health tiles and nav.
- `MetricCard` — KPI tile with label, large value, trend indicator, status dot.
- `EventFeed` — scrollable timestamped event stream.
- `CommandInput` — terminal-style input with history (arrow up/down), monospace font.
- `ChatBubble` — message bubble with direction (in/out), channel icon, timestamp.
- `DataTable` — sortable table with dark rows and orange hover.
- `SideNav` — collapsible left navigation with icon + label.
- `Toast` — top-right notification stack, auto-dismiss, color by severity.
- `Modal` — centered overlay with blur backdrop.
- `Toggle` — on/off switch using accent orange for active state.

### 3.5 Layout Grid

All pages follow a two-panel layout on desktop, single-column on mobile:

```
Desktop (≥1024px):
┌──────────────────────────────────────────────────────────┐
│ TopBar: 9 logo  │  page title  │  status pills  │ avatar│
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│  SideNav │              Main Content                     │
│  (240px) │                                               │
│          │                                               │
│  Fixed   │                                               │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘

Mobile (<1024px):
┌──────────────────────────┐
│ TopBar: hamburger + logo │
├──────────────────────────┤
│                          │
│      Main Content        │
│   (full width, 16px pad) │
│                          │
└──────────────────────────┘
│ Bottom nav (5 icons max) │
└──────────────────────────┘
```

---

## 4. Screen Inventory and Wireframes

### 4.1 TopBar (persistent, all screens)

```
┌─────────────────────────────────────────────────────────────────┐
│  ▣ 9          Command Center    ●RELAY  ●HUB OK  ●SYNC OK   [J]│
└─────────────────────────────────────────────────────────────────┘
```

Elements (left to right):
- **9 logo mark** — Bengals wordmark style, orange, links to dashboard
- **Page title** — current section name
- **Status pills** (right-aligned):
  - Terminal mode: `RELAY` (green) or `AUTONOMOUS` (amber)
  - Hub: `HUB OK` (green) or `HUB DOWN` (red)
  - Sync: `SYNC OK` (green) or `DRIFT` (amber)
- **Avatar** — owner initials circle, links to settings

All status pills pull from `/health` endpoint, refreshed every 15 seconds via polling in Phase 1, upgraded to SSE push in Phase 2.

---

### 4.2 Screen 1 — Dashboard Home

**Purpose:** Instant situational awareness. Open this page and know whether everything is healthy in under 5 seconds.

**URL:** `/`

**Layout:**

```
TopBar
──────────────────────────────────────────────────────────
  KPI ROW (4 tiles, full width)
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  HUB UPTIME  │ │ TERMINAL MODE│ │ LAST MSG     │ │ OPEN TASKS   │
│   99.2%      │ │    RELAY     │ │   4 min ago  │ │     7        │
│  ●  Healthy  │ │  ● Active    │ │  ● Telegram  │ │  ● 2 urgent  │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘

  COMPONENT HEALTH GRID (left 2/3)    RECENT EVENTS (right 1/3)
┌─────────────────────────────┐       ┌─────────────────────────┐
│ COMPONENT STATUS             │       │ LIVE EVENT FEED          │
│                              │       │                          │
│ ● Hub Process     HEALTHY    │       │ 14:23 ● Hub: ping ok     │
│ ● Telegram        HEALTHY    │       │ 14:22 ● Telegram: msg in │
│ ● iMessage        HEALTHY    │       │ 14:20 ● Tunnel: restart  │
│ ● Voice Server    HEALTHY    │       │14:15 ▲ Supabase: drift 3 │
│ ● Cloudflare Tun  HEALTHY    │       │ 14:10 ● Hub: startup     │
│ ● Supabase Sync   MINOR DRIFT│       │                          │
│ ● Health Monitor  HEALTHY    │       │  (scrollable, last 50)   │
│ ● Trader Bot      OFFLINE    │       │                          │
└─────────────────────────────┘       └─────────────────────────┘

  9'S CURRENT ACTIVITY (full width)
┌────────────────────────────────────────────────────────────────┐
│ WHAT 9 IS DOING RIGHT NOW                                      │
│                                                                │
│  Last context update: 14:18 ET                                 │
│  "Working on Command Center design doc. Phase 1 build spec     │
│   in progress. All systems nominal."                           │
│                                                                │
│  Session started: 2026-04-05T14:01:33Z   Uptime: 22 min        │
└────────────────────────────────────────────────────────────────┘
```

**Data sources:**
- KPI row: `/health` (hub uptime, terminal mode, channel status), `/state` (last message timestamp), `/db/context` (open task count)
- Component grid: `/health-dashboard` (current[] array from health-monitor)
- Event feed: `/health-dashboard` (recent_events[] array), Phase 2 upgrades to SSE
- Activity: `/state` (sessionContext field)

**Interactions:**
- Click any component tile to expand detail with last 10 events for that component
- Click an event in the feed to see full event JSON
- Activity section refreshes every 30 seconds

---

### 4.3 Screen 2 — Chat

**Purpose:** Full bidirectional messaging with 9. Read all conversations from all channels. Send to any channel from here.

**URL:** `/chat`

**Layout:**

```
TopBar
──────────────────────────────────────────────────────────
  CHANNEL TABS
[ Telegram (3) ]  [ iMessage ]  [ Email ]  [ All ]

  MESSAGE HISTORY                        SEND PANEL
┌────────────────────────────────┐      ┌─────────────────────┐
│                                │      │  Send as:           │
│  Apr 5, 2026 — 2:18 PM ET     │      │  ○ Telegram         │
│                                │      │  ○ iMessage         │
│  [IN] Jasson                   │      │  ○ Email            │
│  "what's the status on the     │      │                     │
│   command center design?"      │      │  ┌───────────────┐  │
│   2:18 PM  ● Telegram          │      │  │ Type message  │  │
│                                │      │  │               │  │
│  [OUT] 9                       │      │  │               │  │
│  "CANVAS is on it now.         │      │  └───────────────┘  │
│   Design doc in progress,      │      │                     │
│   ~45 min to completion."      │      │  [  Send  ]         │
│   2:19 PM  ● Telegram          │      │                     │
│                                │      │  Quick actions:     │
│  [IN] Jasson                   │      │  [ Status update ]  │
│  "make it good"                │      │  [ Inbox check  ]   │
│   2:20 PM  ● Telegram          │      │  [ Ping 9       ]   │
│                                │      └─────────────────────┘
│  [scrollable]                  │
│                                │
└────────────────────────────────┘
  [ Load older messages... ]
```

**Data sources:**
- Message history: `/state` (recentMessages array), `/db/context` (database messages)
- Phase 2: `/messages/history?channel=telegram&page=1` for paginated history

**Interactions:**
- Channel tabs filter displayed messages
- Send panel POSTs to `/send` with `{"channel":"telegram","message":"..."}` 
- Quick action buttons are pre-filled prompts (e.g., "Status update" sends "What's your current status?")
- Messages show channel icon (Telegram paper plane, iMessage bubble, email envelope)
- Unread count badge on channel tabs
- Phase 2: SSE push appends new messages in real-time without polling

---

### 4.4 Screen 3 — Terminal

**Purpose:** Remote shell. Type a command, see output stream back. The "sitting at Terminal" experience.

**URL:** `/terminal`

**Layout:**

```
TopBar
──────────────────────────────────────────────────────────
  TERMINAL                              [ Clear ] [ History ]

  SECURITY NOTICE (amber bar, Phase 2 only):
  ╔══════════════════════════════════════════════════════╗
  ║  Remote execution active. Every command is logged.   ║
  ╚══════════════════════════════════════════════════════╝

┌────────────────────────────────────────────────────────────────┐
│  Output stream (monospace, dark bg, green text)                │
│                                                                │
│  [14:23:01] $ ps aux | grep comms-hub                         │
│  jasson  1234  0.1  0.3  comms-hub.mjs                        │
│                                                                │
│  [14:23:04] $ curl -s http://localhost:3457/health | python3  │
│              -m json.tool                                      │
│  {                                                             │
│    "status": "running",                                        │
│    "uptime": 5432,                                             │
│    "terminalState": "relay",                                   │
│    ...                                                         │
│  }                                                             │
│                                                                │
│  [14:23:12] $  ▌   (cursor blink)                             │
│                                                                │
│  [scrollable to top — full history this session]               │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  $ _                                          [Run] [⬆] [⬇]  │
└────────────────────────────────────────────────────────────────┘

  QUICK COMMANDS (pre-built buttons)
  [ Hub health ]  [ Hub state ]  [ Open tasks ]  [ Hub restart ]
  [ Inbox check ] [ Mem stats  ] [ Process list] [ Log tail   ]
```

**Phase note:** Screen exists in Phase 1 as a read-only view showing hub status output for quick-select buttons only. Full command input is Phase 2 (requires new hub endpoint and security review).

**Data sources:**
- Phase 1: Quick command buttons call specific read-only hub endpoints and display formatted JSON output
- Phase 2: `POST /command/run {"cmd":"..."}` → returns `jobId`, then `GET /command/stream/:jobId` SSE streams output

**Interactions:**
- Arrow up/down cycles command history (stored in sessionStorage)
- Ctrl+C sends interrupt signal to running command (Phase 2)
- Clear button wipes display only (history preserved in DB)
- Quick command buttons are read-only safe calls available in Phase 1

---

### 4.5 Screen 4 — Tasks

**Purpose:** Full task list visibility and management. Claim tasks, mark complete, see what's assigned to which agent.

**URL:** `/tasks`

**Layout:**

```
TopBar
──────────────────────────────────────────────────────────
  TASKS                   [ + New Task ]    [ Filter ▼ ]

  FILTER ROW:  [ All ]  [ Open ]  [ In Progress ]  [ Done ]
               Priority: [ All ▼ ]   Agent: [ All ▼ ]

┌────────────────────────────────────────────────────────────────┐
│  PRIORITY  │ TITLE                  │ AGENT   │STATUS │ UPDATED│
├────────────┼────────────────────────┼─────────┼───────┼────────┤
│ ● CRITICAL │ Persistent memory      │ 9       │ OPEN  │ 14:01  │
│ ● HIGH     │ Command Center Phase 1 │ CANVAS  │ PROG  │ 14:05  │
│ ● HIGH     │ Health monitor deploy  │ TEE     │ OPEN  │ 13:55  │
│ ● MEDIUM   │ Social media content   │ PRESS   │ OPEN  │ 13:20  │
│ ● LOW      │ AiNFLGM SEO audit      │ UNO     │ OPEN  │ 12:45  │
└────────────────────────────────────────────────────────────────┘

  TASK DETAIL PANEL (slides in from right on row click):
  ┌─────────────────────────────────────────┐
  │  Command Center Phase 1                 │
  │  Priority: HIGH  │  Agent: CANVAS       │
  │  Status: IN_PROGRESS                    │
  │                                         │
  │  Description:                           │
  │  Design doc + architecture for CC v1.   │
  │  Engineering handoff by EOD Apr 5.      │
  │                                         │
  │  Created: 2026-04-05T14:05:00Z          │
  │  Updated: 2026-04-05T14:05:00Z          │
  │                                         │
  │  [ Mark Complete ]  [ Reassign ]        │
  └─────────────────────────────────────────┘
```

**Data sources:**
- Phase 1: `/db/context` (includes tasks from memory)
- Phase 2: `GET /tasks` (dedicated endpoint querying SQLite tasks table directly)

**Interactions:**
- Click row to open detail panel
- Mark Complete: `POST /tasks/:id {"status":"completed"}`
- Reassign: opens agent picker dropdown
- New Task: opens modal with title, priority, agent, description fields

---

### 4.6 Screen 5 — Memory

**Purpose:** Browse and search 9's persistent memory. Find any stored context, decision, profile, or protocol.

**URL:** `/memory`

**Layout:**

```
TopBar
──────────────────────────────────────────────────────────
  MEMORY                               [ Search: _______ ]

  CATEGORY SIDEBAR    │  RESULTS
  ──────────────────  │  ──────────────────────────────────
  [ All             ] │  Showing 12 files — category: All
  [ Identity        ] │
  [ Products        ] │  ┌────────────────────────────────┐
  [ Feedback        ] │  │ identity_9.md                  │
  [ Protocols       ] │  │ WHO 9 IS: personality, voice…  │
  [ Contacts        ] │  │ Modified: Apr 5               │
  [ Research        ] │  └────────────────────────────────┘
  [ References      ] │
  [ Tasks           ] │  ┌────────────────────────────────┐
  [ Decisions       ] │  │ project_universe_audit_april5  │
                      │  │ Verified live state of all…    │
                      │  │ Modified: Apr 5               │
                      │  └────────────────────────────────┘
                      │
                      │  [ Load more... ]

  FILE READER (opens below or in modal on click):
  ┌───────────────────────────────────────────────────────┐
  │  identity_9.md                              [Copy] [X]│
  │  ───────────────────────────────────────────────────  │
  │  # 9 — Identity                                       │
  │  ...file contents rendered as markdown...             │
  └───────────────────────────────────────────────────────┘
```

**Data sources:**
- Phase 1: `/db/context` endpoint (24hr snapshot includes memory entries)
- Phase 2: `GET /memory/search?q=keyword&category=feedback` — hub reads memory directory and SQLite memory table, returns matched files and database entries

**Interactions:**
- Search filters results in real-time as user types (client-side on loaded data, Phase 1)
- Phase 2: server-side search across all memory files using ripgrep or SQLite FTS
- Click file card to read content inline
- Copy button copies full file content to clipboard

---

### 4.7 Screen 6 — Audit Log

**Purpose:** Complete record of everything that happened — messages, commands, decisions, agent actions. Irreversible audit trail.

**URL:** `/audit`

**Layout:**

```
TopBar
──────────────────────────────────────────────────────────
  AUDIT LOG             [ Date range ▼ ]  [ Export CSV ]

  FILTER: [ All Events ] [ Messages ] [ Commands ] [ Actions ] [ Decisions ]

┌──────────────────────────────────────────────────────────────────┐
│ TIMESTAMP (ET)    │ TYPE      │ ACTOR  │ DESCRIPTION             │
├───────────────────┼───────────┼────────┼─────────────────────────┤
│ Apr 5, 2:23 PM   │ ACTION    │ 9      │ Ran: ps aux | grep hub  │
│ Apr 5, 2:20 PM   │ MESSAGE   │ Jasson │ Telegram IN: "make it…" │
│ Apr 5, 2:19 PM   │ MESSAGE   │ 9      │ Telegram OUT: "CANVAS…" │
│ Apr 5, 2:18 PM   │ MESSAGE   │ Jasson │ Telegram IN: "what's…"  │
│ Apr 5, 2:15 PM   │ ACTION    │ TEE    │ Deployed health-monitor │
│ Apr 5, 2:10 PM   │ DECISION  │ 9      │ Chose Vite over Next.js │
│ Apr 5, 2:01 PM   │ SYSTEM    │ Hub    │ Terminal claimed (relay) │
│ Apr 5, 2:00 PM   │ SYSTEM    │ Hub    │ Startup complete         │
└──────────────────────────────────────────────────────────────────┘

  [pagination]
```

**Data sources:**
- Phase 1: `/db/context` (actions + decisions from SQLite snapshot)
- Phase 2: dedicated `/audit?type=all&from=2026-04-05&page=1` endpoint with full pagination

**Interactions:**
- Click any row to expand full detail (full command output, full message text, JSON payload)
- Export CSV downloads all filtered results as CSV
- Date range filter (today / last 7d / last 30d / custom)

---

### 4.8 Screen 7 — Settings

**Purpose:** Configure agent authority, budget gates, notification preferences, and auth.

**URL:** `/settings`

**Layout:**

```
TopBar
──────────────────────────────────────────────────────────
  SETTINGS

  TABS: [ Authority Matrix ]  [ Budget Gates ]  [ Alerts ]  [ Security ]

  ── AUTHORITY MATRIX ─────────────────────────────────────────────

  PERMISSION                    STATUS    LIMIT       DESCRIPTION
  ──────────────────────────────────────────────────────────────────
  auto_deploy                   ● ACTIVE  —           Ship when build passes
  auto_spend                    ● ACTIVE  <$100/task  Spend without approval
  auto_spend_daily              ● ACTIVE  <$100/day   Daily spend cap
  agent_delegation              ● ACTIVE  <$20/task   Auto-delegate agent tasks
  budget_monthly                ● ACTIVE  $5,000/mo   Monthly budget ceiling

  [+ Add rule]  [Edit rule]  [Revoke rule]

  ── ALERT PREFERENCES ────────────────────────────────────────────

  EVENT                         TELEGRAM    iMESSAGE    EMAIL
  ──────────────────────────────────────────────────────────────────
  Hub down                      ● ON        ● ON        ● ON
  Terminal crash                ● ON        ● ON        ○ OFF
  Supabase drift                ● ON        ○ OFF       ○ OFF
  Command executed              ● ON        ○ OFF       ○ OFF
  Budget threshold              ● ON        ● ON        ● ON

  ── SECURITY ─────────────────────────────────────────────────────

  Auth method: TOTP
  Session expiry: 24 hours
  Last login: Apr 5, 2026 2:01 PM ET — MacBook Pro

  [ Revoke all sessions ]   [ Regenerate TOTP secret ]
```

**Data sources:**
- Phase 1: `/state` (authority matrix from hub) and static display only
- Phase 2: dedicated endpoints for CRUD on authority rules and alert preferences

---

## 5. Navigation Structure

### 5.1 Desktop Side Navigation

```
┌──────────────────┐
│  ▣  9            │  (logo + wordmark)
│  ──────────────  │
│  ⬡ Dashboard     │  (active = orange left border)
│  ✉ Chat       3  │  (unread badge)
│  > Terminal      │
│  ☑ Tasks      7  │
│  ◎ Memory        │
│  ⊟ Audit Log     │
│  ⚙ Settings      │
│  ──────────────  │
│  ● Hub: RELAY    │  (live status pill)
│  ● Sync: OK      │
└──────────────────┘
```

### 5.2 Mobile Bottom Navigation (5 items max)

```
┌────────────────────────────────────────────┐
│  ⬡        ✉        >        ☑        •••  │
│  Home    Chat   Terminal  Tasks    More    │
└────────────────────────────────────────────┘
```

"More" expands to bottom sheet with Memory, Audit Log, Settings.

---

## 6. Implementation Plan

### Phase 1 — Minimum Viable Command Center (target: 48 hours from handoff)

**Done definition:** Owner can open the URL on his iPhone, authenticate with TOTP, see live system health, read and send Telegram messages, and view current tasks and 9's activity — all in real-time with 30-second refresh, accessible from anywhere in the world.

**Scope:**

1. React + Vite project scaffold with CSS custom properties (no external UI libs)
2. TOTP authentication (otpauth library, secret in .env, JWT issued by Cloudflare Worker)
3. Dashboard screen — reads `/health`, `/health-dashboard`, `/state` on 30s poll
4. Chat screen — reads message history from `/state`, sends via `/send` endpoint
5. Terminal screen — read-only, quick command buttons only (calls read-only hub endpoints)
6. Deployment to Cloudflare Pages (connected to git, auto-deploys on push)
7. Cloudflare Worker for auth proxy (validates JWT, proxies to hub tunnel)

**What is explicitly NOT in Phase 1:**
- SSE real-time push (polling is acceptable for Phase 1)
- Remote shell command execution (Phase 2 — requires hub endpoint + security review)
- Tasks/Memory/Audit/Settings screens (Phase 2 — data is available in Phase 1 dashboard)
- Paginated message history beyond what `/state` provides

**Acceptance test:**
- [ ] Owner authenticates on iPhone from a non-home network
- [ ] Dashboard shows correct terminal mode (RELAY vs AUTONOMOUS)
- [ ] All component health tiles show accurate status (cross-checked vs `curl /health-dashboard`)
- [ ] Owner sends a Telegram message from Chat screen — message arrives on Telegram
- [ ] Owner receives a Telegram message — it appears in Chat screen within 30 seconds

---

### Phase 2 — Full Two-Way Remote Terminal (target: 1 week after Phase 1 ships)

**Done definition:** Owner can execute any permitted shell command from the Command Center and see output stream in real-time. All 7 screens are functional. SSE push replaces polling for live events.

**New hub endpoints required:**
- `POST /command/run {"cmd": "..."}` — executes command, returns `jobId`
- `GET /command/stream/:jobId` — SSE stream of stdout/stderr
- `GET /events/stream` — SSE stream of all hub events (messages, health, terminal state)
- `GET /tasks` — returns tasks from SQLite
- `POST /tasks/:id` — update task status/assignment
- `GET /messages/history` — paginated message history from SQLite
- `GET /memory/search` — search memory files and SQLite memory table
- `GET /audit` — paginated audit entries from actions + decisions tables

**Scope:**
1. All remaining screens (Tasks, Memory, Audit, Settings)
2. Upgrade Dashboard + Chat from polling to SSE push
3. Full Terminal screen with command input + streaming output
4. Command security layer in hub (blocklist, rate limit, audit log)
5. Mobile UX audit — every screen tested at 390px width (iPhone 15)

**Acceptance test:**
- [ ] Owner runs `curl -s http://localhost:3457/health` from Terminal screen, sees JSON output stream within 3 seconds
- [ ] New Telegram message appears in Chat screen within 2 seconds (SSE push, not poll)
- [ ] Component health change appears in Dashboard event feed within 5 seconds
- [ ] All screens render correctly on iPhone 15 (390px)

---

### Phase 3 — Full Feature Set + Polish (target: 2 weeks after Phase 2)

**Done definition:** Every feature in the screen inventory is implemented. Performance is optimized. The product passes a CIO review without modifications.

**Scope:**
1. Settings screen — full CRUD on authority matrix and alert preferences
2. Audit log — CSV export, date range filter, full-detail row expansion
3. Memory screen — full server-side search with ripgrep
4. Tasks screen — create new task from UI, rich task cards
5. Chat screen — per-channel pagination, full message history
6. Performance: lazy-load non-critical screens, optimize bundle size
7. Error states for every data-fetch failure (never show empty UI)
8. Comprehensive mobile testing across iOS Safari + Android Chrome
9. Accessibility audit: contrast ratios, touch target sizes (44x44px minimum), keyboard navigation

---

## 7. Engineering Handoff Spec — Phase 1

This section is written directly for the engineering agent who will implement Phase 1.

### 7.1 Repository Structure

```
command-center/
├── public/
│   └── favicon.svg          (9 logo — Bengals orange square with "9")
├── src/
│   ├── main.jsx             (React root mount)
│   ├── App.jsx              (router, auth guard)
│   ├── styles/
│   │   ├── globals.css      (CSS custom properties + resets)
│   │   └── components.css   (reusable component styles)
│   ├── hooks/
│   │   ├── useHub.js        (fetch wrapper with auth header)
│   │   └── usePoll.js       (polling interval hook, cleans up on unmount)
│   ├── components/
│   │   ├── TopBar.jsx
│   │   ├── SideNav.jsx
│   │   ├── StatusBadge.jsx
│   │   └── MetricCard.jsx
│   ├── screens/
│   │   ├── Login.jsx        (TOTP input + verify)
│   │   ├── Dashboard.jsx    (Phase 1 main screen)
│   │   ├── Chat.jsx         (Phase 1 chat)
│   │   └── Terminal.jsx     (Phase 1 read-only)
│   └── lib/
│       └── auth.js          (JWT storage + verify, logout)
├── worker/
│   └── index.js             (Cloudflare Worker — auth proxy)
├── package.json
├── vite.config.js
└── wrangler.toml            (Cloudflare Worker config)
```

### 7.2 Hub Proxy Configuration

The Cloudflare Worker is the single origin for all API calls from the React app. It validates JWT on every request, then proxies to the hub tunnel URL.

```javascript
// worker/index.js — sketch
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Auth endpoint — no JWT required
    if (url.pathname === '/auth/verify' && request.method === 'POST') {
      const { code } = await request.json();
      const valid = verifyTOTP(code, env.TOTP_SECRET);
      if (!valid) return new Response('unauthorized', { status: 401 });
      const jwt = signJWT({ owner: true }, env.JWT_SECRET, 86400); // 24hr
      return Response.json({ token: jwt });
    }

    // All other routes — require valid JWT
    const jwt = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt || !verifyJWT(jwt, env.JWT_SECRET)) {
      return new Response('unauthorized', { status: 401 });
    }

    // Proxy to hub tunnel
    const target = new URL(url.pathname + url.search, env.HUB_TUNNEL_URL);
    return fetch(target, {
      method: request.method,
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        'x-hub-secret': env.HUB_API_SECRET,
      },
      body: request.method !== 'GET' ? request.body : undefined,
    });
  }
};
```

Worker env vars (set in Cloudflare dashboard, never in code):
- `TOTP_SECRET` — base32 TOTP secret (generate once, add to Authenticator app)
- `JWT_SECRET` — 32-byte random hex string
- `HUB_TUNNEL_URL` — the Cloudflare tunnel URL for the Mac hub
- `HUB_API_SECRET` — value of `HUB_API_SECRET` from BengalOracle `.env`

### 7.3 Core CSS Variables

Paste this into `globals.css` as the design system foundation:

```css
:root {
  --bg-primary: #0a0a0a;
  --bg-surface: #111111;
  --bg-elevated: #1a1a1a;
  --bg-hover: #222222;
  --accent: #FB4F14;
  --accent-hover: #ff6a2f;
  --accent-dim: rgba(251, 79, 20, 0.15);
  --status-green: #22c55e;
  --status-amber: #f59e0b;
  --status-red: #ef4444;
  --status-blue: #3b82f6;
  --text-primary: #ffffff;
  --text-secondary: #a1a1aa;
  --text-muted: #52525b;
  --border: #2a2a2a;
  --border-accent: rgba(251, 79, 20, 0.3);
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-modal: 0 8px 32px rgba(0, 0, 0, 0.6);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 24px;
  -webkit-font-smoothing: antialiased;
}
```

### 7.4 Hub Endpoints Used in Phase 1

| Screen | Endpoint | Method | Polling interval |
|--------|----------|--------|-----------------|
| TopBar status pills | `/health` | GET | 15s |
| Dashboard — KPI tiles | `/health` + `/state` | GET | 30s |
| Dashboard — component grid | `/health-dashboard` | GET | 30s |
| Dashboard — event feed | `/health-dashboard` | GET | 30s |
| Dashboard — activity | `/state` | GET | 30s |
| Chat — message history | `/state` | GET | 30s |
| Chat — send message | `/send` | POST | on user action |
| Terminal — quick commands | `/health`, `/state`, `/db/context` | GET | on user action |

### 7.5 Phase 1 Acceptance Checklist

Before marking Phase 1 complete, verify every item:

- [ ] Authentication: TOTP works with Google Authenticator. Wrong code returns 401. Valid code returns JWT. JWT stored in localStorage.
- [ ] Auth expiry: After 24 hours (or manual localStorage clear), app redirects to login.
- [ ] Dashboard loads within 3 seconds on an iPhone 15 on a 4G connection.
- [ ] All status pills in TopBar accurately reflect hub state.
- [ ] Component health grid shows correct status for all 8 components.
- [ ] Activity section shows current sessionContext from hub `/state`.
- [ ] Chat screen loads last 50 messages from `/state`.
- [ ] Sending a message via Chat screen results in a Telegram message arriving at Owner's phone. Verified manually.
- [ ] Terminal quick command buttons return formatted output.
- [ ] No errors in browser console (React warnings are acceptable; JS errors are not).
- [ ] All screens render without horizontal scroll at 390px viewport width.
- [ ] Cloudflare Pages deployment is connected to git — push to main = auto-deploy.
- [ ] All API calls go through Cloudflare Worker — direct hub URL is never exposed to the browser.

---

## 8. Open Items for Engineering Judgment

The following decisions are intentionally left to the engineering agent — they do not affect the design spec but will arise during build:

1. **TOTP library choice:** `otpauth` (modern, ESM) or `speakeasy` (CommonJS, battle-tested). Either is acceptable.
2. **JWT library in Cloudflare Worker:** Workers do not have Node crypto. Use the Web Crypto API directly or a Worker-compatible JWT library such as `@tsndr/cloudflare-worker-jwt`.
3. **Routing:** React Router v6 or a minimal custom router. Given Phase 1 has only 3 screens, a custom router (switch on `window.location.pathname`) eliminates a dependency. Engineering agent's call.
4. **Favicon:** A standalone SVG of the 9 logo (black square, "9" in Bengals orange) should be created. Until that exists, use a CSS-generated version or a plain text favicon.

---

*Document ends. Phase 1 build spec begins above at section 7.*
