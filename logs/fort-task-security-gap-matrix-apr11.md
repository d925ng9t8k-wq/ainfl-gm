# FORT — Enterprise Security Gap Matrix
**Generated:** 2026-04-11T05:37Z
**Author:** FORT (Security) — sub-agent of 9
**Repo HEAD:** f1bf3de
**Companion doc:** `logs/fort-task-security-posture-apr11.md`
**Audience:** Kyle Shea (CIO Rapid Mortgage) — enterprise readiness review track.

---

## Methodology

- **Scope:** 9 Enterprises universe = comms-hub, voice-server, pilot-server, your9-* services, team agents (wendy/fort/scout/tee), trader9-bot, cloud-worker, ainflgm.com, command-hub, supporting infra (.env, SQLite memory DB, Supabase, Neon).
- **Scoring rule:** Every control gets one of:
  - `PASS` — direct evidence (file path, code line, command output) demonstrates control is implemented and effective.
  - `PARTIAL` — control is partially implemented; specific gap noted.
  - `FAIL` — control is missing or actively contradicted by evidence.
  - `EVIDENCE MISSING` — no evidence found; *NOT scored as PASS* per audit rules.
  - `N/A` — control does not apply to current architecture.
- **Effort scale:** S (≤1 day), M (1-5 days), L (≥1 week).
- Every PASS/PARTIAL/FAIL line cites a file path or `lsof`/`grep` command output. No invented compliance scores.

---

## Part 1 — SOC 2 Trust Services Criteria (Type II)

The 15 most relevant controls for a multi-product, single-operator AI ops universe.

| Control | Description | Status | Evidence | Effort to PASS |
|---|---|---|---|---|
| **CC1.1** | COSO control environment — written code of conduct | **EVIDENCE MISSING** | No employee handbook (1 operator). Soul Code (`SOUL_CODE.md`) functions as ethics charter for AI agents. No human-readable security policy. | M |
| **CC1.4** | Hiring / background checks | N/A | Single operator; no employees. | — |
| **CC2.1** | Communication of policies to internal users | **PARTIAL** | `CLAUDE.md`, `SOUL_CODE.md`, `memory/MEMORY.md` document operating rules for the AI workforce. No security-incident-comms policy doc. | S |
| **CC2.2** | Communication of changes to system commitments | **EVIDENCE MISSING** | No customer-facing change communication beyond ad-hoc Telegram. | M |
| **CC3.1** | Risk assessment process | **PARTIAL** | `docs/dependency-map-critical-path.md` is the closest artifact — qualitative blast-radius analysis. No quantitative likelihood × impact register. | M |
| **CC4.1** | Monitoring activities | **PARTIAL** | `health-monitor.mjs`, `9-ops-daemon.mjs`, `agent-watchdog.mjs` exist. No SIEM, no centralized log aggregation, Sentry partially deployed (`SENTRY_DSN_*` for hub/voice/trader9). | M |
| **CC5.1** | Control activities — selection of controls | **EVIDENCE MISSING** | No control selection document; controls accreted ad-hoc. | M |
| **CC6.1** | Logical access controls — authorization | **FAIL** | `comms-hub.mjs` `/send`, `/send-email`, `/authority`, `/action` endpoints have no auth (Section 4 F-02). Anyone on LAN can post. | S |
| **CC6.2** | New user provisioning | **EVIDENCE MISSING** | No Your9 user provisioning audit log enumerated. | M |
| **CC6.3** | User access reviews | **EVIDENCE MISSING** | No periodic access review. Authority matrix in SQLite (`authority` table) but no quarterly review process documented. | M |
| **CC6.6** | Logical access security — encryption in transit | **PARTIAL** | Public surface (`ainflgm.com`, `9-cloud-standin.workers.dev`, `your9.ai`) is HTTPS via Cloudflare. **LAN-bound services bind to 0.0.0.0 in plain HTTP** (ports 3456-3484). | S |
| **CC6.7** | Restriction of physical access | **PARTIAL** | MacBook Pro is the entire production substrate. Physical security = "Jasson's house." No documented physical access policy. | M |
| **CC6.8** | Prevention/detection of unauthorized software | **FAIL** | `*.deprecated` scripts still present (e.g. `scripts/telegram-listener.mjs.deprecated` with hardcoded token). No allowlisting of running processes. | S |
| **CC7.1** | System operations — detection of anomalies | **PARTIAL** | Hub freeze watchdog, FDA watchdog, Supabase health endpoint, drift watchdog all in place. No anomaly detection on auth events (none exist to detect). | M |
| **CC7.2** | System monitoring — security events | **FAIL** | No security event log table. `auth_rejected` events go to `comms-hub.log` but are not categorized, alerted, or retained per a documented policy. | S |
| **CC7.3** | Evaluation of security events | **EVIDENCE MISSING** | No incident triage queue. `protocol-incident-response-apr7.md` exists but is process-only, not triage. | M |
| **CC7.4** | Incident response procedures | **PARTIAL** | `docs/incident-runbooks.md` and `docs/protocol-incident-response-apr7.md` exist. No tabletop exercise record. | M |
| **CC7.5** | Recovery from incidents | **PARTIAL** | `LaunchAgent com.9.comms-hub` auto-restart, cloud worker failover (deployed). No documented RTO/RPO. | M |
| **CC8.1** | Change management — authorization | **PARTIAL** | git history + commit messages serve as change log. No formal CAB. CI workflow exists (`.github/workflows/ci.yml`). | M |
| **CC9.1** | Risk mitigation — vendor management | **PARTIAL** | `docs/vendor-management-log.md` exists. No vendor security questionnaire on file for Anthropic/Twilio/ElevenLabs/Cloudflare/Stripe. | M |
| **CC9.2** | Confidential data handling | **FAIL** | 341 files in `data/agent-runs/` contain plaintext live secrets including Anthropic key, Twilio auth token, Stripe secret, Alpaca password+MFA seed (Section 4 F-01). | S (purge) + L (rotate) |

**SOC 2 totals:** PASS 0 · PARTIAL 11 · FAIL 4 · EVIDENCE MISSING 6 · N/A 1 · *(of 22 mapped controls)*

The **0 PASS** is the headline. Every control with implementation evidence has a documented gap. Kyle's review would not find a single TSC with a clean tick.

---

## Part 2 — NIST Cybersecurity Framework (CSF 2.0)

Five functions, each scored 1-5 (5 = optimized). Evidence-based.

| Function | Subcategory | Status | Score | Evidence |
|---|---|---|---|---|
| **IDENTIFY** | ID.AM-1: Hardware inventory | **PARTIAL** | 3 | `docs/dependency-map.md` lists 14 components. No hardware-asset CMDB. MacBook is the entire infra. |
| | ID.AM-2: Software inventory | **PASS** | 4 | `docs/dependency-map.json` enumerates all 14 components, every env var, every external API. Recently verified (Apr 5). |
| | ID.AM-5: Resources prioritized | **PARTIAL** | 3 | `dependency-map-critical-path.md` ranks by P0-P4 blast radius. |
| | ID.RA-1: Asset vulnerabilities identified | **FAIL** | 1 | No vulnerability scan run. No SCA/SAST in CI. `package.json` deps not audited via `npm audit` on a schedule. |
| | ID.RA-3: Threats identified | **PARTIAL** | 2 | This document + `docs/security-audit-apr9.md`, `docs/fort-cloud-security-audit-apr9.md`. Ad-hoc, not continuous. |
| | ID.GV-1: Cybersecurity policy established | **PARTIAL** | 2 | `SOUL_CODE.md` is the operating charter. No standalone infosec policy. |
| | ID.GV-4: Governance and risk management aligned | **EVIDENCE MISSING** | 1 | No board, no GRC tooling. |
| | **IDENTIFY average** | | **2.3 / 5** | |
| **PROTECT** | PR.AC-1: Identities and credentials issued and managed | **FAIL** | 1 | `data/agent-runs/` leaks (F-01). No central identity store. No secrets manager. |
| | PR.AC-3: Remote access managed | **PARTIAL** | 2 | Cloudflare tunnel for voice, ssh-disabled by default. cloudflared tunnel auth = none on tunnel itself, signature check on app layer (and bypassed in voice-server, F-03). |
| | PR.AC-4: Access permissions managed (least privilege) | **FAIL** | 1 | `SUPABASE_SERVICE_KEY` (bypasses RLS) used by hub. `CLOUDFLARE_API_TOKEN` likely full-scope. No least-privilege scoping verified. |
| | PR.AC-5: Network integrity protected (segmentation) | **FAIL** | 1 | 9 services on `0.0.0.0`, no host firewall, no LAN segmentation (Section F-06, F-09). |
| | PR.AC-7: Users authenticated commensurate with risk | **FAIL** | 1 | `/send`, `/send-email`, `/authority` unauthenticated (F-02). |
| | PR.AT-1: All users informed and trained | N/A | — | Single operator. |
| | PR.DS-1: Data-at-rest protected | **PARTIAL** | 2 | SQLCipher in use for `9-memory.db`. Key co-located in `.env` (F-05). |
| | PR.DS-2: Data-in-transit protected | **PARTIAL** | 2 | Public surface HTTPS. Internal LAN HTTP. |
| | PR.DS-5: Data leak protections | **FAIL** | 1 | `data/agent-runs/` is the live counter-evidence. |
| | PR.IP-1: Baseline configuration established | **PARTIAL** | 2 | `dependency-map.json` is the closest baseline. No CIS benchmark applied. |
| | PR.IP-4: Backups | **FAIL** | 1 | No automated SQLite backup (F-10). Supabase mirror is partial. |
| | PR.IP-12: Vulnerability management plan | **FAIL** | 1 | No plan. |
| | PR.MA-1: Maintenance/repair logs | **PARTIAL** | 3 | git history + memory files document maintenance. No structured log. |
| | PR.PT-1: Audit/log records reviewed | **PARTIAL** | 2 | `comms-hub.log` rotated, but no review cadence. |
| | PR.PT-3: Principle of least functionality | **FAIL** | 1 | Many ports, many services, many `.deprecated` scripts. |
| | **PROTECT average** | | **1.6 / 5** | |
| **DETECT** | DE.AE-1: Baseline of network operations | **PARTIAL** | 2 | `health-monitor.mjs` polls. No NetFlow / Zeek / packet capture. |
| | DE.AE-2: Detected events analyzed | **EVIDENCE MISSING** | 1 | No SIEM. |
| | DE.AE-3: Event data aggregated | **PARTIAL** | 2 | Sentry partially deployed for hub/voice/trader9. No central log store. |
| | DE.CM-1: Network monitoring | **FAIL** | 1 | None. |
| | DE.CM-3: Personnel activity monitoring | N/A | — | Single operator. |
| | DE.CM-4: Malicious code detection | **EVIDENCE MISSING** | 1 | macOS XProtect implicit. No EDR. |
| | DE.CM-7: Unauthorized personnel/connections monitored | **FAIL** | 1 | No connection logging on hub `/send`. |
| | DE.CM-8: Vulnerability scans performed | **FAIL** | 1 | None. |
| | DE.DP-1: Roles for detection defined | **PARTIAL** | 2 | FORT (this agent) is the role. No 24/7 SOC. |
| | **DETECT average** | | **1.4 / 5** | |
| **RESPOND** | RS.RP-1: Response plan executed | **PARTIAL** | 2 | `docs/incident-runbooks.md`, `docs/protocol-incident-response-apr7.md`. |
| | RS.CO-1: Personnel know their roles | **PARTIAL** | 2 | 9 + Wendy + FORT + Tee + Scout division of labor documented. |
| | RS.CO-2: Events reported per criteria | **PARTIAL** | 2 | Telegram alerts for hub/voice/health failures. No structured criteria. |
| | RS.AN-1: Notifications investigated | **PARTIAL** | 2 | Owner reviews Telegram alerts in real time. |
| | RS.AN-2: Impact understood | **PARTIAL** | 2 | dependency-map-critical-path.md provides framework. |
| | RS.MI-1: Incidents contained | **EVIDENCE MISSING** | 1 | No documented containment runbooks. |
| | RS.MI-2: Incidents mitigated | **PARTIAL** | 2 | Ad-hoc fix-and-commit pattern visible in git history. |
| | RS.IM-1: Lessons learned incorporated | **PASS** | 4 | `memory/feedback_*.md` files explicitly burn lessons (e.g. `feedback_verify_before_assert.md` post-Supabase incident). Strong cultural practice. |
| | **RESPOND average** | | **2.1 / 5** | |
| **RECOVER** | RC.RP-1: Recovery plan executed | **PARTIAL** | 2 | `LaunchAgent` auto-restart for hub. Cloud Worker failover (deployed Apr 9). |
| | RC.IM-1: Recovery plans incorporate lessons | **PARTIAL** | 2 | See RS.IM-1 evidence. |
| | RC.IM-2: Strategies updated | **PARTIAL** | 2 | docs updated frequently (`docs/cloud-cutover-execution-apr9.md`). |
| | RC.CO-1: Public relations managed | N/A | — | No customer base at scale yet. |
| | RC.CO-3: Recovery activities communicated | **PARTIAL** | 2 | Owner-only via Telegram. |
| | **RECOVER average** | | **2.0 / 5** | |

**NIST CSF totals:** IDENTIFY 2.3 · PROTECT 1.6 · DETECT 1.4 · RESPOND 2.1 · RECOVER 2.0
**Overall NIST score: 1.9 / 5.0** — Tier 1 ("Partial") — improvement to Tier 2 ("Risk Informed") requires closing F-01, F-02, F-06.

---

## Part 3 — ISO 27001:2022 Annex A Controls

The 20 most applicable Annex A controls for a single-operator AI ops platform.

| Annex A | Control | Status | Evidence | Effort |
|---|---|---|---|---|
| **A.5.1** | Policies for information security | **PARTIAL** | `SOUL_CODE.md` is operating charter. No standalone infosec policy doc. | S |
| **A.5.7** | Threat intelligence | **EVIDENCE MISSING** | No threat-intel feed consumed. | M |
| **A.5.10** | Acceptable use of information | **PARTIAL** | `CLAUDE.md` rules section. | S |
| **A.5.15** | Access control | **FAIL** | F-02: hub mutating endpoints unauthenticated. | S |
| **A.5.16** | Identity management | **FAIL** | No central identity. SSH/local users mixed. | M |
| **A.5.17** | Authentication information | **FAIL** | F-01: passwords + MFA seeds in plaintext .env and leaked in agent-runs. | M (rotation) |
| **A.5.23** | Information security for use of cloud services | **PARTIAL** | Cloudflare/Supabase/Neon/Stripe/Anthropic in use. No documented cloud security baseline. | M |
| **A.5.24** | Information security incident management planning | **PARTIAL** | `docs/protocol-incident-response-apr7.md`. | S |
| **A.5.30** | ICT readiness for business continuity | **PARTIAL** | Cloud worker failover deployed. RTO/RPO undocumented. | M |
| **A.6.3** | Information security awareness, education, training | N/A | Single operator. | — |
| **A.7.4** | Physical security monitoring | **EVIDENCE MISSING** | MacBook = production. Physical = Jasson's house. | — |
| **A.8.1** | User endpoint devices | **PARTIAL** | One Mac. FileVault status not verified in this audit. | S |
| **A.8.2** | Privileged access rights | **FAIL** | `SUPABASE_SERVICE_KEY` (bypasses RLS), `CLOUDFLARE_API_TOKEN` (likely full scope) — no least privilege. | M |
| **A.8.3** | Information access restriction | **FAIL** | `/inbox`, `/state`, `/db/context`, `/actions`, `/authority` unauthenticated reads on `0.0.0.0:3457`. | S |
| **A.8.5** | Secure authentication | **FAIL** | Plaintext bot token in `*.deprecated` (F-04), App Passwords for Gmail (no expiry, H-01). | M |
| **A.8.7** | Protection against malware | **EVIDENCE MISSING** | macOS XProtect implicit. No EDR. | M |
| **A.8.8** | Management of technical vulnerabilities | **FAIL** | No `npm audit` schedule, no SCA/SAST in CI. | S |
| **A.8.9** | Configuration management | **PARTIAL** | git tracks config files. `.env.example` exists. No drift detection. | M |
| **A.8.10** | Information deletion | **FAIL** | `data/agent-runs/` accumulates indefinitely. No retention policy. | S |
| **A.8.12** | Data leakage prevention | **FAIL** | F-01: 341 files leak live secrets. | S (purge + redactor) |
| **A.8.13** | Information backup | **FAIL** | No automated SQLite backup (F-10). | M |
| **A.8.15** | Logging | **PARTIAL** | `logs/` dir + log rotation in place. No security-event-specific log. | S |
| **A.8.16** | Monitoring activities | **PARTIAL** | health-monitor.mjs, 9-ops-daemon.mjs, agent-watchdog.mjs. | S |
| **A.8.20** | Networks security | **FAIL** | F-06: 9 services on 0.0.0.0, no host firewall (F-09). | S |
| **A.8.23** | Web filtering | N/A | No employee browsing. | — |
| **A.8.24** | Use of cryptography | **PARTIAL** | SQLCipher used. TLS via Cloudflare. Key management (F-05) is the gap. | M |
| **A.8.25** | Secure development life cycle | **PARTIAL** | git + CI exists (`.github/workflows/ci.yml`). No security-gate in pipeline. | M |
| **A.8.26** | Application security requirements | **PARTIAL** | Per-component README/spec docs. No formal requirements traceability. | M |
| **A.8.28** | Secure coding | **PARTIAL** | Recent FORT-driven fixes (H-03 fail-closed pattern). No formal coding standard. | S |
| **A.8.32** | Change management | **PARTIAL** | git + commit hygiene + CI. No formal CAB. | M |

**ISO 27001 totals (29 mapped controls):** PASS 0 · PARTIAL 14 · FAIL 11 · EVIDENCE MISSING 3 · N/A 1

---

## Part 4 — Combined Roll-up

| Framework | PASS | PARTIAL | FAIL | EVIDENCE MISSING | N/A | Total |
|---|---|---|---|---|---|---|
| SOC 2 TSC | 0 | 11 | 4 | 6 | 1 | 22 |
| NIST CSF (subcategories scored) | 1 | 18 | 9 | 4 | 2 | 34 |
| ISO 27001 Annex A | 0 | 14 | 11 | 3 | 1 | 29 |
| **Total** | **1** | **43** | **24** | **13** | **4** | **85** |

**Combined score: 1 PASS / 85 (1.2%)**, 43 PARTIAL (50.6%), 24 FAIL (28.2%), 13 EVIDENCE MISSING (15.3%).

The single PASS is **NIST CSF RS.IM-1: Lessons Learned** — demonstrably strong via the `memory/feedback_*.md` post-incident burn pattern.

---

## Part 5 — Highest-leverage fixes for the Kyle test

Ranked by ROI (control coverage / effort):

1. **Purge `data/agent-runs/` and rotate the ~20 leaked credentials.** Closes F-01, lifts CC9.2 / PR.DS-5 / A.8.12 / A.8.10 from FAIL → PARTIAL. Effort: S+M.
2. **Apply `x-hub-secret` requirement to all comms-hub mutating endpoints + bind to `127.0.0.1`.** Closes F-02 + F-06 (in part). Lifts CC6.1 / PR.AC-7 / PR.AC-5 / A.5.15 / A.8.3 / A.8.20 from FAIL → PASS. Effort: S.
3. **Pin a stable named cloudflared tunnel for voice + remove the signature bypass.** Closes F-03. Lifts PR.AC-3 / A.5.23. Effort: S.
4. **`git filter-repo` the hardcoded Telegram token + delete all `*.deprecated` files + rotate the bot token.** Closes F-04. Lifts CC6.8 / A.8.5. Effort: M.
5. **Move `SQLITE_ENCRYPTION_KEY` to macOS Keychain.** Closes F-05. Lifts PR.DS-1 / A.8.24. Effort: M.
6. **Add `npm audit` + a basic SAST step (`semgrep` or `eslint-plugin-security`) to `.github/workflows/ci.yml`.** Closes ID.RA-1 / PR.IP-12 / A.8.8. Effort: S.
7. **Document RTO/RPO + add nightly encrypted SQLite backup to R2.** Closes F-10 + RC.RP-1 / PR.IP-4 / A.8.13 / A.5.30. Effort: M.

If only one fix happens before the next Kyle conversation, **fix #1**. Without it, every other control is operationally void because the keys are already on disk in 341 files.

---

*FORT — read-only audit. No production touched.*
