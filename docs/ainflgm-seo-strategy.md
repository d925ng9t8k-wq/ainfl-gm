# AiNFLGM — SEO Strategy
**Built:** March 26, 2026
**Status:** Pre-launch / organic growth phase
**Target:** Top 5 ranking for 3+ long-tail keywords within 90 days

---

## 1. Current SEO State

### What's Working
- Page title is solid: "AiNFL GM — Free AI-Powered NFL Offseason Simulator"
- Meta description covers the core value prop in one sentence
- Three schema.org blocks are present: WebApplication, FAQPage, Organization
- Google Analytics configured (G-PLW4H1NNF6)
- Google site verification file exists

### Critical Gaps
| Gap | Impact | Fix |
|-----|--------|-----|
| No Open Graph tags | Every social share shows blank preview | Add og:title, og:description, og:image, og:url |
| No Twitter Card tags | Twitter/X shares look broken | Add twitter:card, twitter:title, twitter:description, twitter:image |
| No canonical tag | Risk of duplicate content if URL params exist | Add `<link rel="canonical" href="https://ainflgm.com">` |
| No keywords meta | Low impact but easy win | Add 8-10 targeted keywords |
| FAQ schema only 3 questions | More FAQs = more SERP real estate | Expand to 8-10 Q&A pairs |
| No blog/content pages | Can't rank for long-tail without content | Build 4-6 content pages |
| Backlink profile likely thin | DA too low to compete on head terms | Reddit + niche NFL sites are the play |

---

## 2. Target Keywords

### Primary (Head Terms — Competitive, Long-Term)
These will take 6-12 months to crack. Build toward them.
- "NFL salary cap simulator"
- "NFL mock draft simulator"
- "NFL GM simulator"

### Long-Tail Targets (Win These First — 30-90 Days)

**Keyword 1:** `NFL salary cap simulator free 2026`
- Monthly searches: ~800-1,200 (estimated)
- Competition: Low — few free tools, none with full feature set
- Intent: Tool-seekers ready to use immediately
- Target page: Homepage + a dedicated "How It Works" content page

**Keyword 2:** `mock draft simulator with trades NFL 2026`
- Monthly searches: ~600-900
- Competition: Medium — Fantrax and others compete but don't simulate full offseason
- Intent: Draft enthusiasts, fantasy players in offseason
- Target page: A dedicated "Mock Draft" feature page or blog post

**Keyword 3:** `AI NFL general manager game free`
- Monthly searches: ~400-600
- Competition: Very Low — near-zero competition on this exact phrase
- Intent: Gaming audience, younger demo
- Target page: Homepage (already partially optimized for this)

**Keyword 4:** `simulate NFL offseason trades free agency draft`
- Monthly searches: ~300-500
- Competition: Low — this is a compound intent query with almost no competition
- Intent: Power users who want the full simulation experience
- Target page: Feature overview page or blog walkthrough

**Keyword 5:** `NFL cap space calculator what-if scenarios`
- Monthly searches: ~500-800
- Competition: Medium — OverTheCap and Spotrac have calculators but no simulation
- Intent: Cap-curious fans, sports bettors running scenarios
- Target page: Dedicated "Cap Simulator" feature page

---

## 3. On-Page SEO Fixes (Do These Now)

### index.html additions needed

```html
<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://ainflgm.com">
<meta property="og:title" content="AiNFL GM — Free AI-Powered NFL Offseason Simulator">
<meta property="og:description" content="Be the GM. Manage the salary cap, sign free agents, make trades, and run a full 7-round mock draft for any of the 32 NFL teams. Free, no signup.">
<meta property="og:image" content="https://ainflgm.com/og-image.png">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="AiNFL GM — Free NFL Offseason Simulator">
<meta name="twitter:description" content="Manage any NFL team's salary cap, sign free agents, make trades, and simulate the season. Free AI-powered GM simulator.">
<meta name="twitter:image" content="https://ainflgm.com/og-image.png">

<!-- Canonical -->
<link rel="canonical" href="https://ainflgm.com">

<!-- Keywords -->
<meta name="keywords" content="NFL salary cap simulator, mock draft simulator, NFL GM game, free agent simulator, NFL offseason game, salary cap calculator, NFL trades simulator, draft simulator 2026">
```

### FAQ Schema Expansion (add to existing FAQPage JSON-LD)
Add these Q&A pairs to the existing schema:
- "What NFL teams can I manage?" → "All 32 NFL teams with real 2026 cap data"
- "Can I make trades with other teams?" → "Yes, AI GMs evaluate trades based on positional need and pick value"
- "Does it use real draft prospects?" → "Yes, PFF-sourced 2026 draft prospects with 30% randomization"
- "What is the 2026 NFL salary cap?" → "$301.2 million per team"
- "Can I simulate multiple seasons?" → explain the feature
- "Does it work on mobile?" → Yes, no account required

---

## 4. Content Calendar — 30 Days

### Goal: Seed content that (a) gives Reddit posts something to link to and (b) builds long-tail keyword rankings.

| Day | Platform | Content | Target Keyword/Audience |
|-----|----------|---------|------------------------|
| Day 1 | Site (blog post) | "How to Build a Super Bowl Roster on a Budget: A Salary Cap Guide" | cap-curious fans, long-tail SEO |
| Day 3 | Reddit r/AItools | Post #5 (builder story) | r/AItools audience |
| Day 5 | Site (blog post) | "2026 NFL Draft Simulator Guide: Top Prospects and How to Build Around Them" | mock draft searchers |
| Day 7 | Reddit r/nfl | Post #1 (Bengals cap scenario) | r/nfl audience |
| Day 8 | X/Twitter | Thread: "I ran 20 NFL offseason scenarios this week. Here's what I learned about cap math." | NFL Twitter audience |
| Day 10 | Site (feature page) | Dedicated "Salary Cap Simulator" page targeting long-tail keyword | SEO |
| Day 12 | Reddit r/NFLDraft | Post #2 (100 mock draft analysis) | r/NFLDraft audience |
| Day 14 | X/Twitter | "Which NFL team has the best offseason setup right now? I ranked all 32." thread | NFL Twitter audience |
| Day 15 | Site (blog post) | "Tennessee Titans Have $63M to Spend — I Tried Every Way to Use It" | Titans fans + cap space searches |
| Day 17 | Reddit r/fantasyfootball | Post #3 (fantasy crossover) | r/fantasyfootball audience |
| Day 19 | X/Twitter | "Ran 100 mock drafts. Here are the 5 teams that draft the worst in the sim." | NFL draft Twitter |
| Day 21 | Site (blog post) | "The Cowboys Cap Situation Explained — And What a Real GM Would Do" | Cowboys fans (massive audience) |
| Day 23 | Reddit r/sportsbook | Post #4 (Polymarket integration) | r/sportsbook audience |
| Day 25 | X/Twitter | "Polymarket has [Team] at X% Super Bowl odds. I simulated 20 seasons. Here's what I found." | sports betting Twitter |
| Day 27 | Site (blog post) | "How NFL Restructures Work (And Why They Always Come Back to Haunt You)" | evergreen SEO, cap education |
| Day 30 | All channels | Recap post: "One Month of Simulations — Most Interesting Things We Found" | retention + backlink bait |

### Content Principles
- Every site blog post should target one specific long-tail keyword in the H1 and first paragraph
- Every post should end with a CTA to ainflgm.com (not a hard sell — a natural "run this yourself")
- Cowboys and Chiefs content will consistently get the most traffic. Lean into it.
- Bengals content is personally authentic. Use it for credibility.

---

## 5. Link Building Strategy

### Tier 1: Reddit (Primary — Do First)
- Already covered in the Reddit launch plan
- Reddit links are nofollow but drive real traffic and social signals
- Goal: 5 Reddit posts in 6 weeks, each with 50+ upvotes

### Tier 2: NFL Niche Sites (30-60 Days)
- **Cincy Jungle** (SB Nation Bengals blog) — reach out with the Bengals sim scenario as a "what would you do" guest post angle
- **The Athletic** comments / community — participate in cap discussions, build credibility
- **PFF community forums** — relevant draft simulator discussions
- **NFLTradeRumors.co** — comment thoughtfully on threads related to cap space

### Tier 3: AI/Indie Maker Sites (Parallel Track)
- **Product Hunt** launch — schedule for a weekday, prep upvote coordination
- **Hacker News "Show HN"** — builder story angle (same as r/AItools post)
- **Indie Hackers** — revenue/growth story when monetization launches
- **BetaList** — early adopter audience, tech-forward NFL fans

### Tier 4: Backlink Outreach (60-90 Days)
- Fantasy football writers who cover the offseason
- NFL cap analysis accounts on X/Twitter
- Sports betting newsletters that cover team construction

---

## 6. Technical SEO Checklist

- [ ] Add OG + Twitter Card tags (see section 3)
- [ ] Add canonical tag
- [ ] Create og-image.png (1200x630, shows the AiNFLGM interface)
- [ ] Submit sitemap.xml to Google Search Console
- [ ] Verify Google Search Console property
- [ ] Check Core Web Vitals score (target: all green)
- [ ] Confirm mobile rendering is correct on iOS Safari and Android Chrome
- [ ] Add robots.txt if not present
- [ ] Expand FAQ schema to 8-10 questions

---

## 7. Metrics to Track

| Metric | Baseline (Now) | 30-Day Target | 90-Day Target |
|--------|---------------|--------------|--------------|
| Google Search Console impressions | 0 (unindexed) | 500/mo | 5,000/mo |
| Organic sessions | ~0 | 200/mo | 1,500/mo |
| Reddit referral sessions | 0 | 500 (post-launch) | 2,000/mo |
| Keyword rankings (any) | 0 | 5 long-tail top 20 | 3 long-tail top 5 |
| DA/backlinks | ~1 | 5 linking domains | 25 linking domains |

---

## 8. Competitive Landscape

| Competitor | Strengths | Weaknesses | Our Edge |
|-----------|-----------|------------|----------|
| Madden Franchise Mode | Brand recognition, console audience | Costs $70, inaccurate cap math, console-only | Free, real data, web-based |
| OverTheCap | Trusted cap data, high DA | No simulation, no game layer | We use their data AND add the game |
| Fantrax/Fantasy platforms | Established user base | Fantasy players, not GM simulation | Different product entirely |
| PFF Mock Draft Simulator | Strong draft tool, PFF brand | Draft only, no cap/FA/season sim | We have the full offseason |
| NFL.com tools | Official, trusted | Sanitized, no real GM decisions | We let you make bad decisions |

**Positioning:** The only free, browser-based tool that simulates the full NFL offseason — cap, FA, trades, draft, AND season — with real 2026 data. Nobody else has the complete loop.

---

*Strategy doc built by UNO / Research Team Lead. Review quarterly or after major product changes.*
