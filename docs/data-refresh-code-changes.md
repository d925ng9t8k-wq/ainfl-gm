# AiNFLGM Data Refresh — Code Changes
**Research date:** March 26, 2026
**Coverage window:** March 16–26, 2026 (moves after our last data update)

---

## Summary of Findings

All seven moves flagged for review were already present in offseasonMoves.js as of March 16. However, **three new moves** occurred after March 16 that require updates:

1. **Joe Flacco re-signed with Bengals** (March 25) — removes him from freeAgents.js, replaces Josh Johnson in CIN entry
2. **Jaxon Smith-Njigba signed 4yr/$168.6M extension with Seahawks** (March 23) — add to SEA extensions
3. **Jaylen Waddle traded from Dolphins to Broncos** — add to both DEN and MIA entries

**Status of the 7 flagged moves:**
| Move | Status in Data | Action Needed |
|---|---|---|
| JSN to Seattle | Was already on SEA (draft pick — never a FA). Extension signed March 23 | Add extension to SEA entry |
| Daniel Jones to Colts | Already in IND as extension — correct | None |
| Rashee Rice to Rams | NOT TRUE — Rice is still on Chiefs under existing contract | None |
| Hendrickson to Ravens | Already in BAL entry — correct | None |
| Jaelan Phillips to Panthers | Already in CAR entry — correct | None |
| Tua to Falcons | Already in ATL entry — correct | None |
| Kyler Murray to Vikings | Already in MIN entry — correct | None |

---

## FILE 1: src/data/freeAgents.js

### Change 1 — Remove Joe Flacco (re-signed with CIN, March 25)

**Remove this line entirely (line 10):**
```js
{ id: 106, name: 'Joe Flacco', position: 'QB', age: 41, askingPrice: 4.3, yearsRequested: 1, previousTeam: 'Bengals', rating: 64 },
```

**No other removals needed.** Kirk Cousins and Tyreek Hill remain unsigned as of March 26. All other players on the list have not reported signings.

---

## FILE 2: src/data/offseasonMoves.js

### Change 1 — CIN: Replace Josh Johnson with Joe Flacco, update summary

**Find this block in CIN.signings:**
```js
{ player: 'Josh Johnson', position: 'QB', previousTeam: 'Free Agent', aav: 1.0, years: 1, total: 1.0, guaranteed: 0.5, rating: 55, date: '2026-03-14' },
```

**Replace with:**
```js
{ player: 'Joe Flacco', position: 'QB', previousTeam: 'Free Agent', aav: 6.0, years: 1, total: 6.0, guaranteed: 3.0, rating: 64, date: '2026-03-25', note: 'Re-signed; up to $9M with incentives. Pro Bowler 2025.' },
```

**Also update CIN.summary — replace the sentence about Josh Johnson:**

Old text:
```
Signed veteran backup QB Josh Johnson.
```

New text:
```
Re-signed Pro Bowl backup QB Joe Flacco (1yr/$6M, up to $9M with incentives).
```

---

### Change 2 — SEA: Add JSN extension, update summary

**Find SEA.extensions (currently does not exist — add it after signings array):**

Add a new `extensions` array to the SEA entry after the `signings` array:
```js
extensions: [
  { player: 'Jaxon Smith-Njigba', position: 'WR', details: '4yr/$168.6M extension, $120M guaranteed. $42.15M/yr — highest-paid WR in NFL history. $35M signing bonus. Signed March 23, 2026. Under contract through 2031.' },
],
```

**Also update SEA.summary — append to existing text:**

Old ending:
```
...and WR Dareke Young (LV).
```

New ending:
```
...and WR Dareke Young (LV). Extended WR Jaxon Smith-Njigba to a record 4yr/$168.6M deal ($120M gtd), making him the highest-paid WR in NFL history after a 2025 season in which he led the NFL with 1,793 receiving yards.
```

---

### Change 3 — DEN: Add Jaylen Waddle trade, update summary

**Find DEN.trades (currently does not exist — add after signings array):**

Add:
```js
trades: [
  { acquired: 'Jaylen Waddle', position: 'WR', from: 'Dolphins', note: 'Sent 2026 R1 (#30), R3 (#94), R4 (#130); received Waddle + MIA R4 (#111)' },
],
```

**Also update DEN.summary — replace existing text:**

Old:
```
'Broncos re-signed RB J.K. Dobbins (2yr/$16M, up to $20M with incentives) and LBs Dre Greenlaw, Alex Singleton (2yr/$15.5M, $11M gtd), and Justin Strnad (3yr/$19.5M, $10M gtd). Re-signed TE Adam Trautman, RB Jaleel McLaughlin, WR Lil\'Jordan Humphrey, and QB Sam Ehlinger. Restructured OG Quinn Meinerz\'s contract to free $11M in cap space.',
```

New:
```
'Broncos made a major splash trading for WR Jaylen Waddle from MIA (sent R1 #30, R3, R4; got Waddle + MIA R4). Re-signed RB J.K. Dobbins (2yr/$16M, up to $20M), LBs Dre Greenlaw, Alex Singleton (2yr/$15.5M), and Justin Strnad (3yr/$19.5M). Re-signed TE Adam Trautman, RB Jaleel McLaughlin, WR Lil\'Jordan Humphrey, and QB Sam Ehlinger. Restructured OG Quinn Meinerz\'s contract for $11M cap relief.',
```

---

### Change 4 — MIA: Add Waddle departure, update summary

**Find MIA.departures array and add:**
```js
{ player: 'Jaylen Waddle', position: 'WR', destination: 'Broncos', note: 'Traded for 2026 R1 (#30), R3, R4 (received MIA R4 #111 back)' },
```

**Also update MIA.summary — add to existing:**

Old ending:
```
Lost Bradley Chubb to Buffalo in free agency.
```

New ending:
```
Lost Bradley Chubb to Buffalo in free agency. Traded WR Jaylen Waddle to DEN for a 2026 first-rounder (#30), third, and fourth (received a fourth back), continuing a full franchise teardown.
```

---

## Implementation Notes

- Rashee Rice is still under contract with the Kansas City Chiefs. The "Rice to Rams" info was incorrect — do not add any Rice entry to LAR.
- JSN was never in freeAgents.js (he was a drafted player on an existing deal). No FA list change needed for him.
- After applying these changes, update the header comment in both files:
  ```
  // Last updated: March 26, 2026
  ```
- The `computeBaselineGrade` function in offseasonMoves.js does not need changes — the scoring logic handles the new entries automatically.

---

## Sources
- [JSN Extension — NFL.com](https://www.nfl.com/news/jaxon-smith-njigba-seahawks-four-year-168-million-contract-extension)
- [Joe Flacco re-signs — NFL.com](https://www.nfl.com/news/bengals-bringing-back-veteran-qb-joe-flacco-on-one-year-deal)
- [Jaylen Waddle Trade — NFL.com](https://www.nfl.com/news/dolphins-trading-wr-jaylen-waddle-to-broncos-for-draft-picks-including-2026-first-rounder)
- [Jaelan Phillips — NFL.com](https://www.nfl.com/news/panthers-signing-pass-rusher-jaelan-phillips-to-four-year-120-million-contract)
- [Tua to Falcons — ESPN](https://www.espn.com/nfl/story/_/id/48156219/sources-qb-tua-tagovailoa-sign-1-year-deal-falcons)
- [Kyler Murray to Vikings — ESPN](https://www.espn.com/nfl/story/_/id/48188052/kyler-murray-signs-one-year-deal-vikings)
- [Daniel Jones / Colts — NFL.com](https://www.nfl.com/news/colts-qb-daniel-jones-finalizing-two-year-88-million-deal)
- [Hendrickson to Ravens — NFL.com](https://www.nfl.com/news/trey-hendrickson-ravens-sign-de-four-year-112-million-contract-maxx-crosby-trade)
- [2026 FA Tracker — CBS Sports](https://www.cbssports.com/nfl/news/nfl-free-agency-tracker-2026-full-list-signings-trades-moves/)
