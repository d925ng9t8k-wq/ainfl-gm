# AiNFL GM — Data Change Management

## Automated Refreshes

### Weekly Cap Space Refresh (GitHub Actions)
- **Schedule:** Every Monday at 6am ET
- **What it does:** Scrapes OTC salary cap space page, updates all 32 teams' capSummary
- **Workflow:** `.github/workflows/data-refresh.yml`
- **Can be triggered manually:** Go to GitHub repo → Actions → "Weekly Data Refresh" → Run workflow

### What's Automated vs Manual

| Data Type | Update Method | Frequency |
|-----------|--------------|-----------|
| Team cap space | Automated (GitHub Actions) | Weekly |
| Player cap hits | Manual scrape needed | As needed |
| Free agent list | Manual review needed | After major signings |
| Draft prospects | Seasonal (pre-draft) | Once before draft |
| Offseason moves | Manual update to offseasonMoves.js | As transactions happen |
| Contract end years | Manual scrape needed | After extensions/signings |

## Manual Update Procedures

### When a Major Signing Happens
1. Update `src/data/freeAgents.js` — remove signed player
2. Update `src/data/offseasonMoves.js` — add to team's signings
3. Player will appear on new team after next cap refresh (or update allRosters.js manually)
4. Bump `CURRENT_BUILD` in index.html

### When a Trade Happens
1. Update `src/data/offseasonMoves.js` — add trade to both teams
2. Update `src/data/allRosters.js` — move player between teams
3. Update `src/data/teams.js` — if draft picks were traded
4. Bump `CURRENT_BUILD` in index.html

### When a Player is Cut/Released
1. Remove from team roster in `allRosters.js` or `bengalsRoster.js`
2. Add to `src/data/freeAgents.js` if they're a notable FA
3. Dead money charge will be captured in next cap refresh
4. Bump `CURRENT_BUILD` in index.html

### When the Draft Happens (April 2026)
1. Run `scripts/scrape-contract-end-years.mjs` to get new contract data
2. Update `src/data/draftProspects.js` with actual draft results
3. Update `src/data/teams.js` with new draft pick allocations for 2027
4. Update all team rosters with drafted rookies
5. Major update — consider a full re-scrape of all data

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/scrape-cap-refresh.mjs` | Weekly automated cap space update |
| `scripts/scrape-dead-money.mjs` | Full cap hit + dead money scrape for all teams |
| `scripts/scrape-contract-end-years.mjs` | Contract end years from OTC multi-year tabs |
| `scripts/scrape-positions.mjs` | Player positions + ages from ESPN |
| `scripts/rebuild-all-rosters.mjs` | Complete roster rebuild from all data sources |
| `scripts/fix-rookie-contracts.mjs` | Fix rookie deal contract years |
| `scripts/scrape-dead-caps.mjs` | Dead money charges for departed players |

## Triggering a Manual Refresh

```bash
cd ~/Projects/BengalOracle

# Quick cap space refresh only
node scripts/scrape-cap-refresh.mjs

# Full roster rebuild (slower, more comprehensive)
node scripts/scrape-dead-money.mjs
node scripts/scrape-positions.mjs
node scripts/scrape-contract-end-years.mjs
node scripts/rebuild-all-rosters.mjs

# Build and deploy
npm run build
git add -A && git commit -m "Data refresh $(date +%Y-%m-%d)" && git push
```
