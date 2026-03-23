# Mortgage Guideline AI — Knowledge Base

## Overview
This directory contains structured mortgage lending guidelines compiled for building an AI-powered underwriting assistant for Rapid Mortgage Company.

## Files

| File | Agency | Size | Coverage |
|------|--------|------|----------|
| fannie-mae-guidelines.md | Fannie Mae | 17KB | DTI, credit, property, LTV, gifts, reserves, buydowns, edge cases |
| fha-guidelines.md | FHA | 10KB | FHA-specific rules vs conventional, MIP, anti-flip, identity of interest |
| va-usda-guidelines.md | VA + USDA | 22KB | Eligibility, entitlement, funding fee, residual income, USDA income limits |
| freddie-mac-differences.md | Freddie Mac | 11KB | Side-by-side comparison of Fannie vs Freddie differences |

## Target Use Cases
1. **Loan officer quick reference** — instant answers to guideline questions
2. **Underwriter training tool** — scenario-based learning
3. **Pre-qualification helper** — automated eligibility screening
4. **Kyle Shea demo** — show practical AI value for Rapid Mortgage operations

## Important Notes
- Guidelines reflect training data through early 2025
- 2026 conforming loan limits need to be updated when FHFA announces them
- Individual lender overlays (Rapid Mortgage's own policies) should be layered on top
- Always verify against current Selling Guides before making lending decisions

## Next Steps
- [ ] Build chat interface for guideline queries
- [ ] Add Rapid Mortgage-specific overlays
- [ ] Create scenario-based training exercises
- [ ] Integrate with Encompass LOS data for automated checks
