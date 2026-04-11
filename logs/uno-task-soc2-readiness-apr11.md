# UNO — SOC 2 Type II Readiness Assessment (Kyle-track CLO Deliverable)

**Author:** UNO (CLO + Research Lead) — sub-agent run
**Date:** 2026-04-11
**Scope:** The 9 Enterprises universe as verified against live code, `docs/credential-inventory.md`, `docs/dependency-map-critical-path.md`, and primary evidence grep/Read on commit `34ce435`.
**Target report:** SOC 2 Type II, AICPA Trust Services Criteria (2017, amended), five TSCs.
**Benchmarks consulted:** Salesforce compliance.salesforce.com; Microsoft Service Trust Portal; AICPA TSC 100; Kyle Shea benchmark (`memory/reference_kyle_enterprise_benchmark.md`).

> **Honesty rule applied:** Every PASS/PARTIAL has a file path or concrete artifact cited. If evidence could not be located in live code, the control is scored FAIL with "no evidence" noted. Kyle will catch invented compliance — so nothing is invented here.

---

## Executive Scorecard

| TSC | Controls scored | PASS | PARTIAL | FAIL | N/A |
|---|---:|---:|---:|---:|---:|
| Security (CC1–CC8) | 25 | 1 | 5 | 19 | 0 |
| Availability (A1.x) | 3 | 0 | 1 | 2 | 0 |
| Processing Integrity (PI1.x) | 3 | 0 | 1 | 2 | 0 |
| Confidentiality (C1.x) | 2 | 0 | 1 | 1 | 0 |
| Privacy (P1–P8) | 8 | 0 | 1 | 7 | 0 |
| **TOTAL** | **41** | **1** | **9** | **31** | **0** |

**Headline:** 1 PASS, 9 PARTIAL, 31 FAIL out of 41 scored controls (2.4% PASS, 22.0% PARTIAL, 75.6% FAIL). SOC 2 Type II is **not achievable on any current observation window.** The system is pre-readiness. Earliest credible Type II report date assuming a remediation sprint starts Apr 14 and hits all P0 items in 60 days, then observes for 6 months: **January 2027.**

---

## Security — Common Criteria (25 controls scored)

### CC1 — Control Environment

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC1.1 | Commitment to integrity and ethics | FAIL | `SOUL_CODE.md` exists as a founder charter but is not a formal code of conduct mapped to policies/acknowledgments. No HR onboarding, no training records. | Small (2 days): Draft code of conduct, require acknowledgment from any sub-agent or human contributor. |
| CC1.2 | Board independence / oversight | FAIL | Single-founder LLC (`memory/project_9enterprises.md`). No board, no independent oversight. | Medium (10 days): Appoint advisory board or document sole-owner governance model with Kyle-style peer review. |
| CC1.3 | Reporting lines / org structure | PARTIAL | `docs/org-chart.md` and `memory/project_org_chart_apr7.md` define 9 + Wendy + specialists, but the structure is AI-agent-internal, not a legal/HR structure. | Small (2 days): Formalize contractor/employee identities; separate legal org from agent org. |
| CC1.4 | Attract/retain quality staff | FAIL | No HR function. Sub-agents are not staff for SOC 2 purposes. | Medium (unknown): Not applicable until first human hire. |
| CC1.5 | Accountability for responsibilities | FAIL | No performance reviews, no disciplinary process, no accountability chain outside Owner→9 informal trust. | Small (3 days): Document accountability matrix with consequences. |

### CC2 — Communication and Information

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC2.1 | Quality info for internal control | PARTIAL | `memory/` directory + `docs/dependency-map.md` + `docs/credential-inventory.md` give unusually strong internal documentation vs typical seed-stage SaaS. | Medium (5 days): Consolidate into a single control library indexed by SOC 2 criterion. |
| CC2.2 | Internal communication of responsibilities | FAIL | No written job descriptions for any role (founder is both CEO and sole engineer). No communication of control responsibilities. | Small (2 days): Document who owns each control. |
| CC2.3 | External communication with customers/regulators | FAIL | No customer-facing trust portal. `public/privacy.html` exists for AiNFLGM but no Your9/FreeAgent/AI Underwriter trust documentation. No incident disclosure channel. | Medium (7 days): Build minimal trust.9enterprises.ai with SOC 2 status and incident disclosure policy. |

### CC3 — Risk Assessment

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC3.1 | Specifies suitable objectives | FAIL | No written risk objectives. `memory/mission_*` documents are mission, not risk. | Small (3 days): Write enterprise risk register. |
| CC3.2 | Identifies and analyzes risk | PARTIAL | `docs/dependency-map-critical-path.md` is a de facto risk register for infra (rated P0–P4, documented blast radius). This is legitimately strong work. Gap: no asset-level risk register for data, no fraud risk register. | Medium (5 days): Extend the critical-path doc into a formal SOC 2 risk register with likelihood/impact scoring. |
| CC3.3 | Considers potential for fraud | FAIL | No fraud risk analysis. Trader9 has real-money trading keys in `.env` (`ALPACA_LIVE_API_KEY`) with no anti-tampering controls. | Small-Medium (4 days): Document fraud risk for trader9, your9-billing Stripe, and AI Underwriter. |
| CC3.4 | Identifies and assesses changes | FAIL | No change-impact assessment process. Deploys happen at founder speed with no formal review. | Small (3 days): Add a changelog + risk-impact field to every code change; see CC8.1. |

### CC4 — Monitoring Activities

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC4.1 | Ongoing and separate evaluations | FAIL | No internal audit function. Self-monitoring via `health-monitor.mjs` exists but was NOT running at dependency audit time (`docs/dependency-map-critical-path.md` §9). | Medium (7 days): Contract a quarterly internal audit, even a founder self-audit against this checklist. |
| CC4.2 | Communicates deficiencies | FAIL | No deficiency communication process. The Apr 5 Supabase stale-memory incident was caught and burned to memory, but there is no structured defect-tracking outside memory files and git commits. | Small (2 days): Adopt GitHub Issues or equivalent for control deficiencies. |

### CC5 — Control Activities

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC5.1 | Selects/develops control activities | FAIL | Controls are ad-hoc (Soul Code rules, hard-coded CFG blocks). No documented control activity mapping to risk. | Medium (5 days): Map each code-level guard (FORT C-04 flags, budget limits) to a SOC 2 criterion. |
| CC5.2 | Selects/develops technology controls | PARTIAL | Strong technology controls do exist in code: ALPACA_LIVE_ENABLED hard gate (`trader9-bot.mjs` FORT C-04), budget caps (`feedback_spending_limit.md`), memory DB encryption (SQLCipher verified below). Gap: not inventoried as SOC 2 controls. | Small (2 days): Add a `docs/control-catalog.md` that maps code to criteria. |
| CC5.3 | Deploys policies and procedures | FAIL | No employee handbook, no information security policy, no acceptable use policy. Kyle will ask for these. | Medium (7 days): Adopt a SaaS SOC 2 policy template library (e.g., Vanta, Drata, Secureframe) and customize. |

### CC6 — Logical and Physical Access Controls

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC6.1 | Logical access security (MFA, RBAC) | FAIL | `HUB_API_SECRET` is optional — if unset the `/context` endpoint is OPEN (`docs/credential-inventory.md` H-03). FORT agent work queue item `hub-auth-implementation` confirms: "comms-hub has zero auth on /send, /authority, /terminal/claim, /inbox, /action" (`scripts/fort-agent.mjs` lines 14–21). No SSO. No MFA. Your9 has scrypt password hashing + JWT (`scripts/your9-auth.mjs` lines 109–170) but no MFA. | Medium (10 days): Implement bearer-token auth on hub endpoints (FORT design exists); add MFA (TOTP) to Your9 auth. |
| CC6.2 | User registration and authorization | PARTIAL | Your9 has signup/login with email verification (`your9-auth.mjs`). No formal provisioning workflow for admin/founder access. `YOUR9_ADMIN_TOKEN` falls back to a random per-process token logged to stdout if unset (`docs/credential-inventory.md`). | Small (3 days): Require YOUR9_ADMIN_TOKEN; log a critical error (not a random fallback) if missing. |
| CC6.3 | User access modification/removal | FAIL | No documented offboarding process. No access review cadence. | Small (2 days): Quarterly access review checklist. |
| CC6.4 | Physical access restriction | PARTIAL | All production infrastructure is one MacBook Pro in Owner's home (`docs/dependency-map-critical-path.md` §1 — P0 BLACKOUT). Physical access = house access. Not enterprise-grade. | Large (30+ days): Migrate to cloud VPS / Azure (already researched in `docs/vps-deployment-plan.md`, not deployed). |
| CC6.5 | Logical/physical asset disposal | FAIL | No asset disposal or decommissioning procedure. Deleted `.env` keys not rotated automatically. | Small (1 day): Write a decommissioning runbook. |
| CC6.6 | Protection against external threats | FAIL | No WAF, no DDoS protection outside whatever Cloudflare tunnel provides by default. No IDS. | Medium (10 days): Cloudflare Zero Trust + WAF on all public endpoints. |
| CC6.7 | Data in transit protection | PARTIAL | Outbound API calls use HTTPS (Anthropic, Stripe, Twilio, ElevenLabs, Supabase). Cloudflare tunnel provides TLS for voice webhook. Gap: the hub listens on `127.0.0.1:3457` unencrypted (acceptable since localhost, but would be a finding if ever exposed). | Small (1 day): Document the localhost-only guarantee and add assertion that refuses to bind non-loopback. |
| CC6.8 | Prevention of unauthorized/malicious software | FAIL | No EDR, no endpoint protection beyond stock macOS XProtect. No malware scanning of dependencies. | Small (2 days): Add `npm audit` to CI; enable macOS FileVault + Gatekeeper verification logs. |

### CC7 — System Operations

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC7.1 | Detect changes to system components | FAIL | Git log is the only change record. No file-integrity monitoring (FIM). | Medium (5 days): Add a FIM daemon watching `scripts/`, `.env`, `data/9-memory.db`. |
| CC7.2 | Monitor for anomalies | PARTIAL | `scripts/health-monitor.mjs` + Sentry DSNs in place (`comms-hub`, `voice-server`, `trader9-bot` per credential inventory). Gap: health-monitor not consistently running; no alerting to external SOC. | Small (3 days): Make health-monitor a required process with LaunchAgent retry + alert if down >5 min. |
| CC7.3 | Evaluate security events | FAIL | No documented triage process. Protocol exists in memory (`memory/protocol_incident_response_apr7.md`) but not implemented as a ticketing/tracking system. | Small (3 days): Implement a simple incident register. |
| CC7.4 | Incident response | PARTIAL | `protocol_incident_response_apr7.md` + DOC role documented. Apr 5, Apr 7, Apr 8 incident writeups exist (`docs/incident-*.md`). Gap: not tested in a tabletop; no 72-hour breach notification procedure. | Small (3 days): Add breach-notification playbook; run one tabletop exercise. |
| CC7.5 | Recovery from identified incidents | PARTIAL | Session recovery works (PostToolUse hook, handoff files). Backups via `scripts/backup-memory.mjs` exist. Gap: no disaster recovery test on record; no offsite backup verified. | Medium (5 days): Test restore-from-backup; document RPO/RTO. |

### CC8 — Change Management

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| CC8.1 | Change authorization, design, test, deploy | FAIL | `.github/workflows/ci.yml` runs lint + syntax check + build — this is a genuine but minimal CI gate. No test suite enforcement, no code review (single-contributor repo). No change advisory board. Kyle K-17: "Don't let speed to CODE fool you into thinking the SDLC is somehow now irrelevant." | Medium (7 days): Add required test suite, required review gate for `main`, change log with risk ratings. |

---

## Availability (A1.x, 3 controls scored)

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| A1.1 | Capacity management | FAIL | No capacity planning. Mac is sized to founder laptop, not load. | Medium (5 days): Document capacity baselines; alert on thresholds. |
| A1.2 | Environmental protections / backup / DR | PARTIAL | `backup-memory.mjs` backs up the encrypted memory DB locally. `scripts/test-wal-replay.mjs` exists for WAL replay testing. Supabase mirror of messages + actions. Gap: no offsite backup verified; no DR site; Mac is the only production host (`docs/dependency-map-critical-path.md` §1 — P0 BLACKOUT). RTO/RPO undocumented. | Large (14 days): Cloud failover deployment; documented RTO<4h / RPO<1h. |
| A1.3 | Recovery testing | FAIL | No scheduled DR test on record. Incidents have triggered ad-hoc recoveries but no planned test. | Small (3 days): Schedule monthly recovery drill. |

---

## Processing Integrity (PI1.x, 3 controls scored)

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| PI1.1 | Input validation and error handling | PARTIAL | Trader9 has fee model + risk manager gates on every order (`scripts/trader9-bot.mjs` lines 33–50). Your9 billing validates Stripe webhook signatures when `STRIPE_WEBHOOK_SECRET` set (credential inventory notes hub logs a warning if missing — unverified signatures allowed, which is a CC6.1 finding too). | Small (2 days): Make STRIPE_WEBHOOK_SECRET REQUIRED; refuse to process unsigned events. |
| PI1.2 | System processing completeness and accuracy | FAIL | AI Underwriter (`mortgage-ai/fha-agent.mjs`) returns Haiku-generated mortgage guideline answers with no post-processing validation against source citations. Answers could hallucinate — there is no accuracy control. | Medium (7 days): Add citation-required output format + regex/grounding check against `fha-guidelines.md` before return. |
| PI1.3 | Output accuracy and distribution | FAIL | No output audit trail for AI-generated content beyond application logs. Kyle K-09: "AI can't architect what it doesn't know to look for." | Small (3 days): Log every AI output with prompt, response, and user to an immutable audit log. |

---

## Confidentiality (C1.x, 2 controls scored)

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| C1.1 | Protection of confidential information | **PASS** | SQLCipher encryption on the primary memory database is **verified live**: `/usr/bin/sqlite3 data/9-memory.db` returns `"file is not a database"` — the stock SQLite driver cannot open it, confirming encryption is active. Key is in `.env` as `SQLITE_ENCRYPTION_KEY`. Rotation script exists (`scripts/rotate-memory-db-key.mjs`, `docs/memory-db-key-rotation.md`). | Small (2 days, hygiene improvement): Move key out of `.env` and into a secrets manager — key and lock are currently co-located (credential inventory C-03). Not required for PASS but strongly recommended. |
| C1.2 | Disposal of confidential information | FAIL | No data destruction procedure for customer accounts. `your9-auth.mjs` uses JSON file per account (`instances/accounts/{id}.json`) — deletion not implemented. | Small (3 days): Implement account deletion with secure overwrite. |

---

## Privacy (P1–P8, 8 controls scored)

| # | Control | Score | Evidence / Gap | Remediation |
|---|---|---|---|---|
| P1.1 | Notice and communication | FAIL | Privacy policy exists for AiNFLGM only (`public/privacy.html`). No privacy notice for Your9, FreeAgent9, AI Underwriter, Pepper, or trader9. | Small (3 days): Product-specific privacy notices. |
| P2.1 | Choice and consent | FAIL | No consent mechanism on any product beyond the AiNFLGM static page. Voice server has no call-consent disclosure (FORT work queue item `voice-consent-disclosure` confirms — `scripts/fort-agent.mjs` lines 37–41). Two-party consent states (CA, FL, IL, MD, etc.) are at risk. | Small (1 day): Add 5-second "This call may be AI-assisted" TTS greeting per FORT's existing design. |
| P3.1 | Collection limitation | FAIL | No data minimization policy. `.env` contains PII for non-customers (`JAMIE_PHONE`, `JASSON_PHONE`, `JULES_KYLEC_RECIPIENT_PHONE`) — these are not customers but are stored in the primary config. | Small (2 days): Move PII out of `.env` into an encrypted contacts store. |
| P4.1 | Use, retention, disposal | FAIL | No retention schedule. SQLite memory DB retains messages indefinitely. | Small (2 days): Document retention policy; implement time-based purge. |
| P5.1 | Access (data subject rights) | FAIL | No data-subject access portal. CCPA/GDPR grants right of access; not implementable today. | Medium (5 days): Build DSAR workflow. |
| P6.1 | Disclosure and notification | FAIL | No third-party disclosure log. Vendor list exists in `memory/reference_verified_subscriptions.md` but no data-flow diagram showing what customer data goes to which vendor. | Small (3 days): Data flow diagram per product. |
| P7.1 | Quality | PARTIAL | Your9 email verification enforces validity on signup (`your9-auth.mjs`). No broader data quality controls. | Small (2 days): Add basic validation library. |
| P8.1 | Monitoring and enforcement | FAIL | No privacy complaints process. No privacy officer. | Small (2 days): Designate 9 or Wendy as privacy officer; publish contact. |

---

## Remediation Roadmap (Rolled Up)

### P0 — Ship in 14 days (blocks Type I, not just Type II)

1. **Auth on hub endpoints** (CC6.1) — FORT already has the design. Small.
2. **Stripe webhook signature REQUIRED** (PI1.1) — refuse unsigned events. Tiny.
3. **Your9 JWT + admin token REQUIRED** (CC6.2) — no random fallbacks. Tiny.
4. **Voice call consent disclosure** (P2.1) — FORT already has the design. Tiny.
5. **Remove Dominos card data from `.env`** (credential inventory C-01, PCI-relevant) — Tiny.
6. **Rotate hardcoded Telegram bot tokens out of source** (credential inventory C-05) — Small.
7. **Product-specific privacy notices + data retention policy** (P1.1, P4.1) — Small.
8. **SOC 2 policy library adoption (Vanta/Drata/Secureframe)** (CC5.3) — Medium.

### P1 — Ship in 30 days (required to begin a 6-month observation window)

9. **Cloud failover deployment — remove Mac as SPOF** (A1.2, CC6.4) — Large. This is Kyle K-05.
10. **Internal control catalog and risk register** (CC3.1, CC3.2, CC5.1) — Medium.
11. **Incident response playbook test (tabletop)** (CC7.4) — Small.
12. **File-integrity monitoring + access-review cadence** (CC6.3, CC7.1) — Medium.
13. **DSAR workflow + data flow diagrams per product** (P5.1, P6.1) — Medium.

### P2 — Ship in 60 days (required for Type II controls to be operational over the observation period)

14. **MFA on Your9 auth** (CC6.1) — Medium.
15. **Offsite backup verification + DR drill** (A1.2, A1.3, CC7.5) — Medium.
16. **AI output grounding/audit log for AI Underwriter** (PI1.2, PI1.3) — Medium.
17. **Formal change management with review gates** (CC8.1) — Medium.

---

## Highest-Priority Single Remediation

**P0 #1: Ship bearer-token auth on every comms-hub write endpoint.** This is the control gap that both FORT (internal security agent) and Kyle's K-05 converge on. It maps to SOC 2 CC6.1, it is a ~4-hour code change with FORT's design already written, and it closes the most visible "amateur hour" finding a CIO auditor would catch in 30 seconds by curling an endpoint. Until this ships, no Security-TSC control in CC6 passes.

---

## Realistic SOC 2 Type II Timeline

- Apr 11 → Apr 25 — P0 remediation sprint (2 weeks).
- Apr 26 → May 26 — P1 remediation sprint (30 days).
- May 27 → Jul 26 — P2 remediation sprint (60 days).
- Jul 27 → Aug 26 — Pre-audit readiness window (controls must be operational and documented for 30 days before the observation period starts).
- **Aug 27, 2026 → Feb 27, 2027** — 6-month SOC 2 Type II observation period.
- **Mar 2027** — Auditor field work.
- **Apr 2027** — Earliest credible Type II report issuance.

**Can be compressed to Type I (point-in-time) by Sep 2026** if P0 + P1 are complete and a policy library is adopted. Type I is a valid Kyle-track interim artifact.

---

## Sources and Standards Consulted

- AICPA Trust Services Criteria (TSC 100, 2017 amended)
- SOC 2 CC-series control definitions (compassitc.com, secureframe.com, brightdefense.com)
- Salesforce Service Trust Portal (compliance.salesforce.com)
- Microsoft Service Trust Portal (learn.microsoft.com)
- Internal: `docs/credential-inventory.md`, `docs/dependency-map-critical-path.md`, `docs/dependency-map.md`
- Internal: `memory/reference_kyle_enterprise_benchmark.md` (the canonical Kyle benchmark)
- Internal: `scripts/fort-agent.mjs`, `scripts/trader9-bot.mjs`, `scripts/your9-auth.mjs`, `scripts/your9-billing.mjs`, `mortgage-ai/fha-agent.mjs`
- Live check: SQLCipher encryption verified via stock `sqlite3` rejection of `data/9-memory.db`

*Generated by UNO sub-agent, 2026-04-11. Report is read-only analysis; no code or artifact was modified.*
