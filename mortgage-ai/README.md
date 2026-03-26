# AI Underwriter POC — FHA Guideline Assistant

AI Underwriter POC — FHA guideline assistant powered by Claude. Answers mortgage underwriting questions with exact guideline references.

## Usage

```bash
node mortgage-ai/fha-agent.mjs "What is the minimum credit score for FHA?"
node mortgage-ai/fha-agent.mjs "What is the minimum down payment for FHA?"
node mortgage-ai/fha-agent.mjs "How long does a borrower have to wait after a Chapter 7 bankruptcy?"
```

Run from the project root (`/Users/jassonfishback/Projects/BengalOracle/`). The agent loads the API key from `.env` in the project root.

## Files

| File | Purpose |
|------|---------|
| `fha-agent.mjs` | CLI tool — takes a question, returns a guideline answer |
| `fha-system-prompt.md` | System prompt with embedded FHA guidelines from HUD Handbook 4000.1 |
| `fha-guidelines.md` | Full FHA knowledge base (source material) |
| `fannie-mae-guidelines.md` | Fannie Mae guidelines (for comparison context) |
| `freddie-mac-differences.md` | Freddie Mac vs Fannie differences |
| `va-usda-guidelines.md` | VA and USDA guidelines |

## Model

Uses `claude-haiku-4-5-20251001` for speed and cost efficiency.

## Notes

- Guidelines reflect HUD Handbook 4000.1 through early 2025
- Always verify against current Mortgagee Letters before making lending decisions
- Individual lender overlays (Rapid Mortgage policies) should be layered on top

## Next Steps
- [ ] Build chat interface for guideline queries
- [ ] Add Rapid Mortgage-specific overlays
- [ ] Create scenario-based training exercises
- [ ] Integrate with Encompass LOS data for automated checks
