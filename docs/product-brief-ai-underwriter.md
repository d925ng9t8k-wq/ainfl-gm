# AI Underwriting Team — Product Brief
**Product:** RAG-Based Mortgage Guideline Intelligence
**Company:** 9 Enterprises LLC / The Franchise
**Status:** POC ready to build — anchor customer identified
**Revenue Model:** SaaS, $500-2,000/month per lender

---

## What It Is

The AI Underwriting Team is a RAG-based chatbot that lets mortgage loan officers query agency guidelines in plain English and get back accurate answers with exact source citations — in under five seconds.

No PDF searching. No scrolling through 900-page handbooks. No calling the underwriting desk to ask a question they have answered fifty times this week. The LO asks the question. The AI answers it. With the guideline section attached.

**Stack:**
- Claude API (200K context window) as the reasoning layer
- Agency PDFs ingested, chunked, and embedded via vector search
- Web or Telegram interface for LO access
- No fine-tuning required — pure RAG architecture, updateable on guideline change without retraining

---

## Example Q&A

**Loan Officer asks:**
> "Can I use rental income from a property the borrower just bought to qualify for an FHA loan?"

**AI Underwriting Team responds:**
> Rental income from a recently acquired property is generally not eligible for FHA qualification unless the borrower has a two-year history of managing rental properties documented on their tax returns. Exceptions apply for relocations where the departing residence becomes a rental — specific documentation requirements apply.
>
> Source: HUD Handbook 4000.1, Section II.A.4.d — Rental Income

That answer would have taken a loan officer 15-20 minutes to find manually. It took the AI five seconds. Multiply that by 10 questions a day, 20 loan officers, 250 working days. That is the ROI conversation.

---

## The Competitive Gap

Enterprise underwriting intelligence tools — Tavant, ICE Encompass AI, LoanLogics — solve this problem at the enterprise level. Implementation costs start at $200,000. Deployment takes six months. They require dedicated IT resources and ongoing vendor relationships. They are built for the top 50 lenders by volume.

**Mid-size lenders get nothing.**

A regional lender with 20-50 loan officers is too small to justify the enterprise tools and too large to survive on Ctrl+F and tribal knowledge. Their LOs are still manually searching through guidebooks that run 1,200 pages for Fannie Mae alone. Every question costs time. Every misread guideline is a compliance risk. Every training cycle for a new LO is expensive and slow.

No lightweight, accurate, affordable guideline assistant exists for this market. That gap is the business.

---

## Architecture Decision

**Why RAG and not fine-tuning?**
Agency guidelines update frequently — HUD and Fannie Mae push revisions quarterly. A fine-tuned model requires retraining on every update, which takes time, compute, and money. A RAG system with a versioned PDF corpus requires a re-ingest — a process that takes hours, not weeks. For a small team operating at speed, RAG is the only viable long-term architecture.

**Why FHA first?**
FHA is the most commonly originated product for mid-size lenders. HUD Handbook 4000.1 is the most consistently structured of the five agency documents. And it is free to download — zero cost to acquire the primary data source. The POC can be running in 2-3 days.

---

## The Five Agencies

Full coverage means all five. The POC starts with one and proves the architecture before expanding.

| Agency | Document | Pages |
|---|---|---|
| FHA | HUD Handbook 4000.1 | ~900 |
| Fannie Mae | Selling Guide | ~1,200 |
| Freddie Mac | Seller/Servicer Guide | ~1,000 |
| VA | Pamphlet 26-7 | ~500 |
| USDA | HB-1-3555 | ~400 |

All five documents are publicly available. Total corpus: approximately 4,000 pages. A RAG system over this corpus covers the vast majority of guideline questions a loan officer will ever ask.

---

## Phases

**Phase 1 — FHA POC (2-3 days)**
Ingest HUD 4000.1 into vector store. Build query interface. Tune retrieval for guideline precision. Demo on a live call with a real LO asking real questions.

**Phase 2 — Full Agency Expansion (2-3 weeks)**
Add all four remaining agencies. Single query interface across all five. Cross-agency comparison queries ("What's the minimum credit score for FHA vs. Conventional?"). Rapid Mortgage as the first paying customer.

**Phase 3 — Voice Integration**
Voice-in, voice-out query support. The LO asks a question out loud mid-call with a borrower. The AI answers in five seconds through an earpiece. Hands-free underwriting reference during live borrower conversations. The voice infrastructure already exists — this is an integration, not a rebuild.

**Phase 4 — Market Expansion**
Direct outbound to regional lenders in the 5-50 LO range. The pitch is simple: your LOs are spending 20 minutes per guideline question. This costs $500/month and cuts that to five seconds. The ROI conversation closes itself.

---

## Revenue Model

SaaS subscription, billed monthly per lender.

| Tier | LO Count | Monthly Price |
|---|---|---|
| Starter | Up to 10 LOs | $500/month |
| Growth | 11-50 LOs | $1,000/month |
| Team | 51+ LOs | $2,000/month |

There are approximately 5,000 independent mortgage companies and regional lenders in the US with 5-100 loan officers. At 1% market penetration and $750 average monthly contract, that is $37.5M in ARR.

The bottleneck is not the product — it is distribution. Rapid Mortgage as an anchor customer is a reference account, a testimonial, and a proof point for every regional lender in Ohio and beyond.

---

## Why Rapid Mortgage

Rapid Mortgage is the ideal anchor customer for three reasons.

First, the access is direct — Jasson Fishback is co-owner. There is no sales cycle. The POC can be deployed and tested with real loan officers in real conditions without a procurement process.

Second, Rapid operates in 13 states. A tool that proves value at Rapid has a clear expansion path to every other lender in those states who competes with or knows Rapid.

Third, Rapid's LOs are the exact user profile the product is designed for — experienced, high-volume, time-constrained loan officers who know the guidelines exist but do not have time to search them manually every day.

---

## Next Steps

1. Build FHA POC — ingest HUD 4000.1, stand up query interface, tune retrieval (2-3 days)
2. Demo to a Rapid LO on a live call — capture real feedback from a real user
3. Define Phase 2 scope — agency expansion sequence, interface requirements, LO access model
4. Price and contract structure — anchor customer agreement with Rapid Mortgage
5. Outbound strategy — target list of Ohio regional lenders for Phase 4 expansion

The FHA POC can be running by end of week. The only thing separating this from a paying product is the demo.
