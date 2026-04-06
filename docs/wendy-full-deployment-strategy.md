# Full Deployment Strategy: $500/Day, 100% Utilization

**Author:** Wendy, Super Consultant & Platform Orchestrator, 9 Enterprises
**Date:** April 6, 2026
**Status:** READY FOR IMMEDIATE EXECUTION
**Directive:** Owner says 10% utilization is unacceptable. 9 never touches a file again. Wendy owns the entire execution layer.

---

## The New Operating Model

**9's job:** Stay on Telegram with Owner. Receive directives. Hand them to Wendy within 60 seconds. Monitor comms. That is it. No files. No commands. No builds. No "let me just quickly fix this." Zero.

**Wendy's job:** Receive every handoff from 9. Decompose into squad-level tasks. Deploy agents. Monitor quality gates. Push status back to 9 for Owner relay. Kill and respawn anything that falls below gold standard.

**Handoff protocol:**
1. Owner sends directive to 9 via Telegram
2. 9 sends Wendy a structured task block: `TASK: [what] | PRIORITY: [P0-P3] | DEADLINE: [when]`
3. Wendy acknowledges within 30 seconds, assigns to squad, sets QC gate
4. Squad executes. GM verifies. Wendy spot-checks. Result pushed to 9.
5. 9 relays to Owner. Done.

If 9 ever opens a file or runs a command that is not a comms check, Wendy has failed.

---

## Squad Deployment: All Five Simultaneous

### Squad 1: FOUNDATION (Infrastructure GM)
**Agents: 5** -- Tee (Opus, Engineering Lead), DOC (Sonnet, Reliability), FORT (Sonnet, Security), WATCH (Sonnet, Observability), + 1 burst Sonnet worker

**Week 1 assignments from Unified Plan:**
- FORT: Close all 6 critical credential flags. Rotate Gmail, Supabase, Telegram tokens. Auth-gate exposed internal pages.
- WATCH: Deploy Sentry free tier on AiNFLGM + comms-hub + pilot-server. Stand up health dashboard. Fix voice tunnel routing.
- DOC: Deploy Cloud Worker to Cloudflare (Mac SPOF elimination). Build automated daily SQLite backup pipeline (local + R2).
- Tee: Set up Pinecone namespace for agent memory. Wire Supabase memory schema (4-type model from Ironclad). Land Kyle RAM agent build.
- Burst worker: Stand up Notion workspace with squad boards. Wire comms-hub session-handoff to Supabase writes.

**QC gate:** JUDGE reviews every infrastructure change before deploy. No production push without JUDGE sign-off.

**Daily cost allocation: $150**

### Squad 2: PRODUCT (Product GM)
**Agents: 4** -- SCOUT (Sonnet, AiNFLGM lead), PRESS (Sonnet, Content/SEO), MONEY (Sonnet, Economics), + 1 burst Sonnet worker

**Week 1 assignments:**
- SCOUT: Wire BetMGM/FanDuel affiliate banners on AiNFLGM. Fix service worker stale-content bug. Submit AdSense application.
- PRESS: Add ToS/Privacy footer links. Draft content pipeline for NFL Draft coverage. SEO audit and fixes.
- MONEY: Build unit economics model for AiNFLGM (cost per visitor, affiliate conversion projections). Define FreeAgent9 pricing at $99/mo.
- Burst worker: Verify Umami analytics reporting. Lighthouse performance audit (target >80 on all pages).

**QC gate:** JUDGE runs WWKD Quick Test on every user-facing change. Nothing ships below 8/10.

**Daily cost allocation: $120**

### Squad 3: PEPPER (dedicated per Owner Tier 1 classification)
**Agents: 2** -- CANVAS (Sonnet, Design/UX), + 1 dedicated Sonnet builder

**Week 1 assignments:**
- CANVAS: Define Pepper product architecture -- per-user Pinecone namespace, per-user Telegram bot, per-user prompt layer. Document the custom-build-per-user model technically.
- Builder: Implement first Pepper instance beyond family deployment. Build onboarding flow template.

**QC gate:** CANVAS reviews UX. JUDGE reviews architecture. Owner tests with family.

**Daily cost allocation: $60**

### Squad 4: STRATEGY / GOVERNANCE (Strategy GM)
**Agents: 3** -- UNO (Opus, Research), JUDGE (Opus, Quality Gate), + 1 burst Sonnet researcher

**Week 1 assignments:**
- JUDGE: Write ADR template + first 5 ADRs. Establish PR review process. Build SDLC compliance scorecard. Run QC gates for all other squads.
- UNO: Kyle benchmark maintenance (K-1 through K-20 status). Research Stripe checkout integration for FreeAgent9. Competitive intel on NFL AI products before Draft.
- Burst researcher: Tool evaluation for any new services squads request. Verify product/pricing claims against live sources.

**QC gate:** Wendy directly reviews all JUDGE output. JUDGE reviews everyone else.

**Daily cost allocation: $100**

### Squad 5: MEDIA ACCESS (NEW -- per Owner directive)
**Agents: 2** -- FETCH (Sonnet, media retrieval), + 1 Playwright browser agent

**Mission:** Owner sends X/Twitter links, YouTube links, news articles, screenshots. This squad extracts the content and delivers a plain-English summary to 9 within 60 seconds. 9 never has to parse a URL.

**How it works:**
- 9 receives a link from Owner, forwards to Wendy
- FETCH uses WebFetch/WebSearch to pull content, extract text, summarize
- Playwright agent handles anything requiring browser rendering (paywalled sites, dynamic content, video metadata)
- Summary returned to 9 in under 60 seconds for immediate Owner relay

**Standing assignments:**
- Monitor Owner-shared links in real-time
- Extract and summarize any media content
- Archive summaries to Supabase episodic memory for future reference

**QC gate:** Accuracy check -- summary must faithfully represent source. No hallucinated details.

**Daily cost allocation: $70**

---

## Total Deployment

| Squad | Agents | Daily Budget | GM |
|-------|--------|-------------|-----|
| Foundation | 5 | $150 | Infrastructure GM |
| Product | 4 | $120 | Product GM |
| Pepper | 2 | $60 | Product GM (shared) |
| Strategy/Governance | 3 | $100 | Foundation GM (shared for JUDGE QC) |
| Media Access | 2 | $70 | Wendy (direct) |
| **TOTAL** | **16** | **$500/day** | |

---

## QC Gates at Every Level

**Level 1 -- Agent self-check:** Every agent runs task-specific verification before marking complete. "Did the deploy return 200?" "Does Lighthouse score > 80?" "Did the credential rotate succeed?"

**Level 2 -- GM review:** Squad GM reviews all output before it leaves the squad. Infrastructure GM verifies all deploys. Product GM verifies all user-facing changes.

**Level 3 -- JUDGE gate:** JUDGE runs the WWKD Quick Test on anything that ships externally. SDLC compliance check on every PR. ADR required for architecture changes.

**Level 4 -- Wendy spot-check:** I randomly audit 20% of completed tasks daily. Any failure triggers full squad review.

**Level 5 -- 9 relay check:** 9 confirms Owner satisfaction on every delivered result. Dissatisfaction triggers immediate Wendy re-work cycle.

Nothing reaches Owner without passing Levels 1-4. Nothing is marked complete without Level 5.

---

## How 9 Hands Off (The 60-Second Rule)

1. Owner message arrives on Telegram
2. 9 reads it immediately (comms is 9's only job)
3. If it is a directive/task: 9 sends Wendy structured handoff within 60 seconds
4. If it is a question: 9 answers from context or asks Wendy for data (Wendy responds in <2 min)
5. If it is a link: 9 forwards to Media Access squad, gets summary back in <60 seconds, relays to Owner
6. 9 NEVER says "let me look into that" and then goes dark. 9 says "Wendy's team is on it, I'll have an answer in [X minutes]"

**What 9 stops doing permanently:** Reading code. Writing code. Running scripts. Editing files. Deploying anything. Debugging anything. Researching anything. All of that is Wendy's execution layer.

**What 9 keeps doing:** Talking to Owner. Making CEO-level decisions. Approving Wendy's escalations. Maintaining comms-hub liveness (tool call heartbeat).

---

## Rate Limits and Scaling

Owner is correct: rate limits are a payment question. Current Claude Max plan provides substantial throughput. If we hit limits with 16 agents:

1. First: stagger non-urgent squad work across time windows (Foundation runs heavy morning, Product runs heavy afternoon)
2. Second: request Max plan upgrade or add API key capacity
3. Third: burst overflow to Sonnet API for parallelizable tasks

We do not throttle quality to avoid rate limits. We expand capacity to meet quality demands.

---

## Monday April 7 -- Launch Sequence

06:00 ET: Wendy instantiates all 5 squads with charters and Week 1 assignments
06:15 ET: All GMs confirm squad readiness
06:30 ET: Foundation Squad begins Cloud Worker deployment + credential remediation
06:30 ET: Product Squad begins AiNFLGM affiliate wiring + AdSense application
06:30 ET: Pepper Squad begins architecture definition
06:30 ET: Strategy Squad begins ADR template + SDLC scorecard
06:30 ET: Media Access Squad goes to standing ready
07:00 ET: First status push to 9 -- all squads active, blockers identified
12:00 ET: Midday status -- progress on all tracks
18:00 ET: EOD report -- what shipped, what is blocked, tomorrow's priorities

Every day after follows this cadence. 9 gets three status pushes minimum. Owner never has to ask "what's happening."

---

## Success Criteria

- 9 touches zero files, runs zero commands (except comms checks) for the entire week
- All 16 agents are actively executing by end of Monday
- Owner receives status updates without asking
- Media links are summarized and returned in under 60 seconds
- At least 3 credential flags closed by Friday
- Cloud Worker deployed by Wednesday
- AiNFLGM has affiliate banners live by Friday
- Universe health delta: +5 points minimum by end of Week 1

This is full utilization. This is the leadership layer ensuring quality. This is 9 staying on comms 100% of the time.

-- Wendy, Super Consultant & Platform Orchestrator, 9 Enterprises
