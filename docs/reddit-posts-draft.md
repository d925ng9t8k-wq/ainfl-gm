# AiNFLGM — Reddit Launch Posts (Polished)
**Last Updated:** March 26, 2026
**Strategy:** Lead with analysis, not promotion. Link at bottom only. Be the fan, not the marketer.

---

## Post 1: r/nfl
**Title:** I simulated what happens when the Bengals spend their $22M in cap space this offseason — the results were actually interesting

**Subreddit:** r/nfl

**Body:**
The Bengals entered this offseason with roughly $22M in cap space and some real defensive holes to fill. They've already signed Boye Mafe, Jonathan Allen, and Bryan Cook — solid moves. But I wanted to play out a more aggressive scenario: what if they pushed their luck and went all-in?

I used AiNFLGM to sim it out. Here's exactly what I did:

**The moves:**
- Restructured Joe Burrow's deal (creates ~$18M in additional space, brutal dead cap exposure in year 3)
- Signed Joey Bosa on a 2-year, $28M deal to pair with Mafe as a legit pass rush duo
- Traded a 3rd round pick to move up from 17 to 11, targeting Rueben Bain Jr. (top edge prospect in this class per PFF)
- Mid-round picks went OL depth and LB (Wagner-type vet on a 1-year minimum)

**The sim result:** Bengals went 11-6, won the AFC North, exited in the divisional round. The defense actually rated out as a top-10 unit. The cap situation in 2028 looked genuinely scary.

The most interesting part wasn't the wins — it was seeing how the restructure math played out. You gain $18M now but you're basically mortgaging 2028 if Burrow gets hurt. The tool shows you the year-by-year dead cap implications and it's a real gut-punch.

For comparison, the Titans are sitting on $63M in space right now and could theoretically go nuclear. I ran that scenario too and they ended up as a 9-8 wild card team because cap space doesn't fix QB.

Anyone want me to run their team?

Tool is free at ainflgm.com — real 2026 cap data, no account needed.

*Disclosure: I built this tool. Passion project, completely free.*

---

## Post 2: r/NFLDraft
**Title:** I ran 100 mock drafts with AI GMs for all 32 teams. Some franchises are genuinely broken at the draft table.

**Subreddit:** r/NFLDraft

**Body:**
Built an NFL offseason simulator that includes a full 7-round mock draft with AI opponents. Each AI GM drafts based on PFF big board rankings, positional need, and a 30% randomization factor — so it's not scripted, but it's not random either.

I ran 100 full drafts and tracked average draft grades per team's AI.

**Worst 5 AI draft performances (avg grade across 100 runs):**
1. Dallas Cowboys — Reach machine. The AI reliably drafts a WR in round 1 even when elite edge and OL prospects are sitting there.
2. Las Vegas Raiders — Takes BPA in rounds 1-2 then completely ignores positional need in rounds 3-5.
3. New York Giants — Drafts for a scheme it doesn't have. OL-heavy every time regardless of needs.
4. Chicago Bears — Spends all $243K in cap space, then reaches for a QB in round 2 when it already has one.
5. Carolina Panthers — Consistently trades back and then uses the picks poorly.

**Best 5 AI draft performances:**
1. Kansas City Chiefs — Eerily mimics actual Spagnuolo-era tendencies. Grabs the best available corner every time.
2. Detroit Lions — The AI plays best ball available and it works.
3. Philadelphia Eagles — Trades up efficiently, doesn't panic.
4. San Francisco 49ers — Scheme-aware picks even under randomization.
5. Baltimore Ravens — The "versatile athlete" tendency kicks in every time.

The interesting meta-finding: teams with multiple first-round picks (like Tennessee's situation this year) don't grade out better because the AI reaches for need over BPA when it has capital. Sound familiar?

Tool is at ainflgm.com if you want to run your own drafts. 7 rounds, real 2026 prospects including Fernando Mendoza and Rueben Bain Jr. at the top of the board.

*Disclosure: I built this.*

---

## Post 3: r/fantasyfootball
**Title:** Fantasy is fun but I got obsessed with the actual front office part — so I built a GM simulator. Here's what I've learned.

**Subreddit:** r/fantasyfootball

**Body:**
Every offseason I follow free agency closer than I follow my actual fantasy team. The cap math, the restructures, the "we had to cut him because of dead money" explanations — that stuff is more interesting to me than any individual player's stats.

Problem is there's no game for that. Fantasy simulates player performance. Madden Franchise Mode is fun but the cap math is fake. So I spent the last few months building AiNFLGM.

Here's what it actually does:

- Pick any of the 32 teams and inherit their real 2026 cap situation (Titans have $63M to spend, Bears have literally $243K — choose your difficulty setting)
- Sign free agents with real contract structures — years, AAV, guaranteed money, dead cap implications
- Trade with AI GMs that have actual needs and won't give you a superstar for a 4th (but you can lowball them and sometimes they bite)
- Run the full 7-round draft with real 2026 prospects
- Simulate the season and see if your moves worked

Some things that genuinely surprised me when I built and played it:

The Bengals restructured Burrow and I gained $18M in space. Felt great. Then I simulated to 2028 and stared at $34M in dead cap. That's how teams get stuck.

The Chiefs AI GM drafts a corner in the first round in like 70% of my test simulations. That's either a coincidence or I accidentally built a Spagnuolo bot.

No account needed. Works on mobile. Free at ainflgm.com.

What's the first move you'd make with your team this offseason?

---

## Post 4: r/sportsbook
**Title:** Built an NFL simulator that shows Polymarket odds next to your sim results — interesting way to think about roster construction and implied probability

**Subreddit:** r/sportsbook

**Body:**
I built an NFL offseason sim tool and recently added Polymarket prediction market data alongside the season simulation results. Thought this sub might find the combination interesting.

Here's the basic flow: you rebuild a team's roster — free agency, trades, full 7-round draft — then simulate the season. Next to your results, you see live Polymarket odds for that team's Super Bowl probability, division odds, and win total over/under.

The interesting use case: you can see the delta between what the market currently prices and what your GM moves theoretically imply.

Quick example I ran this week: The Titans have $63M in cap space — most in the league — and the #1 pick. Polymarket has them at roughly 4% Super Bowl odds going into the offseason. I built out the most aggressive scenario I could (signed two elite FAs, used the pick on the top QB prospect, Fernando Mendoza), simulated 20 seasons. Average result: 8-9 wins, one playoff appearance in 20 tries. The market isn't wrong.

For comparison: ran the Chiefs with their current roster (basically no space, but Mahomes). Average result: 11-12 wins, four out of twenty Super Bowl appearances. Market has them at 18-20% Super Bowl odds. That feels about right.

The tool isn't a betting edge and I'm not claiming it is — NFL outcomes are genuinely chaotic and a sim is just one model. But it's a useful gut-check for thinking about team construction through a probability lens.

Free at ainflgm.com. Pulls live Polymarket data, no account needed.

*Not affiliated with Polymarket. Pulling their public API data.*

**This is a simulation tool for entertainment purposes. Not financial advice. Not gambling advice. Please gamble responsibly. If you or someone you know has a gambling problem, call 1-800-522-4700.**

---

## Post 5: r/AItools
**Title:** I'm a mortgage company owner with zero coding background. I used Claude to ship a real web app. Here's an honest breakdown of what worked and what didn't.

**Subreddit:** r/AItools (also fits r/ClaudeAI, r/ChatGPT)

**Body:**
Quick background: I own a mortgage company. I have no CS degree, haven't taken a coding course, can barely write a SQL query. Six months ago I decided to see if AI could take me from "has an idea" to "has a shipped product."

The result is ainflgm.com — a full NFL offseason simulator. Real 2026 cap data, 7-round mock drafts with real prospects, trade system with AI opponents, season simulation, Polymarket odds integration. Live, free, no account needed.

Here's the honest breakdown:

**What Claude actually did:**
- Wrote essentially all of the code (React + Vite frontend, GitHub Pages deploy)
- Designed and iterated on the UI based on my descriptions
- Built the salary cap math engine (restructures, dead cap calculations, void years — this is genuinely complex)
- Created the draft AI that evaluates prospects by need and positional value
- Debugged every error I couldn't understand
- Integrated external data sources (OverTheCap for cap figures, PFF for prospects, Polymarket for odds)

**Where I actually added value:**
- Product decisions — I knew what a good NFL sim should feel like from years of playing the real game
- Data validation — AI hallucinated cap numbers early on, I caught it because I knew what the numbers should roughly be
- Iteration direction — "this feels wrong, here's why" is something you can only do if you understand the domain
- The idea itself

**Where AI genuinely struggled:**
- Consistent design quality across components (needed a lot of "make this match the feel of the rest of the site")
- Keeping external data fresh without manual oversight
- Understanding edge cases in cap math that only surface in weird situations (practice squad elevations, IR designations)
- Writing marketing copy that doesn't sound like a press release

**The real lesson:** AI coding is not a shortcut. It's a force multiplier for someone with domain expertise. I knew NFL salary cap math and game design intuitively. That knowledge was the thing that made the prompts actually work. Without it, I would have gotten a technically functional app with broken game feel.

If you want to ask questions about the build process, the Claude workflow, or how I handled data sourcing — ask away. Happy to go deep.

Site: ainflgm.com

*I built this tool. It's free, no monetization yet.*

---

## Sample Karma-Building Comments (Post These Before Any Posts — 2 Weeks Minimum)

### r/nfl karma comments (post on hot threads, be genuinely helpful)

**Comment 1** (on any Bengals cap thread):
"The restructure math on Burrow's deal is interesting — you free up space now but the dead cap exposure in years 3-4 is legitimately scary if he gets hurt. Teams get trapped by those decisions 3 years later and people forget this was the reason."

**Comment 2** (on any NFL free agency/spending thread):
"Tennessee's cap situation is wild this year. $63M in space, the #1 pick, and they're still going to be an 8-win team because cap space doesn't fix QB. The NFL is just not a league where you can roster-build your way past a bad QB situation."

**Comment 3** (on any NFL draft thread):
"The most underrated concept in the draft is teams reaching for need over BPA in the first round. It almost never works — the best drafting franchises (Chiefs, Lions, Eagles recently) consistently take the best player available and figure out fit later."

---

### r/NFLDraft karma comments

**Comment 1** (on any mock draft thread):
"Rueben Bain Jr. is the most interesting prospect in this class to me — not necessarily the best but the most versatile. Can play 3-4 DE, 4-3 end, even some 3T in sub packages. Teams value that kind of flexibility highly and it usually means he sticks even if he doesn't become an elite pass rusher."

**Comment 2** (on any QB discussion thread):
"Fernando Mendoza vs. Ty Simpson is a genuinely interesting debate because they're different player profiles entirely. Mendoza's ceiling is higher, Simpson's floor is higher. Depends whether you're a team that can develop a prospect or needs a starter year one."

**Comment 3** (on any team's draft needs thread):
"The teams that consistently grade well in the draft have one thing in common: they don't panic at the end of round 1. The Cowboys reach for need at 24 almost every year and it almost never works out. BPA at the top of the board, then need in rounds 3-5 is the actual formula."

---

### r/fantasyfootball karma comments

**Comment 1** (on any offseason boredom thread):
"The part of the NFL offseason I find more interesting than anything in fantasy is watching teams navigate their own cap mistakes from 3 years ago. Detroit is good right now partly because they made good cap decisions in 2022-23 when nobody was paying attention."

**Comment 2** (on any free agency thread):
"The contract structure matters as much as the AAV. Guaranteed money, void years, and dead cap implications are where teams actually win or lose the offseason — the headline number is almost always misleading."

**Comment 3** (on any "what would you do with your team" thread):
"If I'm running the Bengals with $22M in space, I'm signing a real pass rusher before anything else. They have Burrow on a team-friendly deal for a few more years — this is the window and they're not maximizing it. One elite edge rusher changes their entire defensive profile."

---

### r/sportsbook karma comments

**Comment 1** (on any NFL futures/odds thread):
"The Chiefs at 18-20% Super Bowl odds feels about right to me historically. Mahomes + Reid in a conference that doesn't have a clear #2 threat. The market has priced them almost exactly where their historical performance suggests they should be."

**Comment 2** (on any team's odds discussion):
"Tennessee getting $63M in cap space + the #1 pick and still sitting at 4% Super Bowl odds tells you everything about how the NFL values QB certainty above all else. Resources without a franchise QB are just slightly better losing."

**Comment 3** (on any model/simulation discussion):
"The honest limitation of any NFL simulation is that individual game variance is massive. A team that 'should' win 11 games will win anywhere from 8-14 in any given season. The model tells you the mean — the actual season will be the tail."

---

### r/AItools karma comments

**Comment 1** (on any "what have you built with AI" thread):
"Domain expertise is the thing nobody talks about in AI coding. I built a reasonably complex web app using Claude without a CS background — but only because I knew the subject matter deeply. The AI wrote the code. I caught the domain errors. That collaboration is the actual model."

**Comment 2** (on any Claude/ChatGPT comparison thread):
"For longer-form technical projects, Claude has been significantly better for me than other models specifically because it maintains context better across a complex codebase. It remembers what it built three sessions ago. That's underrated."

**Comment 3** (on any non-technical founder thread):
"The failure mode for non-technical founders using AI to build is: you accept whatever the AI produces because you can't evaluate the code. You end up with technically functional software that solves the wrong problem. Your job isn't to write the code — it's to know whether it's working the way it should."

---

## Posting Schedule

| Week | Action |
|------|--------|
| Week 1-2 | Karma building ONLY. 2-3 genuine comments per day across all 5 subs. No links anywhere. |
| Week 3 | Post #1 (r/nfl) Monday + Post #5 (r/AItools) Thursday — different audiences, no overlap |
| Week 4 | Post #2 (r/NFLDraft) — time around big NFL news if possible |
| Week 5 | Post #3 (r/fantasyfootball) |
| Week 6 | Post #4 (r/sportsbook) |
| Week 7+ | Re-post best performer on alternate days if original hit 100+ upvotes |

**Rules:**
- Never post more than 1 per week per sub
- 2-week karma building minimum before first post
- Respond to EVERY comment within 2 hours if possible — early comment velocity determines ranking
- If a post gets removed, don't repost — adjust angle, wait one week, try again
- FTC disclosure ("I built this") on every post
- Responsible gambling footer on r/sportsbook post only
- Never post the same content to two subs in the same week
- Upvote thoughtfully on karma-building comments but don't brigade
