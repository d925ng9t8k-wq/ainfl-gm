# Tee — Persistent Context (auto-loaded every session)

Last updated: March 25, 2026 — Sprint complete

## Current Sprint Status
Sprint complete. All 4 tasks delivered. No push to remote (9 handles that).

## What You Have Built Recently

### Tonight's Sprint (March 25, 2026)
- **Owner presentation** — Markdown pitch deck at docs/owner-presentation.md (commit 5530d09)
- **Owner HTML page** — public/owner.html — polished standalone page for presenting 9 Enterprises (commit 0c2f9dd)
- **Freeze prevention** — check-messages.sh now writes unix timestamp to /tmp/9-last-tool-call after every tool call; hub reads this to detect frozen terminal (commits 91be186 + 94a1062)
- **Persistent agent system** — tasks/tee-backlog.json and tasks/uno-backlog.json for cross-session task persistence (commit 91be186)
- **Pilot/freeagent9 prompt draft** — scripts/jules-prompt.md stub for future Pilot agent (commit 94a1062)
- **Reddit content drafts** — strategy and post drafts for AiNFL GM growth (commit 206b3c8)
- **Stress test** — Grade A result (reported to 9)
- **Freeze detector in hub** — setInterval every 30s reads /tmp/9-last-tool-call; if terminalActive AND >180s gap, sends ONE Telegram alert + osascript keystroke to unblock; flag resets on ping/inbox (commit 4caba44)
- **Shared-state.json removed from git** — was already in .gitignore but still tracked; removed with git rm --cached (commit 8c91887)
- **Pilot routing stub** — JAMIE_PHONE constant added to hub; iMessage handler checks sender and routes Jamie's messages to handleJulesMessage() stub (commit 44da68d)

### Prior Work
- Hub upgrades: OC silence fix, tunnel monitor, session tokens (commit 7edbba0)
- Polymarket CORS proxy in cloud worker (commit 7289fed)
- FTC disclosure + responsible gambling footer (commit c0e5239)
- get9.ai landing page (commit 37a9189)
- FHA Underwriter POC — working CLI tool (commit 448a297)
- SEO meta tags for AiNFL GM (commit 70817d2)

## Active Codebase
- /Users/jassonfishback/Projects/BengalOracle/ — main repo
- scripts/comms-hub.mjs — OC (comms daemon, port 3457)
- scripts/voice-server.mjs — The Headset (voice, port 3456)
- cloud-worker/src/worker.js — Backup QB (Cloudflare Worker)
- src/ — AiNFL GM React site (GitHub Pages)
- mortgage-ai/ — FHA Underwriter POC
- docs/ — owner-presentation.md, Kyle presentation, get9.ai landing page, Reddit drafts
- public/owner.html — Owner pitch page (live on GitHub Pages)
- tasks/tee-backlog.json — Tee's persistent task queue
- tasks/uno-backlog.json — UNO's persistent task queue

## Pending / Next Steps
- Pilot handler: replace stub in handleJulesMessage() with actual Claude API call + iMessage response routing
- Set JAMIE_PHONE in .env so Pilot routing activates (Jamie's number not yet in env)
- Cloud worker deploy still needs `wrangler login` (OAuth expired)
- get9.ai DNS may still be initializing

## Known Blockers
- Cloud worker deploy needs `wrangler login` (OAuth expired)
- Pilot routing is stub-only — needs Claude API wiring and JAMIE_PHONE in .env

## Tech Stack
- Node.js, vanilla JS, React (Vite), Cloudflare Workers
- Claude API (Anthropic), ElevenLabs, Twilio
- Git, GitHub Pages auto-deploy on push

## Rules
- Always read files before editing
- Commit each task separately with clear messages
- Do NOT push to remote — 9 handles pushes
- Do NOT restart hub or voice server
- Do NOT access .env directly — ask 9 for credentials
