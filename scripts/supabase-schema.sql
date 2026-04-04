-- supabase-schema.sql
-- 9 Enterprises — Persistent Memory Schema
-- Reference schema for Supabase (Postgres) if a cloud mirror is ever needed.
-- The authoritative database is the local SQLite WAL file at data/9-memory.db.
-- This schema matches the SQLite tables 1:1 so a future sync job can write here.
--
-- To use: paste this into the Supabase SQL Editor and run.
-- Supabase project needed at: https://supabase.com (free tier is sufficient)
-- After creating project, add to .env:
--   SUPABASE_URL=https://<project-ref>.supabase.co
--   SUPABASE_ANON_KEY=<your-anon-key>

-- ─── Enable UUID extension ───────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── messages ────────────────────────────────────────────────────────────────
-- Stores every inbound and outbound message across all channels.

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL    PRIMARY KEY,
  timestamp   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  channel     TEXT         NOT NULL,          -- telegram | imessage | email | voice
  direction   TEXT         NOT NULL,          -- in | out
  text        TEXT,
  read        BOOLEAN      NOT NULL DEFAULT false,
  metadata    JSONB        NOT NULL DEFAULT '{}',
  session_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_timestamp  ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_channel    ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_read       ON messages(read);
CREATE INDEX IF NOT EXISTS idx_messages_session    ON messages(session_id);

-- ─── actions ─────────────────────────────────────────────────────────────────
-- Every action the agent takes: sends, deploys, purchases, config changes.
-- Used for duplicate-prevention across crashes (wasActionCompleted check).

CREATE TABLE IF NOT EXISTS actions (
  id           BIGSERIAL    PRIMARY KEY,
  timestamp    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  action_type  TEXT         NOT NULL,         -- send | deploy | purchase | config | etc.
  description  TEXT         NOT NULL,         -- human-readable, used for dedup key
  status       TEXT         NOT NULL DEFAULT 'completed',  -- completed | failed | pending
  metadata     JSONB        NOT NULL DEFAULT '{}',
  session_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_timestamp   ON actions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_actions_action_type ON actions(action_type);
CREATE INDEX IF NOT EXISTS idx_actions_status      ON actions(status);

-- ─── decisions ───────────────────────────────────────────────────────────────
-- Significant decisions made by the agent, with reasoning and outcome.

CREATE TABLE IF NOT EXISTS decisions (
  id          BIGSERIAL    PRIMARY KEY,
  timestamp   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  decision    TEXT         NOT NULL,
  context     TEXT,                            -- why, what info was available
  outcome     TEXT,                            -- result, filled in later if needed
  session_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp DESC);

-- ─── authority_matrix ────────────────────────────────────────────────────────
-- Permissions granted by the Owner. Agent checks these before acting.
-- Matches the "authority" table in SQLite but renamed per spec.

CREATE TABLE IF NOT EXISTS authority_matrix (
  id               BIGSERIAL    PRIMARY KEY,
  action_type      TEXT         NOT NULL UNIQUE,  -- the permission key
  permission_level TEXT         NOT NULL DEFAULT 'active',  -- active | revoked
  description      TEXT,
  granted_date     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  granted_context  TEXT,
  conditions       JSONB        NOT NULL DEFAULT '{}',
  last_verified    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_authority_action_type ON authority_matrix(action_type);
CREATE INDEX IF NOT EXISTS idx_authority_level       ON authority_matrix(permission_level);

-- ─── memory ──────────────────────────────────────────────────────────────────
-- Named memory entries: user profiles, feedback, project state, contacts.
-- Mirrors the file-based memory/ directory but queryable.

CREATE TABLE IF NOT EXISTS memory (
  id          BIGSERIAL    PRIMARY KEY,
  name        TEXT         NOT NULL UNIQUE,    -- unique key (filename equivalent)
  type        TEXT         NOT NULL,           -- user | feedback | project | reference | contact
  description TEXT,                            -- one-line summary
  content     TEXT,                            -- full content
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_name       ON memory(name);
CREATE INDEX IF NOT EXISTS idx_memory_type       ON memory(type);
CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at DESC);

-- Full-text search index on memory (Postgres-native, faster than LIKE)
CREATE INDEX IF NOT EXISTS idx_memory_fts ON memory
  USING GIN (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(content,'')));

-- ─── tasks ───────────────────────────────────────────────────────────────────
-- Agent task queue. Assigned to team members (9, UNO, Tee, Money, Trinity).

CREATE TABLE IF NOT EXISTS tasks (
  id           BIGSERIAL    PRIMARY KEY,
  title        TEXT         NOT NULL,
  description  TEXT,
  status       TEXT         NOT NULL DEFAULT 'queued',      -- queued | in_progress | completed | failed | blocked
  assigned_to  TEXT         NOT NULL DEFAULT 'unassigned',  -- 9 | UNO | Tee | Money | Trinity | unassigned
  priority     TEXT         NOT NULL DEFAULT 'medium',      -- critical | high | medium | low
  project      TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result       TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_priority    ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at  ON tasks(created_at DESC);

-- ─── Row-level security (Supabase default — enable per table as needed) ───────
-- Uncomment and adjust policies when exposing to client-side code.
-- For server-side use with service_role key, RLS can remain disabled.

-- ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE actions        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE decisions      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE authority_matrix ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE memory         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tasks          ENABLE ROW LEVEL SECURITY;
