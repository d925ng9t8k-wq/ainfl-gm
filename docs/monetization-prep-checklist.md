# AiNFLGM Monetization Prep Checklist
**Date:** March 26, 2026
**Last Updated:** March 26, 2026 (Tee sprint)
**Goal:** Get everything ready for revenue activation

---

## Status Summary (March 26, 2026)

| Item | Status |
|------|--------|
| Live site with original content | DONE |
| Google Analytics (G-PLW4H1NNF6) | DONE — firing correctly in index.html |
| Privacy policy (React route /privacy) | DONE — upgraded to full AdSense-grade policy |
| Privacy policy (standalone /privacy.html) | DONE — full HTML page in public/ |
| FTC affiliate disclosure on all pages | DONE — in Layout.jsx footer |
| Responsible gambling footer | DONE — in Layout.jsx footer |
| AdSense meta tag placeholder in index.html | DONE — commented placeholder ready to activate |
| Ad slot scaffolding in Layout.jsx | DONE — footer leaderboard slot coded |
| Buy Me a Coffee active | DONE |
| Cookie consent banner | NOT YET — optional for US-only, add before EU traffic |
| 30 days traffic data | IN PROGRESS — clock running |
| AdSense application submitted | NOT YET — ready to apply |
| DraftKings affiliate applied | NOT YET |
| FanDuel affiliate applied | NOT YET |

---

## Google AdSense

### Prerequisites
- [x] Live website with original content (ainflgm.com)
- [x] Privacy policy page — full policy at /privacy and /privacy.html
- [x] Content meets AdSense policies (sports simulation, no prohibited content)
- [x] FTC disclosure on all pages (Layout.jsx footer)
- [x] Responsible gambling footer (Layout.jsx)
- [x] Google Analytics active and firing (G-PLW4H1NNF6 verified in index.html)
- [x] AdSense meta tag placeholder in index.html (activate after account creation)
- [ ] Minimum 30 days of traffic data (clock running — apply when ready)

### How to Apply
1. Go to google.com/adsense and sign in with Google account
2. Add site: ainflgm.com
3. Replace the commented placeholder in index.html with actual pub ID:
   `<meta name="google-adsense-account" content="ca-pub-XXXXXXXXXXXXXXXX">`
4. Also add the AdSense auto-ads script to index.html `<head>`:
   `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>`
5. Wait for review (typically 1-14 days)
6. Once approved, replace the placeholder div in Layout.jsx `#ad-slot-footer` with actual ad unit code

### Recommended Ad Placements (Ready to Activate)
- Footer leaderboard (728x90) — slot already coded in Layout.jsx
- In-feed ads on roster/free agent lists — add between every 10 rows
- Between draft rounds — interstitial after round completion
- Sidebar on desktop (cap tracker page)

### Estimated Revenue
- At 1K monthly sessions: $10-30/month
- At 5K monthly sessions: $50-150/month
- At 25K monthly sessions: $250-750/month
- At 50K monthly sessions: $500-1,500/month
- At 100K monthly sessions: $1,000-3,000/month

---

## DraftKings Affiliate

### Prerequisites
- [ ] 30-60 days of traffic history (in progress)
- [x] Sports-related content
- [x] US-based website
- [x] FTC disclosure on affiliate pages (Layout.jsx footer)

### Application
1. Apply at draftkings.com/affiliates (Google Form)
2. Provide: site URL, traffic estimate, content description
3. Wait for approval (1-2 weeks typically)
4. Receive affiliate links and tracking codes

### Integration Points on AiNFLGM
- Season sim results page: "Think this team wins? Bet on it" → DraftKings link
- Polymarket comparison: "Want to put real money on it?" → DraftKings
- Free agency page: "Build your DFS lineup with these FAs" → DraftKings DFS
- Draft page: "Draft your fantasy team too" → DraftKings

### Payout
- CPA: $100-300 per depositing sportsbook user
- CPA: $40-100 per DFS user
- Rev share: 25-40% of net gaming revenue

---

## FanDuel Affiliate

### Prerequisites
- Same as DraftKings
- [ ] Apply simultaneously with DraftKings

### Application
1. Apply at affiliates.fanduel.com (Income Access platform)
2. Similar process to DraftKings

### Payout
- CPA: $100-400 per depositing sportsbook user
- CPA: $30-100 per DFS user
- Rev share: 20-40% NGR (35% first 730 days, $1K cap)

---

## Buy Me A Coffee (Active)

- [x] Account created at buymeacoffee.com/ainflgm
- [x] Floating button in Layout.jsx (fixed bottom-right)
- [x] Support banner in Layout.jsx main content area
- [x] $5/month membership option available

---

## Premium Tier (Future — after 10K MAU)

### When to Launch
- After 10K+ monthly active users
- After core features are polished
- After data accuracy is verified

### Features for Premium ($9.99/month)
- Multi-season dynasty mode
- Advanced analytics dashboard
- Custom team creation
- Trade analyzer with historical comparisons
- No ads
- Priority data updates

### Tech Stack
- Stripe for payments
- Feature flags for gating
- User accounts (email + password or OAuth)

---

## Revenue Projections (Updated March 26, 2026)

Based on current traffic baseline (early stage, site launched Feb 2026).

| Timeline | Monthly Sessions | AdSense | Affiliates | BMAC | Premium | Total |
|----------|-----------------|---------|------------|------|---------|-------|
| Now (March 2026) | ~500 | $0 | $0 | $5 | $0 | $5 |
| Month 3 (June 2026) | 5K | $75 | $200 | $20 | $0 | $295 |
| Month 6 (Sept 2026) | 20K | $300 | $2,000 | $50 | $200 | $2,550 |
| Month 12 (March 2027) | 50K | $1,000 | $8,000 | $100 | $2,000 | $11,100 |
| Month 18 (Sept 2027) | 100K | $2,500 | $25,000 | $200 | $5,000 | $32,700 |

**Notes:**
- Affiliate revenue is highly variable — one viral post could spike it significantly
- AdSense RPM for sports content typically $2-5 CPM
- DraftKings/FanDuel CPA events are rare but high-value ($100-400 each)
- NFL offseason (Feb-May) and draft season are peak traffic windows
- Reddit and X distribution are the primary growth levers right now

---

## Immediate Next Steps

1. [x] Upgrade PrivacyPage.jsx to full AdSense-grade policy
2. [x] Add AdSense meta tag placeholder to index.html
3. [ ] Create AdSense account at google.com/adsense
4. [ ] Activate AdSense meta tag once pub ID is assigned
5. [ ] Submit AdSense application
6. [ ] Apply to DraftKings affiliate program simultaneously
7. [ ] Apply to FanDuel affiliate program simultaneously
8. [ ] Add cookie consent banner before targeting EU traffic
