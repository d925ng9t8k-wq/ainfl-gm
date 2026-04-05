# AI Underwriter — Product Brief

**Status:** Local Pilot | **Category:** FinTech / Mortgage Technology

---

## What It Is

AI Underwriter is an instant mortgage loan analysis tool that applies FHA, VA, USDA, and Conventional agency guidelines in real time. Loan officers upload borrower documents (pay stubs, bank statements, tax returns), and the AI returns a guideline analysis in seconds.

The current version handles:
- FHA guidelines with full DTI and LTV analysis
- Income calculation from multiple income types
- Red flag identification before file submission
- Plain-English explanation of findings

## Target User

Mortgage loan officers and processors at independent mortgage banks (IMBs). The initial target is Rapid Mortgage Company, a 15+ LO Ohio IMB co-owned by the founder.

## The Pain Point

Agency guidelines change constantly. A loan officer must simultaneously know FHA, VA, USDA, Conventional, and sometimes state-specific rules — while running a pipeline of 20+ files. A single guideline miss costs a deal or creates a compliance issue. The knowledge gap is constant, expensive, and entirely solvable with AI.

## Technology

- Node.js API server (localhost:3471, local only as of Apr 5)
- 5 agency PDF guideline documents loaded via RAG (retrieval-augmented generation)
- Claude Sonnet for analysis, Haiku for routing
- Demo UI at ainflgm.com/underwriter-demo.html

## Business Model

- B2B SaaS license to mortgage lenders: $500–2,000/month per office
- Enterprise deal with Rapid Mortgage: in discussion
- Expansion path: FHA → VA → USDA → Conventional → Non-QM

## Why 9enterprises Has an Edge

The founder co-owns a mortgage company. The initial customer is captive. Real loan officers with real files test every iteration. The feedback loop that other mortgage AI startups spend millions to build, 9enterprises has for free.

## Current Status

- RAG system: functional
- FHA MVP: complete
- VA/USDA/Conventional: in development
- Multi-document upload: in development
- Production deployment: not yet (local only)

## Contact

captain@9enterprises.ai | Partnership inquiries for lenders welcome
