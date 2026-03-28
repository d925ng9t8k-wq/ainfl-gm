# AiNFLGM / AiNBA GM / AiMLB GM — Data Update Process

**Last updated:** March 27, 2026
**Author:** UNO (Research Team Lead, 9 Enterprises)

---

## Current Data Status

| Simulator | Last Updated | Source | Confidence |
|-----------|-------------|--------|------------|
| NFL (allRosters.js) | March 26, 2026 | OTC auto-refresh + manual cap pass | High |
| NBA (nbaRosters.js) | March 28, 2026 | Initial build | Medium — needs spot-check |
| MLB (mlbRosters.js) | March 28, 2026 | Initial build | Medium — needs spot-check |

---

## Spot-Check Results (NFL, March 27, 2026)

Four major players verified against live OTC/Spotrac data:

| Player | Team | Our Cap Hit | Actual Cap Hit | Delta | Status |
|--------|------|-------------|----------------|-------|--------|
| Josh Allen | BUF | $44.23M | $44.2M | ~$30K | PASS |
| Lamar Jackson | BAL | $34.54M | $34.54M | $0 | PASS |
| Patrick Mahomes | KC | $34.65M | $34.65M | $0 | PASS |
| Saquon Barkley | PHI | $9.88M | $9.88M | $0 | PASS |

NFL data is accurate as of March 26, 2026. All four players reflect post-restructure numbers. No errors found.

---

## NFL Update Cadence

### Free Agency Window (March — ongoing through May)
- **What changes:** Players change teams, new contracts signed, released players added to FA pool
- **Data files affected:** `allRosters.js`, `freeAgents.js`, `teamDeadCaps.js`
- **Update trigger:** Any major signing or release that affects team rosters or cap totals
- **Frequency:** Weekly during March-May, monthly June-July

### NFL Draft (Late April)
- **What changes:** Rookies added to rosters, draft pick slot cap figures assigned
- **Data files affected:** `allRosters.js`, `draftProspects.js`
- **Update trigger:** Day after draft concludes (Day 3 + 1)
- **Note:** Rookie cap hits are slotted by pick — predictable from pick number, formulaic

### Training Camp Cuts (August — 90 → 53 man rosters)
- **What changes:** ~37 players cut per team (1,184 total across league), practice squad moves
- **Data files affected:** `allRosters.js`
- **Update trigger:** Final cut day (typically August 26-27)
- **This is the highest-volume single update of the year**

### In-Season Trades (September — January)
- **What changes:** Player moves teams, cap hit splits between teams
- **Data files affected:** `allRosters.js`
- **Update trigger:** As trades happen — within 48 hours ideally
- **Frequency:** Low volume (NFL trade market is slow vs. NBA/MLB)

---

## NBA Update Cadence

### Free Agency (June 30 — mid-August)
- **What changes:** Players sign new contracts, max deals, veteran minimums
- **Data files affected:** `nba/nbaRosters.js`, `nba/nbaFreeAgents.js`
- **Update trigger:** July 1 (moratorium lifts) — major signing wave in first 2 weeks
- **Frequency:** Daily during first two weeks of July

### Trade Deadline (February — typically around Feb 6)
- **What changes:** Mid-season trades, teams buy out veterans
- **Data files affected:** `nba/nbaRosters.js`
- **Update trigger:** Day after trade deadline
- **Volume:** Medium — 15-30 players typically move

### NBA Draft (Late June — before free agency opens)
- **What changes:** Rookies added via two-way or standard contracts
- **Data files affected:** `nba/nbaRosters.js`, `nba/nbaDraftProspects.js`
- **Update trigger:** Day after draft

### Two-Way / 10-Day Contracts (October — April)
- **What changes:** Frequent roster churn for G League callups, injuries
- **Note:** Lower priority for simulator accuracy — these are fringe roster players

---

## MLB Update Cadence

### Free Agency (November — February, peaks in December-January)
- **What changes:** All 6+ year service time players can become free agents
- **Data files affected:** `mlb/mlbRosters.js`, `mlb/mlbFreeAgents.js`
- **Update trigger:** Winter Meetings (December) is the single most active week
- **Frequency:** Weekly November-February

### Trade Deadline (July 31 — hard deadline, no waiver trades)
- **What changes:** Contenders buy, sellers move veterans
- **Data files affected:** `mlb/mlbRosters.js`
- **Update trigger:** August 1 (day after deadline)
- **Volume:** High — can be 50+ players in the 72 hours around the deadline

### Rule 5 Draft (December — during Winter Meetings)
- **What changes:** Minor leaguers exposed and claimed by other teams
- **Data files affected:** `mlb/mlbRosters.js` (low priority — mostly minor leaguers)

### Spring Training Cuts (March)
- **What changes:** 40-man rosters finalized, spring invitees released
- **Data files affected:** `mlb/mlbRosters.js`
- **Update trigger:** Opening Day roster announcements (late March)

---

## Data Sources by League

### NFL
| Data Type | Primary Source | Secondary Source | Notes |
|-----------|---------------|-----------------|-------|
| Cap hits / contracts | [Over The Cap](https://overthecap.com) | [Spotrac](https://spotrac.com/nfl) | OTC is the gold standard |
| Rosters / positions | [ESPN NFL Rosters](https://www.espn.com/nfl/teams) | [NFL.com Rosters](https://www.nfl.com/teams) | ESPN more structured for scraping |
| Dead money | [OTC Dead Money](https://overthecap.com/dead-money) | — | Already integrated in our data |
| Free agents | [OTC Free Agents](https://overthecap.com/free-agents) | Spotrac | OTC has the cleanest list |

### NBA
| Data Type | Primary Source | Secondary Source | Notes |
|-----------|---------------|-----------------|-------|
| Cap hits / contracts | [Spotrac NBA](https://spotrac.com/nba) | [HoopsHype](https://hoopshype.com/salaries/) | HoopsHype is clean and free |
| Rosters | [ESPN NBA Rosters](https://www.espn.com/nba/teams) | [Basketball-Reference](https://www.basketball-reference.com) | B-Ref has best historical data |
| Salary cap / luxury tax | [CBA FAQ](https://www.cbafaq.com) | [HoopsHype Cap Space](https://hoopshype.com/salary-cap-space/) | Cap numbers change each year |

### MLB
| Data Type | Primary Source | Secondary Source | Notes |
|-----------|---------------|-----------------|-------|
| Contracts / AAV | [Spotrac MLB](https://spotrac.com/mlb) | [Baseball-Reference](https://www.baseball-reference.com) | Spotrac has cleanest contract data |
| Rosters | [ESPN MLB Rosters](https://www.espn.com/mlb/teams) | [Baseball-Reference](https://www.baseball-reference.com) | B-Ref is authoritative |
| Service time / arbitration | [FanGraphs](https://www.fangraphs.com) | MLB Trade Rumors | FanGraphs tracks arb projections |
| CBT payroll / luxury tax | [Cot's Baseball Contracts](https://legacy.baseballprospectus.com/compensation/cots/) | Spotrac | Cot's is the MLB equivalent of OTC |

---

## Automation Options

### Option A: GitHub Actions Scheduled Workflow

**How it works:** A `.github/workflows/data-refresh.yml` file triggers on a schedule (cron). It runs a Node.js scraper that hits OTC/Spotrac, diffs the output against current data files, and commits changes.

**Pros:**
- Fully automated, zero human intervention
- Free (GitHub Actions minutes within free tier for public repos)
- Version-controlled — every data change is a commit with a timestamp
- Can run on schedule (e.g., every Monday at 6am ET)

**Cons:**
- Scraper maintenance — OTC/Spotrac change their HTML periodically, breaking scrapers
- Sites can block GitHub Actions IP ranges
- Requires parsing HTML or reverse-engineering their API, which is fragile
- Rate limiting risk

**Verdict:** Good for NFL (OTC has consistent structure). Risky for others. Would need maintenance when scrapers break.

**Sample cron trigger:**
```yaml
on:
  schedule:
    - cron: '0 10 * * MON'  # Every Monday at 10am UTC (6am ET)
  workflow_dispatch:         # Also allow manual trigger
```

---

### Option B: Agent-Run Manual Refresh Script

**How it works:** A script (`scripts/refresh-data.mjs`) accepts a league flag and a source URL, fetches the current data, diffs it against the local files, and outputs a patch for review before committing.

**Pros:**
- Agent (Tee or a scraper sub-agent) can run it on demand
- No scraper maintenance required — agent reads the page intelligently
- Human-in-the-loop review before any data change goes live
- Works even if source sites change their layout

**Cons:**
- Not fully automated — requires 9 or an agent to trigger
- Slower than a scheduled job

**Verdict:** This is the right approach for the current scale. Low overhead, high reliability.

---

### Option C: Versioned Data with Timestamp Headers

**How it works:** Each data file contains a header comment with the last-updated timestamp and source. A lightweight `scripts/data-status.mjs` script reads all headers and outputs a staleness report.

**Already partially implemented:** `allRosters.js` has `// Auto-generated by rebuild-all-rosters.mjs on 2026-03-18T12:46:23.977Z`

**Pros:**
- Zero infrastructure — just discipline and a script
- Makes staleness visible at a glance
- Works with any update approach

**Cons:**
- Does not automate the update itself — only tracks when it happened

**Verdict:** Should be implemented regardless of which other option is chosen. It is free and solves the "when was this last updated?" problem immediately.

---

## Recommended Approach

**Short-term (now through summer 2026): Option B + C**

1. Add a consistent timestamp header to all six data files (NFL, NBA, MLB rosters + FA lists)
2. Build `scripts/refresh-data.mjs` — a manual refresh script that an agent can run
3. Create a data staleness check in the owner dashboard (show last-updated date per league)
4. Set a calendar cadence for manual refreshes aligned to league events (see below)

**Medium-term (fall 2026 when traffic justifies it): Add Option A for NFL**

NFL data is the most structured and OTC is the most scrapable source. Once the user base grows and accuracy becomes a competitive differentiator, automate the NFL Monday morning refresh via GitHub Actions. NBA and MLB can stay on manual for longer.

---

## Recommended Update Calendar

| Month | NFL | NBA | MLB |
|-------|-----|-----|-----|
| January | Monitor trades | Monitor trades | Free agency active |
| February | Monitor trades | **Trade deadline refresh** | Free agency wraps |
| March | **Free agency refresh (weekly)** | Monitor | Spring training cuts |
| April | FA + **draft refresh** | Monitor | Opening Day roster refresh |
| May | Monitor | Playoff roster moves | Monitor |
| June | Monitor | **Draft refresh** | Monitor |
| July | Monitor | **Free agency (daily first 2 weeks)** | **Trade deadline refresh** |
| August | **Training camp cuts (critical)** | FA wrap-up | Post-deadline refresh |
| September | Week 1 roster check | Preseason opens | Monitor |
| October | Monitor trades | **Opening Night rosters** | Monitor |
| November | Monitor | Monitor | **FA opens — weekly** |
| December | Monitor | Monitor | **Winter Meetings — weekly** |

---

## Data Versioning Standard

All roster/FA data files should include this header block:

```javascript
// League: NFL
// Data version: 2026-03-26
// Source: Over The Cap (overthecap.com), ESPN Rosters
// Last updated by: Tee (auto-refresh script)
// Next scheduled refresh: 2026-04-28 (post-draft)
// Confidence: High
```

This allows the dashboard to surface data age warnings (e.g., "NFL data is 45 days old — consider refreshing before the draft").

---

## Priority Gaps to Address

1. **NBA and MLB have no spot-check verification yet** — initial build data, unknown accuracy. Run a spot-check against Spotrac before launch.
2. **No data versioning headers in NBA/MLB files** — add immediately.
3. **No staleness indicator in the UI** — users have no way to know if data is current.
4. **No refresh script exists yet** — `scripts/refresh-data.mjs` needs to be built.
5. **freeAgents.js (NFL) not verified** — free agent pool accuracy should be checked post-March 26 signing wave.
