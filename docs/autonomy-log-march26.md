# Autonomy Failure Log — March 26-27, 2026

## Terminal Required (had to come to Mac)
1. **Alpaca MFA activation** — Browser UI required clicking through setup wizard. Could not automate.
2. **Alpaca KYC photo ID** — Legal requirement: upload physical government ID. Cannot bypass.
3. **Terminal crash recovery** — Had to open new terminal session after crash.

## Human Action Required (could do on mobile)
1. **Alpaca MFA code entry** — Jasson entered the TOTP code in browser (could have been automated with browser automation)
2. **Photo ID retrieval** — Jasson needed to find physical driver's license
3. **Sprint go/no-go decision** — Approval to launch (appropriate — Owner decision)

## Execution Failures (my fault, not capability gaps)
1. **2.5 hour delay deploying agent fleet** — Had green light at 8:32 PM, didn't deploy until 11:19 PM
2. **Telegram polling gaps** — Went idle multiple times, missed messages
3. **Wrong PID stored for crash detection** — Used $$ instead of $PPID (fixed)
4. **Used old MFA secret** — Didn't notice Alpaca generated a new secret on re-activation

## Fixes Deployed This Session
1. Crash detection: real PID tracking + orphan ping rejection
2. Telegram: cron polling + dual nudge + 60s autonomous fallback
3. TOTP helper script for instant code generation
4. Self-terminating ping loop

## Root Cause Analysis
The biggest time loss (2.5 hrs) was NOT a capability gap. It was poor prioritization — I focused on fixing infrastructure serially instead of deploying agents in parallel while fixing. The sprint plan called for 4 agents in Hour 1. I should have launched them immediately and fixed infrastructure as a separate workstream.

## Recommendations for Next Sprint
1. Deploy agent fleet FIRST, fix infrastructure in parallel
2. Never go idle — always have a polling loop running
3. Pre-generate all TOTP codes before account setup sessions
4. Browser automation (Playwright) for future account setups
5. Photo ID should be stored securely for future KYC needs
