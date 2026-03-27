# FreeAgent9 — Business Plan
**Product:** AI Assistant for Sales Professionals (Mortgage, Real Estate, Insurance)
**Company:** 9 Enterprises LLC
**Date:** March 26, 2026
**Status:** Pilot live (Kyle Cabezas, mortgage LO) — converting to paid product

---

## Executive Summary

FreeAgent9 is a personal AI assistant delivered via text message (SMS/iMessage) and web chat. It gives mortgage loan officers, real estate agents, and insurance producers a business partner in their pocket — morning briefings, guideline answers, rate alerts, client reminders, and content generation — without requiring them to install an app, learn a dashboard, or change any behavior.

The product is live in pilot with Kyle Cabezas, a Producing Branch Manager at Rapid Mortgage in Cincinnati. The architecture is proven. The next step is converting it into a paid subscription product.

---

## Target Market

### Primary: Mortgage Loan Officers

- **Total addressable market:** ~300,000 licensed MLOs in the US (NMLS data)
- **Serviceable market:** ~80,000 purchase-focused LOs at independent mortgage banks and credit unions (not mega-banks)
- **Initial target:** Producing LOs and Branch Managers at mid-size lenders (100-2,000 employees)
- **Why they pay:** They live on their phone. They need guideline answers at 9 PM. They manage 20-40 active files. Every minute saved on admin is a minute spent closing deals.
- **Willingness to pay:** LOs routinely spend $200-500/month on CRM tools, lead services, and marketing. $29-99/month for an AI assistant is trivially priced relative to the value of one additional closed loan ($3,000-8,000 commission).

### Secondary: Real Estate Agents

- **Total addressable market:** ~1.5 million active licensed agents (NAR data)
- **Serviceable market:** ~400,000 agents closing 6+ transactions/year
- **Use cases:** Market data on demand, listing description writer, client follow-up reminders, social media content, open house prep checklists
- **Timeline:** Launch Q3 2026 after mortgage vertical is proven

### Tertiary: Insurance Agents/Producers

- **Total addressable market:** ~400,000 active P&C and life insurance agents
- **Serviceable market:** ~150,000 independent agents (not captive)
- **Use cases:** Policy comparison Q&A, renewal reminders, client birthday/milestone outreach, carrier guideline lookups
- **Timeline:** Launch Q4 2026

---

## Pricing Strategy

### Tier 1: Starter — $29/month

**Target user:** Solo-producing LO, individual agent

| Feature | Included |
|---------|----------|
| Morning briefing (daily) | Yes |
| Guideline Q&A (unlimited) | Yes |
| Client reminders | Up to 25 active |
| Rate alerts (threshold-based) | Yes |
| SMS delivery | Yes |
| Web chat dashboard | Yes |
| Conversation history | 30 days |

**Margin analysis:**
- Estimated API cost per user: $3-8/month (varies by usage volume)
- Twilio SMS cost per user: $1-3/month
- Infrastructure per user: <$1/month
- **Gross margin: ~70-85%**

### Tier 2: Pro — $99/month

**Target user:** Top producer, branch manager, team lead

| Feature | Included |
|---------|----------|
| Everything in Starter | Yes |
| Unlimited reminders | Yes |
| Script sparring partner | Yes |
| Social media ghostwriter | Yes |
| Referral partner wingman | Yes |
| Branch performance snapshots | Yes |
| iMessage + SMS delivery | Yes |
| Priority support | Yes |
| Conversation history | Unlimited |

**Margin analysis:**
- Estimated API cost per user: $8-15/month (heavier usage)
- Twilio + iMessage cost per user: $3-5/month
- Infrastructure per user: <$2/month
- **Gross margin: ~75-85%**

### Future: Enterprise / Team — Custom pricing

- For lenders deploying across an entire branch or company
- Volume discount: $19/user/month at 10+ seats, $15/user/month at 25+ seats
- Centralized admin dashboard
- Custom knowledge base (company-specific overlays, in-house guidelines)
- Encompass/LOS integration (roadmap)

---

## Feature Tiers Detail

### Core Features (Both Tiers)

**Morning Briefing**
Daily text at the user's preferred time. Contains: rate snapshot (current vs. yesterday), today's closings/appointments, pipeline flags, one priority action item. Format: 5 lines or fewer, casual tone, no bullet points.

**Guideline Q&A**
Instant answers to FHA, Conventional, VA, USDA guideline questions with citations. Built from official sources: FHA Handbook 4000.1, Fannie Mae Selling Guide, Freddie Mac Guide, VA Lender's Handbook. Common questions answered from a hardcoded lookup table (zero latency). Complex questions routed to Claude with the full guideline reference injected.

**Rate Alerts**
Threshold-based notifications when 30-year conventional rates move more than 0.125% intraday. Starter tier: manual rate input model (user texts their rate sheet). Pro tier: integrated real-time feed.

**Client Reminders**
Natural language reminder creation: "Remind me to call the Smiths at 3pm." Fires at the exact time specified. Manages concurrent reminders across the full pipeline.

### Pro-Only Features

**Script Sparring Partner**
Interactive roleplay for objection handling, rate lock conversations, realtor pitches, and cold calls. The AI plays the prospect/agent and pushes back. Designed for practice between real calls.

**Social Media Ghostwriter**
Generate LinkedIn posts, market updates, milestone celebrations, and referral partner content on demand. Knows the user's brand voice and keeps content compliant (no rate quotes, no guarantees).

**Referral Partner Wingman**
Draft personalized outreach to real estate agents, financial planners, and builders. Tracks relationship context over time. Suggests touchpoints based on seasonal patterns (spring buying season, year-end reviews).

**Branch Performance Snapshots**
For Branch Managers: team production tracking, application counts vs. prior month, LO-level status updates. Manual input model initially; Encompass API integration on roadmap.

---

## Customer Acquisition Plan

### Phase 1: Founder-Led Sales (Months 1-3)
**Target: 10-25 paying users**

- **Kyle Cabezas as anchor customer and case study.** His experience becomes the proof point for every sales conversation.
- **Rapid Mortgage expansion.** Kyle's team (Jebb Lyons, Justin Phillips, Adam Brewer) are the immediate next 3 users. Then Mark Jaynes (Columbus), Mike McGuffey (COO). Total Rapid Mortgage opportunity: 10-20 seats.
- **Jasson's network.** Direct outreach to LOs and branch managers Jasson knows personally from 15+ years in the industry. Warm introductions only. Target: 10-15 conversations, 5-8 conversions.
- **Cost: $0.** Zero paid acquisition in Phase 1.

### Phase 2: Content + Community (Months 3-6)
**Target: 50-100 paying users**

- **LinkedIn content.** Jasson publishes 2-3x/week about AI in mortgage. Not product pitches — real insights about how Kyle uses the tool, what works, what doesn't. Authentic, vulnerable, specific.
- **Mortgage industry forums and Facebook groups.** Loan Officer Hub, Mortgage Mastermind, branch manager communities. Provide value first (guideline answers, rate analysis), mention product second.
- **Referral program.** Existing users get 1 month free for every referral who subscribes. Kyle refers his LO friends, those LOs refer theirs.
- **Pilot-to-paid conversion.** Offer 14-day free trial. No credit card upfront. Conversion target: 40% trial-to-paid.

### Phase 3: Partnerships + Paid (Months 6-12)
**Target: 200-500 paying users**

- **Mortgage company partnerships.** Offer FreeAgent9 as a value-add for mid-size IMBs (100-500 LOs). Company pays, LOs get the tool. Land one 50-seat deal = $1,450/month recurring (at team pricing).
- **Conference presence.** MBA Annual Convention, regional mortgage conferences. Demo the product live from a phone on stage.
- **Google Ads.** Target "mortgage AI assistant," "loan officer tools," "mortgage guideline chatbot." Estimated CPC: $3-8. Target CAC: <$60 (2-month payback at $29/month).
- **Integration partnerships.** Partner with CRM vendors (Surefire, Aidium, Jungo) as a recommended add-on. Revenue share model.

---

## Revenue Projections

### Conservative Scenario

| Month | Users | MRR | Cumulative Revenue |
|-------|-------|-----|-------------------|
| Month 1 | 5 | $245 | $245 |
| Month 3 | 20 | $1,180 | $2,850 |
| Month 6 | 60 | $3,540 | $12,500 |
| Month 9 | 120 | $7,080 | $28,500 |
| Month 12 | 200 | $11,800 | $56,000 |

*Assumptions: 60% Starter, 40% Pro. 5% monthly churn. Average revenue per user: $59/month.*

### Optimistic Scenario (Land one enterprise deal)

| Month | Users | MRR | Cumulative Revenue |
|-------|-------|-----|-------------------|
| Month 1 | 5 | $245 | $245 |
| Month 3 | 35 | $2,065 | $4,800 |
| Month 6 | 120 | $7,080 | $22,000 |
| Month 9 | 250 | $14,750 | $55,000 |
| Month 12 | 500 | $29,500 | $120,000 |

### Unit Economics

| Metric | Value |
|--------|-------|
| Average Revenue Per User (ARPU) | $59/month |
| Cost of Goods Sold (API + SMS + infra) | $8-18/user/month |
| Gross Margin | ~75% |
| Target Customer Acquisition Cost (CAC) | <$60 |
| Payback Period | <2 months |
| Estimated Lifetime Value (LTV) at 5% churn | $1,180 |
| LTV:CAC Ratio | ~20:1 |

---

## Competitive Landscape

| Competitor | Price | Channel | AI Quality | Mortgage-Specific |
|-----------|-------|---------|-----------|-------------------|
| FreeAgent9 | $29-99/mo | SMS + iMessage + Web | Claude (best-in-class) | Yes |
| Aidium AI | $149-299/mo | Web dashboard | GPT-based | Partial (CRM-focused) |
| Homebot | $25-50/borrower/yr | Email | Rules-based | Homeowner-focused |
| Capacity (AI) | Enterprise pricing | Web + Slack | Custom | Yes (enterprise) |
| ChatGPT/Claude direct | $20/mo | Web/app | Best-in-class | No (generic) |
| Lindy.ai | $49-199/mo | Email + iMessage | Multiple | No (generic) |

**Our differentiation:**
1. **Zero friction.** No app download. No login. No dashboard to learn. Just text.
2. **Mortgage-native.** Not a generic AI with a mortgage prompt. Built-in guideline knowledge, rate awareness, pipeline vocabulary.
3. **Text-first delivery.** Works in the channel LOs already live in. No behavior change required.
4. **Price point.** $29/month is less than one borrower lunch. $99/month is less than 1/3 of what they pay for a CRM.

---

## Key Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Low trial-to-paid conversion | Medium | High | 14-day trial with daily value delivery (briefings). If they get value for 14 days, they'll pay. |
| API cost spikes from heavy users | Low | Medium | Token usage monitoring per user. Rate limiting on Starter tier. Hardcoded lookups for common questions reduce API calls. |
| Twilio/SMS delivery issues | Medium | High | A2P 10DLC registration in progress. iMessage as backup channel. |
| Competitor launches similar product | Medium | Medium | Speed advantage (live product now). Mortgage-specific depth is hard to replicate quickly. Network effects from user referrals. |
| Guideline accuracy liability | Low | High | Disclaimers on all responses. Citations to official sources. "Always confirm with your underwriter" built into system prompt. |

---

## 90-Day Roadmap

### Month 1: Foundation
- [ ] Convert Kyle pilot to paid subscription (first paying customer)
- [ ] Stripe Checkout integration for self-serve signup
- [ ] Onboarding flow: sign up -> customization survey -> number provisioned -> first briefing
- [ ] Deploy 3-5 additional users from Rapid Mortgage
- [ ] Landing page live at ainflgm.com/freeagent-landing.html

### Month 2: Product-Market Fit
- [ ] Collect NPS from first 10 users
- [ ] Identify top 3 most-used features (double down on those)
- [ ] Identify top 3 requested features (build the highest-value one)
- [ ] Launch referral program
- [ ] Begin LinkedIn content strategy

### Month 3: Scale Prep
- [ ] Multi-tenant architecture (shared server, per-user profiles)
- [ ] Admin dashboard for user management
- [ ] Real-time rate feed integration (Pro tier)
- [ ] Apply for mortgage industry conference speaking slots
- [ ] Target: 25 paying users, $1,475+ MRR

---

## Bottom Line

FreeAgent9 has three things most AI startups do not:

1. **A live pilot user** generating real feedback in a real business workflow.
2. **A founder with 15+ years of domain expertise** in the target industry.
3. **Infrastructure that already works** — voice, text, web chat, guideline RAG, all built and running.

The gap between "pilot" and "product" is pricing, onboarding, and acquisition. The technology is done. The market is ready. The only question is execution speed.

---

*Prepared by 9 — March 26, 2026*
