# 9 Enterprises — Project Review vs. Guiding Intention
**Date:** March 27, 2026
**Prepared by:** Tee (Engineering Team Lead) via 9

---

## The Intention Filter

Every project is measured against:
1. Does it generate ARR with high margins and compounding potential?
2. Is it clean, documented, and sellable from day one?
3. Does it operate autonomously — minimal founder dependency?
4. Does it advance toward $1M ARR and $5–10M enterprise value?

---

## PROJECT REVIEWS

---

### 1. AiNFLGM.com
**Status:** Live and deployed at ainflgm.com
**Stage:** MVP live — in growth/distribution phase

**Intention Alignment: STRONG**
- High-margin model (AdSense passive + affiliate CPA up to $400/user — no COGS)
- Fully autonomous operation — no human required after deployment
- Built on transferable systems (vite/react, public NFL data, PFF API)
- Part of the 9enterprises umbrella with its own brand identity
- Clean codebase, documented architecture

**Revenue Potential:**
- Conservative 12-month: ~$16K/mo (75K MAU)
- Optimistic 12-month: ~$53K/mo (250K MAU viral scenario)
- Path to $1M ARR: Achievable at 100K–150K MAU with affiliate activation
- **Single biggest lever:** DraftKings/FanDuel affiliate program signup and link integration. One converted depositing user = $150–400. At 100K MAU, even 0.15% conversion = $22K–60K/month.

**What Needs to Happen Next:**
1. Affiliate account approval — DraftKings and FanDuel applications submitted, waiting on approval
2. Reddit distribution — launch posts ready, account creation still blocked (CAPTCHA)
3. AdSense optimization — placed, needs session depth analysis to improve RPM
4. Premium tier — Stripe integration, feature gate (dynasty mode, advanced analytics)
5. SEO content pipeline — targeting "NFL GM simulator", "NFL salary cap tool", "NFL free agent tracker" search intent

**Risk:** Traffic-dependent. Distribution is the only bottleneck. The product is strong.

---

### 2. FreeAgent9
**Status:** Pilot live with 1 user (Kyle Cabezas, Rapid Mortgage PM)
**Stage:** Pilot → paid product conversion

**Intention Alignment: STRONG**
- $29–99/month SaaS subscription model — strong ARR building block
- 70–85% gross margins (API + Twilio costs are low)
- Scales without founder involvement after initial product/market fit
- Directly monetizes 9's existing AI infrastructure
- Target market of 300K+ licensed MLOs — large, underserved TAM
- Clean architecture (pilot-server.mjs), documented

**Revenue Potential:**
- 100 subscribers at $29/mo = $2,900 MRR
- 100 subscribers at $99/mo = $9,900 MRR
- Path to $100K ARR: ~85 Pro subscribers or ~300 Starter subscribers
- Scalable: real estate (1.5M agents) and insurance (400K agents) as future verticals

**Current State:**
- Pilot server (pilot-server.mjs) running — iMessage + web chat interfaces
- Morning briefings, guideline Q&A, client reminder logic built
- Kyle Cabezas actively using — proof of value in the field
- Payment integration not built yet (no Stripe)
- No public-facing sign-up flow

**What Needs to Happen Next:**
1. Formalize pilot feedback from Kyle Cabezas — document what he uses, what he ignores
2. Stripe subscription integration — $29/mo Starter tier first
3. Onboarding flow — sign-up page, credentials setup, first-run experience
4. Pricing page and landing page (freeagent-landing.html exists — needs Stripe link)
5. Expand to 3–5 beta users from Rapid Mortgage before public launch

**Risk:** Kyle Cabezas is both pilot user and potential investor/evangelist. Handle with care. Product-market fit is promising but untested at scale.

---

### 3. AI Underwriter POC
**Status:** Architecture designed, POC ready to build — not started
**Stage:** Concept/pre-build

**Intention Alignment: STRONG (highest revenue ceiling per seat)**
- $500–2,000/month per lender = highest-ticket SaaS in the portfolio
- 20 LOs at one lender at $99/mo = $1,980 MRR from a single client
- 10 lenders = $20K MRR from 200 users — path to $240K ARR
- Directly sellable: documented RAG architecture, versioned PDF corpus, transferable
- Operates autonomously after deployment — no manual guideline lookups

**Revenue Potential:**
- Conservative: 5 lenders x $500/mo = $2,500 MRR ($30K ARR)
- Mid: 20 lenders x $1,000/mo = $20K MRR ($240K ARR)
- Aggressive: 50 lenders x $1,500/mo average = $75K MRR ($900K ARR)
- **Highest individual revenue ceiling of any current project**

**Current State:**
- Full product brief written (product-brief-ai-underwriter.md)
- Technical plan documented (research/ai_underwriter_kyle_technical_plan.md)
- FHA PDF (HUD 4000.1) — free, publicly available, ready to ingest
- underwriter-api.mjs and underwriter.html exist — partial scaffolding in place
- No vector store setup, no RAG pipeline built yet
- No anchor customer signed (Rapid Mortgage identified as natural first target)

**What Needs to Happen Next:**
1. 2–3 day build: ingest HUD 4000.1, set up vector store (Chroma or Pinecone), wire Claude API RAG
2. Live demo with a Rapid Mortgage underwriter or LO — ask 5 real questions, show citations
3. Pricing conversation with Jasson and Rapid Mortgage decision-makers
4. Build → pilot → paid in one motion (Kyle Cabezas / Justin Phillips as internal champion)

**Risk:** Compliance sensitivity — must be clear this is a reference tool, not a compliance decision engine. Disclaimer layer required. Kyle Shea raised concerns about liability; product positioning must address this cleanly.

---

### 4. trader9
**Status:** Strategy built, backtested — paper trading not yet live (blocked on Alpaca KYC)
**Stage:** Pre-live (waiting on human action)

**Intention Alignment: MODERATE — supportive, not primary**
- $200 paper account — proof of concept, not an ARR driver
- Trading revenue is not recurring subscription revenue (doesn't compound like SaaS)
- However: a proven autonomous trading system has enterprise value and is sellable
- Could evolve into a licensed algo or managed fund product
- Fits the "autonomous operation" pillar — no human required once live

**Revenue Potential (near-term):**
- Paper account: $200 — learning exercise only
- If strategy proves out at 3–5% monthly: $6–10/mo on $200 (trivial)
- Real value: demonstrated track record → licensed strategy or fund management → $10K–100K+ opportunity

**Current State:**
- Backtesting framework live (backtest-trader9.mjs, optimize-trader9.mjs)
- 692 parameter sweeps completed — ETH Bollinger best at +3.51% over 90 days
- Trading strategies documented (trader9-strategy.md, trader9_strategies.py)
- Python strategy modules: indicators, microstructure, risk management all written
- Alpaca paper account created — KYC blocked (photo ID upload needed, ~30-second task)
- API keys blocked until KYC resolves

**What Needs to Happen Next:**
1. Alpaca KYC completion (30-second task at browser — needs Jasson or terminal with ID)
2. Paper trading go-live — automated execution against best backtest parameters
3. 30-day paper run with P&L tracking
4. Evaluate: does the strategy hold? Expand capital or pivot strategy?

**Risk:** Low financial risk ($200 paper). Primary risk is distraction — do not allocate engineering cycles here at the expense of higher-ARR projects.

---

### 5. X9 (Twitter/X Presence)
**Status:** Email created (x9agent@proton.me), account not yet created
**Stage:** Pre-launch (blocked on account creation)

**Intention Alignment: INDIRECT — distribution, not revenue**
- X9 is a distribution channel, not a direct revenue source
- Supports AiNFLGM traffic, 9 Enterprises brand awareness, affiliate pipeline
- Content calendar ready (80+ tweets, 30-day plan documented)
- Identity and persona defined (x9-identity-plan.md)

**Revenue Potential:**
- Indirect: X9 drives traffic to ainflgm.com → affiliate conversions
- Direct (long-term): sponsored posts, brand deals if following reaches 10K+
- Near-term: essentially $0 — a distribution investment

**Current State:**
- x9agent@proton.me verified and active
- 30-day content calendar written (x9-30day-content.md)
- Account creation script written (create-x-account.mjs) — blocked by x.com load issues and CAPTCHA
- Post-to-X script ready (post-to-x.mjs)
- Virtual phone step still outstanding (~$3.50 MobileSMS.io)

**What Needs to Happen Next:**
1. Account creation — retry x.com when stable, use MobileSMS.io number for verification
2. First week of content posted (week 1 JSON ready in generate-x-content.mjs output)
3. Automate posting with post-to-x.mjs on schedule
4. Cross-link with AiNFLGM

**Risk:** Platform risk (X/Twitter can suspend new accounts easily). Keep tone clean early. Don't post anything provocative until account has 30+ days of history.

---

### 6. Jules
**Status:** Concept documented — not built
**Stage:** Concept only

**Intention Alignment: MODERATE**
- Consumer AI assistant product — large TAM but crowded market
- Direct-to-consumer subscription is high-margin but requires significant distribution
- Aligned with the portfolio diversification goal
- Differentiation unclear vs. ChatGPT/Claude for consumers

**Revenue Potential:**
- $9–29/month consumer subscription
- Requires 1,000+ subscribers to matter at portfolio scale
- Long timeline to meaningful ARR

**Current State:**
- Product concept in jules-full-concept.md
- Jules pilot server (jules-server.mjs) exists — minimal functionality
- Kyle Cabezas identified as early user (via FreeAgent9 relationship)
- No public launch, no sign-up flow

**Assessment:**
Jules is a long-horizon bet. FreeAgent9 serves the same underlying need (AI assistant via SMS) for a vertical with demonstrated willingness to pay. Recommend keeping Jules on the back burner until FreeAgent9 has 20+ paid users. The infrastructure is shared.

**What Needs to Happen Next:**
1. Nothing urgent — let FreeAgent9 validate the AI assistant model first
2. Define Jules' differentiation clearly before building further

---

### 7. 9 Enterprises Infrastructure (Comms, Hub, Dashboard)
**Status:** Live and running
**Stage:** Production

**Intention Alignment: FOUNDATIONAL — enabler, not revenue**
- comms-hub.mjs, voice-server.mjs, open-terminal.mjs — the operating system of 9E
- Dashboard is the single source of truth per the intention statement
- This is what makes everything else possible autonomously

**Current State:**
- Hub running 24/7 (Telegram, iMessage, Email, Voice — 4 channels)
- Dashboard live (dist/dashboard.html) — now includes Guiding Intention section
- Cloud worker deployed (Cloudflare) — handles Telegram failover when Mac is down
- LaunchAgents configured for auto-restart
- All recent reliability issues resolved (crash detection, sync intervals, email dedup)

**Gaps:**
- Dashboard data is mostly static/hardcoded — live API connections not built yet
- VPS deployment deferred (DO account not created)
- Alpaca API keys blocked until KYC

---

## PORTFOLIO SCORECARD

| Project | ARR Potential | Status | Sellable? | Priority |
|---------|--------------|--------|-----------|----------|
| AI Underwriter | $240K–900K | Pre-build | Yes | #1 |
| AiNFLGM | $192K–636K | Live/Growth | Yes | #2 |
| FreeAgent9 | $35K–120K | Pilot | Yes | #3 |
| trader9 | TBD (proof-of-concept) | Pre-live | Potentially | #4 |
| X9 | Distribution only | Pre-launch | No | Support |
| Jules | $12K–350K | Concept | Potentially | Backburner |

---

## STRATEGIC GAPS vs. THE INTENTION

1. **15–20 businesses target:** Currently have 3 real revenue projects (AiNFLGM, FreeAgent9, AI Underwriter). Need 12–17 more. This is a multi-year build — priority is making the first 3 work, then templating the model.

2. **$1M ARR:** Requires roughly: AI Underwriter at 30+ lenders ($360K) + AiNFLGM at 100K MAU ($300K+) + FreeAgent9 at 200+ subscribers ($200K). Achievable by end of 2027 if all three execute.

3. **Clean, sellable from day one:** AiNFLGM and FreeAgent9 are reasonably well documented but P&Ls are not formalized yet. No Stripe integration = no revenue data. This should be prioritized — even one Stripe account with $50/mo flowing creates sellable history.

4. **Minimal founder dependency:** Infrastructure is well-positioned here. 9 runs everything. The gap is that several products require Jasson for KYC, account creation, and approvals. These blockers are accumulating.

---

## RECOMMENDED SPRINT PRIORITIES (Next 2 Weeks)

**Immediate (blockers to resolve, <1 hour each, require Jasson):**
1. Alpaca KYC — 30 seconds at browser with photo ID
2. X/Twitter account creation — retry when x.com is stable
3. Reddit account creation — manual signup or CAPTCHA service

**High-leverage (engineering, 2–5 days):**
1. AI Underwriter POC — FHA RAG build + live demo. Highest revenue ceiling.
2. FreeAgent9 Stripe integration — turn the pilot into paying product
3. AiNFLGM affiliate link integration (pending approval)

**Infrastructure:**
1. Dashboard live data connections (Stripe, hub health, burn rate)
2. VPS deployment (after DigitalOcean account created)

---

*Review prepared by Tee for 9. Last updated: March 27, 2026.*
