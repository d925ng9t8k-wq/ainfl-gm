# AI Underwriter — POC Brief
**For:** Kyle Shea, CIO, Rapid Mortgage
**From:** Jasson Fishback
**Date:** March 2026

---

## What It Is

A RAG-based guideline chatbot that lets loan officers query mortgage agency guidelines in natural language and get back accurate answers with exact source citations — no searching through 900-page PDFs.

POC scope: FHA only (HUD Handbook 4000.1). The intent is to prove the architecture works before expanding to all five agencies.

**Stack:**
- Claude API (200K context window) as the reasoning layer
- PDF ingested, chunked, and embedded via vector search
- Web or Telegram interface for LO access
- No fine-tuning needed at POC stage — pure RAG

---

## Example Q&A

**Loan Officer asks:**
> "What's the minimum credit score for FHA with 3.5% down?"

**AI Underwriter responds:**
> Borrowers with a credit score of 580 or above are eligible for maximum financing (3.5% down payment). Borrowers with scores between 500 and 579 are limited to 90% LTV (10% down). Borrowers below 500 are not eligible for FHA-insured financing.
>
> Source: HUD Handbook 4000.1, Section II.A.1.b — Creditworthiness

No PDF searching. No internal back-and-forth. The LO gets the answer in under 5 seconds with the guideline section attached.

---

## The Competitive Gap

Enterprise underwriting tools (Tavant, ICE Encompass AI, LoanLogics) solve this problem at the enterprise level — $200K+ implementations, dedicated IT resources, 6-month deployment cycles. They are built for the top 50 lenders.

Mid-size lenders like Rapid get nothing. LOs are still Ctrl+F-ing through 900-page PDFs. That is a daily time drain, a compliance risk, and a training burden that never goes away.

No lightweight, fast, accurate guideline assistant exists for a lender of Rapid's size. That is the gap.

---

## Architecture Decision

**Why not fine-tuning?**
Guidelines change frequently — HUD and Fannie push updates quarterly. A fine-tuned model requires retraining on every update. RAG with a versioned PDF corpus just requires a re-ingest. Operationally, that is the only viable approach for a small team.

**Why FHA first?**
Most commonly used product, most consistently structured document, highest ROI on the first demo. Proof of concept can be running in 2-3 days.

---

## Next Steps

**Phase 1 — FHA POC (2-3 days)**
- Ingest HUD 4000.1 into vector store
- Build query interface (web or Telegram)
- Tune retrieval for guideline precision
- Demo on a live call

**Phase 2 — Agency Expansion (2-3 weeks)**
- Add Fannie Mae Selling Guide (~1,200 pages)
- Add Freddie Mac Seller/Servicer Guide (~1,000 pages)
- Add VA Pamphlet 26-7 (~500 pages)
- Add USDA HB-1-3555 (~400 pages)
- All five agencies covered, single query interface

**Phase 3 — Voice Integration**
- Voice-in, voice-out query support (infrastructure already exists)
- LO asks question out loud mid-call, gets answer in 5 seconds
- Hands-free underwriting reference during borrower conversations

---

## Why This Matters for Rapid

- Reduces LO research time from minutes to seconds per question
- Reduces underwriting errors from misread or outdated guidelines
- Faster loan decisions = better borrower experience
- Scales without adding underwriting headcount

The FHA POC can be running by end of week. Worth a 30-minute demo.
