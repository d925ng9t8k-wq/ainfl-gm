# Additional Revenue Streams — AiNFLGM
**Date:** March 27, 2026
**Status:** Research Complete
**Goal:** Diversify beyond AdSense and sportsbook affiliates

---

## 1. Prediction Market Affiliates

### Polymarket
- **Program Type:** Referral + Affiliate (powered by Dub.co)
- **How to Join:** Create account at polymarket.com, accumulate $10,000+ trading volume, then apply at polymarket.com/refer
- **Earnings:**
  - $0.01 per click on referral links
  - $10 per referred user who makes first deposit
  - 30% of fees from direct referrals (first 180 days)
  - 10% of fees from indirect referrals (second-level chain)
- **Payout:** Daily at midnight UTC, via Stripe, minimum $100
- **Integration for AiNFLGM:** Our prediction markets page already shows Polymarket odds. Add referral links directly: "Trade this market on Polymarket" next to each odds display.
- **Realistic Revenue:** At 100 clicks/day = $1/day from clicks + occasional deposits. $30-$100/month initially, scaling with traffic.
- **Barrier:** Need $10K trading volume first. This requires either Jasson trading or using project funds.

### Kalshi
- **Program Type:** Referral only (not a true affiliate program)
- **How to Join:** Create account, verify KYC, trade ~100 shares to unlock referral section
- **Earnings:**
  - $25 per referred user who trades $100+ within 30 days
  - Referred user also gets $25
  - Cap: $1,000 per referrer
- **Payout:** Referral credits (must trade to withdraw profits)
- **Integration for AiNFLGM:** Add alongside Polymarket on prediction pages: "Trade NFL outcomes on Kalshi"
- **Realistic Revenue:** Lower ceiling ($1K cap) but easy to set up. Good supplementary income.
- **Barrier:** Lower earning potential than Polymarket. Credits, not cash.

### Recommendation
Start with Polymarket (higher earning potential, no cap). Add Kalshi as secondary. Both fit perfectly with our existing prediction markets feature.

---

## 2. Sports Betting Affiliates (Beyond DK/FanDuel)

### BetMGM Partners
- **URL:** https://www.betmgmpartners.com/
- **CPA:** $100-$200+ per depositing player (tiered by volume)
- **RevShare:** Negotiated individually
- **Why:** Third largest US sportsbook. Different user base than DK/FD.
- **Apply:** After getting first DK or FD approval (shows legitimacy)

### Caesars Sportsbook Affiliates
- **URL:** Through WSOP/Caesars affiliate portal
- **CPA:** $100-$300 per depositing player
- **Why:** Strong brand, especially in states where they're dominant (NJ, MI, AZ)

### ESPN BET (Penn Entertainment)
- **Status:** May not have a public affiliate program yet — monitor
- **Why:** ESPN brand = massive trust factor. If they launch an affiliate program, apply immediately.

### bet365 Affiliates
- **URL:** https://www.bet365affiliates.com/
- **Why:** Largest global sportsbook, expanding in US
- **CPA:** Varies by market

### Strategy
Apply to ALL major sportsbook affiliate programs. Each operates in different states. A user in Michigan might use BetMGM over DraftKings. More programs = more potential conversions across all US states.

---

## 3. Premium Tier ($9.99/month)

### When to Launch
- After 10,000+ monthly active users
- After core features are polished and bug-free
- Target: Week 14 of roadmap (June 2026)

### Premium Features
| Feature | Free Tier | Premium ($9.99/mo) |
|---------|-----------|-------------------|
| Single-season sim | Yes | Yes |
| Multi-season dynasty mode | No | Yes |
| Advanced analytics dashboard | No | Yes |
| Custom team creation | No | Yes |
| Trade analyzer with historical comps | Basic | Full |
| Export report cards | Watermarked | Clean |
| Ad-free experience | No | Yes |
| Priority data updates | No | Yes |
| Season-long tracking | No | Yes |
| Community leaderboards | View only | Full participation |

### Pricing Strategy
- **$9.99/month** — Core premium
- **$79.99/year** — Annual discount (33% off, improves retention)
- **$4.99/month** — "Lite" tier (ad-free only, no extra features)
- **Free trial:** 7 days of premium, then convert

### Tech Stack
- **Stripe Checkout** for payments (keys already in .env)
- **Feature flags** in React (simple boolean checks against user subscription status)
- **Auth:** Email + password (or Google OAuth via Firebase)
- **Storage:** User subscription status in localStorage + server verification

### Revenue Projections
| Subscribers | Monthly Revenue | Annual Revenue |
|------------|----------------|----------------|
| 10 | $100 | $1,200 |
| 50 | $500 | $6,000 |
| 100 | $1,000 | $12,000 |
| 500 | $5,000 | $60,000 |
| 1,000 | $10,000 | $120,000 |

### Conversion Rate Assumptions
- Industry standard for freemium sports apps: 2-5% conversion
- At 10,000 MAU: 200-500 potential subscribers = $2,000-$5,000/month
- At 50,000 MAU: 1,000-2,500 potential subscribers = $10,000-$25,000/month

---

## 4. Newsletter / Email Monetization

### Strategy
Build an email list via the site, then monetize through:

1. **Affiliate CTAs in emails** — Weekly "NFL picks" email with DraftKings/FanDuel links
2. **Sponsored content** — Sports brands pay $50-$500 per email send to 1K-10K subscribers
3. **Premium newsletter tier** — $4.99/month for exclusive AI predictions

### Implementation
- Add email capture popup/banner to site
- Use free tier of Mailchimp, ConvertKit, or Beehiiv
- Weekly sends during NFL season, bi-weekly in offseason
- Include affiliate links in every email

### Revenue Potential
| List Size | Sponsorship Revenue | Affiliate Revenue | Total |
|-----------|-------------------|-------------------|-------|
| 500 | $0 | $20/mo | $20/mo |
| 2,000 | $200/mo | $100/mo | $300/mo |
| 5,000 | $500/mo | $300/mo | $800/mo |
| 10,000 | $1,500/mo | $800/mo | $2,300/mo |

---

## 5. API / Data Licensing (B2B)

### What We Have
- NFL salary cap data for all 32 teams
- AI-powered trade value calculator
- Season simulation engine
- Draft prospect rankings

### Who Would Pay
- Fantasy sports apps needing salary cap data
- Sports media outlets needing trade analysis
- Other developers building NFL tools
- Content creators needing data for articles

### Pricing
- **Starter:** $49/month — 1,000 API calls/month
- **Pro:** $199/month — 10,000 API calls/month
- **Enterprise:** Custom pricing — unlimited calls + custom endpoints

### Implementation
- Build a simple REST API on top of existing data
- Deploy on Cloudflare Workers (we already have cloud-worker infrastructure)
- API key authentication
- Rate limiting and usage tracking

### Timeline
- Build: 2-3 weeks of dev work
- Launch: Month 5-6 of roadmap
- Revenue: $500-$2,000/month once established

---

## 6. Sponsored Content / Direct Advertising

### When
After reaching 25,000+ monthly sessions

### Types
- **Banner ads sold directly** — Cut out AdSense middleman, sell to sports brands directly
- **Sponsored team analysis** — "This Bengals analysis brought to you by [Brand]"
- **Sponsored predictions** — "Week 1 predictions powered by [Sportsbook]"

### Pricing (based on traffic)
- 25K sessions: $200-$500/month for a banner spot
- 50K sessions: $500-$1,000/month
- 100K sessions: $1,000-$3,000/month

### How to Find Sponsors
- Direct outreach to sports brands
- Use BuySellAds.com or Carbon Ads marketplaces
- Network at sports tech conferences

---

## 7. White-Label / Licensing

### Concept
License the AiNFLGM engine to other sports sites or media companies.

### Potential Buyers
- Local sports news sites wanting an interactive feature
- Fantasy sports platforms wanting a trade calculator
- Sports podcasts wanting an embedded simulator
- College football sites wanting a similar tool for NCAA

### Pricing
- $500-$2,000/month per licensee
- Or revenue share on their traffic

### Timeline
- Feasible after Month 6 once the product is mature
- Requires building an embeddable widget version

---

## Revenue Stream Priority Matrix

| Stream | Time to Revenue | Revenue Potential | Effort | Priority |
|--------|----------------|-------------------|--------|----------|
| Sportsbook affiliates (DK/FD/BetMGM) | 2-4 weeks | HIGH ($1K-$10K/mo) | LOW | 1 |
| AdSense | 2-6 weeks | LOW ($50-$500/mo) | LOW | 2 |
| Prediction market referrals | 1-2 weeks | MEDIUM ($50-$200/mo) | LOW | 3 |
| Buy Me a Coffee | Active now | LOW ($5-$50/mo) | NONE | 4 |
| Premium tier | 3-4 months | HIGH ($1K-$10K/mo) | HIGH | 5 |
| Email newsletter | 2-3 months | MEDIUM ($200-$2K/mo) | MEDIUM | 6 |
| API licensing | 5-6 months | MEDIUM ($500-$2K/mo) | HIGH | 7 |
| Direct ad sales | 4-6 months | MEDIUM ($500-$3K/mo) | MEDIUM | 8 |
| White-label licensing | 6-12 months | HIGH ($2K-$10K/mo) | VERY HIGH | 9 |

---

## Total Addressable Revenue (Month 12 Target)

| Stream | Conservative | Optimistic |
|--------|-------------|-----------|
| Sportsbook affiliates | $3,000 | $10,000 |
| AdSense | $300 | $1,000 |
| Prediction markets | $100 | $500 |
| Premium subscriptions | $1,000 | $5,000 |
| Email/Newsletter | $200 | $1,000 |
| API licensing | $200 | $1,000 |
| Buy Me a Coffee | $50 | $100 |
| **Total** | **$4,850** | **$18,600** |

**Target: $10,000/month by March 2027.**
