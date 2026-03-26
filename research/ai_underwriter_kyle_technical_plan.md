# AI Underwriter — Technical Architecture Plan
## Presentation Draft for Kyle Shea, CIO, Rapid Mortgage
### Version 1.0 | March 26, 2026

---

## EXECUTIVE SUMMARY

This document proposes a privately-hosted AI underwriting assistant for Rapid Mortgage. The system provides loan officers with an intelligent reference tool that interprets agency mortgage guidelines, calculates income qualification across all income types, and validates borrower scenarios against agency-specific rules — all without any borrower data leaving Rapid's infrastructure.

This is not a replacement for underwriters. It is a force multiplier: faster income calculations, instant guideline lookups, and consistent answers across the team.

Estimated Phase 1 build time: 2-3 weeks. Total cost to operate: under $500/month at full team utilization.

---

## PART 1: ARCHITECTURE OVERVIEW

### System Components

```
[Loan Officer Browser UI]
         |
         v
[Web Application — Next.js or React]
         |
         v
[API Layer — Node.js or .NET (Kyle's native stack)]
    |              |
    v              v
[Income Calc   [RAG Query
 Engine]        Engine]
    |              |
    v              v
[Business Rules [Vector Store]
 Database]       (pgvector on Postgres)
                   |
                   v
              [Claude API]
              (Anthropic — query only,
               no borrower data sent)
```

### How It Works

1. Loan officer types a question or inputs a scenario (e.g., "Borrower has Schedule C income. 2023: $72K net. 2024: $68K net. What qualifies for FHA?")
2. The query engine searches the vector store for relevant guideline chunks
3. Retrieved chunks + the question are packaged and sent to Claude API
4. Claude generates an answer with citations to the exact guideline section
5. Income calculation engine handles structured math (gross-up, 2-year average, etc.) deterministically — no AI involved in the arithmetic

**Critical security constraint:** Claude API only ever receives the guideline text + the loan officer's typed question. Borrower PII (name, SSN, DOB, credit score, property address) is never transmitted.

---

## PART 2: DATA SOURCES — THE FIVE AGENCY GUIDELINE PDFS

All five documents are publicly available and require no licensing fees:

| Agency | Document | Pages | Source |
|--------|----------|-------|--------|
| FHA | HUD Handbook 4000.1 | ~900 | hud.gov — public domain |
| Fannie Mae | Selling Guide | ~1,200-1,500 | selling-guide.fanniemae.com — public |
| Freddie Mac | Seller/Servicer Guide | ~1,000-1,500 | guide.freddiemac.com — public |
| VA | Pamphlet 26-7 | ~500 | benefits.va.gov — public domain |
| USDA | HB-1-3555 | ~400 | rd.usda.gov — public domain |

**Total corpus:** approximately 4,500-5,500 pages of guidelines.

### Ingestion Pipeline

```
PDF Files
    |
    v
[PDF Parser — pdfplumber or PyMuPDF]
    |
    v
[Text Chunker]
  - Chunk size: 500-800 tokens
  - Overlap: 100 tokens (prevents splitting mid-rule)
  - Metadata attached per chunk: agency, section number, page, last updated date
    |
    v
[Embedding Model — text-embedding-3-small (OpenAI) or Voyage-3 (Anthropic)]
    |
    v
[pgvector — Postgres extension]
  - Stored in Rapid's own Postgres instance
  - No data leaves the building after ingestion
    |
    v
[Ready for semantic search]
```

**Why pgvector over Pinecone/Weaviate:** Kyle already uses SQL Server — Postgres + pgvector is familiar relational territory, can be self-hosted, joins to other data with standard SQL, and eliminates an external vendor dependency. Pinecone is SaaS-only; pgvector runs on-prem or on a VPS that Rapid controls.

### Update Protocol
Guidelines update periodically (FHA publishes mortgagee letters, FNMA publishes selling guide updates). The ingestion pipeline should run on a scheduled basis — monthly at minimum. New document versions replace old chunks by section. Metadata timestamps let the system flag when a chunk is from an older version.

---

## PART 3: INCOME CALCULATION ENGINE

This component is deterministic — same inputs always produce same outputs. No AI involved. This directly addresses the regulatory concern that "LLMs can't be deterministic."

### Architecture

The income engine is a structured rules library. All 14 income types are implemented as callable functions. Each function takes structured inputs and returns a qualified monthly income figure, a calculation trace, and a flag for any anomalies.

```
Input (structured, from UI form):
  - income_type: "schedule_c"
  - year1_net_profit: 72000
  - year1_depreciation: 4200
  - year2_net_profit: 68000
  - year2_depreciation: 3800
  - agency: "FHA"

Output:
  - qualifying_monthly_income: 5891.67
  - calculation_trace: [
      "Year 1: $72,000 + $4,200 depreciation = $76,200",
      "Year 2: $68,000 + $3,800 depreciation = $71,800",
      "2-year average: ($76,200 + $71,800) / 2 = $74,000",
      "Income declining: using lower year = $71,800",
      "Monthly: $71,800 / 12 = $5,983.33",
      "FHA rule: use lesser of 2-year average or lower year",
      "RESULT: $5,891.67/mo"
    ]
  - flags: ["Income declined YOY — underwriter review recommended"]
  - guideline_ref: "HUD 4000.1, Section III.A.3.c.iii"
```

### Income Types Implemented (Phase 1 — FHA Focus)

1. W-2 salary (annualized, YTD validation)
2. Hourly + overtime (2-year OT average, directional flag)
3. Schedule C (net profit + depreciation add-back)
4. Schedule 1065/K-1 (guaranteed payments + add-backs)
5. Schedule 1120S/K-1 (W-2 wages + business income + add-backs)
6. Rental — Schedule E (add-back methodology)
7. Rental — Lease/1007 (75% vacancy factor)
8. Social Security / pension (gross-up by agency)
9. VA disability (gross-up for DTI, no gross-up for residual)
10. Commission (2-year average, threshold trigger at 25%)
11. Bonus (2-year average, continuation flag)
12. Child support / alimony (6/36 rule validation, documentation check)
13. Interest / dividend (2-year Schedule B average)
14. Boarder income (FHA only — 9/12 months rule, 30% cap)

### Phase 2 Additions
- Notes receivable
- Trust income
- Part-time / seasonal
- Asset dissipation / depletion method
- Freddie Mac variant rules

### Qualification Stacking
The engine handles multiple income types per borrower. Combined qualifying income is summed, and the engine checks DTI against agency-specific thresholds:

```
Total qualifying income = SUM of all income sources
Front-end DTI = (Housing payment) / Total qualifying income
Back-end DTI = (Housing payment + all debts) / Total qualifying income

Compared against:
- FHA: 31% / 43% standard; up to 57% back-end with AUS approval
- Conventional: 28% / 45% standard; up to 50% with DU
- VA: 41% back-end + separate residual income test
- USDA: 29% / 41% hard
```

---

## PART 4: BORROWER QUALIFICATION LOGIC

### Agency Parameters — Phase 1 Rule Set

```
FHA:
  - Min FICO: 580 (3.5% down) / 500 (10% down)
  - Max DTI: 43% standard / 57% AUS
  - Max LTV: 96.5% (purchase) / 97.75% (rate-term refi)
  - MIP: 0.55% annual (life of loan if LTV > 90%)

Conventional:
  - Min FICO: 620
  - Max DTI: 45% / 50% DU
  - Max LTV: 95% (standard) / 97% (HomeReady/HomePossible)
  - PMI: required if LTV > 80% (cancelable at 80%)

VA:
  - No FICO minimum (lender overlays typically 580-620)
  - No DTI hard cap — residual income test governs
  - Max LTV: 100% (no down payment required)
  - VA funding fee: varies by usage and down payment

USDA:
  - Min FICO: 640
  - Max DTI: 41% / 44% with strong compensating factors
  - Max LTV: 100% (no down payment required)
  - Geographic: rural/suburban areas only (USDA eligibility map)
  - Income ceiling: household income limits apply
```

### Scenario Output Format

The system will output a structured scenario analysis:

```
Borrower Scenario Summary
--------------------------
Income: $5,891/mo qualifying (Schedule C, FHA method)
Property: $285,000 purchase price
Loan amount: $274,727 (3.5% down)
Estimated PITIA: $1,945/mo
Monthly debts: $450 (auto + student)

FHA ANALYSIS:
  Front-end DTI: 33.0% [PASS — under 31% standard, but AUS likely approves to 35%]
  Back-end DTI: 40.6% [PASS — under 43%]
  Min FICO required: 580 [FLAG — confirm credit score]
  MIP: $126/mo upfront amortized; $125/mo annual

CONVENTIONAL ANALYSIS:
  Front-end DTI: 33.0% [borderline]
  Back-end DTI: 40.6% [PASS]
  Min FICO required: 620 [FLAG — confirm credit score]
  PMI required: yes (LTV 96.4%)

RECOMMENDATION: FHA program is likely best fit pending credit confirmation.
```

---

## PART 5: INTEGRATION PATH — ENCOMPASS AND NCINO

### Phase 1 (Standalone — No LOS Integration)
The tool operates as a standalone web application. Loan officers enter data manually into the income calculator and query interface. This is intentional:
- Fastest to build and demo
- No IT dependency on Encompass during evaluation
- Allows us to validate accuracy and UX before committing to integration

### Phase 2 — Encompass Integration

ICE Mortgage Technology's Developer Connect platform provides REST API access to Encompass loan data. As of 2025, the legacy SDK has been sunset; all integration is via modern REST APIs.

**Authentication:** OAuth 2.0 (standard token-based)

**What the integration enables:**
- Pull borrower data directly from an Encompass loan file (income fields, employment data, liabilities)
- Pre-populate the income calculator from Encompass field data
- Write calculation results back to designated Encompass fields
- Trigger calculation as a workflow step when income section is completed

**Key Encompass fields for income:**
- Borrower Income fields (base, overtime, bonus, commission, other)
- Self-employment income fields (Schedule C/K-1 data)
- Rental income fields
- 4506-C ordering and retrieval via API

**Integration architecture (Phase 2):**
```
Encompass Loan File
    |
    v
[Encompass REST API — OAuth token]
    |
    v
[AI Underwriter API Layer]
  - Maps Encompass field IDs to calculator inputs
  - Runs income calculation engine
  - Queries RAG for relevant guideline rules
  - Returns structured output
    |
    v
[Results written back to Encompass custom fields]
[Display panel in Encompass UI via plugin/iframe]
```

**Developer note:** Encompass supports external site URLs and an iframe embed pattern via Encompass Partner Connect (EPC). A custom panel can surface our tool's output directly inside the loan officer's Encompass workflow without requiring a context switch to a separate browser tab.

### Phase 2 — nCino Integration

nCino launched Integration Gateway in September 2025 (formerly Glyue by Sandbox Banking) — a dedicated iPaaS with 14+ core banking platform connectors. nCino also maintains a Developer Portal with REST API documentation.

For Rapid's purposes, nCino integration follows the same pattern as Encompass: OAuth-authenticated REST calls to pull and push loan file data. nCino is Salesforce-native — Kyle already has Salesforce in the stack (Salesforce + Black Knight integration was his signature project). This is an advantage; the nCino API layer and the existing Salesforce infrastructure can likely share auth patterns and data pipelines.

**Phase 2 integration is estimated at 3-4 weeks of development**, primarily the field mapping exercise from LOS data structures to the AI Underwriter's standardized input schema.

---

## PART 6: TESTING INTERFACE

### What We Build for the Demo

A clean, browser-based query interface. No login required for internal testing phase. Features:

**1. Natural Language Query Panel**
- LO types: "What are the FHA rules for self-employment income with a 2-year business history?"
- System returns: guideline answer with exact section citations and page references

**2. Structured Income Calculator**
- Dropdown: select income type
- Form fields: enter raw numbers from tax returns / pay stubs / award letters
- Calculate button: returns qualified monthly income + full calculation trace + applicable guidelines
- Agency toggle: shows how result changes from FHA to Conventional to VA

**3. Scenario Builder**
- Enter multiple income sources per borrower
- Enter proposed loan details (price, down, estimated debts)
- Output: full DTI analysis by agency with pass/fail/flag for each

**4. Citation Viewer**
- Every AI answer includes the exact guideline section and chunk source
- LO can click to view the original guideline text passage
- This is the key trust-builder: LOs know exactly where the answer came from

### Accuracy Validation Protocol

Before showing Kyle, we run a validation sprint against known scenarios:
- 25 income calculation test cases with pre-verified correct answers
- Run all 25 through the engine; track pass rate
- Target: 100% accuracy on calculation engine (deterministic), 90%+ relevance on RAG queries
- Edge cases flagged and documented; none hidden

---

## PART 7: SECURITY MODEL

### Core Principle
Borrower PII never leaves Rapid's infrastructure. The Claude API receives only:
- Agency guideline text (public domain content)
- The loan officer's question (a text string — no names, no SSN, no addresses)

### What This Means in Practice
- The income calculator receives numbers, not borrower identity
- Queries are phrased as scenarios: "Borrower has $72K net Schedule C income Year 1..." — not "John Smith SSN 123-45-6789..."
- The RAG vector store lives on Rapid's Postgres instance — on-prem or on a VPS Rapid controls

### Data Classification

| Data Type | Where It Lives | External? |
|-----------|---------------|-----------|
| Agency guideline PDFs (public) | Rapid vector store | Ingested from public sources; no ongoing external call |
| Vector embeddings | pgvector on Rapid Postgres | Never leaves Rapid |
| LO queries (text only) | Sent to Claude API | Yes — but no PII; scenario language only |
| Borrower income numbers | Calculation engine only | Never sent externally |
| Encompass loan data | Pulled via API, processed locally | API call to ICE; results stored locally |
| Calculation results | Written to Encompass or displayed in UI | Stays within Rapid ecosystem |

### API Key Management
- Anthropic API key stored in server environment variable — never in code, never in git
- Principle of least privilege: API key scoped to inference only
- Rate limiting on the application layer: prevent runaway API calls
- Logging: all queries logged locally (not the Claude response — just the query for audit trail)

### Regulatory Alignment
- No GLBA exposure: guideline queries are not processing NPI
- CFPB fair lending: the tool provides consistent answers based on written guidelines — reduces LO inconsistency, which is a fair lending positive
- Explainability: every answer cites source — satisfies audit requirements

---

## PART 8: TIMELINE

### Phase 1 — FHA-Only POC (Weeks 1-2)

| Week | Work |
|------|------|
| Week 1, Days 1-2 | Environment setup. Postgres + pgvector install. Ingestion pipeline for FHA 4000.1 PDF. |
| Week 1, Days 3-5 | Chunking strategy tuned. All ~900 pages embedded and indexed. Query tests against known FHA questions. |
| Week 2, Days 1-3 | Income calculation engine — FHA rules for top 8 income types. Unit tests for each function. |
| Week 2, Days 4-5 | Web UI — query panel + income calculator. Scenario builder basic version. |
| End of Week 2 | Internal demo-ready. FHA-only. Accuracy validation sprint. |

### Phase 2 — All 5 Agencies (Weeks 3-4)

| Week | Work |
|------|------|
| Week 3 | Ingest FNMA, Freddie, VA, USDA. Extend income calculator with conventional/VA/USDA rule variants. |
| Week 4 | Multi-agency scenario builder. Comparison output (best program for scenario). UI polish. |
| End of Week 4 | Full agency coverage. Demo for broader Rapid team. |

### Phase 3 — Encompass Integration (Weeks 5-8)

| Week | Work |
|------|------|
| Week 5 | Encompass Developer Connect API setup. OAuth authentication. Sandbox loan file access. |
| Week 6 | Field mapping: Encompass income fields to calculator input schema. |
| Week 7 | Read from Encompass, run calculation, display results. Write results to Encompass custom fields. |
| Week 8 | Encompass UI panel (iframe/EPC). Testing with real loan files. Pilot with 2-3 LOs. |

### Phase 4 — Production Rollout (Weeks 9-10)

| Week | Work |
|------|------|
| Week 9 | LO training. Documentation. Error handling and edge case hardening. |
| Week 10 | Full team rollout. Monitoring dashboard. Feedback loop established. |

---

## PART 9: COST

### One-Time Build Cost
Assumes internal development (no outside agency):
- Developer time: 6-8 weeks of one developer. At Rapid's internal cost structure this is the primary expense.
- Infrastructure setup: minimal (covered below)

### Ongoing Monthly Operating Cost

| Item | Cost/Month |
|------|-----------|
| Claude API (Anthropic) | ~$50-150 (at 50-150 LO queries/day; Sonnet-class model) |
| Postgres + pgvector hosting | $20-40 (self-hosted VPS or existing DB server) |
| Application server | $20-30 (lightweight VPS, or existing infrastructure) |
| Encompass API access | Included in existing Encompass contract (Developer Connect) |
| **Total** | **~$90-220/month** |

### Claude API Cost Detail
- Model: claude-sonnet (recommended — faster, lower cost than Opus for standard guideline queries)
- Opus reserved for complex multi-agency edge cases (optional escalation path)
- At 100 queries/day average, 700-1,000 tokens input + 400-600 tokens output per query:
  - ~130,000 input tokens/day, ~65,000 output tokens/day
  - Monthly: ~4M input + 2M output tokens
  - Sonnet pricing (2025): approximately $3/1M input, $15/1M output
  - Estimated: $12 input + $30 output = ~$42/month at current pricing
  - Budget for spikes and longer context queries: $100-150/month ceiling

### Comparison to Enterprise Alternatives
- Tavant AI underwriting platform: $50,000-$250,000+ implementation + ongoing SaaS fees
- ICE Mortgage Technology AI tools: bundled into enterprise Encompass contracts, significant annual cost
- **This system: under $5,000 total build + under $200/month to operate**

---

## PART 10: WHAT THIS IS NOT

Kyle will ask the right skeptical questions. Anticipate them.

**"Is this replacing underwriters?"**
No. This does not make credit decisions. It does not approve loans. It is a reference and calculation tool. The underwriter retains full authority and judgment. This tool reduces the time underwriters and LOs spend looking up rules and doing manual income math.

**"What happens when guidelines update?"**
The ingestion pipeline re-runs on the updated PDF. New chunks replace old by section. Turnaround on a guideline update is hours, not weeks. The system can flag that a specific section was updated and when.

**"Is the AI making up answers?"**
The RAG architecture constrains Claude to only answer from retrieved guideline text. It cannot hallucinate rules that aren't in the documents — because its answers are grounded in the retrieved chunks. Every answer surfaces its source. If the chunk doesn't have an answer, the system says so rather than fabricating one.

**"How does this handle edge cases the guidelines don't cover?"**
The system returns: "No specific guideline found for this scenario. Underwriter discretion required." It does not guess. This is a feature, not a limitation.

**"What about the income calculator — what if it's wrong?"**
The income engine is deterministic code, not AI. It has unit tests. Every calculation outputs a full trace. An LO or underwriter can verify the math step-by-step. If a rule changes, one function changes in code, all tests re-run, verified before deploy.

---

## APPENDIX: TECHNICAL STACK SUMMARY

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Frontend | React / Next.js | Standard, Kyle's team likely knows it |
| Backend API | Node.js or .NET | .NET preferred if Kyle wants team ownership — his native stack |
| Database | PostgreSQL + pgvector | Self-hosted, relational, no external vendor |
| PDF parsing | pdfplumber (Python) or iTextSharp (.NET) | Handles complex PDF layouts |
| Embeddings | Anthropic voyage-3 or OpenAI text-embedding-3-small | High quality, low cost |
| LLM inference | Claude API (Anthropic) — Sonnet tier | Best RAG performance; long context; strong instruction following |
| LOS integration | REST API (Encompass Developer Connect, OAuth 2.0) | Modern API, SDK sunset complete |
| Deployment | On-prem server or VPS (Rapid controls) | No borrower data in external cloud |
| Version control | Git (existing) | Standard |
| Monitoring | Simple logging + dashboard | Lightweight, custom-built |

---

## NEXT STEPS

1. Demo the FHA POC (2 weeks to build)
2. Validate accuracy with Rapid underwriting team on 25 known scenarios
3. Kyle reviews architecture and proposes any modifications to the stack
4. Agree on Phase 2-4 timeline and resource allocation
5. Decision: build in-house, or bring in a part-time developer to accelerate

---

*Prepared by: UNO Research Team | BengalOracle*
*For: Jasson Fishback / Rapid Mortgage CIO Presentation*
*Date: March 26, 2026*
