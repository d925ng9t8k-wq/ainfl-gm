# Squad Deployment Orders -- 9 Enterprises

**Issued by:** Wendy, Super Consultant & Platform Orchestrator
**Date:** April 6, 2026
**Effective:** Monday April 7, 2026 at 06:00 ET
**Authorization:** Owner-approved. 9-approved. Wendy signed.

---

## Preamble

Owner said "Today we cook with rocket fuel." 9 relayed full authority. I have reviewed the Full Deployment Strategy, the three additions from 9, and the new intake protocol. Everything below is binding. All five squads deploy simultaneously Monday morning.

---

## Section 1: Handoff Protocol (9 -> Wendy -> Squad)

**The chain of command is absolute:**

1. Owner sends directive to 9 via Telegram
2. 9 sends Wendy a structured task block within 60 seconds: `TASK: [what] | PRIORITY: [P0-P3] | DEADLINE: [when]`
3. Wendy acknowledges within 30 seconds, decomposes task, assigns to squad GM
4. Squad GM assigns to agent(s), sets internal deadline, confirms back to Wendy
5. Agent executes. Agent self-verifies. GM verifies. JUDGE gates. Wendy spot-checks.
6. Result pushed to 9. 9 relays to Owner. Done.

**Hard rules:**
- 9 never opens a file. 9 never runs a command beyond comms checks. If 9 touches code, I have failed.
- No task lives in anyone's head. Every task is externalized to the Notion queue (Squad 1 burst worker stands this up Day 1).
- No squad GM communicates directly with Owner. Everything flows through 9.

---

## Section 2: QC Gates

**Level 1 -- Agent self-check:** Agent verifies own output against task-specific criteria before marking complete. HTTP 200, Lighthouse > 80, credential rotation confirmed, etc.

**Level 2 -- GM review:** Squad GM reviews all output before it leaves the squad.

**Level 3 -- JUDGE gate:** JUDGE runs WWKD Quick Test on anything shipping externally. SDLC compliance on every PR. ADR required for architecture changes.

**Level 4 -- Wendy spot-check:** I randomly audit 20% of completed tasks daily. Any failure triggers full squad review and root-cause analysis.

**Level 5 -- 9 relay check:** 9 confirms Owner satisfaction. Dissatisfaction triggers immediate Wendy re-work cycle with priority override.

Nothing reaches Owner without passing Levels 1-4. Nothing is marked complete without Level 5.

---

## Section 3: Squad Deployment Orders

### SQUAD 1: FOUNDATION (Infrastructure)

**GM:** Infrastructure GM
**Agents:** Tee (Opus, Engineering Lead), DOC (Sonnet, Reliability), FORT (Sonnet, Security), WATCH (Sonnet, Observability), + 1 burst Sonnet worker
**Daily budget:** $150

**Week 1 Task Assignments:**

| Agent | Task | Deadline | Success Criteria |
|-------|------|----------|-----------------|
| FORT | Close all 6 critical credential flags. Rotate Gmail, Supabase, Telegram tokens. Auth-gate exposed internal pages. | Friday EOD | All 6 flags green. No plaintext secrets in source. .env.example created. |
| WATCH | Deploy Sentry free tier on AiNFLGM + comms-hub + pilot-server. Stand up health dashboard. Fix voice tunnel routing. | Wednesday EOD | Sentry capturing errors. Dashboard live. Voice tunnel stable for 24h. |
| DOC | Deploy Cloud Worker to Cloudflare (Mac SPOF elimination). Build automated daily SQLite backup pipeline (local + R2). | Wednesday EOD | Cloud Worker responding. Backup pipeline running. R2 bucket receiving. |
| Tee | Set up Pinecone namespace for agent memory. Wire Supabase memory schema (4-type model from Ironclad). Land Kyle RAM agent build. | Friday EOD | Pinecone namespace queryable. Supabase schema migrated. Kyle RAM agent functional. |
| Burst worker | Stand up Notion workspace with squad boards (all 5 squads). Wire comms-hub session-handoff to Supabase writes. | Monday EOD | Notion boards live with all squads populated. Session handoffs persisting to Supabase. |

---

### SQUAD 2: PRODUCT (Revenue & User-Facing)

**GM:** Product GM
**Agents:** SCOUT (Sonnet, AiNFLGM Lead), PRESS (Sonnet, Content/SEO), MONEY (Sonnet, Economics), + 1 burst Sonnet worker
**Daily budget:** $120

**Week 1 Task Assignments:**

| Agent | Task | Deadline | Success Criteria |
|-------|------|----------|-----------------|
| SCOUT | Wire BetMGM/FanDuel affiliate banners on AiNFLGM. Fix service worker stale-content bug. Submit AdSense application. | Friday EOD | Banners rendering. SW cache-bust verified. AdSense application submitted. |
| PRESS | Add ToS/Privacy footer links (all pages). Draft content pipeline for NFL Draft coverage. SEO audit and fixes. | Thursday EOD | Legal pages live. Draft content calendar created. SEO score improved. |
| MONEY | Build unit economics model for AiNFLGM (cost/visitor, affiliate conversion projections). Define FreeAgent9 pricing at $99/mo with justification doc. | Friday EOD | Economics model in shared doc. FreeAgent9 pricing deck ready for Owner review. |
| Burst worker | Verify Umami analytics reporting end-to-end. Run Lighthouse performance audit on all pages (target >80). | Tuesday EOD | Umami confirmed tracking. Lighthouse scores documented. Fixes filed as tasks. |

---

### SQUAD 3: PEPPER (Personal AI -- Owner Tier 1)

**GM:** Product GM (shared)
**Agents:** CANVAS (Sonnet, Design/UX), + 1 dedicated Sonnet builder
**Daily budget:** $60

**Week 1 Task Assignments:**

| Agent | Task | Deadline | Success Criteria |
|-------|------|----------|-----------------|
| CANVAS | Define Pepper product architecture: per-user Pinecone namespace, per-user Telegram bot, per-user prompt layer. Document the custom-build-per-user model. | Wednesday EOD | Architecture doc reviewed by JUDGE. Pinecone namespace strategy approved. |
| Builder | Implement first Pepper instance beyond family deployment. Build onboarding flow template. | Friday EOD | One non-family Pepper instance running. Onboarding template documented and repeatable. |

**9's Addition -- Pepper as Front Door:**
Pepper handles all inbound leads from Mark, Kyle, and prospects. When a lead contacts 9 Enterprises through any channel, Pepper is the first touchpoint. Pepper qualifies the lead, captures context, and routes to the appropriate squad or directly to 9 if it requires Owner-level attention. This is not a future feature -- this is Week 1 scope for the Builder agent. Wire Pepper's Telegram intake to recognize inbound from Mark Jaynes, Kyle Shea, and any new prospect contact. Pepper responds within 30 seconds, gathers requirements, and files a structured intake to Wendy's queue.

---

### SQUAD 4: STRATEGY / GOVERNANCE

**GM:** Foundation GM (shared for JUDGE QC cross-cutting role)
**Agents:** UNO (Opus, Research), JUDGE (Opus, Quality Gate), + 1 burst Sonnet researcher
**Daily budget:** $100

**Week 1 Task Assignments:**

| Agent | Task | Deadline | Success Criteria |
|-------|------|----------|-----------------|
| JUDGE | Write ADR template + first 5 ADRs (covering credential rotation, Cloud Worker deploy, memory schema, Pepper architecture, intake protocol). Establish PR review process. Build SDLC compliance scorecard. Run QC gates for all other squads all week. | Ongoing + Friday EOD for artifacts | ADR template live. 5 ADRs written. PR review process documented. Scorecard in use. |
| UNO | Kyle benchmark maintenance (K-1 through K-20 status tracking). Research Stripe checkout integration for FreeAgent9. Competitive intel on NFL AI products before Draft. | Friday EOD | Kyle benchmark dashboard updated. Stripe integration recommendation doc. Competitive analysis delivered. |
| Burst researcher | Tool evaluation for any new services squads request. Verify product/pricing claims against live sources. Standing research support. | On-demand | All tool evaluations completed within 4 hours of request. Zero unverified claims shipped. |

---

### SQUAD 5: MEDIA ACCESS

**GM:** Wendy (direct)
**Agents:** FETCH (Sonnet, media retrieval), + 1 Playwright browser agent
**Daily budget:** $70

**Standing Assignments (effective immediately):**

| Agent | Task | Deadline | Success Criteria |
|-------|------|----------|-----------------|
| FETCH | Extract and summarize any media content Owner shares (X/Twitter, YouTube, news articles, screenshots). Use WebFetch/WebSearch. | <60 seconds per request | Summary faithfully represents source. No hallucinated details. Returned to 9 in under 60 seconds. |
| Playwright agent | Handle anything requiring browser rendering: paywalled sites, dynamic content, video metadata extraction. | <90 seconds per request | Content extracted. Summary accurate. Archived to Supabase episodic memory. |

---

## Section 4: 9's Three Additions -- APPROVED AND INTEGRATED

### Addition 1: Pepper as Front Door

**Status: APPROVED. Integrated into Squad 3 Week 1 scope.**

Pepper is the inbound face of 9 Enterprises. Every lead from Mark Jaynes, Kyle Shea, or any new prospect hits Pepper first. Pepper qualifies, captures context, and routes. This eliminates 9 needing to context-switch from Owner comms to handle inbound business inquiries. Squad 3 Builder agent wires this in Week 1.

### Addition 2: Daily Automated Owner Briefing at 8 AM ET

**Status: APPROVED. Assigned to WATCH (Squad 1) for infrastructure, aggregated by Wendy.**

Every morning at 8:00 AM ET, 9 receives a structured briefing to relay to Owner. The briefing contains:

- **Universe health score** (current vs. previous day)
- **What shipped yesterday** (completed tasks with verification status)
- **What is in progress today** (active tasks across all squads)
- **Blockers requiring Owner input** (if any -- most days this should be zero)
- **Financial snapshot** (daily spend vs. $500 budget, cumulative week spend)
- **Highlight reel** (one notable win or milestone)

WATCH builds the automated aggregation pipeline. Each squad GM pushes EOD status to a shared endpoint by 6 PM ET. WATCH compiles and formats. Wendy reviews for accuracy. 9 receives at 7:55 AM ET with 5 minutes to review before relaying to Owner at 8:00 AM.

### Addition 3: Live Command Center Dashboard Wired to Real Data

**Status: APPROVED. Assigned to WATCH (Squad 1) for data pipeline, CANVAS (Squad 3) for UI.**

The Command Center dashboard is not a mockup. It is wired to real data:

- **Squad status boards** pulling from Notion API (live task states)
- **Agent health** pulling from comms-hub /health and process monitoring
- **Universe health score** computed from gold standard audit criteria
- **Financial tracking** pulling from actual API usage and service costs
- **Deployment status** pulling from Cloudflare, Vercel, and git deploy logs

WATCH owns the data pipeline and API endpoints. CANVAS owns the UI. Target: read-only dashboard live by Wednesday. Interactive elements (task reassignment, priority override) by Friday. 9 and Owner can view real-time state without asking anyone.

---

## Section 5: New Intake Protocol -- APPROVED

### How New Work Enters the System

1. **Owner sends new work to 9** via Telegram (or voice, or any channel)
2. **9 sends structured handoff to Wendy** within 60 seconds: `TASK: [what] | PRIORITY: [P0-P3] | DEADLINE: [when] | CONTEXT: [any relevant background]`
3. **Wendy decomposes and routes:**
   - If an existing squad has capacity: task is assigned to that squad's GM with deadline
   - If no squad has capacity: Wendy spins up a new agent (burst worker) or creates a new squad if the work is sustained
   - If the work is a new product/concept: Wendy creates a project brief, assigns to UNO for initial research, then routes to appropriate squad
4. **Every task is externalized** to the Notion queue immediately. Nothing lives in any agent's context window. If an agent crashes, the task survives in Notion and gets reassigned.
5. **New work NEVER displaces current work.** If all squads are at capacity, Wendy creates capacity by spinning burst workers or requesting budget increase from 9. Current commitments are sacred.

### Priority Override Rules

- **P0 (Owner emergency):** Interrupts everything. Wendy pulls best-fit agent from any squad. Original task is paused, not dropped.
- **P1 (Owner directive, time-sensitive):** Assigned to burst worker or next-available agent. No displacement.
- **P2 (Standard work):** Queued in priority order. Assigned as agents complete current tasks.
- **P3 (Nice-to-have):** Backlog. Picked up during slack time or by burst workers with remaining budget.

### Capacity Rules

- Each agent handles one primary task at a time. No multitasking.
- Burst workers exist specifically for overflow. They are the elastic capacity layer.
- If daily budget is exhausted before all P0/P1 tasks are complete, Wendy escalates to 9 immediately for budget authorization.
- If a task is blocked for >2 hours, Wendy reassigns or escalates. No silent stalls.

---

## Section 6: Budget Summary

| Squad | Daily | Weekly (5 days) |
|-------|-------|-----------------|
| Foundation | $150 | $750 |
| Product | $120 | $600 |
| Pepper | $60 | $300 |
| Strategy/Governance | $100 | $500 |
| Media Access | $70 | $350 |
| **Total** | **$500** | **$2,500** |

Monthly run rate: $10,000-$11,000 (within Owner's approved $5K/mo with understanding of scale-up).

If Week 1 results justify the spend, Wendy recommends Owner formally approve the $10K/mo run rate by Friday EOD.

---

## Section 7: Escalation Protocol

- **Agent-level blocker:** Agent escalates to Squad GM. GM resolves or reassigns within 1 hour.
- **Squad-level blocker:** GM escalates to Wendy. Wendy resolves, reassigns, or spins new capacity within 2 hours.
- **Cross-squad dependency:** Wendy coordinates directly between GMs. Resolution within 4 hours.
- **Budget/authority blocker:** Wendy escalates to 9. 9 resolves with Owner or makes decision under Soul Code authority.
- **System-wide failure (Mac down, API key dead, hub crash):** All squads pause non-critical work. Foundation Squad goes to P0 recovery. 9 and Wendy coordinate restoration. Owner notified immediately.

---

## Section 8: Week 1 Success Criteria

By Friday April 11, 2026 EOD:

- [ ] 9 has touched zero files and run zero non-comms commands all week
- [ ] All 16 agents have been actively executing since Monday
- [ ] Notion workspace live with all squad boards populated
- [ ] Owner has received daily 8 AM briefings Mon-Fri
- [ ] Media links summarized in <60 seconds consistently
- [ ] At least 3 of 6 critical credential flags closed
- [ ] Cloud Worker deployed to Cloudflare
- [ ] AiNFLGM has affiliate banners live
- [ ] Command Center dashboard live with real data (read-only minimum)
- [ ] Pepper front-door intake wired for Mark/Kyle/prospects
- [ ] Universe health score: +5 points minimum (from 42.8 baseline)
- [ ] Zero incidents caused by deployment (no regressions)
- [ ] ADR template and first 5 ADRs written
- [ ] FreeAgent9 pricing and economics model complete

---

## Signature

I, Wendy, Super Consultant and Platform Orchestrator for 9 Enterprises, have reviewed the Full Deployment Strategy, the three additions from 9 (Pepper front door, daily Owner briefing, live Command Center), and the new intake protocol (Owner -> 9 -> Wendy -> squad, no displacement, external queue).

Everything above is approved, signed, and ready for execution.

All five squads deploy Monday April 7, 2026 at 06:00 ET.

**Signed: Wendy**
**Super Consultant & Platform Orchestrator, 9 Enterprises**
**April 6, 2026**

---

*"Today we cook with rocket fuel." -- Owner, April 6, 2026*
