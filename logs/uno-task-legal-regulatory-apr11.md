# UNO — Legal & Regulatory Gap Matrix (Kyle-track CLO Deliverable)

**Author:** UNO (CLO + Research Lead) — sub-agent run
**Date:** 2026-04-11
**Scope:** Consumer-facing and B2B-facing products in the 9 Enterprises universe.
**Jurisdictions considered:** U.S. federal, Ohio (9 Enterprises LLC state of formation), Colorado, California, Virginia, Connecticut, New York, EU.
**Method:** Live repo audit + April 2026 regulatory research (cutoff-correct) via web search.

> **Honesty rule applied:** Status ratings are what exists in code today, not what is planned. Where a product is not yet live, the gap is labeled "gap at launch." Kyle will catch over-claimed compliance posture.

---

## Product Inventory and Data Touch Points

| Product | Live? | Data touched | Regulatory exposure |
|---|---|---|---|
| **AiNFLGM** (ainflgm.com) | Yes — static site | GA tracking, AdSense, Umami | CCPA (if CA users), GDPR (if EU users), COPPA (if <13 users), FTC ad disclosure |
| **AI Underwriter POC** (mortgage-ai/fha-agent.mjs) | CLI only — not deployed | None yet (internal POC) | **CRITICAL at launch:** CFPB/ECOA, TILA, RESPA, GLBA, State LO licensing, ECOA adverse action, Colorado AI Act, EU AI Act |
| **Your9** (scripts/your9-*.mjs, ~38 scripts) | Billing infra live, user accounts infra live | Email, Stripe customer IDs, subscription data, user-generated task data | CCPA, GDPR, state privacy laws, TCPA (multichannel agent), SOC 2 customer-demanded |
| **FreeAgent9 / Pilot Server** (scripts/pilot-server.mjs) | Pilot live — Kyle Cabezas | Phone number, SMS content, AI responses | TCPA (SMS to US consumer), Ohio two-party consent, data minimization |
| **Jules/Pepper** (scripts/jules-telegram.mjs, pepper-*.mjs) | Live for Owner, pilot for others | Telegram messages, personal schedule data | GDPR if EU users, CCPA if CA users, COPPA if minors |
| **Kids Mentor** (scripts/kids-mentor.mjs) | Live for Owner's kids | iMessage content, minor data | **COPPA** (Jude 11, Jacy 8), Ohio parental consent law, GLBA-adjacent if financial topics |
| **Trader9** (scripts/trader9-bot.mjs) | Paper only; live gated on ALPACA_LIVE_ENABLED | Alpaca account data, Kalshi positions | SEC Rule 15c3-5, FINRA, CFTC if prediction markets, state broker-dealer laws |
| **Voice Server** (scripts/voice-server.mjs) | Live (Cloudflare tunnel) | Voice recordings, Twilio call logs, ElevenLabs TTS | TCPA, federal and state two-party consent wiretap laws |
| **x9/x9-poster** (scripts/x9-poster.mjs) | CLI-only social posting | X (Twitter), Reddit, Proton | Platform ToS, FTC endorsement rules if advertising |

---

## Section 1 — Mortgage Industry Regulations (AI Underwriter)

The AI Underwriter product is the single highest legal risk in the universe because it touches mortgage underwriting decisions. Every one of the regulations below becomes live the moment the POC is deployed to a real LO — including internal use at Rapid Mortgage.

### 1.1 CFPB / ECOA / Regulation B (Adverse Action Notifications for AI)

**Applies to:** AI Underwriter at launch.

**Current CFPB posture (2026):** Per CFPB Circular 2023-03 and the Consumer Financial Protection Circular issued September 2023 and reaffirmed through 2024–2026, **"ECOA and Regulation B do not permit creditors to use a 'black-box' underwriting technology when doing so means that the creditor cannot provide specific and accurate reasons for an adverse action."** The 2026 Regulation B proposal targets digital lending transparency and is expected to finalize this year.

**Gap:** `mortgage-ai/fha-agent.mjs` uses `claude-haiku-4-5-20251001` as a single-shot LLM with a system prompt containing `fha-system-prompt.md` content. No:

- Structured reason-code output
- Grounding/citation enforcement against `fha-guidelines.md`
- Adverse action reason log
- Human-in-the-loop gating (Kyle benchmark C-05)

**Status:** **FAIL at launch.** Will not pass CFPB examination if ever used to make a lending decision, even as a recommendation.

**Remediation:** Medium (10 days). Add a structured-output schema requiring the model to emit `{decision, reason_codes[], cited_guideline_sections[], confidence}`; enforce that every reason_code maps to an approved CFPB reason-code taxonomy (Reg B Appendix C). Add a human-review gate for any adverse-leaning output.

### 1.2 Fair Housing Act + ECOA Disparate Impact

**Applies to:** AI Underwriter at launch.

**Gap:** No bias testing, no disparate-impact analysis, no documented protected-class handling. CFPB will examine any ML/LLM used in underwriting for disparate impact.

**Status:** **FAIL at launch.**

**Remediation:** Medium (14 days). Engage a fair-lending analytics vendor or build an offline test harness using synthetic borrower profiles across protected classes; document decision consistency.

### 1.3 TILA (Truth in Lending Act) / Regulation Z

**Applies to:** AI Underwriter **only if** it surfaces APR/rate/payment figures. Current POC answers FHA guideline questions only — no rate or payment surfacing.

**Status:** **Not applicable yet.** Becomes a hard requirement the moment the product quotes rates or payments. Will need full TILA disclosures, APR calculation parity with Rapid's existing LOS (Encompass), and triggering event handling.

**Remediation:** Large (15+ days at minimum). Avoid until product is rate-capable.

### 1.4 RESPA Section 8 (Kickback and Referral Rules)

**Applies to:** Any 9 product that refers business to a settlement service provider (lender, title, appraiser) in exchange for anything of value.

**Current risk:** Low. AI Underwriter is internal. However, if 9 Enterprises ever monetizes AI Underwriter by charging per-user to Rapid Mortgage while also referring borrowers, a RESPA Section 8 review is required. Kyle K-14 ("don't duplicate LOS functionality, integrate through Encompass") is the right architectural answer here.

**Status:** **Watch-item.** Not a current violation.

**Remediation:** Document the revenue model before any monetization; run RESPA Section 8 review with counsel.

### 1.5 GLBA (Gramm-Leach-Bliley Act) — Safeguards Rule

**Applies to:** AI Underwriter, any product that receives Rapid Mortgage borrower data, and the Your9 instance if an LO uploads customer data.

**FTC Safeguards Rule (2023 amendment, enforced 2024):** Financial institutions and their service providers must maintain:

- Qualified individual responsible for the information security program
- Written risk assessment
- Access controls + MFA on all systems accessing customer information
- Encryption in transit and at rest
- Continuous monitoring or annual penetration testing
- Incident response plan with 30-day notification to FTC for breaches affecting >500 consumers

**Status:** **FAIL.** Of the seven bullets above, only "encryption at rest" (SQLCipher on memory DB) partially passes. No MFA, no qualified individual formally designated, no written risk assessment, no pen test, no FTC notification process.

**Remediation:** Medium-Large (21 days). Formally designate 9 (or Wendy under 9) as the qualified individual; adopt the SOC 2 P0 remediation list which addresses most of the Safeguards Rule requirements simultaneously.

### 1.6 State-level Mortgage Licensing (SAFE Act / NMLS)

**Applies to:** AI Underwriter **if** it is packaged as a service to an LO for hire.

**Risk:** Ohio (9E's state of formation), Michigan (Kyle's state), and every other state have SAFE Act mortgage licensing requirements. A service that "takes applications" or "negotiates terms" of a residential mortgage may be a licensable activity. Pure guideline Q&A is unlikely to trigger, but if 9 ever ingests a real loan application and returns conditional approvals, state licensing triggers.

**Status:** **Watch-item.** POC is safe; productization requires a state-by-state analysis.

**Remediation:** Engage a mortgage compliance attorney before any pilot at a licensed lender. Small ($2–5K retainer) but required.

---

## Section 2 — Consumer Privacy

### 2.1 CCPA / CPRA (California)

**Applies to:** AiNFLGM (public site), Your9 (SaaS product), Pepper, Jules if any California user.

**Threshold:** Businesses that collect CA consumer data AND meet one of: >$25M revenue, >100K consumers/year, or >50% revenue from selling data. **AiNFLGM is likely under threshold on all three, but once AdSense revenue or analytics scale up, the 100K consumer threshold is the first to cross.**

**Gaps:**
- `public/privacy.html` exists for AiNFLGM only — no "Do Not Sell or Share My Personal Information" link
- No CCPA opt-out flow
- No data subject access request (DSAR) process
- No privacy policy for any other product (Your9, Jules, Pepper, AI Underwriter)

**Status:** AiNFLGM = **PARTIAL.** All other products = **FAIL.**

**Remediation:** Small (3 days) for AiNFLGM policy update + "Do Not Sell" link. Medium (7 days) for product-specific privacy policies and a DSAR workflow tied to `your9-auth.mjs`.

### 2.2 GDPR (EU)

**Applies to:** Any product that intentionally markets to EU users or processes EU personal data.

**Current posture:** AiNFLGM is NFL-specific content, almost exclusively US audience. Your9 has no EU-specific marketing. Risk is **low but not zero** — web analytics will pick up any EU visitor, and server-side logs will have IPs.

**Gaps:**
- No GDPR lawful basis documented
- No cookie consent banner on AiNFLGM (Umami is cookieless, but GA is loaded per `public/privacy.html` line 19–26 — GA uses cookies)
- No DPA with vendors (Anthropic, Stripe, Cloudflare, Twilio, ElevenLabs)
- No DPO (not required for small businesses but recommended)
- No EU representative designated

**Status:** **FAIL if a single EU user signs up for a paid product.** Watch-item for AiNFLGM.

**Remediation:** Medium (10 days). Add cookie consent for EU users (IP geolocation + cookieless GA config); sign DPAs with all customer-data vendors; publish GDPR notice.

### 2.3 Virginia CDPA, Colorado CPA, Connecticut CTDPA, Utah UCPA, Texas TDPSA, Oregon OCPA, Iowa ICDPA, Delaware DPDPA, New Hampshire NHPA

**Applies to:** State privacy laws, 19 states in effect as of April 2026.

**Thresholds vary** but most fire at ~100K consumers/year. Your9 as a B2B SaaS may avoid these; AiNFLGM may trigger depending on traffic.

**Status:** **FAIL** — zero awareness in the repo. No state-by-state compliance matrix exists.

**Remediation:** Small-Medium (5 days). Adopt a state privacy law matrix (several SaaS vendors publish templates). Implement a single universal privacy notice that satisfies the strictest state (California).

---

## Section 3 — AI-Specific Laws

### 3.1 Colorado AI Act (SB 24-205)

**Applies to:** AI Underwriter — **this is the single biggest AI-specific regulatory risk in the universe.**

**Current status (April 2026 research):** Effective date **delayed from Feb 1, 2026 to June 30, 2026** per special session bill signed by Governor Polis in August 2025. General Assembly is expected to revisit the framework in its January 2026 session and may further modify. A Colorado AI Policy Work Group has proposed an updated framework replacing SB 24-205.

**What it covers:** High-risk AI systems used to make "consequential decisions" including credit scoring and mortgage eligibility. Mortgage underwriting AI is explicitly covered as a high-risk deployment.

**Obligations on deployers:**
1. Risk management program mapped to NIST AI RMF or ISO 42001
2. Annual impact assessments
3. Consumer disclosures when AI contributes to a consequential decision
4. Notice to consumers with adverse action explanation
5. Right to appeal to a human reviewer

**Status:** AI Underwriter is **FAIL against every one of these** as of Apr 11, 2026. Effective date is **80 days out** (Jun 30, 2026).

**Remediation:** Large (21 days). If AI Underwriter is ever deployed to a Colorado borrower or a Colorado-licensed lender, every one of these controls must be in place. The NIST AI RMF mapping alone is a 7-day effort. Impact assessment is 5 days per deployment context. Human appeal flow is 3 days of product work.

### 3.2 EU AI Act — High-Risk Credit Scoring

**Applies to:** AI Underwriter **if** ever deployed to an EU user or EU-licensed lender.

**Current status (April 2026 research):** AI Act entered force Aug 2, 2024. For credit scoring / creditworthiness assessment AI, the high-risk obligations apply from **August 2, 2026** — 114 days from today.

**Obligations on deployers (Articles 26–27):**
1. Ensure input data relevance and representativeness
2. Continuous monitoring of system performance
3. Log retention per system logs
4. Transparency to affected individuals
5. Fundamental Rights Impact Assessment (FRIA) before deployment
6. Report serious incidents without delay
7. AI literacy training for all staff dealing with the system (already in effect since Feb 2025)

**Penalty ceiling:** €35M or 7% of worldwide turnover for prohibited practices; €55M for deployment without documentation as of Aug 2, 2026.

**Status:** **FAIL** on every obligation. AI literacy training alone is not documented anywhere in the repo.

**Remediation:** Large — **avoid EU deployment until compliance is built.** If EU is not on the near-term roadmap, geofence the product.

### 3.3 NYC AEDT (Automated Employment Decision Tools)

**Applies to:** No current product. 9 does not produce HR/employment screening tools.

**Status:** **N/A.** Monitor for scope changes.

### 3.4 Federal AI Executive Order / White House AI Bill of Rights

**Applies to:** Federal agencies primarily; a soft-law benchmark for private-sector products. Rescinded or modified by various administrations; reference only.

**Status:** N/A as binding law; useful as a framework for explainability commitments.

---

## Section 4 — Payments (PCI DSS)

### 4.1 PCI DSS Scope for Stripe-Based Billing

**Applies to:** Your9 billing (`scripts/your9-billing.mjs`).

**Current posture:** Your9 billing uses raw HTTPS against Stripe's API rather than the JS SDK. Comment at top of file: "Raw HTTPS only — no Stripe SDK. Matches codebase pattern from comms-hub.mjs." This means **the product never handles card numbers directly** — Stripe Checkout or Stripe.js handles all PAN data. This keeps Your9 in the narrowest PCI DSS scope (SAQ A).

**SAQ A requirements (minimum for merchants that outsource all cardholder data):**
- Annual self-assessment questionnaire
- External vulnerability scan by an ASV quarterly (if using Stripe Checkout hosted pages, Stripe provides this)
- Information security policy
- Vendor management program for third-party service providers

**Status:** **PARTIAL.** The technical architecture is PCI-friendly. The paperwork (SAQ A, info sec policy, vendor management) does not exist.

**Remediation:** Small (3 days). Complete SAQ A; document that Stripe handles all PAN; reference Stripe's PCI compliance.

### 4.2 Dominos Card Data in .env — PCI Violation

**Applies to:** The POC script `food-order-poc.mjs`.

**Gap (from `docs/credential-inventory.md` C-01):** Full payment card data in `.env`: `DOMINOS_CARD_NUMBER`, `DOMINOS_CARD_CVV`, `DOMINOS_CARD_EXPIRY`, `DOMINOS_CARD_ZIP`. **This is a PCI DSS violation of Requirement 3 (do not store sensitive authentication data such as CVV after authorization) and Requirement 4 (encrypt PAN storage).**

**Status:** **FAIL.** Active violation regardless of whether the script runs.

**Remediation:** Tiny (1 hour). Remove all Dominos card data from `.env` immediately. Flagged as P0 #5 in the SOC 2 deliverable. **This is the single cheapest legal-risk remediation in the entire universe.**

---

## Section 5 — Securities and Trading (Trader9)

### 5.1 SEC / FINRA — Broker-Dealer Registration

**Applies to:** `scripts/trader9-bot.mjs`.

**Current posture:** Trader9 trades in a single Alpaca account owned by the founder. It is a personal trading bot. It does not:
- Take funds from third parties
- Publish recommendations to non-owners
- Charge fees for advice

**Status:** **Not a broker-dealer. Not an investment adviser.** If operated only for the founder's own account, it is personal trading.

**Trigger points that would change the status:**
1. Taking capital from any third party → becomes an investment adviser (Investment Advisers Act of 1940)
2. Publishing trading signals to paying subscribers → may require IA registration (state or federal depending on AUM)
3. Managing any capital for a family member with compensation → IA registration
4. Any claim of track record in marketing → SEC advertising rule (Rule 206(4)-1)

**Current guardrails in code:** `ALPACA_LIVE_ENABLED` hard gate, MAX_DAILY_LOSS_PCT circuit breaker, paper mode default.

**Status:** **PASS as currently operated.** Document this explicitly so Kyle knows trader9 is not a product for sale.

### 5.2 CFTC — Prediction Markets (Kalshi, Polymarket)

**Applies to:** The scaffolded Kalshi/Polymarket strategies in trader9.

**Current posture:** Scaffold only. `PREDICTION_MARKET_ENABLED` gate prevents execution. Kalshi is CFTC-regulated; Polymarket is not available to US persons for most markets.

**Status:** **PASS as scaffolded.** Becomes a regulatory concern the moment the gate is flipped.

**Remediation:** Before flipping: confirm the Kalshi account is KYC'd to the correct entity (founder personal vs 9 Enterprises LLC); do not cross-trade Polymarket from a US IP unless using compliant markets.

### 5.3 Cryptocurrency (Hyperliquid)

**Applies to:** Scaffolded Hyperliquid funding-rate carry strategy in trader9.

**Current posture:** Scaffold only. `HYPERLIQUID_ENABLED` gate.

**Risk at launch:** Hyperliquid is a DEX. US person access is a moving target. CFTC and SEC have asserted jurisdiction over various crypto derivatives.

**Status:** **Watch-item.** Do not enable without a crypto counsel review.

---

## Section 6 — TCPA (Telephone Consumer Protection Act)

### 6.1 SMS/Call Products

**Applies to:** Pilot Server (FreeAgent9 to Kyle Cabezas), Voice Server, Your9 multichannel.

**TCPA basics:**
- Written consent required for marketing calls/texts
- Express consent (not "written") sufficient for transactional/informational
- Opt-out must be honored immediately (STOP keyword)
- Quiet hours: 8 AM – 9 PM local time
- Identify caller on every message

**Pilot Server posture:** Kyle Cabezas has consented (Jasson's long-time friend, documented in `memory/contact_kyle_cabezas.md`). No evidence of STOP keyword handling in the script. No quiet-hours gating.

**Status:** **PARTIAL for Pilot Server (consent yes, opt-out + quiet hours no).** Product-launch = **FAIL** without STOP handling.

**Remediation:** Small (1 day). Add STOP/HELP keyword handling in `pilot-server.mjs` and any Your9 SMS path; respect local-time quiet hours.

### 6.2 Two-Party Consent / Wiretap Laws

**Applies to:** Voice Server (Twilio inbound calls).

**Gap:** No call recording disclosure. Several states (CA, FL, IL, MD, MA, MT, NH, PA, WA) require all-party consent for call recording. Ohio is one-party (OK). But a CA caller reaching the Cincinnati-based voice server triggers California's all-party rule if the call is recorded or analyzed.

**Status:** **FAIL.** FORT agent has already queued the fix (`scripts/fort-agent.mjs` work item `voice-consent-disclosure`): 5-second TTS greeting at call start. Not yet shipped.

**Remediation:** Tiny (2 hours). Ship FORT's design.

### 6.3 COPPA (Children's Online Privacy Protection Act)

**Applies to:** Kids Mentor (used with Jude 11 and Jacy 8, both under 13).

**Current posture:** This is a family-internal tool used by the founder with his own children. COPPA applies to operators of commercial sites/services directed at children or with actual knowledge of collecting data from children under 13. Personal/family use by a parent is not a covered "operator."

**Status:** **PASS as currently operated** (parental-use exception).

**Risk at launch:** If Kids Mentor ever becomes a product sold to other parents, COPPA compliance (verifiable parental consent, direct notice, data minimization, deletion on request) becomes mandatory. **Do not ship as a product without counsel.**

---

## Section 7 — Product-Level Legal Status Matrix

| Product | CFPB/ECOA | TILA | GLBA | State privacy (CCPA+) | GDPR | Colorado AI Act | EU AI Act | PCI | TCPA | Overall |
|---|---|---|---|---|---|---|---|---|---|---|
| AiNFLGM | N/A | N/A | N/A | PARTIAL | FAIL (if EU) | N/A | N/A | N/A | N/A | PARTIAL |
| AI Underwriter | **FAIL** | Watch | **FAIL** | FAIL | FAIL | **FAIL** | **FAIL** | N/A | N/A | **FAIL (blocks launch)** |
| Your9 | N/A | N/A | FAIL | FAIL | FAIL | N/A | N/A | PARTIAL (SAQ A) | FAIL | FAIL |
| FreeAgent9 / Pilot | N/A | N/A | N/A | FAIL | N/A | N/A | N/A | N/A | PARTIAL | PARTIAL |
| Jules / Pepper | N/A | N/A | N/A | FAIL | FAIL (if EU) | N/A | N/A | N/A | N/A | FAIL |
| Kids Mentor | N/A | N/A | N/A | FAIL (COPPA if productized) | N/A | N/A | N/A | N/A | N/A | PASS personal / FAIL product |
| Trader9 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | PASS personal |
| Voice Server | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | FAIL (no disclosure) | FAIL |
| x9 / social | N/A | N/A | N/A | FAIL | N/A | N/A | N/A | N/A | N/A | FAIL |

---

## Top 3 Legal/Regulatory Blockers

1. **AI Underwriter violates CFPB/ECOA adverse action rules and Colorado AI Act simultaneously.** A single deployment to any borrower — even a friendly Rapid LO test — creates regulatory exposure. This is the biggest legal blocker in the entire universe. **Do not deploy AI Underwriter to any real user in any jurisdiction until reason-code output, adverse action logging, human review gate, and a Colorado AI Act risk management program are in place.**

2. **FTC Safeguards Rule non-compliance for any product that touches Rapid Mortgage data.** GLBA Safeguards Rule requires MFA, a written risk assessment, designated qualified individual, and annual pen testing. The universe passes none of these. Any data exchange with Rapid (even a POC connection) is a GLBA violation and exposes both 9 Enterprises and Rapid Mortgage. Kyle will catch this immediately.

3. **Dominos payment card data in `.env` is an active PCI DSS violation.** This is the cheapest fix in the repo (1 hour to remove) and must happen today. Any security audit that looks at `.env` flags this instantly. Also a GLBA red flag because it demonstrates the project does not treat financial data appropriately.

---

## Highest-Priority Single Remediation

**Pull AI Underwriter from any deployment path until a compliance wrapper is built.** Specifically:

1. Freeze `mortgage-ai/fha-agent.mjs` in internal-only mode. Add a visible header banner on all outputs: "INTERNAL RESEARCH ONLY — NOT FOR USE IN LENDING DECISIONS."
2. Before any production step, build: (a) structured reason-code output per Reg B Appendix C, (b) grounding against `fha-guidelines.md` with enforced citation, (c) human-review gate for adverse-leaning outputs, (d) a Colorado AI Act risk management program per NIST AI RMF (effective Jun 30, 2026 — 80 days out), (e) a GLBA Safeguards Rule compliance statement.
3. Engage mortgage compliance counsel before the first external pilot. This is table stakes in the industry.

This single remediation closes the highest-exposure blockers (CFPB/ECOA, Colorado AI Act, GLBA) in one workstream and is the right story to tell Kyle: "We stopped the AI Underwriter deployment track, we're rebuilding it on a compliance spine, and here is the plan." That conversation survives a Kyle meeting. The alternative does not.

---

## Sources Consulted

- CFPB Circular 2023-03 (consumerfinance.gov)
- CFPB AI adverse action guidance (consumerfinance.gov/about-us/blog/innovation-spotlight-providing-adverse-action-notices-when-using-ai-ml-models/)
- Skadden analysis of CFPB AI + ECOA enforcement posture (skadden.com, Jan 2024)
- Colorado AI Act SB 24-205 + special session update (hudsoncook.com, bhfs.com, leg.colorado.gov)
- Mayer Brown — Colorado AI Policy Work Group 2026 update (mayerbrown.com, Mar 2026)
- EU AI Act Annex III + Articles 26–27 (artificialintelligenceact.eu)
- Goodwin — EU AI Act Key Points for Financial Services (goodwinlaw.com)
- FTC Safeguards Rule 2023 amendment
- PCI DSS v4.0 SAQ A requirements (PCI Security Standards Council)
- Internal: `docs/credential-inventory.md`, `scripts/fort-agent.mjs`, `scripts/pilot-server.mjs`, `scripts/your9-billing.mjs`, `mortgage-ai/fha-agent.mjs`, `public/privacy.html`
- Internal: `memory/reference_kyle_enterprise_benchmark.md`

*Generated by UNO sub-agent, 2026-04-11. Read-only analysis; no code or artifact was modified.*
