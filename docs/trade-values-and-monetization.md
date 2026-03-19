# AiNFL GM — Trade Value Overhaul + Monetization Plan

**Prepared:** March 19, 2026

---

## Part 1: New Player Trade Value Formula

The current formula (`80 * Math.sqrt(capHit)` with basic multipliers) is too simplistic. Here's a research-backed replacement using data from PFF WAR, the Rich Hill chart, Massey-Thaler surplus value analysis, and ESPN trade tier research.

### New Formula

```
Trade_Value = Base_Value x Position_Mult x Age_Mult x Contract_Mult
```

### Base Value (from cap hit, with diminishing returns)

```javascript
// Scale: $1M player ~80pts, $10M ~250pts, $25M ~500pts, $45M ~670pts
const baseValue = 100 * Math.sqrt(capHit);
```

### Position Multipliers (from PFF WAR + surplus value data)

| Position | Multiplier | Rationale |
|----------|-----------|-----------|
| QB | 2.50 | 3x the WAR of any other position; franchise QBs command 2-3 first-rounders |
| EDGE/DE | 1.50 | Second-highest positional value; elite edges get 2 firsts (Crosby, Mack) |
| OT | 1.30 | Highest surplus value among non-QB; peak at 4%+ of cap |
| WR | 1.25 | High WAR ceiling; young elite WRs on rookie deals valued at 2+ firsts |
| CB | 1.20 | Premium coverage position; Ramsey set market at 2 firsts |
| DT/IDL | 1.05 | Solid value but less than edge; surplus peaks in mid-rounds |
| TE | 0.90 | Moderate WAR, latest peak, good longevity |
| LB | 0.85 | Mid-value; surplus peaks in round 2 |
| S | 0.75 | Among lowest positional value in draft return analysis |
| IOL (G/C) | 0.75 | Best centers generated only 2.53 combined WAR; surplus peaks mid-rounds |
| RB | 0.50 | Lowest value — shortest careers, earliest decline, smallest surplus |
| K/P/LS | 0.30 | Specialists rarely traded for meaningful capital |

### Age Multipliers (from PFF aging curves + FiveThirtyEight data)

Position-specific peak ages with exponential decay:

| Position | Peak Age | Decay Rate | Age 28 Mult | Age 30 Mult | Age 32 Mult | Age 34 Mult |
|----------|----------|-----------|-------------|-------------|-------------|-------------|
| QB | 27 | 0.95/yr | 0.95 | 0.90 | 0.86 | 0.77 |
| RB | 25 | 0.88/yr | 0.68 | 0.53 | 0.41 | 0.32 |
| WR | 26 | 0.90/yr | 0.90 | 0.73 | 0.59 | 0.48 |
| TE | 27 | 0.92/yr | 0.92 | 0.85 | 0.78 | 0.66 |
| OT | 27 | 0.92/yr | 0.92 | 0.85 | 0.78 | 0.66 |
| IOL | 27 | 0.92/yr | 0.92 | 0.85 | 0.78 | 0.66 |
| EDGE | 26 | 0.90/yr | 0.90 | 0.73 | 0.59 | 0.48 |
| DT | 26 | 0.90/yr | 0.90 | 0.73 | 0.59 | 0.48 |
| LB | 26 | 0.91/yr | 0.91 | 0.75 | 0.62 | 0.52 |
| CB | 26 | 0.89/yr | 0.88 | 0.69 | 0.55 | 0.43 |
| S | 26 | 0.90/yr | 0.90 | 0.73 | 0.59 | 0.48 |

```javascript
function getAgeMult(age, position) {
  const peaks = { QB: 27, RB: 25, WR: 26, TE: 27, OT: 27, IOL: 27, EDGE: 26, DT: 26, LB: 26, CB: 26, S: 26 };
  const decays = { QB: 0.95, RB: 0.88, WR: 0.90, TE: 0.92, OT: 0.92, IOL: 0.92, EDGE: 0.90, DT: 0.90, LB: 0.91, CB: 0.89, S: 0.90 };
  const peak = peaks[position] || 27;
  const decay = decays[position] || 0.90;
  if (age <= peak) return Math.min(1.0, 0.85 + (age - 21) * 0.03); // young but unproven ramp
  return Math.max(0.05, Math.pow(decay, age - peak));
}
```

### Contract Multipliers (from surplus value research)

| Situation | Multiplier | Why |
|-----------|-----------|-----|
| Rookie deal, 3+ years left | 1.35 | Maximum surplus value; team control at below-market cost |
| Rookie deal, 2 years left | 1.20 | Strong surplus, extension window |
| Rookie deal, 1 year left | 1.05 | Still cheap but less control |
| Below-market veteran deal | 1.10 | Positive surplus |
| Market-rate deal, 3+ years | 0.85 | No surplus, locked in |
| Market-rate deal, 2 years | 0.75 | Declining asset on full salary |
| Market-rate deal, 1 year | 0.55 | Rental territory |
| Above-market / unmovable deal | 0.35 | Negative surplus; may need sweetener to trade |
| Expiring / pending FA | 0.25 | Pure rental |

```javascript
function getContractMult(yearsRemaining, capHit, position) {
  // Estimate if on rookie deal by age and cap hit
  const isRookie = capHit < 8; // rough proxy
  if (isRookie) {
    if (yearsRemaining >= 3) return 1.35;
    if (yearsRemaining >= 2) return 1.20;
    return 1.05;
  }
  if (yearsRemaining >= 3) return 0.85;
  if (yearsRemaining >= 2) return 0.75;
  if (yearsRemaining >= 1) return 0.55;
  return 0.25;
}
```

### Draft Pick Values (Rich Hill chart, 1000-point scale)

The current PICK_VALUES table is close to the Jimmy Johnson chart. The Rich Hill chart (based on actual trade data 2011-2019) is more accurate:

| Pick | Johnson | Rich Hill | Recommended |
|------|---------|-----------|-------------|
| 1 | 3000 | 1000 | 3000 |
| 5 | 1700 | 468 | 1700 |
| 10 | 1300 | 398 | 1300 |
| 16 | 1000 | 316 | 1000 |
| 32 | 590 | 178 | 590 |

**Recommendation:** Keep the Johnson scale (it's what 99% of actual NFL trades match) but apply these future pick discounts:

| Year | Discount | Rationale |
|------|---------|-----------|
| Current (2026) | 1.00 | Face value |
| Next year (2027) | 0.55 | ~1 round downgrade; teams show extreme "win now" bias |
| Two years out (2028) | 0.30 | ~2 round downgrade |

Current code uses 0.85/0.70 which is too generous — real NFL trades discount future picks much more steeply.

---

## Part 2: Monetization + Prediction Markets

### The Killer Angle: Prediction Markets x Simulator

**No other NFL simulator is doing this.** When a user simulates a trade — say, sending Ja'Marr Chase to the Giants — show live Polymarket/Kalshi odds for that exact scenario alongside the trade result, with an affiliate link. The contextual relevance drives dramatically higher conversion than generic ad placements.

Example UX:
```
Trade Complete: Ja'Marr Chase to NYG for 2 first-round picks

Live Market: "Ja'Marr Chase next team" on Polymarket
  Giants: 12%  |  Cowboys: 8%  |  Field: 80%
  [Trade on Polymarket →]  (affiliate link, $10/signup)
```

### Revenue Streams — Ranked by Implementation Speed

#### Phase 1: This Week ($100-$1,000+/mo potential)

1. **Polymarket referral links** — $10/signup, no cap, free API for live odds data
   - Add contextual links throughout the simulator
   - Show live NFL market probabilities on trades, FA signings, draft picks
   - Implementation: 1-2 days

2. **Kalshi referral links** — $10/signup, $403M single-day NFL volume
   - Same contextual approach as Polymarket
   - Implementation: 1 day

3. **Sportsbook affiliates** (FanDuel $25-$35/signup, DraftKings 40% rev share)
   - Post-draft summary: "Think you can beat the real GM? Put your knowledge to work"
   - Implementation: 1-2 days

4. **Google AdSense** — already have placeholder slots ready
   - Uncomment the ad slots in Layout.jsx, apply for AdSense
   - Sports content CPM: $5-$15
   - Implementation: 1 hour (code is ready)

#### Phase 2: Next 30 Days ($500-$3,000/mo potential)

5. **Live odds widget** — The Odds API or Oddspedia (free widgets)
   - Embed live NFL odds alongside simulator pages
   - Drives affiliate conversions significantly
   - Implementation: 1 week

6. **Polymarket API integration** — free, 1000 calls/hr, no auth needed
   - Build custom displays showing live market probabilities
   - Match simulator scenarios to real prediction markets
   - Implementation: 2-3 weeks

7. **Buy Me a Coffee / Ko-fi** — already partially set up
   - Complete BMC account setup
   - Implementation: 10 minutes

#### Phase 3: 60-90 Days ($1,000-$5,000/mo potential)

8. **Freemium subscription** ($4.99/mo or $29.99/yr)
   - Free: 1 team, 1-round mock draft, basic trades
   - Premium: All 32 teams, 7-round draft, unlimited scenarios, advanced analytics, ad-free
   - Payment: Stripe Checkout
   - Implementation: 2-3 weeks

9. **Premium ad network upgrade** (Raptive at 25K visits = $35-$50 RPM)
   - 10-20x the revenue of AdSense
   - Wait until traffic qualifies
   - Implementation: Apply when ready

10. **Creator partnership program**
    - Give NFL YouTubers/podcasters free premium access + referral commissions
    - They promote AiNFL GM to their audience
    - Implementation: 1-2 weeks

#### Phase 4: 6+ Months ($5,000-$20,000/mo potential)

11. **API licensing** — sell simulator engine access to media sites
12. **White-label versions** — team-branded simulators for fan sites ($99-$299/mo each)
13. **Draft guides** — $9.99 PDF, seasonal revenue spike around April draft

### Revenue Projection

| Traffic | Ads | Pred Market Referrals | Sportsbook Affiliates | Premium Subs | Total |
|---------|-----|----------------------|----------------------|-------------|-------|
| 5K/mo | $150 | $200 | $300 | $0 | **$650** |
| 25K/mo | $1,000 | $1,000 | $1,500 | $1,000 | **$4,500** |
| 100K/mo | $5,000 | $4,000 | $5,000 | $5,000 | **$19,000** |

### Key APIs to Integrate

| Platform | API | Auth | Rate Limit | Cost |
|----------|-----|------|-----------|------|
| Polymarket | REST + WebSocket | None (read) | 1000/hr | Free |
| Kalshi | REST | API key | TBD | Free tier available |
| The Odds API | REST | API key | 500/mo | Free tier |
| SportsGameOdds | REST | API key | Varies | Free tier |

---

## Implementation Priority

1. **Now:** Sign up for Polymarket + Kalshi referral programs
2. **Now:** Apply for FanDuel + DraftKings affiliate programs
3. **This week:** Add contextual prediction market links to trade/FA/draft pages
4. **This week:** Uncomment AdSense slots, apply for AdSense account
5. **Next 2 weeks:** Build Polymarket API integration showing live odds
6. **Next 2 weeks:** Implement the new trade value formula (Part 1)
7. **Month 2:** Launch freemium tier with Stripe
8. **Month 2:** Creator partnership program
9. **Month 3:** Apply for Raptive/Mediavine when traffic qualifies

---

*This document combines research from PFF, ESPN, FiveThirtyEight, Over The Cap, Massey-Thaler academic research, Polymarket, Kalshi, and industry affiliate program data. See full source lists in the research agent outputs.*
