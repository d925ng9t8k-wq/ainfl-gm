# Affiliate Application Guide — AiNFLGM
**Date:** March 27, 2026
**Status:** Ready to Submit
**Site:** ainflgm.com

---

## 1. DraftKings Affiliate Program

### Application URL
- **Primary:** https://forms.gle/rW2KTw2PgaJuFop36 (DraftKings Affiliates Interest Survey)
- **Alternative:** https://www.draftkings.com/affiliates -> click "Contact Us"
- **Partner Portal Registration:** https://partner.draftkings.com/registration.asp

### Step-by-Step Application

1. Go to https://forms.gle/rW2KTw2PgaJuFop36
2. Fill in the following fields:
   - **Email:** captain@ainflgm.com
   - **Website:** https://ainflgm.com
   - **Products to Promote:** Sportsbook + DFS
   - **Licenses Held:** None required for content/affiliate (not an operator)
   - **Audience Description:** NFL fans using an AI-powered offseason simulator. Users actively engage with trade values, draft picks, and season projections — high-intent sports audience.
   - **Marketing Channels:** Website (organic SEO), Reddit (r/nfl, r/fantasyfootball), X/Twitter
   - **Competing Partnerships:** None currently
3. Click Submit
4. Wait for response (24 hours to several weeks — follow up if no response in 2 weeks)

### Commission Structure
| Product | CPA (per depositing user) | Rev Share |
|---------|--------------------------|-----------|
| Sportsbook | $100 - $300 | 25% - 40% NGR |
| Casino | $200 - $600 | 25% - 40% NGR |
| DFS | $40 - $100 | 25% - 40% NGR |

### Payout
- Monthly, within 30 days of the end of the conversion month
- Minimum threshold varies by agreement

### Reality Check
DraftKings is one of the **hardest** affiliate programs to get into. They want demonstrated ability to drive consistent, quality new players. Our pitch: AI-powered NFL simulator with high-intent sports users who are already thinking about team performance and game outcomes. If no response in 2 weeks, follow up via their contact form.

---

## 2. FanDuel Affiliate Program

### Application URL
- **Primary:** https://affiliates.fanduel.com/ -> click "Join Now"
- **Alternative:** https://partners.fanduel.com/registration.asp

### Step-by-Step Application

1. Go to https://affiliates.fanduel.com/
2. Click "Join Now"
3. Fill in the registration form:
   - **Username:** ainflgm
   - **Password:** (use password manager)
   - **Security Questions:** Fill as prompted
   - **Email:** captain@ainflgm.com
   - **Phone:** Jasson's number
   - **Name:** Jasson Fishback
   - **Payment Method:** Bank transfer (preferred) or check
4. In the "Additional Information" section:
   - **Website URL:** https://ainflgm.com
   - **Products to Promote:** Sportsbook + DFS
   - **Licenses:** N/A (content affiliate, not operator)
   - **Promotion Methods:** Organic web traffic, SEO content, social media (Reddit, X)
   - **Commission Preference:** CPA (better for low-volume early stage)
5. Click "Join Now" and wait
6. Response time: up to 1 month (they get many applications)

### Commission Structure
| Product | CPA (per depositing user) | Rev Share |
|---------|--------------------------|-----------|
| Sportsbook | $100 - $400 | 20% - 40% NGR |
| Casino | $200 - $500 | 20% - 40% NGR |
| DFS | $30 - $100 | 20% - 40% NGR |

### Cookie Duration
30 days from click to conversion

### Payout
- End of the month following the performance month
- Platform: Income Access

### Important Restrictions
- Cannot simultaneously promote offshore/unregulated gambling operators (we don't)
- Must include FTC disclosures (already in our footer)
- Must include responsible gambling messaging (already in our footer)

---

## 3. BetMGM Affiliate Program (Bonus Application)

### Application URL
- **Primary:** https://www.betmgmpartners.com/ -> Sign Up

### Step-by-Step Application

1. Go to https://www.betmgmpartners.com/
2. Complete the sign-up form with website info, promotion methods, and audience details
3. Explain how you plan to promote BetMGM (same pitch as DraftKings)
4. Submit and wait (a few business days for review)

### Commission Structure
| Tier | CPA per Player |
|------|---------------|
| First 50 referrals | $100+ |
| Next 500 referrals | $150+ |
| 500+ referrals | $200+ |

- RevShare: Negotiated individually
- Qualified Player: Must register, deposit $10+, and settle a real-money wager
- Payout: Within 15 working days of the following month, $100 minimum

---

## 4. Integration Plan for AiNFLGM

### Where Affiliate Links Go

| Page / Feature | Affiliate Link Placement | CTA Copy |
|---------------|-------------------------|----------|
| Season Simulator Results | After W/L projection | "Think this team wins? Bet on it at DraftKings" |
| Trade Analyzer | After trade evaluation | "Like this trade? Build your DFS lineup" |
| Free Agent Signings | After major signing | "Build your fantasy lineup with these FAs" |
| Draft Simulator | After draft completion | "Draft your fantasy team too" |
| Prediction Markets Page | Next to market odds | "Want real money on the line? Try DraftKings" |
| Report Card Export | In the exported report | "Share your picks — then put money on them" |

### FTC Compliance (Already in Place)
- Footer disclosure on all pages (Layout.jsx)
- Responsible gambling message (Layout.jsx)
- Privacy policy at /privacy

---

## 5. Application Priority Order

| Priority | Program | Why | Apply When |
|----------|---------|-----|-----------|
| 1 | FanDuel | Easiest application, good CPA | NOW |
| 2 | DraftKings | Highest brand recognition, harder approval | NOW |
| 3 | BetMGM | Third major operator, solid CPA tiers | After first approval |
| 4 | Polymarket | Prediction market angle (see revenue-streams.md) | After $10K volume |
| 5 | Kalshi | Secondary prediction market | After Polymarket |

---

## 6. Post-Approval Checklist

Once approved by any program:

- [ ] Get affiliate tracking links from dashboard
- [ ] Create a dedicated component in React for affiliate CTAs
- [ ] A/B test CTA copy and placement
- [ ] Track clicks via Google Analytics UTM parameters
- [ ] Set up monthly revenue reporting in a spreadsheet
- [ ] Ensure all affiliate links use rel="sponsored noopener" attributes
- [ ] Test links work correctly in all US states where the operator is live
