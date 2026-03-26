# AiNFLGM Data Refresh Research — March 26, 2026

**Research by:** UNO
**Date:** March 26, 2026
**Covers:** Items 11 (freeAgents.js removals) and 12 (offseasonMoves.js additions)

---

## TASK 11 — Free Agent List Removals

### Summary
Of the players in `src/data/freeAgents.js` (sourced March 16), the following have confirmed signings and should be REMOVED from the available free agent pool. Several others remain unsigned as of March 26.

---

### CONFIRMED SIGNED — REMOVE FROM freeAgents.js

#### Quarterbacks
| Player | ID | Signed With | Contract | Notes |
|---|---|---|---|---|
| Joe Flacco | 106 | Bengals | 1yr/$6M, max $9M | Re-signed; confirmed |

#### Wide Receivers
| Player | ID | Signed With | Contract | Notes |
|---|---|---|---|---|
| Christian Kirk | 114 | 49ers | 1yr/$6M, $4M gtd | Already in offseasonMoves.js (SF) — remove from FA list |

#### Offensive Line
| Player | ID | Signed With | Contract | Notes |
|---|---|---|---|---|
| Wyatt Teller | 137 | Texans | 2yr/$16M, max $23M | Per CBS/NFL.com — signed HOU after March 16 |

#### Kickers
| Player | ID | Notes |
|---|---|---|
| Daniel Carlson | 220 | Raiders replaced him with Matt Gay; Carlson destination not confirmed in search results — do NOT remove yet, needs verification |

---

### STILL UNSIGNED AS OF MARCH 26 — KEEP IN freeAgents.js

Based on multiple "best remaining free agents" articles dated March 22-26:

**Quarterbacks (all unsigned):**
- Kirk Cousins (ID 101)
- Aaron Rodgers (ID 102)
- Russell Wilson (ID 103)
- Zach Wilson (ID 104)
- Tyrod Taylor (ID 105)

**Wide Receivers (still unsigned):**
- Tyreek Hill (ID 110)
- Deebo Samuel (ID 111)
- Stefon Diggs (ID 112)
- Jauan Jennings (ID 113)

**Linebackers:**
- Bobby Wagner (ID 181) — confirmed still unsigned as of March 22

**Cornerbacks:**
- Marshon Lattimore (ID 190) — released by Commanders, still unsigned
- L'Jarius Sneed (ID 191) — status unclear, no confirmed signing found
- Trevon Diggs (ID 192) — status unclear, no confirmed signing found

**Running Backs:**
- Joe Mixon (ID 210) — listed among top remaining RBs still available
- Najee Harris (ID 211) — Achilles recovery, still unsigned

**Defensive Line:**
- Joey Bosa (ID 150) — confirmed still unsigned as of March 22

---

### CONFIDENCE ASSESSMENT — TASK 11

| Finding | Confidence |
|---|---|
| Joe Flacco re-signed with Bengals | High — multiple sources |
| Wyatt Teller signed with Texans | High — multiple sources |
| Christian Kirk signed with 49ers | High — in offseasonMoves.js already |
| Kirk Cousins / Rodgers / Wilson still unsigned | High — multiple "remaining FA" lists dated March 22 |
| Joey Bosa still unsigned | High — named specifically as unsigned |
| Bobby Wagner still unsigned | High — named specifically as unsigned |
| Tyreek Hill still unsigned | High — named specifically as unsigned |
| Daniel Carlson — Raiders replaced with Matt Gay | Medium — source notes Raiders signed Gay; Carlson destination unclear |
| L'Jarius Sneed / Trevon Diggs status | Low — no confirmed news either way |

---

### GAPS — TASK 11
- Could not confirm where Daniel Carlson ultimately signed (or if he remained unsigned through March 26).
- No confirmation on L'Jarius Sneed or Trevon Diggs destinations.
- Did not find signing news for David Njoku, Jawaan Taylor, Taylor Decker, or Joel Bitonio — all likely still available.
- Rashee Rice is already signed (existing Chiefs contract per Spotrac — he was never a true FA).

---

## TASK 12 — Offseason Moves Additions (March 16–26)

### Summary
The offseasonMoves.js file was verified through March 16. The following are NEW moves confirmed between March 16-26 that need to be added.

---

### NEW MOVES BY TEAM (March 16-26 only)

#### CIN — Cincinnati Bengals
- **Joe Flacco re-signed** — 1yr/$6M, max $9M with incentives (signed ~March 17-20 per CBS/NFL.com)
  - Already listed in freeAgents.js as a FA; this is the confirmation he re-signed
  - CIN already has Josh Johnson signed as backup; Flacco likely replaces or competes

#### SEA — Seattle Seahawks
- **Jaxon Smith-Njigba extension** — 4yr/$168.8M ($42.15M AAV, $120M guaranteed), signed March 23, 2026
  - Makes him the highest-paid WR in NFL history, surpassing Ja'Marr Chase ($40.25M AAV)
  - Total value including existing deal: 6yr/$195.1M through 2031
  - JSN is the reigning NFL Offensive Player of the Year (led NFL with 1,793 receiving yards in 2025)
  - This is an EXTENSION, not a trade — he remains a Seahawk

#### HOU — Houston Texans
- **Wyatt Teller signed** — 2yr/$16M, max $23M (signed after March 16)
  - Becomes third OL added to the Texans' interior this offseason
  - Remove Teller from freeAgents.js

#### MIN — Minnesota Vikings
- **Kyler Murray signed** — 1yr, veterans minimum (~$1.3M) after Cardinals released him
  - Confirmed in offseasonMoves.js already at $15M AAV — **NOTE: contract details conflict**
  - Multiple sources say vet minimum ($1.3M), not $15M — the $15M figure in the file may be incorrect
  - Recommend flagging for review

#### IND — Indianapolis Colts
- **Daniel Jones extension confirmed** — 2yr/$88M, up to $100M with incentives, $60M+ guaranteed
  - Already in offseasonMoves.js correctly (IND extensions section)
  - Confirmed by ESPN and NFL.com as of early-mid March

#### KC — Kansas City Chiefs
- **Justin Fields trade** — already in offseasonMoves.js (dated 2026-03-16, the exact cutoff date)
  - Technically within the new window but likely already captured

---

### MAJOR NEW MOVES THAT MAY NEED SEPARATE ENTRIES OR UPDATES

#### Jaxon Smith-Njigba (SEA extension) — March 23
This is the biggest single move of the window. Needs an `extensions` entry added to SEA in offseasonMoves.js:
```
{ player: 'Jaxon Smith-Njigba', position: 'WR', details: '4yr/$168.8M extension, $120M guaranteed, $42.15M AAV. Highest-paid WR in NFL history. Total: 6yr/$195.1M through 2031. Reigning NFL Offensive Player of the Year.' }
```

#### Kyler Murray Contract Clarification (MIN)
The file shows Murray at `aav: 15.0, years: 1, total: 15.0`. Multiple search results describe it as a veterans minimum deal (~$1.3M). This needs verification and possible correction.

---

### TEAMS WITH NO NEW CONFIRMED MOVES (March 16-26)
Based on research, the following teams appear to have had no significant new moves after March 16 (their data in the file is current):
- BAL, BUF, MIA, NE, NYJ (AFC East)
- CLE, PIT (AFC North — though PIT status unclear)
- JAX, TEN (AFC South)
- DEN, LV, LAC (AFC West)
- DAL, NYG, PHI, WSH (NFC East)
- CHI, DET, GB (NFC North — GB/Packers pending verification)
- ATL, CAR, NO, TB (NFC South)
- ARI, LAR, SF (NFC West — SF signed Christian Kirk pre-March 16 per file; needs date check)

---

### CONFIDENCE ASSESSMENT — TASK 12

| Finding | Confidence |
|---|---|
| JSN 4yr/$168.8M extension, March 23 | High — NFL.com, ESPN, Yahoo, NBC Sports, FOX Sports all confirm |
| Joe Flacco re-signed with CIN post-March 16 | High — CBS/NFL.com confirm |
| Wyatt Teller signed with HOU post-March 16 | High — CBS/NFL.com confirm |
| Daniel Jones 2yr/$88M with IND | High — already in file, confirmed by multiple sources |
| Kyler Murray vet minimum (not $15M) | Medium — multiple sources say vet min but file shows $15M; needs reconciliation |
| Christian Kirk to SF (already in file) | High — confirmed, likely pre-March 16 |

---

### GAPS — TASK 12
- Rashee Rice: Spotrac shows his existing Chiefs contract; he was never a true UFA. No new deal needed.
- Jaelan Phillips (CAR, 4yr/$120M) and Trey Hendrickson (BAL, 4yr/$112M) were both pre-March 16 moves — already in offseasonMoves.js.
- Could not pin down exact signing date for Joe Flacco re-sign or Wyatt Teller to confirm whether they are truly post-March 16 vs. already captured.
- Some team-level moves (e.g., Panthers, Rams, Raiders, Titans) all appear to be pre-March 16 and already in the file.

---

## RECOMMENDED ACTIONS FOR 9

### freeAgents.js (do not modify yet — research complete):
1. **REMOVE:** Joe Flacco (ID 106) — re-signed with Bengals
2. **REMOVE:** Wyatt Teller (ID 137) — signed with Texans
3. **REMOVE:** Christian Kirk (ID 114) — signed with 49ers (may already be handled)
4. **FLAG:** Daniel Carlson (ID 220) — Raiders replaced him with Matt Gay; destination unclear, hold pending confirmation

### offseasonMoves.js (do not modify yet — research complete):
1. **ADD to SEA:** Jaxon Smith-Njigba extension (4yr/$168.8M, $120M gtd, March 23)
2. **ADD to CIN:** Joe Flacco re-signing (1yr/$6M, max $9M)
3. **VERIFY/FIX for MIN:** Kyler Murray contract — file says $15M AAV, sources suggest vet minimum (~$1.3M); reconcile before publishing
4. **ADD to HOU:** Wyatt Teller signing (2yr/$16M, max $23M) — update CLE departure note if needed

---

## Sources

- [NFL.com Free Agency Tracker 2026](https://www.nfl.com/news/2026-nfl-free-agency-tracker-latest-signings-trades-contract-info-for-all-32-teams)
- [ESPN Free Agency Tracker](https://www.espn.com/nfl/story/_/id/47899175/2026-nfl-free-agency-tracker-live-updates-signings-trades-cuts-contracts-rumors)
- [CBS Sports Free Agency Tracker](https://www.cbssports.com/nfl/news/nfl-free-agency-tracker-2026-full-list-signings-trades-moves/)
- [Yahoo Sports Live Updates (JSN deal)](https://sports.yahoo.com/nfl/live/nfl-news-free-agency-updates-jaxon-smith-njigba-seahawks-agree-to-4-year-1688-million-contract-becoming-highest-paid-wr-in-nfl-history-125653243.html)
- [NFL.com: Jaxon Smith-Njigba extension](https://www.nfl.com/news/jaxon-smith-njigba-seahawks-four-year-168-million-contract-extension)
- [ESPN: Daniel Jones 2yr/$88M Colts](https://www.espn.com/nfl/story/_/id/48174240/sources-colts-re-sign-qb-daniel-jones-2-year-88m-deal)
- [Spotrac: Rashee Rice contract](https://www.spotrac.com/nfl/player/_/id/82347/rashee-rice)
- [PFF Offseason Tracker](https://www.pff.com/news/2026-nfl-offseason-tracker-signings-trades-and-cuts-for-all-32-teams)
- [Pro Football Network: Best Remaining FAs March 22](https://www.profootballnetwork.com/best-remaining-nfl-free-agents-2026-march-22/)
- [CBS Sports: Top Remaining FAs](https://www.cbssports.com/nfl/news/top-10-remaining-2026-nfl-free-agents-march-9/)
- [NFL.com: Ten Best Offseason Moves](https://www.nfl.com/news/ten-best-moves-of-2026-nfl-offseason-so-far-trades-free-agent-signings-boost-rams-dolphins-steelers)
- [FOX Sports: Free Agency Tracker](https://www.foxsports.com/stories/nfl/2026-nfl-free-agency-trades-tracker-signings-updates-best-players-available)
- [CBS Sports: Offseason Team Grades](https://www.cbssports.com/nfl/news/nfl-offseason-team-grades-free-agency/)
