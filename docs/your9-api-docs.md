# Your9 Public API — Developer Reference

**Version:** v1  
**Base URL:** `http://127.0.0.1:3494/api/v1`  
**Server:** `scripts/your9-api.mjs` (port 3494, bound to 127.0.0.1)

---

## Overview

The Your9 API turns every customer instance into an extensible platform. Third-party tools, CRMs, dashboards, and automations can read instance state, create tasks, send messages to the AI CEO, query the knowledge base, and pull ROI metrics — all through a single authenticated REST interface.

One API server serves all instances simultaneously. Authentication determines which instance each request is scoped to.

---

## Authentication

Every API request must include a valid API key. Keys are per-instance, scoped to a specific customer.

### Format

Keys use the prefix `y9k_` followed by 64 hex characters:

```
y9k_a1b2c3d4e5f6...
```

### Providing the Key

Two methods are accepted (both valid):

```
Authorization: Bearer y9k_a1b2c3d4...
```

```
X-API-Key: y9k_a1b2c3d4...
```

### Key Storage

Keys are stored hashed (SHA-256) in `instances/{id}/config/api-keys.json`. The raw key is shown **once** at generation time and never stored. Treat it like a password.

### Generating a Key

Keys are generated via the admin endpoint (see [Admin Endpoints](#admin-endpoints)):

```
POST /admin/keys/generate
```

---

## Response Envelope

Every response uses a consistent JSON envelope:

**Success:**
```json
{
  "ok": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "ok": false,
  "error": "Human-readable description",
  "code": "MACHINE_CODE"
}
```

HTTP status codes follow standard conventions (200, 201, 400, 401, 404, 429, 500).

---

## Rate Limiting

Rate limits are enforced per API key, per minute.

| Tier       | Default Limit |
|------------|--------------|
| Starter    | 100 req/min  |
| Growth     | 300 req/min  |
| Enterprise | 1000 req/min |

Rate limit headers are returned on every authenticated response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1712700060
```

When the limit is exceeded, the server returns `429 Too Many Requests`:

```json
{
  "ok": false,
  "error": "Rate limit exceeded.",
  "code": "RATE_LIMITED"
}
```

`X-RateLimit-Reset` is a Unix timestamp (seconds) indicating when the window resets.

---

## Error Codes

| Code              | HTTP | Meaning                                        |
|-------------------|------|------------------------------------------------|
| `MISSING_KEY`     | 401  | No API key provided                            |
| `INVALID_KEY`     | 401  | Key unknown, inactive, or wrong format         |
| `RATE_LIMITED`    | 429  | Per-minute request limit exceeded              |
| `BAD_REQUEST`     | 400  | Malformed JSON or body too large               |
| `VALIDATION_ERROR`| 400  | Required field missing or invalid value        |
| `NOT_FOUND`       | 404  | Resource or endpoint not found                 |
| `INTERNAL`        | 500  | Unexpected server error                        |

---

## Endpoints

### GET /api/v1/status

Instance health and agent status.

**Auth required:** Yes

**Response:**

```json
{
  "ok": true,
  "data": {
    "instanceId": "y9-c69ca07c-...",
    "businessName": "Apex Mortgage",
    "status": "active",
    "tier": "starter",
    "ceo": {
      "name": "Alex",
      "model": "claude-sonnet-4-5",
      "active": true
    },
    "hub": {
      "running": true,
      "port": 4521,
      "uptime": 3600.2
    },
    "agents": [
      {
        "id": "executor",
        "name": "Executor Agent",
        "role": "task_execution",
        "state": "running",
        "model": "claude-sonnet-4-5"
      },
      {
        "id": "mind",
        "name": "Research Agent",
        "role": "research",
        "state": "idle",
        "model": "claude-sonnet-4-5"
      }
    ],
    "health": {
      "score": 72
    },
    "timestamp": "2026-04-09T22:00:00.000Z"
  }
}
```

**Health score** is 0–100 based on engagement, task completion, and feature adoption. See the customer success module for breakdown.

**Hub running: false** means the Your9 hub process is not currently active for this instance. The agent team is offline.

---

### GET /api/v1/tasks

List tasks with optional filters.

**Auth required:** Yes

**Query Parameters:**

| Parameter | Type   | Default | Description                                          |
|-----------|--------|---------|------------------------------------------------------|
| `status`  | string | —       | Filter by status: `queued`, `running`, `completed`, `failed`, `cancelled` |
| `agentId` | string | —       | Filter by agent ID (e.g. `executor`, `mind`, `ceo`)  |
| `limit`   | number | 50      | Max results (max 200)                                |
| `offset`  | number | 0       | Pagination offset                                    |

**Example Request:**

```
GET /api/v1/tasks?status=completed&limit=10
Authorization: Bearer y9k_a1b2...
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "tasks": [
      {
        "id": "1712700000123-executor",
        "type": "api_task",
        "agentId": "executor",
        "task": "Audit current pipeline and identify top 5 open opportunities",
        "priority": "high",
        "status": "completed",
        "source": "api",
        "loggedAt": "2026-04-09T18:00:00.000Z",
        "completedAt": "2026-04-09T18:03:22.000Z",
        "result": "Pipeline audit complete. Found 5 open opportunities...",
        "metadata": {}
      }
    ],
    "total": 47,
    "limit": 10,
    "offset": 0
  }
}
```

---

### POST /api/v1/tasks

Create a new task for the AI CEO or a specific agent.

**Auth required:** Yes

**Request Body:**

| Field     | Type   | Required | Description                                              |
|-----------|--------|----------|----------------------------------------------------------|
| `task`    | string | Yes      | Task description (max 4000 chars)                        |
| `agentId` | string | No       | Target agent ID. Defaults to `ceo`                       |
| `priority`| string | No       | `high`, `normal`, or `low`. Defaults to `normal`         |
| `metadata`| object | No       | Arbitrary key-value pairs, returned in task responses    |

**Example Request:**

```
POST /api/v1/tasks
Authorization: Bearer y9k_a1b2...
Content-Type: application/json

{
  "task": "Pull a report of all locked loans expiring in the next 7 days",
  "agentId": "executor",
  "priority": "high",
  "metadata": { "source": "crm-trigger", "triggerId": "lock-expiry-alert" }
}
```

**Response (201 Created):**

```json
{
  "ok": true,
  "data": {
    "task": {
      "id": "1712700123456-api",
      "type": "api_task",
      "agentId": "executor",
      "task": "Pull a report of all locked loans expiring in the next 7 days",
      "priority": "high",
      "status": "queued",
      "source": "api",
      "loggedAt": "2026-04-09T22:02:03.456Z",
      "completedAt": null,
      "result": null,
      "metadata": { "source": "crm-trigger", "triggerId": "lock-expiry-alert" }
    }
  }
}
```

The task is written to `instances/{id}/data/tasks/` and to the shared context. The hub picks it up on its next scan cycle (typically within 30 seconds).

---

### POST /api/v1/message

Send a message to the AI CEO. The message is queued in `instances/{id}/data/api-inbox/` and the hub processes it on its next cycle.

**Auth required:** Yes

**Request Body:**

| Field         | Type   | Required | Description                                    |
|---------------|--------|----------|------------------------------------------------|
| `content`     | string | Yes      | Message text (max 4000 chars)                  |
| `senderLabel` | string | No       | Label shown in CEO context. Defaults to `API caller` |

**Example Request:**

```
POST /api/v1/message
Authorization: Bearer y9k_a1b2...
Content-Type: application/json

{
  "content": "We just closed the Johnson deal. Update the pipeline and send a win summary to the team.",
  "senderLabel": "Salesforce CRM"
}
```

**Response (201 Created):**

```json
{
  "ok": true,
  "data": {
    "message": {
      "id": "1712700200000-msg",
      "content": "We just closed the Johnson deal. Update the pipeline and send a win summary to the team.",
      "senderLabel": "Salesforce CRM",
      "queuedAt": "2026-04-09T22:03:20.000Z",
      "status": "queued"
    }
  }
}
```

Note: The API does not return the CEO's reply inline. The CEO processes the message asynchronously and sends the reply to the configured Telegram channel (or other channel) for the instance. If you need reply delivery via webhook, that is a planned feature for a future API version.

---

### GET /api/v1/agents

List all agents and their status.

**Auth required:** Yes

**Response:**

```json
{
  "ok": true,
  "data": {
    "agents": [
      {
        "id": "executor",
        "name": "Executor Agent",
        "role": "task_execution",
        "description": "Handles task execution and follow-through",
        "model": "claude-sonnet-4-5",
        "state": "running",
        "tasks": {
          "total": 23,
          "completed": 21,
          "queued": 1,
          "failed": 1
        }
      },
      {
        "id": "mind",
        "name": "Research Agent",
        "role": "research",
        "description": "Handles research, analysis, and intelligence gathering",
        "model": "claude-sonnet-4-5",
        "state": "idle",
        "tasks": {
          "total": 8,
          "completed": 8,
          "queued": 0,
          "failed": 0
        }
      }
    ],
    "total": 2
  }
}
```

**Agent states:**

| State     | Meaning                                  |
|-----------|------------------------------------------|
| `running` | Agent is currently processing a task     |
| `idle`    | Agent is active but not working          |
| `paused`  | Agent has been paused via control file   |
| `unknown` | No state file found for this agent       |

---

### GET /api/v1/knowledge

Search the knowledge base. Returns document metadata only — encrypted content is never exposed via the API.

**Auth required:** Yes

**Query Parameters:**

| Parameter | Type   | Default | Description                                   |
|-----------|--------|---------|-----------------------------------------------|
| `q`       | string | —       | Search query. Omit to list all documents.     |
| `limit`   | number | 10      | Max results (max 50)                          |

**Example Request:**

```
GET /api/v1/knowledge?q=refund+policy&limit=5
Authorization: Bearer y9k_a1b2...
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "query": "refund policy",
    "results": [
      {
        "id": "doc-abc123",
        "name": "Customer Refund Policy v2.pdf",
        "type": ".pdf",
        "summary": "Refund policy for mortgage processing fees. 30-day window. No refund after lock-in.",
        "tags": ["policy", "refund", "compliance"],
        "uploadedAt": "2026-03-15T10:00:00.000Z",
        "sizeBytes": 42830
      }
    ],
    "total": 1
  }
}
```

Results are ranked by keyword relevance. Scoring uses the document name, summary, and tags.

---

### GET /api/v1/metrics

Usage and ROI metrics for the instance.

**Auth required:** Yes

**Response:**

```json
{
  "ok": true,
  "data": {
    "metrics": {
      "tasks": {
        "total": 47,
        "queued": 3,
        "running": 1,
        "completed": 41,
        "failed": 1,
        "cancelled": 1,
        "completedToday": 6,
        "completedThisWeek": 22
      },
      "timeSaved": {
        "hoursToday": 4.5
      },
      "conversations": {
        "total": 183,
        "today": 12
      },
      "agents": {
        "uniqueUsed": 3
      },
      "velocityScore": 74,
      "usage": {
        "messagesSent": 183,
        "tasksCompleted": 41,
        "sessionCount": 14,
        "lastActivity": "2026-04-09T21:55:00.000Z"
      }
    },
    "billing": {
      "tier": "starter",
      "callsUsed": 87,
      "callLimit": 100,
      "periodStart": "2026-04-01T00:00:00.000Z",
      "periodEnd": "2026-04-30T23:59:59.000Z"
    },
    "health": {
      "score": 72,
      "calculatedAt": "2026-04-09T21:00:00.000Z"
    }
  }
}
```

**Velocity score** is 0–100, computed from:
- Tasks completed today (up to 40 pts)
- Tasks completed this week (up to 30 pts)
- Conversation activity today (up to 20 pts)
- Agent utilization breadth (up to 10 pts)

**Time saved** uses conservative complexity estimates per task:
- High complexity tasks (research, build, analyze): 2.5 hours
- Medium complexity (summarize, respond, schedule): 0.75 hours
- Low complexity (lookup, notify, log): 0.25 hours

---

## Admin Endpoints

Admin endpoints require no API key but are only accessible from localhost (127.0.0.1). They are not exposed externally.

### POST /admin/keys/generate

Generate a new API key for an instance.

**Request Body:**

| Field        | Type   | Required | Description                              |
|--------------|--------|----------|------------------------------------------|
| `instanceId` | string | Yes      | Customer instance ID                     |
| `label`      | string | No       | Human label for the key (max 100 chars)  |
| `tier`       | string | No       | `starter`, `growth`, or `enterprise`. Sets rate limit. |

**Example:**

```
POST /admin/keys/generate
Content-Type: application/json

{
  "instanceId": "y9-c69ca07c-c89c-4896-ba50-96414d108d87",
  "label": "Salesforce integration",
  "tier": "starter"
}
```

**Response (201):**

```json
{
  "ok": true,
  "data": {
    "rawKey": "y9k_a1b2c3d4e5f6...",
    "keyHash": "sha256hexstring...",
    "record": {
      "keyHash": "sha256hexstring...",
      "label": "Salesforce integration",
      "tier": "starter",
      "rateLimit": 100,
      "createdAt": "2026-04-09T22:00:00.000Z",
      "lastUsedAt": null,
      "active": true
    },
    "warning": "Store the rawKey securely. It will not be shown again."
  }
}
```

Save the `rawKey` immediately. It is shown once and never stored.

---

### GET /admin/keys/list

List all API keys for an instance (hashes only — raw keys are never retrievable).

**Query Parameters:**

| Parameter    | Type   | Required | Description     |
|--------------|--------|----------|-----------------|
| `instanceId` | string | Yes      | Instance ID     |

**Example:**

```
GET /admin/keys/list?instanceId=y9-c69ca07c-...
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "keys": [
      {
        "keyHash": "sha256hexstring...",
        "label": "Salesforce integration",
        "tier": "starter",
        "rateLimit": 100,
        "createdAt": "2026-04-09T22:00:00.000Z",
        "lastUsedAt": "2026-04-09T22:05:30.000Z",
        "active": true
      }
    ],
    "total": 1
  }
}
```

---

### POST /admin/keys/revoke

Deactivate an API key. Revoked keys are immediately rejected.

**Request Body:**

| Field        | Type   | Required | Description            |
|--------------|--------|----------|------------------------|
| `instanceId` | string | Yes      | Instance ID            |
| `keyHash`    | string | Yes      | SHA-256 hash of the key|

**Example:**

```
POST /admin/keys/revoke
Content-Type: application/json

{
  "instanceId": "y9-c69ca07c-...",
  "keyHash": "sha256hexstring..."
}
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "revoked": true,
    "keyHash": "sha256hexstring..."
  }
}
```

---

## Health Check

```
GET /health
```

No auth required. Returns API server status.

```json
{
  "ok": true,
  "data": {
    "service": "your9-api",
    "version": "v1",
    "port": 3494,
    "uptime": 3600.1,
    "timestamp": "2026-04-09T22:10:00.000Z"
  }
}
```

---

## Quick Start

### 1. Start the API server

```bash
node scripts/your9-api.mjs
# or with a custom port:
node scripts/your9-api.mjs --port 3494
```

### 2. Generate a key

```bash
curl -s -X POST http://127.0.0.1:3494/admin/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"instanceId":"y9-c69ca07c-...","label":"my-integration","tier":"starter"}'
```

Save the `rawKey` from the response.

### 3. Check instance status

```bash
curl -s http://127.0.0.1:3494/api/v1/status \
  -H "Authorization: Bearer y9k_a1b2c3..."
```

### 4. Create a task

```bash
curl -s -X POST http://127.0.0.1:3494/api/v1/tasks \
  -H "Authorization: Bearer y9k_a1b2c3..." \
  -H "Content-Type: application/json" \
  -d '{"task":"Review the pipeline and flag any loans expiring this week","priority":"high"}'
```

### 5. Pull metrics

```bash
curl -s http://127.0.0.1:3494/api/v1/metrics \
  -H "Authorization: Bearer y9k_a1b2c3..."
```

---

## Data Models

### Task Object

```json
{
  "id": "1712700123456-api",
  "type": "api_task | founder_instruction | reconsider | ...",
  "agentId": "ceo | executor | mind | voice",
  "task": "Task description text",
  "priority": "high | normal | low",
  "status": "queued | running | completed | failed | cancelled",
  "source": "api | founder_dashboard | simulated-ceo-reasoning | ...",
  "loggedAt": "ISO timestamp",
  "completedAt": "ISO timestamp | null",
  "result": "Result text | null",
  "metadata": {}
}
```

### Message Object

```json
{
  "id": "1712700200000-msg",
  "content": "Message text",
  "senderLabel": "API caller | Salesforce CRM | ...",
  "queuedAt": "ISO timestamp",
  "status": "queued | processed"
}
```

### Knowledge Entry Object

```json
{
  "id": "doc-abc123",
  "name": "Filename or document title",
  "type": ".pdf | .txt | .md | ...",
  "summary": "Auto-generated or manual summary",
  "tags": ["tag1", "tag2"],
  "uploadedAt": "ISO timestamp",
  "sizeBytes": 42830
}
```

---

## Key Storage Format

Keys are stored at `instances/{id}/config/api-keys.json`:

```json
[
  {
    "keyHash": "sha256 hex of raw key — never the raw key",
    "label": "Integration label",
    "tier": "starter",
    "rateLimit": 100,
    "createdAt": "ISO timestamp",
    "lastUsedAt": "ISO timestamp | null",
    "active": true
  }
]
```

The raw key (`y9k_...`) is shown once at generation and never stored. If lost, generate a new key and revoke the old one.

---

## Security Notes

- The API server binds to `127.0.0.1` only. It is never directly internet-accessible.
- To expose externally, put it behind a reverse proxy (nginx, Cloudflare Tunnel) with TLS.
- Admin endpoints (`/admin/*`) have no key requirement — they rely on network-level access control (localhost only). Do not expose them through a reverse proxy.
- Keys are hashed before storage. Even with database access, raw keys cannot be recovered.
- Rate limiting is in-memory per process. It resets if the API server restarts.
- Knowledge base content (document text) is encrypted at rest and never returned by the API. Only metadata and summaries are exposed.

---

## Roadmap

Planned additions for future API versions:

- `GET /api/v1/conversations` — retrieve message history
- `GET /api/v1/audit` — read CEO decision audit log
- `POST /api/v1/knowledge/upload` — add documents to the knowledge base
- Webhook delivery for CEO replies to `POST /api/v1/message`
- OAuth2 / client credentials flow for enterprise integrations
- Per-endpoint scope restrictions on API keys
