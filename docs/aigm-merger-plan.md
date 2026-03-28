# AiGM Umbrella Strategy — Research Brief
**Prepared by:** UNO (Research Team Lead)
**Date:** March 27, 2026
**Subject:** Merging AiNFLGM into AiGM umbrella brand covering NFL, NBA, MLB

---

## Summary

AiNFLGM has a well-structured React codebase where approximately 65-70% of the app logic is sport-agnostic and reusable. The recommended approach is a Monorepo (Approach A) with a shared component library and sport-specific config/data packages. A multi-tenant SPA (Approach C) is the right *product experience* — one app, sport selector — but should be built inside a monorepo structure, not as a flat single-repo SPA. Domain recommendation is aigm.com as the umbrella with subdomains per sport. AiNBA GM can launch within 3-5 weeks on top of the existing architecture.

---

## 1. Architecture Reuse Analysis

### Codebase Inventory

| Category | Files | Lines | Sport-Specific? |
|---|---|---|---|
| Data: allRosters.js | 1 | 28,667 | 100% NFL |
| Data: bengalsRoster.js | 1 | 110 | 100% NFL |
| Data: draftProspects.js | 1 | 256 | 100% NFL |
| Data: freeAgents.js | 1 | 118 | ~90% NFL |
| Data: offseasonMoves.js | 1 | 583 | ~90% NFL |
| Data: teamDeadCaps.js | 1 | 307 | 100% NFL |
| Data: teams.js | 1 | 36 | 100% NFL (32 teams, colors, picks) |
| Context: GameContext.jsx | 1 | ~420 | 60-70% NFL-specific logic |
| Pages (11 files) | 11 | 7,635 | 30-40% NFL-specific |
| Components (8 files) | 8 | 2,613 | 20-25% NFL-specific |
| Config: affiliates.js | 1 | ~90 | 0% (generic structure) |

**Total app code (excluding data): ~10,760 lines**

### What Is Genuinely Sport-Agnostic (Reusable As-Is)

- **Full UI shell:** Layout.jsx, FloatingMenu.jsx, EmailCapture.jsx, ShareButtons.jsx, ScenarioManager.jsx — zero sport logic, 100% portable
- **Context architecture:** The useReducer + Context pattern in GameContext.jsx is completely portable. Actions like SIGN_PLAYER, CUT_PLAYER, TRADE_PLAYER, SAVE_SCENARIO are sport-neutral concepts. Only the cap math rules differ.
- **AiSuggest.jsx:** The suggestion engine is generic — it analyzes roster gaps, cap tightness, expiring contracts. The position group names are the only sport-specific data. Swap the positionGroupMap and it works for any sport.
- **Prediction Markets, Leaderboard:** No sport-specific logic. Generic data structures.
- **Route structure:** All 11 pages have parallel equivalents in NBA/MLB (roster, cap, free agency, draft/trade, season sim, summary).
- **Affiliate config:** affiliates.js is a generic config file. NBA/MLB sportsbooks slot right in.
- **Vite + PWA config:** Fully reusable. Just swap theme_color, name, and icons.
- **Cap gauge, trade values, scenario save/load:** All generic simulation patterns.

### What Is NFL-Specific and Must Be Rebuilt Per Sport

- **Data layer (everything in /src/data/):** 28,000+ lines of NFL roster, salary, cap, draft data. Each sport needs its own equivalent dataset built or sourced.
- **GameContext cap math:** The "Top 51" rule, franchise tag logic, dead money/restructure mechanics, and the 4-year rookie deal structure are NFL-specific. NBA has a different CBA (max contracts, supermax, Bird rights, two-apron system). MLB has no true salary cap — it uses a luxury tax.
- **SeasonSimPage.jsx:** NFL divisions (AFC/NFC), 17-game schedule format, playoff seeding. Must be rebuilt per sport.
- **DraftPage.jsx:** NFL draft (7 rounds, 257 picks). NBA draft is 2 rounds/60 picks. MLB draft is 20 rounds. Logic adapts but requires rewrite.
- **Position groups:** NFL (QB/RB/WR/TE/OL/DL/LB/DB) vs NBA (PG/SG/SF/PF/C) vs MLB (SP/RP/C/1B/2B/3B/SS/OF). Maps over easily but hardcoded throughout.
- **Cap rule engine in GameContext:** ~40-50 lines of pure NFL logic (Top 51, franchise tag, prorated bonus spread) need sport-specific equivalents.
- **Team data:** 32 NFL teams with draft picks. NBA = 30 teams, NBA draft lottery order. MLB = 30 teams, no draft picks in the same way.

### Reuse Percentage Estimate

| Layer | Reusable % | Notes |
|---|---|---|
| UI components | 85% | Minor position label changes |
| Page layouts/structure | 75% | Structure reusable, data bindings swap |
| GameContext architecture | 70% | Pattern reusable, cap rules sport-specific |
| Cap/salary logic | 30% | Rules fundamentally different per sport |
| Data files | 0% | 100% rebuild — different sport entirely |
| **Overall blended** | **~65-70%** | Data is the heavy lift, not code |

**Bottom line: The app's skeleton, UI, simulation engine, and state management are all reusable. The data pipeline and cap rule engine are the only things that must be rebuilt per sport. This is favorable for a shared architecture.**

---

## 2. Approach A — Monorepo

**Structure:**
```
aigm/
  packages/
    ui/              — shared React components (Layout, FloatingMenu, AiSuggest, etc.)
    game-engine/     — sport-agnostic simulation logic (ScenarioManager, Context base)
    affiliates/      — shared affiliate config
  apps/
    nfl/             — AiNFLGM (current codebase migrated here)
    nba/             — AiNBA GM
    mlb/             — AiMLB GM
    web/             — aigm.com landing page / sport selector
  data/
    nfl/             — all current NFL data files
    nba/             — NBA salary/roster data (to be built)
    mlb/             — MLB payroll/roster data (to be built)
```

**Tooling:** Turborepo (simpler, Vite-native, JS/TS-focused — best fit here given existing Vite stack). pnpm workspaces for dependency management.

**Pros:**
- One PR touches shared UI and all three sports apps simultaneously
- Bug fixes in AiSuggest.jsx propagate to NFL, NBA, MLB at once
- Single CI/CD pipeline, one set of shared dependencies
- No code drift between sport apps — they're always in sync on shared components
- Easier to build and maintain a unified AiGM brand identity
- One place to manage affiliate links, FTC disclosures, AdSense config

**Cons:**
- Upfront migration cost (~1 week to restructure current AiNFLGM into monorepo)
- Slightly more complex local dev setup (pnpm workspaces instead of plain npm)
- Overkill if only ever building two sports

**Verdict:** Best long-term architecture for a 3-sport platform. Upfront cost is low given the codebase size.

---

## 3. Approach B — Template Fork

**Structure:** Fork BengalOracle repo to AiNBAGM repo, AiMLBGM repo. Edit independently.

**Pros:**
- Fastest to start — fork and build immediately
- Each sport team works in total isolation
- Simple CI/CD per repo

**Cons:**
- Code immediately diverges on day 1. Fix a bug in AiSuggest.jsx for NFL, manually copy it to NBA and MLB repos.
- After 6 months, three codebases are meaningfully different. Shared improvements require triple the work.
- No unified branding or shared component library
- Three separate dependency trees to maintain and upgrade
- Multiplied technical debt — the cost compounds with every shared feature added

**Verdict:** Do not use this approach. It is the fastest path to a maintenance nightmare with three active sports. The time saved on day 1 is paid back 3x within 60 days.

---

## 4. Approach C — Multi-Tenant SPA

**Structure:** Single repo, single deployed SPA. Route-based sport switching at runtime.
- aigm.com/nfl — NFL game
- aigm.com/nba — NBA game
- aigm.com/mlb — MLB game

**Pros:**
- Single deployment unit
- Users can switch sports without leaving the site — increases session time and page views (AdSense win)
- One domain to rank for SEO
- Unified leaderboard, prediction markets, user profile across sports

**Cons:**
- Bundle size becomes enormous if all three sports' data loads together. allRosters.js alone is 28,000 lines / ~672KB. Three sports = 2MB+ of data bundles.
- The current Vite manualChunks strategy already splits data into separate chunks — this can be extended to lazy-load per sport, but requires architecture work.
- A single broken deploy takes down all three sports simultaneously
- Sport-specific PWA manifests (different icons, theme colors, names) become complicated in a single SPA

**Verdict:** Multi-tenant routing is the right *user experience* model, and should be the product design. But it should be implemented inside a monorepo architecture, not as a flat single-repo SPA. Build it as separate apps in a monorepo, with a shared landing page and navigation shell that routes between them. Lazy-load each sport's data bundle on demand.

**Recommended hybrid:** Monorepo + route-based navigation shell (get the best of both A and C).

---

## 5. Recommendation — The Right Approach

**Build: Monorepo (Approach A) + multi-sport navigation shell (Approach C UX)**

Execution plan:

1. Restructure AiNFLGM into a Turborepo monorepo. Extract shared components to `packages/ui`. Keep all existing NFL data and pages in `apps/nfl`. This migration is ~1 week.
2. Build `apps/web` — the aigm.com landing page with sport selector (NFL, NBA, MLB). Each sport card routes to its subapp.
3. Build `apps/nba` using shared components. NFL GameContext becomes a template. NBA cap rules replace NFL cap rules. NBA data fills the data layer.
4. Repeat for MLB when ready.

The shared components do the heavy lifting — the work for sport #2 is ~40% of the work for sport #1.

---

## 6. Domain Strategy

### Recommendation: aigm.com as umbrella + subdomains per sport

**Preferred structure:**
- aigm.com — brand homepage, sport selector, about, privacy
- nfl.aigm.com — AiNFLGM (current site)
- nba.aigm.com — AiNBA GM
- mlb.aigm.com — AiMLB GM

**Why subdomains over paths (aigm.com/nfl):**
- Each sport has its own PWA manifest, theme color, and icon. Subdomains make PWA install UX clean — users install "AiNFL GM" vs "AiGM/nfl".
- Subdomains allow independent deployment per sport. An NFL deploy doesn't touch NBA.
- Sports fans self-identify by sport — they'll bookmark nfl.aigm.com, not aigm.com/nfl.
- Google treats subdomains as related but independent for SEO — existing SEO equity on ainflgm.com can be redirected.

**Alternative worth considering:** Keep ainflgm.com active and 301 redirect to nfl.aigm.com. Protects existing SEO equity while migrating to the new brand. ainbagm.com and aimlbgm.com can launch directly on the new structure.

**Domain status for aigm.com:** A WHOIS check is needed to confirm availability. The search results surfaced an X account @AIGM_Official (AI Game Master) that is unrelated — a tabletop RPG context. No active sports product is using aigm.com as a brand. Strongly recommend checking GoDaddy/Namecheap immediately — if available, acquire it now before this plan is shared externally.

**Backup domain options if aigm.com is taken:**
- theaigm.com
- aigmapp.com
- plaiaigm.com
- aigmsports.com

---

## 7. Data Sources for NBA and MLB

### NBA Data Sources

| Source | What It Provides | Cost | API? | OTC Equivalent? |
|---|---|---|---|---|
| Spotrac (spotrac.com/nba) | Team salary cap tracker, player contracts, cap space, apron tracking, multi-year projections | Free web | No public API | Closest NBA equivalent to OTC |
| HoopsHype (hoopshype.com/salaries) | Per-player salary data, contract terms | Free web | No | Strong supplemental source |
| Basketball-Reference.com/contracts | Complete roster salary data | Free web | No public API | Good for historical verification |
| SalarySwish.com | NBA cap tracker + trade machine | Free web | No | Good for trade simulation reference |
| balldontlie.io | Roster, stats, player data | Free tier available | Yes — REST API | Good for roster data |
| nba_api (Python, GitHub: swar/nba_api) | Official NBA.com stats endpoint wrapper | Free, open source | Unofficial API | Good for stats, not salary |
| RealGM | Salary cap history | Free web | No | Cap history verification |

**2025-26 NBA cap:** $154.647M salary cap / $187.895M luxury tax / $195.945M first apron / $207.824M second apron

**Build strategy for AiNBA GM data layer:** Spotrac + HoopsHype manual scrape for initial static dataset (same approach used for OTC data in the NFL build). The balldontlie.io free API covers roster and player data. Contract data gets manually compiled into a static JS file structured identically to allRosters.js — sport-specific values, generic data structure. The 30-team NBA roster/salary dataset will be substantially smaller than the NFL's 28,000-line file because NBA rosters are 15 players vs 53 for NFL.

**Estimated NBA data build time:** 2-3 days for a clean initial dataset covering all 30 teams. Spotrac and HoopsHype provide everything needed.

### MLB Data Sources

| Source | What It Provides | Cost | API? | Notes |
|---|---|---|---|---|
| Spotrac (spotrac.com/mlb) | Payroll tracker, AAV, luxury tax projections, multi-year cap | Free web | No public API | Primary source |
| FanGraphs Roster Resource (fangraphs.com/roster-resource) | Full payroll breakdown per team, contract type, future projections | Free web | No | Extremely detailed, per-team pages |
| Cot's Baseball Contracts (legacy.baseballprospectus.com) | Contract details, historical salary | Free web | No | Industry standard for historical data |
| Baseball-Reference.com | Comprehensive player and team stats | Free web | No public API | Strong verification source |
| balldontlie.io | MLB data (they cover MLB per their homepage) | Free tier | Yes | Check coverage depth |

**2026 MLB luxury tax threshold:** $244M (first threshold). Penalties scale at $264M, $284M, $304M. No hard cap — it's a competitive balance tax.

**Important MLB structural difference:** MLB has no salary cap, only a luxury tax. The "cap tracker" concept becomes a "payroll vs luxury tax threshold" tracker. This is actually simpler to model — no "Top 51" rules, no dead money in the same sense, no franchise tags. Trade logic and contract restructuring mechanics don't exist the same way. The simulation engine simplifies.

**Estimated MLB data build time:** 2-3 days. 30 teams x ~26-man rosters = ~780 players. Smaller scope than NFL.

---

## 8. Timeline Estimate — AiNBA GM Launch

Assumes monorepo migration is done first (recommended).

| Phase | Task | Duration |
|---|---|---|
| Week 1 | Monorepo migration — restructure AiNFLGM into Turborepo, extract shared packages, verify NFL app still works | 5-7 days |
| Week 2 | NBA data build — compile 30-team roster/salary/cap dataset from Spotrac + HoopsHype | 2-3 days |
| Week 2 | NBA GameContext — adapt cap rules (max contracts, Bird rights, two-apron mechanics, 15-man rosters) | 3-4 days |
| Week 3 | NBA-specific pages — adapt SeasonSim (NBA divisions, 82-game schedule, playoff seeding), Draft (2-round lottery), position groups (PG/SG/SF/PF/C) | 4-5 days |
| Week 3-4 | Polish + testing — team colors, AiSuggest NBA suggestions, PWA config, mobile QA | 3-4 days |
| Week 4 | Domain setup — aigm.com acquisition, subdomain routing, ainflgm.com 301 redirect | 1 day |

**Total estimated timeline: 3-5 weeks from start to AiNBA GM launch**

Using the calibrated ETA model (agent work completes ~7.5x faster than estimates): if sub-agents are deployed for data compilation and cap rule implementation in parallel, this compresses to 10-14 actual calendar days.

**AiMLB GM after NBA:** Add 2-3 weeks on top of NBA launch. MLB is simpler (no hard cap = simpler engine), but roster data is larger (40-man rosters + DL). Realistically 2 weeks after NBA is live.

---

## 9. Revenue Impact

### AdSense Scaling Model

Current AiNFLGM has a single-sport audience: NFL fans, peak traffic during offseason (March-August) and draft season. Dead traffic November-February during NFL regular season when no offseason activity.

Adding NBA GM and MLB GM fills the traffic calendar:

| Sport | Peak Traffic Window | AdSense Opportunity |
|---|---|---|
| NFL GM | March-August (free agency, draft, camp) | High — currently captured |
| NBA GM | June-October (free agency, draft, summer league) | Fills the gap post-NFL draft |
| MLB GM | December-March (winter meetings, hot stove) + July (trade deadline) | Fills NFL offseason ramp-up period |

**Combined result:** Near year-round traffic with overlapping peaks. This is the most important AdSense multiplier — not just additive users, but continuous engagement replacing seasonal dead zones.

**Traffic multiplier estimate (conservative):**
- 3 sports = ~3x total user base (different sport audiences, minimal overlap)
- Year-round engagement vs seasonal = roughly doubles effective monthly impressions vs a single sport
- Combined AdSense impact: 4-6x current NFL-only revenue once all three sports are live

### Affiliate/Sportsbook Revenue

All three sports have deeply integrated DraftKings/FanDuel affiliate programs. The affiliate structure in affiliates.js is already generic — adding NBA and MLB affiliate SKUs is a config update, not a code change. DraftKings and FanDuel have specific NBA and MLB DFS products with their own affiliate tiers. An AiNBA GM user who signs up for DraftKings NBA DFS is a higher-LTV conversion than a casual visitor.

**Cross-sport affiliate upsell:** A user on nfl.aigm.com sees a banner for AiNBA GM during NBA free agency season. This is a meaningful retention and LTV play — retaining users in your ecosystem across sport seasons rather than losing them to ESPN or a competitor.

### Brand Value

The AiGM umbrella creates a defensible brand position: "The AI general manager simulator for every major sport." This is a category-defining play, not a niche NFL tool. Higher brand equity = better partnership discussions (DraftKings, FanDuel, Sportradar, ESPN affiliate programs) and a more compelling acquisition story if the business ever exits.

---

## 10. Gaps and Open Questions

| Item | Status | Action Needed |
|---|---|---|
| aigm.com domain availability | Unknown | Check WHOIS immediately — acquire before circulating this plan |
| ainflgm.com SEO equity | Not measured | Run Google Search Console data pull to assess before deciding on redirect timing |
| NBA cap rule complexity | Research done, not implemented | NBA two-apron system is significantly more complex than NFL cap. May need to simplify for v1. |
| MLB trade deadline simulator | Not scoped | MLB's biggest sim moment is the July 31 trade deadline, not free agency. Page structure may need a "Trade Deadline Mode" that NFL/NBA don't have. |
| Sportradar API cost | Not evaluated | Paid API options (Sportradar, SportsData.io) offer real-time data but cost $500+/mo. Not needed for MVP — manual static datasets work at current scale. Revisit at 10K daily users. |
| balldontlie.io free tier limits | Unknown | Free tier rate limits need confirmation before committing it as a data source |
| React Native / mobile app | Not scoped | Multi-sport umbrella significantly improves the case for a native app. Not in this plan but worth noting. |

---

## Confidence Ratings

| Finding | Confidence |
|---|---|
| 65-70% code reuse estimate | High — based on direct codebase analysis |
| Monorepo as best architecture | High — well-established pattern, directly applicable |
| Turborepo as tooling choice | High — best fit for Vite + JS/TS stack |
| 3-5 week NBA GM timeline | Medium — assumes focused agent execution, no major blockers |
| Spotrac/HoopsHype as NBA data sources | High — both are live, comprehensive, free |
| FanGraphs/Spotrac as MLB data sources | High — both are live, comprehensive, free |
| 4-6x AdSense revenue multiplier | Medium — directional estimate, actual depends on traffic acquisition |
| aigm.com domain status | Low — not verified, needs immediate check |

---

## Sources

- [Spotrac NBA Cap Tracker 2025-26](https://www.spotrac.com/nba/cap)
- [NBA.com official 2025-26 salary cap announcement](https://www.nba.com/news/nba-salary-cap-set-2025-26-season)
- [HoopsHype NBA Salaries](https://hoopshype.com/salaries/)
- [Basketball-Reference Contracts](https://www.basketball-reference.com/contracts/)
- [SalarySwish NBA Cap Tracker](https://www.salaryswish.com/)
- [balldontlie.io Sports API](https://www.balldontlie.io/)
- [Spotrac MLB Tax Tracker 2026](https://www.spotrac.com/mlb/tax)
- [FanGraphs Roster Resource Payroll](https://www.fangraphs.com/roster-resource/breakdowns/payroll)
- [Cot's Baseball Contracts](https://legacy.baseballprospectus.com/compensation/cots/)
- [Best Monorepo Tools 2026: Turborepo vs Nx](https://www.pkgpulse.com/blog/best-monorepo-tools-2026)
- [Monorepo vs Polyrepo Complete Guide 2026](https://ztabs.co/blog/monorepo-vs-polyrepo-guide)
- [Turborepo managing multiple React apps](https://syskool.com/monorepo-with-turborepo-or-nx-managing-multiple-react-apps/)
- [CBS Sports NBA salary cap 10% increase 2025-26](https://www.cbssports.com/nba/news/nba-salary-cap-to-rise-by-10-for-2025-26-season-what-reported-increase-means-for-aprons-luxury-tax-more/)
