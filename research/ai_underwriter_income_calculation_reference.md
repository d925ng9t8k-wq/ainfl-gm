# AI Underwriter — Income Calculation Reference
## All Types, All Agencies
### UNO Research Sprint | March 26, 2026

---

## SUMMARY

Complete income calculation rules for all 14 income types across FHA, Conventional (Fannie Mae), VA, and USDA. Each entry covers: calculation method, documentation required, and key agency-specific variations. Built for use as the rule engine inside the AI Underwriter product.

---

## INCOME TYPE 1: W-2 SALARY

### Calculation Method
- Base gross monthly income = Annual W-2 Box 1 / 12
- If pay stub available: YTD earnings / months worked (validates annualized figure)
- Use the lower of (a) annualized YTD or (b) prior 2-year average if income is declining

### Documentation Required
- Most recent 30 days of pay stubs
- W-2s from prior 2 years
- Verbal VOE (Verification of Employment) within 10 days of closing
- Written VOE or 10-day pre-closing VOE

### Agency Rules

| Agency | Key Rule |
|--------|----------|
| FHA | 2-year employment history required; gaps over 30 days need explanation |
| Conventional (FNMA) | Same 2-year standard; DU may allow exceptions |
| VA | 2-year history; more lenient on employment gaps if pattern is stable |
| USDA | Same 2-year standard; income counts toward household limit, not just borrower |

### Notes
- Recent job changes at same or higher pay in the same field: generally acceptable
- Gap in employment under 30 days: no explanation required under most agencies
- Career change or promotion: document with offer letter

---

## INCOME TYPE 2: HOURLY INCOME (with Overtime Rules)

### Calculation Method

**Base Hourly:**
- Monthly qualifying income = (Hourly rate x Hours per week x 52) / 12
- If hours vary: use YTD hours / months worked to establish average hourly

**Overtime (OT):**
- Must have 2-year history of receiving OT
- Monthly OT = (2-year total OT earnings) / 24
- If OT is increasing: may use 2-year average or current YTD average (whichever is higher — lender discretion)
- If OT is declining: use lower of 2-year average or current YTD average

### Documentation Required
- Pay stubs (30 days minimum, showing YTD)
- W-2s from prior 2 years (to verify OT history)
- If OT is significant portion of income: employer letter stating likelihood of continuation helpful but not always required

### Agency Rules

| Agency | Key Rule |
|--------|----------|
| FHA | OT must be received 2 years; averaged over 2 years; likelihood of continuation required |
| Conventional | Same 2-year rule; DU may accept 1-year with strong compensating factors |
| VA | 2-year history standard; FHA methodology applied where VA is silent |
| USDA | Mirrors conforming; OT income counted toward household income ceiling |

### 2025 Update (FHA/VA)
"Previous two years" = two most recent calendar years (2024 + 2023), not rolling 24 months. Income from a partial year in the first year is averaged across the full 12 months.

---

## INCOME TYPE 3: SELF-EMPLOYMENT INCOME

### Entities Covered
- Schedule C (Sole Proprietor / 1099)
- Form 1065 (Partnership) + Schedule K-1
- Form 1120S (S-Corporation) + Schedule K-1
- Form 1120 (C-Corporation — rare for qualifying income)

### Calculation Method

**General Rule:** Use lesser of (a) 2-year average or (b) 1-year average if income declining

**Schedule C (Sole Proprietor):**
```
Qualifying Income = Net Profit (Line 31)
+ Depreciation (Schedule C Line 13)
+ Depletion (if applicable)
+ Business use of home (add back if on return)
- Non-recurring income (remove one-time events)
- Business mileage deduction (if car used for personal also)
/ 24 months
```

**Schedule 1065 (Partnership):**
```
Qualifying Income = Ordinary Business Income/Loss (K-1 Line 1)
+ Net Rental Income
+ Guaranteed Payments (K-1 Line 4)
+ Depreciation / Depletion / Amortization (add back)
/ 24 months
Note: Verify income is supported by actual distributions taken
```

**Schedule 1120S (S-Corporation):**
```
Qualifying Income = Ordinary Business Income/Loss (Line 21)
+ W-2 wages paid to borrower
+ Depreciation / Depletion / Amortization (add back)
Note: No "Guaranteed Payments" on 1120S — those are on borrower's W-2
/ 24 months
```

**Form 1120 (C-Corporation — rare):**
```
Qualifying Income = Net Profit (Line 30) minus Total Tax (Line 31)
+ Depreciation / Depletion / Amortization
- Mortgage/Notes Payable less than 1 year
/ 24 months
```

### 2025 Update
Amortization and non-recurring casualty losses can now be added back for all entity types (1120, 1120S, 1065) per updated FHA guidance.

### Documentation Required
- Personal tax returns (1040) — 2 years with all schedules
- Business tax returns — 2 years (1065, 1120S, or 1120 as applicable)
- Year-to-date P&L (current year) — may be required if prior year return not yet filed
- Business bank statements — 2-3 months (lender may require)
- CPA letter verifying business is active and income is ongoing (FHA may require)
- 25%+ ownership must be documented (ownership stake verification)

### Agency Rules

| Agency | Key Rule |
|--------|----------|
| FHA | 2-year self-employment history minimum; if < 2 years SE but 5+ years in same industry, exceptions possible |
| Conventional | Same 2-year standard; Fannie Mae has specific 4506-C transcript requirements |
| VA | 2-year history; P&L statement if filing within 2 months of fiscal year end |
| USDA | 2-year average; business income counts toward household income ceiling |

### Declining Income Rule
If Year 2 income is lower than Year 1: use the lower figure. Do not average. This is consistent across all agencies.

---

## INCOME TYPE 4: RENTAL INCOME

### Sources
- Schedule E (personal tax return) — existing rental properties
- Form 1007 / Form 1025 — appraisal for market rent (when no history)
- Current signed lease agreements

### Calculation Method

**Using Schedule E (Existing Properties with History):**
```
Step 1: Take reported rents received
Step 2: Add back: Depreciation + Interest + HOA dues + Taxes + Insurance + Non-recurring expenses
Step 3: Subtract: Full PITIA on the property (if not already reflected)
Step 4: Divide by 12 for monthly net rental income
Step 5: If positive = add to qualifying income; if negative = add to monthly debts
```

**Using Lease/Form 1007 (No 2-Year History):**
```
Monthly qualifying rental income = Gross rent x 75%
(The 25% haircut covers vacancy and maintenance)
```

**Subject Property (Investment Purchase — No Lease History):**
- Use Form 1007 appraised market rent x 75%

### Agency Rules

| Agency | Vacancy Factor | Key Rule |
|--------|---------------|----------|
| FHA | 75% factor (25% vacancy) | Same as Fannie Mae for existing rentals; lease + appraisal for new |
| Conventional (FNMA) | 75% factor | 1-unit ADU: rental income capped at 30% of total qualifying income |
| VA | Offset only | Rental income on non-subject property can offset PITIA but NOT count as positive qualifying income (in most cases) |
| USDA | Counted toward household income | All household members' rental income counts toward the income ceiling |

### Documentation Required
- 2 most recent signed federal tax returns with Schedule E
- Current signed lease agreements (all units)
- Form 1007 (single-family) or Form 1025 (2-4 unit) rental appraisal
- If no history: lease transferred to borrower + appraisal showing market rent
- Proof of property management experience (for some programs)

---

## INCOME TYPE 5: SOCIAL SECURITY / PENSION / DISABILITY

### Calculation Method
- Monthly qualifying income = gross monthly award amount from award letter
- If non-taxable: apply gross-up factor

### Gross-Up Rules (Non-Taxable Income)

| Agency | Gross-Up Factor | Result |
|--------|----------------|--------|
| Conventional (FNMA) | 25% | $1,000/mo SS = $1,250 qualifying |
| FHA | 15% (or actual tax rate from prior return, whichever applies) | $1,000/mo SS = $1,150 qualifying |
| VA | 25% (or up to 25%) | $1,000/mo SS = $1,250 qualifying |
| USDA | 25% (mirrors conforming) | $1,000/mo SS = $1,250 qualifying |

**Important:** VA disability gross-up applies to DTI calculations but NOT to VA residual income calculation.

**Social Security Nuance:** Up to 85% of SS income can be taxable under IRS rules. The remaining non-taxable portion (at minimum 15%) can be grossed up. If borrower's tax return shows full SS amount as non-taxable, entire amount qualifies for gross-up.

### Documentation Required
- Social Security award letter (dated within 12 months) or SSA Benefits Verification Letter
- For pension: award letter or pension statement showing monthly amount
- For disability: award letter showing amount and continuance period
- Prior 2 years of tax returns (to verify taxable vs. non-taxable status)
- Proof of receipt: 1-2 months bank statements showing regular deposits

### Continuance Requirement
- Income must continue for at least 3 years from loan closing date
- SS retirement: presumed permanent — no continuance documentation needed
- SSDI: technically reviewable, but lenders generally treat as stable unless award letter shows specific end date
- SSI: same as SSDI treatment

---

## INCOME TYPE 6: CHILD SUPPORT / ALIMONY

### The 6/36 Rule (Standard Across Agencies)
- Must have been received consistently for at least 6 months prior to application
- Must be expected to continue for at least 36 months after application date
- Exception: FHA allows 3 months receipt history (not 6) if court-ordered

### Calculation Method
- Monthly qualifying income = court-ordered monthly amount
- If payment history is inconsistent: average actual receipts over prior 24 months
- Voluntary agreements: acceptable for FHA/VA; Conventional requires court order

### Documentation Required
- Divorce decree, separation agreement, or court order specifying:
  - Monthly payment amount
  - Duration / termination date
- Proof of receipt for required history period:
  - Bank statements showing deposits
  - Canceled checks
  - Payment history from state enforcement agency

### Agency Rules

| Agency | History Required | Continuance Required | Voluntary OK? |
|--------|-----------------|---------------------|---------------|
| FHA | 3 months (court-ordered) / 12 months recommended (voluntary) | 3 years | Yes |
| Conventional | 6 months | 3 years | No — court order required |
| VA | 12 months consistent receipt | 3 years | With documentation |
| USDA | 12 months | 3 years | With documentation |

---

## INCOME TYPE 7: COMMISSION INCOME

### Calculation Method
- Monthly commission income = 2-year average of total commissions earned
- Source: W-2 Box 1 minus base salary, or 1099s, or tax returns

### Key Threshold — FHA
- If commission > 25% of total annual income: tax returns required (not just W-2)

### Increasing vs. Declining Commission
- Increasing: use 2-year average (conservative) or most recent 12-month average (aggressive, lender discretion)
- Declining: use lower of 2-year average or current year YTD annualized — flag for underwriter review

### Documentation Required
- 2 years W-2s
- 2 years personal tax returns (especially if commission > 25% of income)
- 30 days pay stubs showing YTD commissions
- Written VOE from employer confirming commission structure is likely to continue
- Employer CPA letter if self-employed on commission basis

### Agency Rules

| Agency | Key Rule |
|--------|----------|
| FHA | Commission > 25% = 2 years tax returns required; averaged over 2 years |
| Conventional | 2-year average standard; DU may accept shorter history with compensating factors |
| VA | 2-year average; FHA methodology applied where VA guidelines are silent |
| USDA | Same 2-year standard |

---

## INCOME TYPE 8: BONUS INCOME

### Calculation Method
- Monthly qualifying income = 2-year total bonus income / 24
- Must have received bonus income for at least 2 years
- Must be "reasonably likely to continue" — this is a judgment call requiring employer documentation

### Declining Bonus
- If Year 2 bonus is less than Year 1: use lower YTD annualized figure or explain to underwriter
- Employer letter stating continuation likelihood is critical for declining bonus scenarios

### Documentation Required
- 2 years W-2s (bonus line items)
- 30 days pay stubs (showing YTD bonus if already paid in current year)
- Employer letter: confirms bonus program is ongoing and borrower is eligible
- 2 years tax returns if bonus is complex or commission-like

### Agency Rules
Same across FHA, Conventional, VA, USDA: 2-year history, likely to continue, averaged over 24 months. The 2025 "calendar year" definition applies here too (same as variable income rules).

---

## INCOME TYPE 9: PART-TIME / SEASONAL INCOME

### Calculation Method
- 2-year average of part-time/seasonal earnings
- Monthly = total earned over 2 years / 24 (even if seasonal gap exists)
- Cannot use less than 2-year history; no exceptions

### Seasonal Income Nuance
- Unemployment compensation during off-season: can be included as part of the seasonal income pattern if 2-year history documented
- Must be in same line of work, same employer or same industry

### Documentation Required
- 2 years W-2s or 1099s
- 2 years tax returns
- Current pay stubs (YTD)
- Employer letter or prior employer confirmation of seasonal pattern

### Agency Rules
All agencies require 2-year history for part-time and seasonal. USDA note: ALL household members' part-time/seasonal income counts toward the household income limit test.

---

## INCOME TYPE 10: INTEREST / DIVIDEND INCOME

### Calculation Method
- Monthly qualifying income = 2-year average of interest + dividend income / 24
- Source: Schedule B (Form 1040) from tax returns
- If declining year-over-year: use lower year

### Documentation Required
- 2 years personal tax returns with Schedule B
- 2 years brokerage/investment account statements confirming:
  - Ownership of income-producing assets
  - Historical dividend/interest payments
- Proof current assets are still owned and generating income (most recent account statement)

### Continuance Test
- Must have reasonable expectation income continues 3+ years
- If asset base is declining (withdrawals reducing principal): flag — continuance may fail

### Agency Rules
Consistent across all agencies: 2-year average required, continuance test applies. If the only income is investment income, underwriter must assess whether asset base can sustain income through loan term.

---

## INCOME TYPE 11: TRUST INCOME

### Calculation Method
- Fixed/scheduled trust distributions:
  - Monthly qualifying income = documented monthly distribution amount
  - Requires 1 month of current receipt history (FNMA standard)
  - Some lenders require 12 months receipt by overlay
- Variable trust distributions (dividends, interest from trust assets):
  - Use 24-month average of distributions
  - Must document current receipt

### Continuance Requirement
- Lender must verify trust assets are sufficient to support payments for at least 3 years from closing
- Trust must not have a termination date within 3 years

### Documentation Required
- Trust agreement or trustee statement showing:
  - Distribution amount
  - Payment frequency
  - Duration of payments
  - Asset balance (for variable trusts)
- Bank statements showing receipt of distributions (12-24 months)
- Letter from trustee confirming distributions will continue

### Agency Rules
FHA follows Appendix Q / HUD 4000.1 — requires 3-year continuance. Conventional follows FNMA selling guide — stricter documentation. VA and USDA: apply conforming methodology.

---

## INCOME TYPE 12: VA DISABILITY INCOME

### Calculation Method
- Non-taxable income — apply gross-up rules for DTI purposes
- Monthly qualifying income = monthly disability amount x 1.25 (25% gross-up)
- Example: $4,500/month VA disability = $5,625 qualifying income for DTI

### Critical Distinction
- Gross-up APPLIES to DTI calculation
- Gross-up does NOT apply to VA residual income calculation (use actual amount)

### Documentation Required
- VA award letter (current — within 12 months or showing permanent rating)
- 100% P&T (Permanent and Total) disability rating: safest documentation for continuance
- If rating is subject to review: provide VA disability letter, may require underwriter judgment on continuance
- Bank statements showing receipt

### Agency Rules
VA loans only. Non-VA agencies treat VA disability as standard non-taxable disability income (same gross-up rules as SS/disability above). VA disability income is generally treated as permanently continuing for qualification purposes when P&T rating is documented.

---

## INCOME TYPE 13: NOTES RECEIVABLE

### Calculation Method
- Monthly qualifying income = scheduled monthly payment amount from note
- Must document receipt history (12 months minimum)
- Must document 3 years of remaining payments

### Documentation Required
- Copy of the promissory note showing:
  - Original amount, interest rate, payment schedule
  - Remaining balance and payoff date
- 12 months bank statements showing consistent receipt of payments
- Evidence note has at least 36 months remaining payments

### Agency Rules
Consistent across agencies: 12 months receipt history + 3 years remaining continuance. If note matures in under 3 years, income generally cannot be used for qualifying. Lender overlays may require CPA letter or attorney confirmation of note validity.

---

## INCOME TYPE 14: BOARDER INCOME (FHA-Specific)

### FHA Mortgagee Letter 2025-04 (Effective March 14, 2025 — case numbers on or after)

### Calculation Method
```
Step 1: Verify income received for at least 9 of the most recent 12 months
Step 2: Calculate 12-month average (total receipts / 12)
Step 3: Cap: boarder income cannot exceed 30% of total monthly qualifying income
Step 4: Use the LESSER of:
  - 12-month average, OR
  - Current monthly rent per written lease agreement
```

### Documentation Required
- Signed written agreement documenting:
  - Boarding terms
  - Monthly rent amount
  - Boarder's intent to continue
- Evidence boarder's address matches borrower's address (shared residence)
- Evidence of rental receipt history over prior 12 months:
  - Bank statements, canceled checks, or payment records

### Agency Rules
- FHA only — this is an FHA-specific product. Conventional does not have equivalent boarder income rules.
- 30% of total qualifying income cap is hard — cannot be overridden.
- Income must be currently being received (not historical only).
- Cannot use projected income from a new boarder relationship.

---

## CROSS-AGENCY COMPARISON: KEY THRESHOLDS

| Parameter | FHA | Conventional | VA | USDA |
|-----------|-----|-------------|-----|------|
| Max DTI (back-end) | 43% (57% with AUS) | 45% (50% with DU approval) | 41% DTI + residual income test | 41% (29%/41% housing/total) |
| Min credit score | 580 (3.5% down) / 500 (10% down) | 620 standard | No minimum (but lenders overlay 580-620) | 640 standard |
| Non-taxable gross-up | 15% | 25% | 25% | 25% |
| Self-employment history | 2 years | 2 years | 2 years | 2 years |
| Variable income history | 2 calendar years | 2 years | 2 years | 2 years |
| Continuance required | 3 years | 3 years | 3 years | 3 years |

---

## SOURCES

- [FHA HUD Handbook 4000.1](https://www.hud.gov/hud-partners/single-family-handbook-4000-1)
- [FHA Mortgagee Letter 2025-04 — Boarder Income](https://www.hud.gov/sites/dfiles/OCHCO/documents/2025-04hsgml.pdf)
- [Fannie Mae Selling Guide — General Income Information](https://selling-guide.fanniemae.com/sel/b3-3.1-01/general-income-information)
- [Fannie Mae Selling Guide — Rental Income](https://selling-guide.fanniemae.com/sel/b3-3.8-01/rental-income)
- [USDA HB-1-3555 Chapter 9](https://www.rd.usda.gov/files/3555-1chapter09.pdf)
- [VA Pamphlet 26-7 Chapter 4](https://www.benefits.va.gov/WARMS/docs/admin26/pamphlet/pam26_7/ch04.pdf)
- [Blueprint — May 2025 FHA/VA Variable Income Updates](https://getblueprint.io/knowledge-base/understanding-the-may-2025-updates-to-fha-and-va-variable-income-calculations/)
- [Blueprint — Grossing Up Income](https://getblueprint.io/knowledge-base/grossing-up-income/)
- [Franklin American — FHA Self-Employment Worksheet](https://www.franklinamerican.com/public_extranet/wholesale_forms_general/fha_self-employment_income_calculation_worksheet_job_aid_013120.pdf)
- [Veterans United — VA Gross-Up](https://www.veteransunited.com/valoans/grossing-up-va-loan/)

---

## CONFIDENCE LEVELS

| Section | Confidence | Notes |
|---------|-----------|-------|
| W-2 / Hourly base | High | Well-documented, consistent across all sources |
| Overtime / Bonus / Commission | High | Confirmed by Blueprint 2025 update article |
| Self-employment formulas | High | Confirmed by FHA worksheet + 2025 HUD updates |
| Rental income / vacancy factor | High | Directly confirmed by FNMA selling guide |
| SS / Pension gross-up rates | High | Confirmed by multiple sources; FHA 15% vs 25% others is definitive |
| Child support / Alimony | High | Well-documented across agencies |
| Trust income | Medium | Rules are consistent; specific lender overlays vary |
| Notes receivable | Medium | Standard rules documented; less common so fewer primary sources |
| Boarder income | High | Directly from FHA ML 2025-04 (January 2025) |
| VA disability residual income distinction | High | Confirmed by VA VBA document |

## GAPS

- Freddie Mac-specific rules not fully enumerated (Freddie generally mirrors Fannie but has specific variances)
- Non-QM income calculation rules not covered (outside scope)
- State-level overlay rules (each state may have additional lender-specific requirements)
- DSCR loan income logic (investment property loans using property income only) not covered
- Asset depletion / asset dissipation income method not covered
