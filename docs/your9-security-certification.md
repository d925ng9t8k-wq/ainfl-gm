# Your9 Platform Security Certification

**Audit Date:** April 9, 2026
**Auditor:** 9 (AI Chief of Staff, 9 Enterprises)
**Scope:** Full codebase review of all `your9-*.mjs` scripts, instance isolation model, credential handling, data boundaries, and human override mechanisms.
**Classification:** Internal -- Founder Confidence Document

---

## Executive Summary

The Your9 platform demonstrates strong architectural security fundamentals for a v1.0 product. Per-customer isolation is enforced through filesystem-level directory separation, per-instance credentials, port isolation, and localhost-only binding. No critical vulnerabilities were found that would allow cross-customer data access in the current deployment model (single-host, localhost-only). Several areas require hardening before multi-tenant production or public-facing deployment.

**Overall Assessment:** PASS WITH CONDITIONS

**Critical findings:** 0
**Warnings requiring action:** 7
**Informational notes:** 4

---

## 1. Per-Customer Isolation (your9-provision.mjs)

### 1.1 Directory Isolation

| Item | Status | Detail |
|------|--------|--------|
| Unique customer ID (UUIDv4) | PASS | Each instance gets a `y9-{uuid}` prefix, cryptographically random via `crypto.randomUUID()`. Collision probability is negligible. |
| Isolated directory tree | PASS | Each customer gets `instances/{id}/` with subdirectories: `config/`, `data/`, `logs/`, `agents/`, `comms/`, `prompts/`. No shared data directories between customers. |
| Idempotent provisioning | PASS | Re-running provisioning with the same `--id` safely skips existing files. No data overwrites. |
| No symlinks or hardlinks | PASS | Directory creation uses `mkdirSync` with `recursive: true`. No cross-linking between instance directories. |

**Recommendation:** None. Directory isolation model is sound.

### 1.2 Credential Isolation

| Item | Status | Detail |
|------|--------|--------|
| Per-instance .env file | PASS | Each instance gets its own `config/.env` with unique tokens generated via `crypto.randomBytes(24)`. |
| Instance-specific secrets | PASS | Three unique tokens generated per instance: `YOUR9_INSTANCE_SECRET`, `YOUR9_AGENT_SECRET`, `YOUR9_WEBHOOK_SECRET`. |
| Separate Telegram bot per customer | PASS | Each instance requires its own `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_CHAT_ID`. No shared bot tokens. |
| Separate Supabase project reference | PASS | Each instance generates a unique Supabase project reference (20-char hex). |
| API key fallback to platform key | WARNING | If a customer instance does not have its own `ANTHROPIC_API_KEY`, the hub falls back to the platform-level `.env` key. This means multiple customer instances share the same Anthropic API key. |

**Recommendation:** For enterprise tier customers, enforce dedicated API keys. Add a startup warning when the platform fallback key is used. Consider per-instance API key rotation on a scheduled basis.

### 1.3 Port Isolation

| Item | Status | Detail |
|------|--------|--------|
| Unique port per instance | PASS | Port derived from `4000 + (hash(customerId) % 900)` or explicitly set in instance `.env`. |
| Localhost binding only | PASS | Hub binds to `127.0.0.1` exclusively. Never exposed externally without explicit reverse proxy configuration. |
| Port collision detection | PASS | Hub exits with `EADDRINUSE` error if port is already in use. Prevents two instances from stomping each other. |

**Recommendation:** None. Port isolation model is correct.

---

## 2. Communications Hub (your9-hub.mjs)

### 2.1 Credential Handling

| Item | Status | Detail |
|------|--------|--------|
| .env loader does not pollute process.env | PASS | Custom `loadEnvFile()` reads into a local object. Other processes on the same host cannot read customer credentials via `process.env`. |
| Placeholder detection | PASS | Hub refuses to start if any credential still contains `PLACEHOLDER_` prefix. Prevents accidental deployment with unconfigured secrets. |
| API key logging | WARNING | Hub logs `anthropicKey.slice(0, 20)...` at startup (line 1107). First 20 characters of the API key are written to the log file. |
| No credential exposure in health endpoint | PASS | The `/health` endpoint returns only: customerId, businessName, industry, tier, agent names, port, uptime, message count. No secrets, tokens, or keys are exposed. |

**Recommendation:** Reduce API key logging to the first 8 characters or use a hash fingerprint instead. Ensure log files have restrictive filesystem permissions (0600).

### 2.2 Message Routing & Owner Verification

| Item | Status | Detail |
|------|--------|--------|
| Owner chat ID verification | PASS | Hub only processes messages from the configured `TELEGRAM_OWNER_CHAT_ID`. Messages from unknown chat IDs are logged and ignored (line 738). |
| No multi-user access | PASS | Exactly one owner per instance. No concept of shared access or team members accessing the same instance. |
| Unknown message types handled | PASS | Photos, documents, and voice messages from the owner receive a clear rejection message. They are not forwarded to Claude API or stored. |

**Recommendation:** None. Owner verification is correctly implemented.

### 2.3 Data Persistence & Encryption

| Item | Status | Detail |
|------|--------|--------|
| Conversation history format | PASS | Stored as JSONL in `instances/{id}/data/conversations/history.jsonl`. Per-instance, not shared. |
| History rotation | PASS | Conversation history is capped at 500 lines, auto-rotated to 400. Prevents unbounded disk growth. |
| Task logging | PASS | Each task gets a unique timestamped JSON file in `instances/{id}/data/tasks/`. |
| Data at rest encryption | WARNING | All data is stored as plaintext JSON on the filesystem. No encryption at rest is applied to conversation history, task logs, credentials, or agent prompts. |
| Telegram offset persistence | PASS | Stored in `instances/{id}/data/telegram-offset.txt`. Per-instance. Prevents message re-processing on restart. |

**Recommendation:** Implement filesystem-level encryption (FileVault on macOS, LUKS on Linux) at minimum. For enterprise deployments, add application-level encryption for `.env` files and conversation history using a per-instance encryption key derived from the instance secret.

### 2.4 Audit Logging

| Item | Status | Detail |
|------|--------|--------|
| Hub activity logging | PASS | All hub operations are logged with ISO timestamps to `instances/{id}/logs/hub-{date}.log`. |
| Agent task execution logged | PASS | Every agent task is persisted as a separate JSON file with start time, completion time, status, and result. |
| CEO conversation history | PASS | Every message exchange (both directions) is logged to `history.jsonl` with timestamps. |
| Audit trail for decisions | PASS | Dashboard reads from `instances/{id}/data/audit/` for decision audit entries. Includes confidence scores, reasoning, sources, and outcomes. |
| Log integrity protection | WARNING | Log files can be modified by any process running as the same OS user. No append-only guarantees, checksums, or tamper detection. |

**Recommendation:** For enterprise tier, consider append-only log shipping to an external service (e.g., Supabase, S3) where logs cannot be retroactively modified.

---

## 3. Dashboard (your9-dashboard.mjs)

### 3.1 Access Control

| Item | Status | Detail |
|------|--------|--------|
| Localhost binding | PASS | Dashboard binds to `127.0.0.1` only (line 2302). Not accessible from external networks. |
| Application-layer IP check | PASS | Every request is verified: `remoteAddr` must be `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`. Non-localhost requests receive HTTP 403 (line 2224). Belt-and-suspenders approach. |
| Security headers | PASS | Dashboard sets `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`. Prevents clickjacking and MIME-type sniffing. |
| Cache control | PASS | `Cache-Control: no-store` prevents browser caching of dashboard data. |
| Authentication | WARNING | No authentication mechanism. Anyone with localhost access can view the dashboard and submit challenges. In a shared server environment, this is a risk. |

**Recommendation:** Add a simple bearer token authentication mechanism (token stored in instance `.env`) for dashboard access. This is critical before any multi-user or remote-access deployment.

### 3.2 Cross-Customer Data Bleed

| Item | Status | Detail |
|------|--------|--------|
| Single-instance binding | PASS | Each dashboard process serves exactly one customer instance. The `instanceDir` is set at startup and never changes. |
| No query parameters for instance selection | PASS | The dashboard does not accept `?instance=` or similar parameters. There is no mechanism to request data from a different instance. |
| Read-only data access | PASS | Dashboard reads `customer.json`, `ceo.json`, agent configs, conversation history, tasks, and audit logs -- all from within the single bound instance directory. No write operations except the challenge endpoint. |
| Challenge write scoped to instance | PASS | `writeChallenge()` writes to `instances/{id}/data/audit/` using the bound instance directory. Input is size-capped (`reason.slice(0, 2000)`). |

**Recommendation:** None. Cross-customer data bleed is not possible in the current architecture.

---

## 4. Agent Security (your9-agent-*.mjs)

### 4.1 Voice/Email Agent (your9-agent-voice-email.mjs)

| Item | Status | Detail |
|------|--------|--------|
| Human approval required for email send | PASS | Emails are NEVER sent without explicit founder approval via Telegram ("SEND" command). Revision loop supports up to 5 iterations. |
| Crash-safe state | PASS | Task state is written to disk at every stage (drafting, pending_approval, sending, completed). Process can be killed and resumed without double-sending. |
| Credential loading from instance .env | PASS | Resend API key and email FROM address are loaded from the instance-specific `.env` file. Not hardcoded. |
| Max revision limit | PASS | Capped at 5 revisions. Prevents infinite loops. |
| HTML injection prevention | PASS | `bodyToHtml()` escapes `&`, `<`, `>` before converting to HTML email body. |

**Recommendation:** None. The email agent's approval workflow is well-designed.

### 4.2 Social Media Agent (your9-agent-social.mjs)

| Item | Status | Detail |
|------|--------|--------|
| Human approval required for publish | PASS | Posts are NEVER published without founder approval ("PUBLISH" command). |
| Platform-specific limits enforced | PASS | X (Twitter) posts are hard-limited to 280 characters. LinkedIn posts are soft-warned at 1300 characters. |
| Pending state persistence | PASS | Drafts are stored in `instances/{id}/data/social/pending/` with unique UUIDs. Published posts move to `published/`. |
| Revision limit | PASS | 5-revision cap with CEO escalation if exceeded. |
| No auto-posting capability | PASS | The agent drafts and logs. Actual API posting to social platforms is not implemented ("future feature"). Copy is saved for manual paste-and-post. |

**Recommendation:** None. Social agent correctly requires human approval at every stage.

### 4.3 Research Agent (your9-agent-mind-research.mjs)

| Item | Status | Detail |
|------|--------|--------|
| Instance-scoped data | PASS | Reports are saved to `instances/{id}/data/reports/`. No cross-instance access. |
| Web search limited | PASS | Anthropic web search tool is capped at `max_uses: 10` per research call. Prevents runaway API costs. |
| Watch mode polling | PASS | In `--watch` mode, the agent polls `instances/{id}/data/tasks/` only -- never other instance directories. |
| Credential handling | PASS | Same instance-first, platform-fallback pattern as the hub. Placeholder detection present. |

**Recommendation:** None. Research agent is properly sandboxed to its instance.

### 4.4 Self-Improvement Agent (your9-self-improve.mjs)

| Item | Status | Detail |
|------|--------|--------|
| CEO gate on all changes | PASS | All improvement proposals must pass through an Opus-powered CEO review. Proposals can be APPROVED, REJECTED, or MODIFIED. No automatic application without CEO approval. |
| Soul Code protection | PASS | CEO review system prompt explicitly states: "Safe: does not remove Soul Code hard rules, does not grant new permissions." Reject criteria include: "The change conflicts with the agent's core purpose or Soul Code." |
| Dry-run mode | PASS | `--dry-run` flag analyzes and reviews without modifying any files. Safe for testing. |
| Improvement audit log | PASS | Every run (proposals, decisions, applied changes) is persisted to `instances/{id}/data/improvements/{timestamp}-{agent}.json`. Full traceability. |
| Minimum task threshold | PASS | Requires at least 3 completed tasks (configurable) before running analysis. Prevents premature optimization on insufficient data. |

**Recommendation:** Consider adding a flag to disable self-improvement entirely for customers who want fully static agent behavior. Log the before/after diff of system prompt changes for rollback capability.

### 4.5 Dynamic Agent Provisioning (your9-add-agent.mjs)

| Item | Status | Detail |
|------|--------|--------|
| Tier cap enforcement | PASS | Agent count is checked against `tierConfig.maxAgents`. Starter: 3, Growth: 6, Enterprise: 12. Exceeding the cap returns an error. |
| Slug collision detection | PASS | If an agent with the same slug already exists, the operation fails cleanly. |
| Instance validation | PASS | Verifies instance directory and customer config exist before any file creation. |
| No hub restart required | PASS | New agent configs are written to the filesystem. The hub discovers them on the next delegation scan. Clean hot-reload pattern. |

**Recommendation:** None. Agent provisioning enforces correct boundaries.

---

## 5. Human Override & Emergency Shutdown

### 5.1 Founder Challenge Mechanism

| Item | Status | Detail |
|------|--------|--------|
| Dashboard challenge UI | PASS | Every audit entry in the dashboard has a "Challenge This Decision" zone. Founder can enter a reason and submit. |
| Challenge persisted to disk | PASS | Challenges are written to both `data/audit/{entryId}-challenge.json` and `data/tasks/{timestamp}-challenge-task.json`. The hub picks up the challenge task for CEO reconsideration. |
| Input validation | PASS | Challenge reason is size-capped at 2000 characters. entryId and reason are both required. |

### 5.2 Emergency Shutdown

| Item | Status | Detail |
|------|--------|--------|
| SIGINT/SIGTERM handling | PASS | Hub sets `hub.shutdown = true` on SIGINT/SIGTERM, triggering graceful exit of the Telegram polling loop. |
| Process kill | PASS | Standard `kill <pid>` or `pkill -f your9-hub` terminates the hub immediately. No orphan processes. |
| No auto-restart | PASS | The hub does not self-restart. It must be explicitly started. This means killing it stops all AI activity for that customer instance. |

### 5.3 Data Deletion

| Item | Status | Detail |
|------|--------|--------|
| Instance removal | WARNING | No built-in `--destroy` or `--deprovision` command exists. Removing a customer requires manual `rm -rf instances/{id}/`. |

**Recommendation:** Add a `your9-provision.mjs --destroy <id> --confirm` command that: (1) stops the hub if running, (2) archives instance data to a timestamped zip, (3) removes the instance directory. This is required for GDPR-style data deletion requests.

---

## 6. Daily Briefing & Scheduling (your9-daily-briefing.mjs)

| Item | Status | Detail |
|------|--------|--------|
| Instance-scoped data access | PASS | Reads only from the specified instance's task and conversation directories. |
| Credential handling | PASS | Same instance-first pattern. Refuses to start with placeholder values. |
| Dry-run mode | PASS | `--dry-run` generates the briefing text without sending via Telegram. |
| Scheduler resilience | PASS | Long-running daemon catches errors and retries next day. Transient API failures do not crash the process. |

**Recommendation:** None.

---

## Summary Scorecard

| Area | Findings | Status |
|------|----------|--------|
| Per-customer directory isolation | Cryptographic UUIDs, separate directory trees, no cross-links | PASS |
| Per-customer credential isolation | Unique tokens per instance, separate .env files, placeholder detection | PASS |
| Network isolation | Localhost-only binding on both hub and dashboard, application-layer IP verification | PASS |
| Owner verification | Telegram chat ID verification, single-owner model, unknown senders rejected | PASS |
| Human approval gates | Email requires "SEND", social requires "PUBLISH", self-improvement requires CEO approval | PASS |
| Credential handling in code | .env loaded to local object (not process.env), no hardcoded secrets | PASS |
| Audit trail | Timestamped logs, task files, conversation history, improvement logs, decision audit | PASS |
| Emergency shutdown | SIGINT/SIGTERM graceful shutdown, process kill stops all activity | PASS |
| Founder override | Dashboard challenge mechanism writes to audit + task queue for CEO reconsideration | PASS |
| Cross-customer data bleed | Each process serves exactly one instance, no query-parameter instance switching | PASS |
| Data at rest encryption | No application-level encryption on stored data | WARNING |
| Dashboard authentication | No auth mechanism beyond localhost binding | WARNING |
| API key sharing across instances | Platform-level fallback key shared across customers | WARNING |
| API key logging | First 20 chars of API key written to log files | WARNING |
| Log integrity | No tamper detection or append-only guarantees | WARNING |
| Instance deprovisioning | No built-in data deletion command | WARNING |
| Self-improvement rollback | No prompt version history or rollback mechanism | WARNING |

---

## Conditions for Full Certification

The following items must be addressed before Your9 is certified for multi-tenant production deployment:

1. **Dashboard authentication** -- Add bearer token auth before any remote access deployment.
2. **Data at rest encryption** -- Enable FileVault (macOS) or LUKS (Linux) at minimum. Application-level encryption for enterprise tier.
3. **API key logging reduction** -- Log only the last 4 characters or a key fingerprint.
4. **Instance deprovisioning** -- Build a `--destroy` command with data archival.
5. **Dedicated API keys for enterprise tier** -- Enforce per-customer Anthropic API keys at the enterprise level.

For the current deployment model (single-host, localhost-only, single operator), the platform passes security review. The founder's data is isolated, human approval gates are enforced at every critical action, and emergency shutdown paths exist.

---

*Security Certification produced by 9 -- 9 Enterprises*
*Reviewed: 9 source files, 1 provisioned instance, ~4,800 lines of platform code*
*Date: April 9, 2026*
