# AI Underwriter — Full Technical Plan
**For:** Kyle Shea, CIO, Rapid Mortgage Company
**From:** Jasson Fishback
**Date:** March 2026
**Classification:** Non-confidential — no Rapid Mortgage borrower data

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture](#2-architecture)
3. [Data Sources](#3-data-sources)
4. [Income Calculation Engine](#4-income-calculation-engine)
5. [Borrower Qualification Logic](#5-borrower-qualification-logic)
6. [Integration Path](#6-integration-path)
7. [Testing Interface](#7-testing-interface)
8. [Security Model](#8-security-model)
9. [Timeline](#9-timeline)
10. [Cost Estimate](#10-cost-estimate)
11. [Competitive Analysis](#11-competitive-analysis)
12. [ROI Case](#12-roi-case)

---

## 1. Executive Summary

This document proposes a privately-hosted AI underwriting assistant for Rapid Mortgage — a RAG-based system that lets loan officers query agency guidelines in natural language, calculate qualifying income across all income types, and validate borrower scenarios against FHA, Fannie Mae, Freddie Mac, VA, and USDA rules, all without any borrower data leaving Rapid's infrastructure. The system is not a replacement for underwriters; it is a force multiplier that turns multi-minute guideline searches into 5-second answered questions with exact source citations, reduces manual income calculation errors, and gives every LO on the team consistent, auditable answers from the same authoritative source. Phase 1 — a fully functional FHA POC with web interface and income calculation engine — can be running in 2 weeks. Full five-agency coverage with Encompass integration follows in 8 weeks total. Operating cost at full team utilization is under $220/month.

---

## 2. Architecture

### System Diagram

```
[Loan Officer]
     |
     | (browser — internal network)
     v
[Web Application — React / Next.js]
     |
     v
[API Layer — Node.js  OR  .NET (Kyle's native stack)]
     |                      |
     v                      v
[Income Calculation    [RAG Query Engine]
 Engine]                    |
     |                      v
[Business Rules DB]   [Vector Store]
                       pgvector on Postgres
                            |
                            v
                      [Claude API]
                       Anthropic — Sonnet tier
                       receives: guideline chunks + LO query text
                       never receives: borrower name, SSN, DOB,
                                       credit score, property address
```

### RAG Pipeline: How It Works

The Retrieval-Augmented Generation (RAG) pattern keeps the LLM grounded in actual guideline text rather than its training data. The pipeline has two phases: ingestion (one-time + periodic updates) and query (real-time, per request).

**Ingestion:**

```
Step 1 — PDF parsing
  Tool: pdfplumber (Python) or iTextSharp (.NET)
  Handles: complex layouts, tables, footnotes, page headers
  Output: raw text per page, structured by section

Step 2 — Chunking
  Chunk size: 500-800 tokens
  Overlap: 100 tokens (prevents rules from being split across chunk boundaries)
  Metadata tagged per chunk:
    - agency: "FHA" / "FNMA" / "Freddie" / "VA" / "USDA"
    - section: "II.A.1.b" (section number from document)
    - page: 142
    - document_version: "4000.1 updated Jan 2026"
    - ingested_date: "2026-03-26"

Step 3 — Embedding
  Model: voyage-3 (Anthropic) or text-embedding-3-small (OpenAI)
  voyage-3 recommended: designed for retrieval tasks, 1,024-dimension output,
  strong performance on technical/regulatory text
  Cost: ~$0.06 per 1M tokens (ingestion is a one-time cost per PDF version)

Step 4 — Storage
  pgvector extension on PostgreSQL
  Stored on Rapid's own Postgres instance — on-prem or VPS Rapid controls
  Standard SQL interface: can join to other Rapid data with normal queries
  No external vendor dependency after ingestion
```

**Query (real-time):**

```
Step 1 — Receive LO query text
  Example: "What qualifies for FHA with Schedule C income declining year over year?"

Step 2 — Embed the query
  Same embedding model used at ingestion time
  Query becomes a vector (list of floats)

Step 3 — Semantic search
  pgvector cosine similarity search against stored chunks
  Top 5-10 most relevant chunks retrieved
  SQL: SELECT chunk_text, section, page, agency
       FROM guideline_chunks
       ORDER BY embedding <=> query_embedding
       LIMIT 8;

Step 4 — Construct Claude prompt
  System prompt: "You are a mortgage guideline expert. Answer only from the
  provided guideline text. Always cite the section and page number. If the
  text does not contain the answer, say so."
  User message: [retrieved chunks] + [LO's question]
  No borrower PII in this payload — ever.

Step 5 — Claude generates response
  Model: claude-sonnet (200K context window — can hold entire retrieved corpus
  for complex multi-section queries)
  Output: plain-language answer + guideline citations

Step 6 — Return to LO
  Answer displayed with citation viewer
  LO can click any citation to see the original guideline text chunk
```

### Why Not Fine-Tuning

Guidelines update quarterly. A fine-tuned model requires retraining on every update — a multi-week, multi-thousand-dollar process each time. RAG re-ingestion of a new PDF takes hours. For a living document corpus like agency guidelines, RAG is the only operationally viable architecture.

### Vector Store Options

| Option | Hosting | Cost | SQL Joins | Recommended Use |
|--------|---------|------|-----------|-----------------|
| pgvector | Self-hosted (Postgres) | Free (your infrastructure) | Yes | POC and production |
| ChromaDB | Local / self-hosted | Free | No | Quick prototyping only |
| Pinecone | SaaS (external) | $70/month | No | Only if self-hosting Postgres is ruled out |

**Recommendation:** pgvector. Kyle's team already knows Postgres. Self-hosted means no external vendor dependency, no data leaving Rapid's environment after ingestion, and standard SQL for any reporting or audit queries against the vector store.

### Embedding Model Options

| Model | Provider | Dimensions | Cost per 1M tokens | Recommended Use |
|-------|----------|------------|-------------------|-----------------|
| voyage-3 | Anthropic | 1,024 | ~$0.06 | Production (best retrieval quality) |
| text-embedding-3-small | OpenAI | 1,536 | ~$0.02 | Budget alternative |
| text-embedding-3-large | OpenAI | 3,072 | ~$0.13 | Max quality, higher cost |

**Recommendation:** voyage-3. Anthropic-native, purpose-built for retrieval, lower latency than OpenAI's large model, better performance on technical regulatory documents in testing.

### LLM: Claude API

- Model tier: claude-sonnet (speed + cost optimized for standard guideline queries)
- Escalation path: claude-opus for complex multi-agency edge cases (optional, triggered manually)
- Context window: 200K tokens — can hold the full retrieved corpus plus calculation context in a single call
- Why Claude over GPT-4o for this use case: stronger instruction following on "cite only what the document says," cleaner citation formatting, better behavior when the document does not contain the answer

---

## 3. Data Sources

All five agency guideline documents are publicly available. No licensing fees. No usage restrictions on this content.

| Agency | Document | Pages | Source URL | Format |
|--------|----------|-------|------------|--------|
| FHA | HUD Handbook 4000.1 | ~900 | hud.gov/hud-partners/single-family-handbook-4000-1 | PDF — public domain |
| Fannie Mae | Selling Guide | ~1,200-1,500 | selling-guide.fanniemae.com | PDF + HTML — public |
| Freddie Mac | Seller/Servicer Guide | ~1,000-1,500 | guide.freddiemac.com | PDF — public |
| VA | Pamphlet 26-7 | ~500 | benefits.va.gov/warms/pam26_7.asp | PDF — public domain |
| USDA | HB-1-3555 | ~400 | rd.usda.gov | PDF — public domain |

**Total corpus:** approximately 4,500-5,500 pages.

### Update Protocol

Guidelines are living documents. FHA publishes Mortgagee Letters that amend 4000.1. Fannie Mae publishes Selling Guide announcements. The ingestion pipeline handles this:

- Scheduled re-ingestion: monthly at minimum, or triggered on announcement of a guideline update
- Chunk replacement: new chunks tagged with updated document version; old chunks marked superseded
- LO transparency: the system surfaces "This section was last updated [date]" on every citation
- Turnaround on a guideline change: hours, not weeks

### Why This Corpus Is Sufficient for RAG

The combined 4,500-page corpus is the complete source of truth for conventional and government-backed lending guidelines. The RAG system does not need to know everything Claude knows about mortgages — it needs to know exactly what these five documents say. Constraining Claude to this corpus is a feature: it prevents the system from answering based on outdated training data or lender overlays that do not apply to Rapid.

---

## 4. Income Calculation Engine

This component is deterministic. Same inputs, same outputs, every time. This is not AI. This is structured business rules implemented as auditable code.

The decision to separate the income calculation engine from the RAG layer is architectural: regulators and compliance teams are rightly skeptical of LLMs making financial calculations. Keeping calculations in deterministic code and reserving Claude for guideline interpretation resolves that concern completely.

### Architecture

```
Input (structured form data from UI or Encompass field mapping):
  {
    income_type: "schedule_c",
    year1_net_profit: 72000,
    year1_depreciation: 4200,
    year2_net_profit: 68000,
    year2_depreciation: 3800,
    agency: "FHA"
  }

Processing:
  - Routes to the appropriate income function (e.g., calc_schedule_c_fha())
  - Applies agency-specific rules
  - Builds a step-by-step calculation trace

Output:
  {
    qualifying_monthly_income: 5983.33,
    calculation_trace: [
      "Year 1: $72,000 net profit + $4,200 depreciation = $76,200",
      "Year 2: $68,000 net profit + $3,800 depreciation = $71,800",
      "Income trend: DECLINING (Year 2 < Year 1)",
      "FHA rule: declining income — use lower of 2-year average or lower year",
      "2-year average: ($76,200 + $71,800) / 2 = $74,000 annual = $6,166.67/mo",
      "Lower year: $71,800 annual = $5,983.33/mo",
      "RESULT: $5,983.33/mo (lower year applied per declining income rule)"
    ],
    flags: [
      "Income declined year-over-year — underwriter review recommended",
      "Verify 2-year self-employment history documentation"
    ],
    guideline_ref: "HUD 4000.1, Section III.A.3.c.iii — Self-Employment Income"
  }
```

Every output is a full audit trail. An underwriter can verify every step of the math. If a rule changes, one function changes in code, all unit tests re-run, verified before deploy.

---

### Income Type Reference: All Types, All Agencies

**1. W-2 Salary**

| Item | Rule |
|------|------|
| Calculation | Annual W-2 Box 1 / 12. If pay stub available: YTD / months worked (validates annualized). Use lower of annualized YTD or prior 2-year average if income is declining. |
| Documentation | 30 days pay stubs, 2 years W-2s, verbal VOE within 10 days of closing |
| FHA | 2-year employment history; gaps over 30 days require explanation |
| Conventional (FNMA) | Same 2-year standard; DU may allow exceptions with compensating factors |
| VA | 2-year history; more lenient on gaps if overall pattern is stable |
| USDA | Same 2-year standard; income counted toward household income ceiling |

**2. Hourly Income (with Overtime)**

| Item | Rule |
|------|------|
| Base hourly calculation | (Hourly rate x hours/week x 52) / 12. If hours vary: YTD hours / months worked. |
| Overtime calculation | 2-year calendar year total OT / 24. If declining: use lower of 2-year average or current YTD annualized. |
| 2025 Update | "Previous two years" = two most recent calendar years (not rolling 24 months). |
| Documentation | Pay stubs (30 days + YTD), 2 years W-2s |
| FHA | OT must have 2-year history; averaged over 2 years; continuation likely |
| Conventional | 2-year history; DU may accept 1-year with strong compensating factors |

**3. Self-Employment Income (Sched C / 1065 / 1120S)**

General rule: use lesser of 2-year average or lower single year if declining.

*Schedule C (Sole Proprietor):*
```
Qualifying income = Net Profit (Line 31)
  + Depreciation (Schedule C Line 13)
  + Depletion (if applicable)
  + Business use of home (add back)
  - Non-recurring income (remove)
  / 24 months
```

*Form 1065 (Partnership / K-1):*
```
Qualifying income = Ordinary Business Income (K-1 Line 1)
  + Net Rental Income
  + Guaranteed Payments (K-1 Line 4)
  + Depreciation / Depletion / Amortization (add back)
  / 24 months
Note: verify income supported by actual distributions taken
```

*Form 1120S (S-Corporation / K-1):*
```
Qualifying income = Ordinary Business Income (Line 21)
  + W-2 wages paid to borrower
  + Depreciation / Depletion / Amortization (add back)
  / 24 months
Note: S-Corps have no Guaranteed Payments — those are on borrower's W-2
```

*Declining income rule:* if Year 2 income < Year 1, use the lower figure. Do not average. Consistent across all agencies.

| Documentation | Tax returns (1040 + business returns) — 2 years, YTD P&L if prior year not yet filed, business bank statements 2-3 months, 25%+ ownership documentation |
|---|---|
| FHA | 2-year SE history minimum; exception if < 2 years SE but 5+ years same industry |
| Conventional | Fannie Mae has specific 4506-C transcript requirements |
| VA | P&L required if filing within 2 months of fiscal year end |
| USDA | Business income counts toward household income ceiling |

*2025 Update:* Amortization and non-recurring casualty losses can now be added back for all entity types (1120, 1120S, 1065) per updated FHA guidance.

**4. Rental Income (Schedule E)**

*Using Schedule E (existing properties with history):*
```
Step 1: Rents received (from tax return)
Step 2: Add back: Depreciation + Interest + HOA + Taxes + Insurance + non-recurring
Step 3: Subtract: full PITIA on the property
Step 4: Divide by 12 for monthly net
Step 5: Positive = add to qualifying income; Negative = add to monthly debts
```

*Using Lease / Form 1007 (no 2-year history):*
```
Monthly qualifying rental = Gross rent x 75%
(25% haircut covers vacancy and maintenance — universal across all agencies)
```

| Agency | Vacancy Factor | Key Rule |
|--------|---------------|----------|
| FHA | 75% | Same as FNMA for existing rentals |
| Conventional | 75% | 1-unit ADU: rental income capped at 30% of total qualifying |
| VA | Offset only | Rental income offsets PITIA but generally cannot count as positive qualifying |
| USDA | Household ceiling | All household member rental income counts toward income limit test |

**5. Social Security / Pension / Disability**

| Item | Rule |
|------|------|
| Calculation | Gross monthly award amount from award letter |
| Gross-up if non-taxable | FHA: 15%; Conventional / VA / USDA: 25% |
| Example | $1,000/mo SS: FHA qualifies $1,150 / Conventional qualifies $1,250 |
| SS nuance | Up to 85% of SS can be taxable. Non-taxable portion qualifies for gross-up. If tax return shows full SS as non-taxable, entire amount grossed up. |
| Continuance | Must continue 3 years from closing. SS retirement: presumed permanent. |
| Documentation | Award letter (within 12 months), bank statements showing receipt |

**6. Child Support / Alimony**

The 6/36 rule: received consistently for at least 6 months; expected to continue at least 36 months. FHA exception: 3 months receipt history if court-ordered.

| Agency | History Required | Continuance | Voluntary Agreement OK? |
|--------|-----------------|-------------|------------------------|
| FHA | 3 months (court order) | 3 years | Yes |
| Conventional | 6 months | 3 years | No — court order required |
| VA | 12 months | 3 years | With documentation |
| USDA | 12 months | 3 years | With documentation |

**7. Commission Income**

| Item | Rule |
|------|------|
| Calculation | 2-year average of total commissions (W-2 minus base salary, or 1099s, or tax returns) |
| FHA threshold | Commission > 25% of total annual income: 2 years personal tax returns required |
| Declining commission | Use lower of 2-year average or current YTD annualized — flag for underwriter |
| Documentation | 2 years W-2s, 2 years tax returns if > 25% threshold, 30 days pay stubs, written VOE |

**8. Bonus Income**

| Item | Rule |
|------|------|
| Calculation | 2-year total bonus / 24 |
| History required | Must have received bonus for at least 2 years |
| Declining bonus | Use lower YTD annualized figure; employer letter on continuation is critical |
| 2025 Calendar Year Rule | Same as variable income — use two most recent calendar years, not rolling 24 months |
| Agency consistency | FHA, Conventional, VA, USDA: same rules |

**9. Part-Time / Seasonal Income**

| Item | Rule |
|------|------|
| Calculation | 2-year total / 24 (gap months in seasonal pattern still divided by 24) |
| History required | 2 years — no exceptions |
| Seasonal nuance | Unemployment during off-season can be included if 2-year pattern is documented in same industry |
| USDA | All household member part-time/seasonal income counts toward household income limit |

**10. Interest / Dividend Income**

| Item | Rule |
|------|------|
| Calculation | 2-year average of Schedule B income / 24 |
| Declining year | Use lower year |
| Continuance test | Must reasonably expect to continue 3+ years. If asset base declining (principal withdrawals), continuance may fail. |
| Documentation | 2 years tax returns with Schedule B, 2 years brokerage statements |

**11. Trust Income**

| Item | Rule |
|------|------|
| Fixed distributions | Document monthly distribution amount; 1 month receipt history (FNMA minimum) |
| Variable distributions | 24-month average |
| Continuance | Lender must verify trust assets sufficient for 3+ years; trust must not terminate within 3 years |
| Documentation | Trust agreement showing distribution amount, payment frequency, duration, asset balance; 12-24 months bank statements; trustee letter |

**12. VA Disability Income**

| Item | Rule |
|------|------|
| Calculation | Non-taxable — apply 25% gross-up for DTI purposes |
| Example | $4,500/mo VA disability = $5,625 qualifying income for DTI |
| Critical distinction | Gross-up APPLIES to DTI calculation. Gross-up does NOT apply to VA residual income calculation — use actual amount. |
| Documentation | VA award letter (within 12 months or showing P&T rating), bank statements |
| Continuance | P&T (Permanent and Total) rating: treated as permanently continuing |

**13. Notes Receivable**

| Item | Rule |
|------|------|
| Calculation | Scheduled monthly payment amount from promissory note |
| History required | 12 months of receipt |
| Continuance | 3 years of remaining payments from closing date. If note matures in under 3 years: income cannot be used. |
| Documentation | Copy of promissory note (original amount, rate, schedule, remaining balance), 12 months bank statements |

**14. Boarder Income (FHA-Specific — ML 2025-04, Effective March 14, 2025)**

```
Step 1: Verify receipt for at least 9 of the most recent 12 months
Step 2: Calculate 12-month average (total receipts / 12)
Step 3: 30% cap — boarder income cannot exceed 30% of total monthly qualifying income
Step 4: Use LESSER of: 12-month average OR current monthly rent per written lease
```

| Item | Rule |
|------|------|
| Agency applicability | FHA only — Conventional has no equivalent |
| Documentation | Signed written agreement, proof of shared address, 12 months payment records |
| Cannot use | Projected income from a new boarder relationship |

### DTI Ratio Calculations

```
Front-end DTI (housing ratio) = Monthly PITIA / Total qualifying monthly income
Back-end DTI (total ratio)    = (Monthly PITIA + all monthly debts) / Total qualifying monthly income

PITIA = Principal + Interest + Taxes + Insurance + HOA (if applicable)
Monthly debts = all installment loans (min payment) + revolving (minimum payment)
               + student loans (see agency rules below) + child support / alimony payments
```

*Student loan rules vary by agency:*
- FHA: use actual payment from credit report; if deferred/income-based, use 1% of outstanding balance
- Conventional: use actual payment from credit report; if $0 IBR, use $0 (DU determines)
- VA: use actual payment; if deferred, $0 allowed if deferred 12+ months past closing
- USDA: use greater of actual payment or 0.5% of outstanding balance

### LTV Limits by Program

| Program | Purchase Max LTV | Rate/Term Refi Max LTV | Cash-Out Max LTV |
|---------|-----------------|----------------------|-----------------|
| FHA | 96.5% (580+ FICO) / 90% (500-579 FICO) | 97.75% | 80% |
| Conventional | 95% standard / 97% HomeReady | 95% | 80% |
| VA | 100% (no down payment required) | 100% | 90% |
| USDA | 100% (no down payment required) | 100% | N/A |

---

## 5. Borrower Qualification Logic

The qualification engine applies borrower-level parameters to agency-specific thresholds and outputs a structured pass/fail/flag result per agency.

### Credit Score Minimums

| Agency | Minimum FICO | Notes |
|--------|-------------|-------|
| FHA | 580 (3.5% down) / 500 (10% down) / below 500 ineligible | Hard minimums from HUD 4000.1 |
| Conventional | 620 | Fannie Mae DU minimum; Freddie Mac similar |
| VA | No agency minimum | Lender overlays typically 580-620; VA itself sets no floor |
| USDA | 640 | Standard for GUS approval; lenders may overlay higher |

### DTI Limits by Program

| Agency | Front-End | Back-End | AUS Override |
|--------|----------|---------|--------------|
| FHA | 31% | 43% | Up to 57% back-end with AUS approval and compensating factors |
| Conventional | 28% | 45% | Up to 50% back-end with DU approval |
| VA | No front-end | 41% | Residual income test governs; DTI is secondary indicator |
| USDA | 29% | 41% | 44% back-end with strong compensating factors |

### VA Residual Income Test

VA requires passing the residual income test in addition to DTI. Residual income = gross monthly income minus all monthly obligations minus estimated maintenance/utilities. Minimums vary by family size and region:

| Family Size | Northeast | Midwest | South | West |
|------------|-----------|---------|-------|------|
| 1 | $390 | $382 | $382 | $425 |
| 2 | $654 | $641 | $641 | $713 |
| 3 | $788 | $772 | $772 | $859 |
| 4 | $888 | $868 | $868 | $967 |
| 5+ | $921 | $902 | $902 | $1,004 |

*Note: Ohio falls in Midwest region.*

### Property Eligibility Rules

| Agency | Property Types | Geographic Restriction |
|--------|--------------|----------------------|
| FHA | 1-4 unit primary residence; condos (FHA-approved list) | None |
| Conventional | 1-4 unit; condos; second homes; investment | None |
| VA | 1-4 unit primary residence; VA-approved condos | None |
| USDA | 1-unit primary residence; rural/suburban per USDA eligibility map | Property must be in USDA-eligible area |

### Reserves Requirements

| Agency | Minimum Reserves | Notes |
|--------|----------------|-------|
| FHA | None required by agency (lender may overlay) | Gift funds allowed for reserves |
| Conventional | 0-6 months PITIA depending on scenario and DU output | Higher for investment properties |
| VA | None required by agency | Lender overlays common at 2 months |
| USDA | None required | Lender overlays may apply |

### Scenario Output Format

```
BORROWER SCENARIO ANALYSIS
--------------------------
Qualifying Income: $5,983/month (Schedule C, FHA method — declining income rule applied)
Property: $285,000 purchase
Loan Amount: $274,727 (3.5% down)
Estimated PITIA: $1,945/month
Monthly Debts: $450 (auto + student loan minimums)

FHA ANALYSIS:
  Front-end DTI: 32.5%  [BORDERLINE — standard 31%; AUS approval likely if FICO qualifies]
  Back-end DTI:  40.0%  [PASS — under 43%]
  Min FICO required: 580  [FLAG — confirm credit score before proceeding]
  MIP: $126/month upfront amortized + $125/month annual (life of loan if LTV > 90%)
  Verdict: LIKELY APPROVABLE pending credit confirmation

CONVENTIONAL ANALYSIS:
  Front-end DTI: 32.5%  [borderline]
  Back-end DTI:  40.0%  [PASS — under 45%]
  Min FICO required: 620  [FLAG — confirm credit score]
  PMI required: yes (LTV 96.4%) — cancelable at 80% LTV
  Verdict: POSSIBLE — depends on credit score

RECOMMENDATION: FHA is likely best program for this scenario pending credit review.
Flagged items for underwriter: declining income documentation, 2-year SE history verification.
```

---

## 6. Integration Path

### Phase 1 — Standalone Web Interface (No LOS Integration)

The tool launches as a standalone internal web application. LOs enter data manually into the income calculator and query interface.

This is intentional, not a limitation. Fastest path to demonstrating value: no IT dependency on Encompass during evaluation, no LOS configuration changes, no vendor coordination. We validate accuracy and UX with real LOs before committing to integration complexity.

**Deployment:** Internal web server on Rapid's network or VPS. Access via browser. No installation on LO workstations.

### Phase 2 — Encompass Integration

ICE Mortgage Technology's Developer Connect platform provides OAuth 2.0-authenticated REST API access to Encompass loan data.

**Important timeline note:** ICE originally announced the Encompass SDK transition for late 2025, but as of March 2026 has delayed the full SDK-to-REST migration to end of 2026. The Developer Connect REST API is fully production-capable today. All new integration work should target the REST API, not the legacy SDK.

**What the integration enables:**
- Pull income, employment, and liability data directly from an Encompass loan file
- Pre-populate the income calculator without manual re-entry
- Write calculation results back to designated Encompass custom fields
- Trigger calculation as a workflow step when the income section is completed by the LO

**Key Encompass fields for income (field ID reference):**

```
BORR.Base Income (1)         — Base income
BORR.Overtime (2)            — Overtime
BORR.Bonus Income (3)        — Bonus
BORR.Commission Income (4)   — Commission
BORR.Other Income (5)        — Other income
SE.ScheduleC.NetProfit       — Schedule C net profit (Year 1 / Year 2)
SE.K1.OrdinaryIncome         — K-1 ordinary income
RE.ScheduleE.RentsReceived   — Rental income
LIAB.[n].Payment             — Monthly debt payments
```

**Integration architecture:**

```
Encompass Loan File
    |
    v [OAuth 2.0 token — scoped read/write]
ICE Developer Connect REST API
    |
    v
AI Underwriter API Layer
  - Maps Encompass field IDs to calculator input schema
  - Runs income calculation engine (deterministic)
  - Queries RAG for applicable guideline rules
  - Returns structured output
    |
    v
Results written to Encompass custom fields
    +
Display panel surfaced in Encompass UI via Encompass Partner Connect (EPC) iframe embed
```

**Encompass Partner Connect (EPC)** supports embedding external URLs as custom panels inside the loan officer's workflow. This eliminates the context switch to a separate browser tab — the AI Underwriter output appears directly inside Encompass.

### Phase 3 — nCino Integration

nCino launched Integration Gateway in September 2025 (iPaaS with 14+ core banking connectors). nCino is Salesforce-native.

Kyle's signature project at Rapid was integrating Salesforce + Black Knight. The nCino integration path leverages that existing Salesforce infrastructure. nCino's REST API follows the same OAuth 2.0 authentication pattern as Encompass — the auth architecture is reusable across both integrations.

**Estimated Phase 3 development:** 3-4 weeks, primarily field mapping from nCino data structures to the AI Underwriter's standardized input schema.

### Borrower Data Boundary (Non-Negotiable)

Borrower PII never crosses the local boundary. The architecture enforces this structurally:

- Income calculator receives numbers, not identities
- LO query text is phrased as scenarios: "Borrower has $72K Schedule C income Year 1" — not borrower names or SSNs
- Vector store lives on Rapid-controlled infrastructure
- Claude API payload: [guideline chunks] + [scenario text] — zero PII

This is not a policy control. It is an architectural constraint built into how data flows through the system.

---

## 7. Testing Interface

### What We Build

A clean, browser-based internal tool. No consumer-facing complexity. Four components:

**1. Natural Language Query Panel**

LO types a question in plain English. System retrieves relevant guideline chunks, passes to Claude, returns answer with citations.

```
LO query:
  "What are the FHA rules for using boarder income?"

System response:
  "Under FHA Mortgagee Letter 2025-04, boarder income may be used
   when the borrower can document receipt for at least 9 of the most
   recent 12 months. The qualifying amount is the 12-month average of
   receipts, capped at 30% of total qualifying income, and limited to
   the lesser of the 12-month average or the current lease amount.
   The borrower and boarder must share the same address."

   Source: HUD 4000.1, Appendix 1.0 — Glossary and References;
           FHA ML 2025-04 (effective March 14, 2025)
   [View source text]
```

**2. Structured Income Calculator**

Dropdown to select income type. Form fields for raw numbers. Output: qualified monthly income + full calculation trace + applicable guideline reference. Agency toggle shows how result changes from FHA to Conventional to VA.

**3. Scenario Builder**

Enter multiple income sources per borrower. Enter proposed loan details (price, down payment, estimated debts, credit score). Output: full DTI analysis by agency with pass/fail/flag for each program. Identifies which agency is the best fit for the scenario.

**4. Citation Viewer**

Every AI response includes exact guideline section and chunk source. LO clicks any citation to see the original guideline text passage. This is the critical trust-builder: LOs know exactly where the answer came from. Underwriters can verify against the source document in one click.

### Accuracy Validation Protocol

Before any demo or team rollout:

- 25+ income calculation test cases with pre-verified correct answers
- 25+ guideline Q&A test cases with verified correct responses
- Run all cases through the system; track pass rate
- Target: 100% accuracy on calculation engine (it is deterministic code — this is achievable)
- Target: 90%+ relevance on RAG guideline queries
- All edge cases documented — none hidden

If any case fails, it is fixed before the demo. We do not paper over accuracy gaps.

### Feedback Loop

LOs flag incorrect answers via a thumbs-down button. Flagged responses are reviewed, categorized, and used to:
- Fix chunking issues (if a rule was split across chunk boundaries)
- Improve prompt engineering (if Claude is misinterpreting retrieved text)
- Update the rule engine (if a calculation function has an error)
- Build a regression test suite (each fixed case becomes a permanent test)

---

## 8. Security Model

### Core Principle

Agency guidelines are public documents. Borrower data is regulated data. These two categories never mix in this system.

### Data Classification

| Data Type | Location | Leaves Rapid Environment? |
|-----------|---------|--------------------------|
| Agency guideline PDFs | Rapid server / VPS | No — ingested from public sources; no ongoing external call |
| Vector embeddings | pgvector on Rapid Postgres | Never |
| LO query text (scenario language, no PII) | Sent to Claude API | Yes — but contains zero borrower PII |
| Borrower income numbers | Income calculation engine only | Never |
| Calculation results | Displayed in UI or written to Encompass | Stays within Rapid ecosystem |
| Encompass loan data (pulled via API) | Processed locally | API call to ICE; results stay local |
| Anthropic API key | Server environment variable | Not in code, not in git |

### What the Claude API Receives

```
PERMITTED:
  - Agency guideline text (retrieved chunks — public domain)
  - LO's typed question or scenario description
    Example: "Borrower has Schedule C income declining year-over-year.
               Year 1: $72K, Year 2: $68K. FHA guidelines."

NEVER SENT:
  - Borrower name, SSN, DOB
  - Property address
  - Credit score
  - Loan number
  - Any field that constitutes NPI under GLBA
```

### Role-Based Access

| Role | Capabilities |
|------|-------------|
| Loan Officer | Query interface, income calculator, scenario builder, view citations |
| Underwriter | All LO capabilities + view full query audit log for loans they touch |
| Manager | All above + aggregate usage reporting, accuracy flag review |
| Admin | System configuration, guideline corpus updates, user management |

### Audit Trail

All queries logged locally:
- Timestamp
- User ID (not borrower ID)
- Query text
- Response (or reference to stored response)
- Citations returned
- Any flags raised

No borrower identity in the audit log. If an underwriter needs to trace the reasoning for a specific loan, they match by loan number in Encompass — the AI Underwriter log records the LO query, not the loan file.

### Regulatory Alignment

**GLBA:** The system does not process NPI. Guideline queries do not trigger GLBA obligations. Income calculation inputs are numbers without associated identity — not NPI in isolation.

**CFPB Fair Lending:** The tool provides consistent answers from the same written guidelines to every LO. This reduces the risk of inconsistent guideline interpretation across LOs — which is a fair lending positive, not a risk.

**Explainability:** Every answer cites its source. Every calculation outputs its trace. The system can satisfy any audit request for the reasoning behind a guideline interpretation.

**EU AI Act (enforcement August 2, 2026):** This system falls in the high-risk category under AI Act Article 10 (AI systems used for creditworthiness assessment). Compliance requirements: human oversight, accuracy documentation, logging, and transparency. This architecture satisfies all four: human underwriter retains final authority, accuracy validation protocol is built-in, audit trail is logged locally, and every response is traceable to a source document.

---

## 9. Timeline

### Phase 1 — FHA-Only POC (Weeks 1-2)

| Days | Work |
|------|------|
| 1-2 | Environment setup. Postgres + pgvector install. Ingestion pipeline for HUD 4000.1 (~900 pages). |
| 3-5 | Chunking strategy tuned. All pages embedded and indexed. Query tests against 25 known FHA questions. |
| 6-8 | Income calculation engine — FHA rules for all 14 income types. Unit tests for each function. |
| 9-10 | Web UI — query panel + income calculator + scenario builder (basic). |
| End of Week 2 | Demo-ready. FHA-only. Accuracy validation sprint complete. |

### Phase 2 — All 5 Agencies (Weeks 3-4)

| Days | Work |
|------|------|
| 11-13 | Ingest Fannie Mae Selling Guide, Freddie Mac Guide, VA Pamphlet 26-7, USDA HB-1-3555. |
| 14-16 | Extend income calculator with Conventional / VA / USDA rule variants for all 14 types. |
| 17-18 | Multi-agency scenario builder. Comparison output: "best program for this scenario." |
| 19-20 | UI polish. Cross-agency accuracy validation (25 test cases per agency). |
| End of Week 4 | Full five-agency coverage. Demo for broader Rapid team. |

### Phase 3 — Encompass Integration (Weeks 5-8)

| Week | Work |
|------|------|
| Week 5 | Encompass Developer Connect API setup. OAuth 2.0 authentication. Sandbox loan file access established. |
| Week 6 | Field mapping: Encompass income field IDs to calculator input schema. All income types mapped. |
| Week 7 | Pull from Encompass, run calculation, display results. Write results to Encompass custom fields. |
| Week 8 | EPC panel (iframe embed in Encompass UI). End-to-end testing with real loan files. Pilot: 2-3 LOs. |

### Phase 4 — Production Rollout (Weeks 9-10)

| Week | Work |
|------|------|
| Week 9 | LO training. Underwriter onboarding. Documentation. Error handling hardened. |
| Week 10 | Full team rollout. Monitoring dashboard active. Feedback loop operational. Lender overlay rules added. |

### Phase 4 Ongoing — Continuous Improvement

- Monthly guideline re-ingestion (triggered by agency updates)
- Lender overlay rules added to calculation engine as Rapid's policies are documented
- Accuracy tracking and model improvement from LO feedback flags
- Encompass workflow triggers (auto-run calculation when income section completed)
- Optional: voice integration — LO asks a question out loud during a borrower call, gets answer in under 5 seconds

---

## 10. Cost Estimate

### One-Time Build Cost

The primary expense is developer time. At 8-10 weeks for full implementation:
- If built in-house: cost is existing developer salary allocation
- If contracted: a mid-level developer at $100-150/hour, 320-400 hours = $32,000-$60,000
- POC only (Phase 1, 2 weeks): 80 hours = $8,000-$12,000 contractor cost if needed

### Ongoing Monthly Operating Cost

| Item | Cost per Month | Notes |
|------|---------------|-------|
| Claude API (Anthropic Sonnet) | $42-150 | Based on 100-500 queries/day; see detail below |
| Postgres + pgvector hosting | $20-40 | Self-hosted VPS or existing DB server |
| Application server | $20-30 | Lightweight VPS, or Rapid's existing infrastructure |
| Encompass Developer Connect API | $0 | Included in existing Encompass enterprise contract |
| Embedding model (voyage-3) | ~$1-2 | Ingestion is one-time; only re-runs on updates |
| **Total** | **$83-222/month** | |

### Claude API Cost Detail

- Model: claude-sonnet (Anthropic's mid-tier — speed and cost optimized for standard queries)
- Average query: 700-1,000 tokens input (guideline chunks + question) + 400-600 tokens output
- At 100 queries/day: ~4M input + 2M output tokens per month
- Sonnet pricing (2026): approximately $3/1M input tokens, $15/1M output tokens
- Estimate: $12 input + $30 output = **$42/month at 100 queries/day**
- At 500 queries/day (full team utilization): **~$210/month ceiling**
- Budget $150/month as realistic ongoing cost for Rapid's LO headcount

### Build vs. Buy Comparison

| Option | Setup Cost | Monthly Cost | Timeline | Control |
|--------|-----------|-------------|---------|---------|
| This system (AI Underwriter) | $8K-60K (phase-based) | $83-222 | 2 weeks to POC, 10 weeks full | 100% Rapid-controlled |
| Guideline Buddy | $0 | $12/seat | Immediate | None — SaaS |
| Tavant AI Underwriting | $50K-250K+ | $5,000-20,000+ | 6-12 months | Vendor-managed |
| ICE Encompass AI tools | Bundled enterprise | $10,000+/year | Depends on contract | Vendor-managed |
| Addy AI | Enterprise pricing | $2,000-10,000+ | Weeks-months | None — SaaS |

---

## 11. Competitive Analysis

### Guideline Buddy

- **What it is:** A lightweight SaaS chatbot for mortgage guideline questions. $12/month per seat. Consumer-grade web interface.
- **Strengths:** Cheap, immediate, zero IT overhead.
- **Weaknesses:** No income calculation engine. No citation viewer — answers are not traceable to source text. No Encompass integration. Black-box AI with no audit trail. No customization for lender overlays. Borrower scenario builder absent. Unknown data handling practices.
- **Why it is not enough for Rapid:** At Rapid's volume and compliance requirements, an unauditable answer is not an answer. An LO cannot take a Guideline Buddy response to underwriting without knowing where it came from.

### Tavant

- **What it is:** Enterprise AI underwriting platform. Full workflow automation, AUS decision support, document processing.
- **Strengths:** Deep Encompass integration, enterprise SLA, regulatory validation.
- **Weaknesses:** Implementation cost $50K-$250K+. Deployment timeline 6-12 months. Requires dedicated IT resources. Designed for the top 50 lenders. Overkill for a lender of Rapid's size — you are buying capabilities you will not use and paying for enterprise infrastructure you do not need.
- **Who it is for:** $10B+ origination volume lenders with dedicated IT departments.

### Addy AI

- **What it is:** AI-powered mortgage assistant targeting lenders. Guideline queries, some workflow automation.
- **Strengths:** More sophisticated than Guideline Buddy. Multi-agency coverage.
- **Weaknesses:** Enterprise pricing removes it from the mid-market. SaaS model means borrower scenario data potentially processed on external infrastructure. No Encompass write-back in base product. No transparent calculation engine — income calcs are AI-generated, not deterministic.
- **The determinism problem:** If an underwriter asks "why did it calculate $5,983?" and the answer is "the AI decided," that does not satisfy a QC audit. Rapid needs a traceable calculation, not an AI output.

### The Gap This System Fills

Enterprise players solve this problem at enterprise cost and complexity. Consumer SaaS tools lack the depth and auditability that a licensed lender requires. No product in the mid-market delivers:
- Five-agency RAG with source citations
- Deterministic income calculation engine with full traces
- Borrower data that never leaves Rapid's infrastructure
- Encompass integration without a six-figure implementation
- Lender overlay support
- Cost under $300/month to operate

That is the gap. This system fills it.

---

## 12. ROI Case

### Time Saved per LO

A loan officer at Rapid handles an average of 8-15 loans per month. Each loan involves multiple income qualification decisions and guideline lookups.

| Activity | Current (manual) | With AI Underwriter | Time Saved |
|----------|-----------------|---------------------|------------|
| Income calculation (SE, rental, variable) | 15-45 minutes per complex file | 2-3 minutes (calculator + trace) | 12-42 minutes per file |
| Guideline lookup (specific rule) | 5-15 minutes (PDF search + read) | 5-10 seconds | 4.5-14.5 minutes per lookup |
| Average lookups per file | 3-5 guideline questions | 3-5 (same questions, faster) | 15-60 minutes per file |
| Total per file | 30-105 minutes in guideline/calc work | 5-10 minutes | 25-95 minutes per file |

At 10 files/month per LO, 30 minutes saved per file:
- **5 hours per LO per month**
- At Rapid's current LO headcount (approximately 10 LOs):
- **50 hours per month across the team**

At a loaded cost of $50/hour for LO time: **$2,500/month in recovered LO capacity**.

The system pays for itself in month one.

### Compliance Risk Reduction

Inconsistent guideline application is a fair lending and QC risk. When different LOs answer the same guideline question differently, the gap is:
- A potential fair lending issue if the inconsistency correlates with borrower demographics
- A QC finding if an underwriter catches an incorrect calculation after the fact
- A re-disclosure or delay if the error is discovered at the underwriting stage

A single QC fail resulting in a re-disclosure, re-underwrite, or closing delay costs the lender and the borrower time, money, and relationship capital. The AI Underwriter eliminates guideline inconsistency by definition: every LO gets the same answer from the same source.

Estimated value of avoiding one significant guideline error per month: $500-5,000 in LO/underwriter time + potential compliance exposure.

### Training Cost Reduction

New LOs at Rapid spend weeks learning agency guidelines. The learning curve on income calculation for complex files (SE income, rental, multi-source) is 3-6 months. A new LO making $60K-$80K in base salary is not fully productive on complex files for that entire period.

The AI Underwriter accelerates new LO ramp-up by providing an always-available, always-accurate reference. Estimated reduction in ramp-up time: 4-6 weeks per new LO.

At $6,000/month base cost for a new LO, 4 weeks of accelerated productivity = **$6,000 per new hire**.

### Summary ROI

| Value Driver | Monthly Value |
|-------------|--------------|
| LO time recovered (50 hrs/month @ $50/hr) | $2,500 |
| Compliance error reduction (1 catch/month) | $500-5,000 |
| New LO ramp-up (1 hire/year amortized) | $500 |
| **Total monthly value** | **$3,500-8,000** |
| **Operating cost** | **$83-222** |
| **ROI multiple** | **15x-40x** |

---

## Appendix: Technical Stack Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Frontend | React / Next.js | Standard; Rapid's team likely knows it |
| Backend API | Node.js or .NET | .NET preferred if Kyle wants long-term team ownership — his native stack |
| Database | PostgreSQL + pgvector | Self-hosted, relational, no external vendor; SQL Server migration path exists |
| PDF parsing | pdfplumber (Python) or iTextSharp (.NET) | Handles complex PDF layouts including tables and footnotes |
| Embedding model | voyage-3 (Anthropic) | Purpose-built for retrieval, strong on regulatory text |
| LLM inference | Claude API — Sonnet tier | Best RAG citation behavior, 200K context, strong instruction following |
| LOS integration | Encompass Developer Connect REST API (OAuth 2.0) | Modern API; legacy SDK sunset |
| Deployment | On-prem server or VPS Rapid controls | No borrower data in external cloud |
| Version control | Git | Standard |
| Monitoring | Application logging + usage dashboard | Lightweight, custom-built |

---

## Anticipated Questions from Kyle

**"Is this replacing underwriters?"**
No. The system does not make credit decisions. It does not approve loans. It is a reference and calculation tool. The underwriter retains full authority and judgment. This tool reduces the time underwriters and LOs spend looking up rules and doing manual income math — it does not replace the judgment those people exercise.

**"What happens when guidelines update?"**
The ingestion pipeline re-runs on the updated PDF. New chunks replace old by section, tagged with the update date. Turnaround on a guideline update is hours, not weeks. The system surfaces the last-updated date on every citation, so LOs know when the source was last refreshed.

**"Is the AI making up answers?"**
The RAG architecture constrains Claude to answer only from retrieved guideline text. It cannot generate information that is not in the retrieved chunks. Every answer surfaces its source text. If the retrieved chunks do not contain the answer, the system says so — it does not fabricate a rule.

**"What about the income calculator — what if it's wrong?"**
The income engine is deterministic code, not AI. It has unit tests. Every calculation outputs a full trace. An LO or underwriter can verify every step of the math. If a rule changes, one function changes in code, all tests re-run, and the fix is verified before deployment. The calculation logic is transparent and auditable at the code level.

**"How does this handle edge cases the guidelines don't cover?"**
The system returns: "No specific guideline found for this scenario. Underwriter discretion required." It does not guess. This is by design — when the document is silent, the system is silent too.

**"What stack should we use if we want to own this internally?"**
.NET backend with iTextSharp for PDF parsing, pgvector on SQL Server (with the pgvector extension), React frontend. That keeps everything in Kyle's existing skill set and the team can maintain it without outside help after handoff.

---

*Prepared by: UNO, Research Team Lead — 9 Enterprise*
*For: Jasson Fishback / Kyle Shea, CIO, Rapid Mortgage*
*Date: March 26, 2026*
*Sources: HUD 4000.1, Fannie Mae Selling Guide, VA Pamphlet 26-7, USDA HB-1-3555, FHA ML 2025-04, ICE Developer Connect documentation, Anthropic API pricing, UNO income calculation research sprint (March 2026)*
