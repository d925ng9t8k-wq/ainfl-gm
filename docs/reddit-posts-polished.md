# AiNFLGM — Reddit Launch Posts (Polished)
**Date:** March 26, 2026
**Strategy:** Lead with analysis, not promotion. Link at bottom only.

---

## Post 1: r/nfl
**Title:** I built an AI that simulates what happens when you give the Bengals an extra $30M in cap space
**Subreddit:** r/nfl

**Body:**
I've been working on a side project — an AI-powered NFL offseason simulator where you can step into the GM role for any of the 32 teams. Real cap numbers from OverTheCap, PFF draft prospects, the whole thing.

Decided to stress-test it with a fun scenario: what if the Bengals magically had $30M more in cap space this offseason?

**The moves I made:**
- Signed Haason Reddick to a 3-year, $54M deal to finally give Burrow a legit edge rush opposite Trey Hendrickson
- Restructured Ja'Marr Chase's deal to push money into future years and free up another $8M
- Traded up from #18 to #11 (gave up a 2027 2nd) to grab the top offensive tackle in the draft
- Added two DBs in rounds 3-4 to shore up a secondary that got torched in the playoffs

**The result:** The simulator projected the Bengals at 12-5, winning the AFC North by two games, beating the Bills in the divisional round... then losing to the Chiefs in the AFCCG. Some things never change.

The cap math was genuinely surprising — Chase's restructure alone created $12M in immediate room, but the dead cap implications in year 3+ are brutal. The simulator actually flags when you're mortgaging the future, which was a nice gut-check.

Anyone else want to try their team? The tool is free at ainflgm.com.

*Disclosure: I built this tool. It's free, no ads yet, just a passion project.*

---

## Post 2: r/NFLDraft
**Title:** I simulated 100 mock drafts with AI opponents — here's which teams consistently draft the worst
**Subreddit:** r/NFLDraft (or r/NFL_Draft)

**Body:**
Built an NFL offseason simulator that includes a full 7-round mock draft with AI-managed teams making picks based on PFF rankings and positional needs.

Ran 100 drafts to see which teams' AI "GMs" consistently make the worst picks relative to available talent.

**Bottom 5 AI draft performances (by average draft grade):**
1. **Raiders** — AI keeps reaching for QB in round 1 regardless of who's available. Classic.
2. **Giants** — Splits early picks between OL and edge, ends up mediocre at both
3. **Panthers** — AI overvalues receiver talent, ignores the trenches
4. **Commanders** — Trades down too aggressively, misses blue-chip talent
5. **Titans** — Hoards picks but spends them on depth over difference-makers

**Top 5 AI draft performances:**
1. **Steelers** — BPA discipline + clear positional hierarchy = consistently strong hauls
2. **Eagles** — AI mirrors Howie Roseman's trade-up-for-value approach and it works
3. **Ravens** — Nails the edge/OL/secondary priority order almost every time
4. **Packers** — Stocks the board with Day 2 contributors, rarely reaches
5. **Cowboys** — BPA-heavy approach fills holes organically (the AI doesn't have Jerry's ego)

The interesting finding: teams with multiple early-round picks don't always grade out better because the AI tends to reach for need over BPA when it has capital to spend. Sound familiar?

Full tool is at ainflgm.com if you want to run your own draft.

---

## Post 3: r/fantasyfootball
**Title:** Built a tool that lets you play GM instead of just playing fantasy — cap management, trades, draft, season sim
**Subreddit:** r/fantasyfootball

**Body:**
I know it's the offseason and we're all bored. So I built something.

Most of us play fantasy football, but the part of the NFL I find most interesting is the front office — the cap management, the trade negotiations, the draft strategy. Fantasy doesn't really simulate that.

So I built AiNFLGM — pick any team, manage their salary cap, sign free agents, execute trades with AI GMs, run the full 7-round draft, then simulate the season to see if your moves actually worked.

Some highlights:
- Real salary cap data from OverTheCap
- PFF-sourced draft prospects with 30% randomization (so it's not the same every time)
- Trade system that won't let you fleece the AI (but you can force bad trades if you're on the losing end)
- Season sim that accounts for roster quality

It's free at ainflgm.com. No account needed. Works on mobile.

What's the first move you'd make with your team?

---

## Post 4: r/sportsbook
**Title:** Built an NFL simulator with Polymarket prediction market integration — compare your GM moves against real money markets
**Subreddit:** r/sportsbook

**Body:**
Working on an NFL offseason simulator and recently added a feature I think this sub would find interesting: live Polymarket prediction market odds displayed alongside your season simulation results.

You rebuild a team's roster through free agency, trades, and the draft. Then the sim runs the season. Next to your sim results, you see what the actual prediction markets are pricing for that team's over/under, division odds, Super Bowl odds, etc.

It creates an interesting feedback loop — you can see how your GM moves would theoretically shift the probability, and compare that against what real money is pricing. For example, the simulator had the Bengals at 11.5 wins after a strong offseason rebuild, while Polymarket had their o/u around 9.5 — a 2-win gap that makes you question either your roster evaluation or the market's.

Obviously not a trading tool, but it's a fun way to think about team-building through a probability lens.

Free at ainflgm.com. Has the Polymarket data integrated.

*Not affiliated with Polymarket. Just pulling their public data.*

*Please gamble responsibly. If you or someone you know has a gambling problem, call 1-800-GAMBLER.*

---

## Post 5: r/AItools
**Title:** I used Claude to build an AI-powered NFL GM simulator — here's the stack and what I learned
**Subreddit:** r/AItools

**Body:**
Background: I'm not a developer. I'm a mortgage company owner who wanted to see if AI could help me build and ship a real product. The answer is yes, but with caveats.

**What I built:** ainflgm.com — a full NFL offseason simulator where you manage any team's salary cap, sign free agents, make trades, run the draft, and simulate seasons.

**The stack:**
- Claude API for AI decision-making (trade evaluations, draft AI opponents)
- React + Vite for the frontend
- GitHub Pages for hosting (free)
- Real NFL data scraped from OverTheCap and PFF

**What AI actually did:**
- Wrote 95%+ of the code
- Designed the UI/UX
- Built the game logic (salary cap math, trade values, draft algorithms)
- Deployed and debugged

**What AI couldn't do:**
- Make it look "premium" (still iterating on design)
- Keep data perfectly accurate without manual verification
- Marketing (turns out you still need to tell people about things you build)

**The real lesson:** AI as a coding partner is genuinely viable for a non-technical founder. But you need to be extremely specific about what you want, verify everything it builds, and expect to iterate. It's not magic — it's a very capable junior developer who never gets tired.

Site is live and free: ainflgm.com

Happy to answer questions about the build process or the stack.

---

## Posting Schedule

| Week | Action |
|------|--------|
| Week 1-2 | Comment karma building on all 5 subs. Be helpful. No links. |
| Week 3 | Post #1 (r/nfl) + Post #5 (r/AItools) — different audiences, no cross-contamination |
| Week 4 | Post #2 (r/NFLDraft) |
| Week 5 | Post #3 (r/fantasyfootball) |
| Week 6 | Post #4 (r/sportsbook) |

**Rules:**
- Never post more than 1 per week per sub
- 2-week karma building minimum before first post
- Respond to EVERY comment
- If a post gets removed, don't repost — adjust and try a different angle next week
- FTC disclosure on every post
- Responsible gambling footer on sportsbook post
