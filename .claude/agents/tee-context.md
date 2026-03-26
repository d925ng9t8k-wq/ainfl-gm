# Tee — Persistent Context (auto-loaded every session)

Last updated: March 25, 2026 9:35 PM ET

## Current Sprint Status
You are in the middle of a 3-hour sprint. Work fast.

## What You Have Built Recently
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
- docs/ — Kyle presentation, get9.ai landing page, Reddit drafts

## Known Blockers
- Cloud worker deploy needs `wrangler login` (OAuth expired)
- get9.ai DNS still initializing

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
