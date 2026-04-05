# AiNFLGM — Cost Per User Model
**Date:** April 5, 2026
**Author:** MONEY (9 Enterprises Revenue Agent)
**Purpose:** Satisfy Kyle's unmet ask #6 — show per-user economics at scale.
**Status:** Live. Recalculate when infrastructure changes.

---

## Infrastructure

AiNFLGM is a static PWA hosted on GitHub Pages (free tier), served globally via Cloudflare CDN (free tier).
There is no backend server, no database, no compute cost per request.
API calls (NFL data refresh) run server-side via GitHub Actions cron — not user-triggered.

---

## Cost Assumptions

| Cost Item | Monthly Cost | Notes |
|-----------|-------------|-------|
| GitHub Pages hosting | $0 | Free, unlimited bandwidth on public repos |
| Cloudflare CDN | $0 | Free tier handles unlimited requests |
| Domain (ainflgm.com) | ~$1.25 | ~$15/yr Namecheap |
| Google Analytics | $0 | Free |
| NFL data refresh (GitHub Actions) | $0 | Free tier (2,000 min/mo included) |
| AdSense (revenue, not cost) | $0 cost | Revenue share, no fee |
| Email notifications (ntfy.sh) | $0 | Free tier |
| Resend (future email list) | $0–$20 | Free up to 3,000/mo; $20/mo for 50K |
| Sentry error monitoring | $0 | Free up to 5K errors/mo |
| **Total fixed monthly burn** | **~$1.25–$21.25** | Low end: no email tool; high end: Resend paid |

No per-user API cost. No per-request compute cost. This is a static site.

---

## Per-User Cost Model

All figures assume current infrastructure (GitHub Pages + Cloudflare free). Costs do not scale with traffic.

| Metric | 100 MAU | 1,000 MAU | 10,000 MAU | 100,000 MAU |
|--------|---------|-----------|------------|-------------|
| Hosting | $0 | $0 | $0 | $0* |
| Domain (amortized) | $0.013 | $0.001 | $0.0001 | $0.00001 |
| Email tool (Resend) | $0 (free) | $0 (free) | $0.002 | $0.0006 |
| Fixed overhead amortized | $0.013 | $0.001 | $0.0001 | $0.00001 |
| **Cost per MAU** | **~$0.01** | **~$0.001** | **~$0.0002** | **~$0.00002** |
| **Cost per DAU (est. 20% of MAU)** | **~$0.07** | **~$0.007** | **~$0.001** | **~$0.0001** |

*At 100K MAU GitHub Pages remains free for static sites. Cloudflare Pro ($20/mo) recommended at this scale for analytics, but not required.

---

## Revenue vs. Cost Model

| Scale | Monthly Infra Cost | AdSense Revenue (est.) | Affiliate Revenue (est.) | Net |
|-------|-------------------|----------------------|--------------------------|-----|
| 100 MAU (~500 PV/day) | $1.25 | $15–$50 | $0–$50 | +$14–$99 |
| 1,000 MAU (~5K PV/day) | $1.25 | $150–$500 | $50–$400 | +$199–$899 |
| 10,000 MAU (~50K PV/day) | $1.25–$21 | $1,500–$5,000 | $500–$4,000 | +$1,979–$8,979 |
| 100,000 MAU (~500K PV/day) | $21–$41 | $15,000–$50,000 | $5,000–$40,000 | +$19,959–$89,959 |

### Revenue Assumptions
- AdSense RPM: $3–$10 (sports niche; draft window commands premium)
- Affiliate CPA: FanDuel $100–400/signup, BetMGM $50–200/signup
- Affiliate conversion rate: 1–3% of users who click a banner actually sign up
- Draft window (April 23–25) expected to 5–10x normal daily traffic

---

## Draft Window Scenario (April 23–25, 2026)

Peak NFL Draft traffic typically lasts 3 days with a tail of 2 weeks.
Projected peak: 5,000–15,000 unique users over 3-day window.

| Revenue Path | Conservative | Aggressive |
|-------------|-------------|-----------|
| AdSense (RPM $5, 3 PV/user) | $75 | $225 |
| Affiliate — FanDuel signups (1%, $150 CPA) | $750 | $22,500 |
| Affiliate — DraftKings (0.5%, $100 CPA) | $250 | $7,500 |
| Email signups captured | 150 | 1,500 |
| **Total 3-day window** | **~$1,075** | **~$30,225** |

Note: Affiliate revenue requires approved accounts with real tracking links live before April 23.
AdSense revenue requires account approval (2–4 week review; submitted today April 5 = tight but possible).

---

## What This Means for Kyle

The unit economics here are exceptional:
- Cost per user is effectively **$0.00 to $0.01** at any scale under 100K MAU
- The business model risk is entirely on revenue, not cost
- No backend = no DevOps, no servers, no scaling bottlenecks
- The only cost that scales is email infrastructure (Resend), which kicks in after free tier

The revenue/cost ratio at 10K MAU is better than most B2C SaaS products at seed stage.

---

## Upgrade Thresholds

| Trigger | Action | Cost Delta |
|---------|--------|-----------|
| 3,000+ email subscribers | Move to Resend paid ($20/mo) | +$20/mo |
| 500K+ monthly page views | Add Cloudflare Pro for analytics | +$20/mo |
| Affiliate income > $500/mo | Upgrade to dedicated hosting for reliability | +$10–25/mo |
| JS errors > 100/day | Add Sentry Team plan | +$26/mo |

---

## Summary

At current scale (estimated <1,000 MAU), AiNFLGM costs **$1.25/month** to run.
Revenue potential at the April 23–25 Draft window is **$1,000–$30,000 for 3 days** if affiliate programs are live.
The only real cost risk is opportunity cost — not having the affiliate accounts live before the draft window is the primary financial exposure.

**Immediate action required:** Complete affiliate signups at FanDuel and BetMGM/DraftKings before April 17 (gives 6 days to get approved and test tracking links before the draft).
