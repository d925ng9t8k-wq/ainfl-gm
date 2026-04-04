#!/usr/bin/env node
// supabase-migrate.mjs — Migrate local SQLite to Supabase cloud
// Run: node scripts/supabase-migrate.mjs
// Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY in .env

import { createClient } from '@supabase/supabase-js';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const db = new Database(resolve(__dirname, '..', 'data', '9-memory.db'), { readonly: true });

async function migrateTable(tableName, mapFn) {
  const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
  console.log(`[${tableName}] ${rows.length} rows to migrate...`);

  if (rows.length === 0) return;

  // Batch insert in chunks of 100
  const mapped = rows.map(mapFn || (r => r));
  for (let i = 0; i < mapped.length; i += 100) {
    const chunk = mapped.slice(i, i + 100);
    const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.error(`  Error on ${tableName} chunk ${i}: ${error.message}`);
    } else {
      console.log(`  Migrated ${Math.min(i + 100, mapped.length)}/${mapped.length}`);
    }
  }
}

async function migrateMessages() {
  const rows = db.prepare('SELECT * FROM messages ORDER BY id').all();
  console.log(`[messages] ${rows.length} rows to migrate...`);

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map(r => ({
      id: r.id,
      timestamp: r.timestamp || new Date().toISOString(),
      channel: r.channel,
      direction: r.direction,
      text: r.text,
      read: r.read === 1,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {}),
      session_id: r.session_id
    }));
    const { error } = await supabase.from('messages').upsert(chunk, { onConflict: 'id' });
    if (error) console.error(`  Error: ${error.message}`);
    else console.log(`  Migrated ${Math.min(i + 100, rows.length)}/${rows.length}`);
  }
}

async function migrateActions() {
  const rows = db.prepare('SELECT * FROM actions ORDER BY id').all();
  console.log(`[actions] ${rows.length} rows to migrate...`);

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map(r => ({
      id: r.id,
      timestamp: r.timestamp || new Date().toISOString(),
      action_type: r.action_type,
      description: r.description,
      status: r.status || 'completed',
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {}),
      session_id: r.session_id
    }));
    const { error } = await supabase.from('actions').upsert(chunk, { onConflict: 'id' });
    if (error) console.error(`  Error: ${error.message}`);
    else console.log(`  Migrated ${Math.min(i + 100, rows.length)}/${rows.length}`);
  }
}

async function migrateDecisions() {
  const rows = db.prepare('SELECT * FROM decisions ORDER BY id').all();
  console.log(`[decisions] ${rows.length} rows to migrate...`);

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map(r => ({
      id: r.id,
      timestamp: r.timestamp || new Date().toISOString(),
      decision: r.decision,
      context: r.context,
      outcome: r.outcome,
      session_id: r.session_id
    }));
    const { error } = await supabase.from('decisions').upsert(chunk, { onConflict: 'id' });
    if (error) console.error(`  Error: ${error.message}`);
    else console.log(`  Migrated ${Math.min(i + 100, rows.length)}/${rows.length}`);
  }
}

async function migrateMemory() {
  const rows = db.prepare('SELECT * FROM memory ORDER BY id').all();
  console.log(`[memory] ${rows.length} rows to migrate...`);

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      description: r.description,
      content: r.content,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString()
    }));
    const { error } = await supabase.from('memory').upsert(chunk, { onConflict: 'name' });
    if (error) console.error(`  Error: ${error.message}`);
    else console.log(`  Migrated ${Math.min(i + 100, rows.length)}/${rows.length}`);
  }
}

async function migrateAuthority() {
  const rows = db.prepare('SELECT * FROM authority ORDER BY id').all();
  console.log(`[authority_matrix] ${rows.length} rows to migrate...`);

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map(r => ({
      id: r.id,
      action_type: r.action_type,
      permission_level: r.permission_level || 'active',
      description: r.description,
      granted_date: r.granted_date || new Date().toISOString(),
      granted_context: r.granted_context,
      conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions || '{}') : (r.conditions || {}),
      last_verified: r.last_verified,
      created_at: r.created_at || new Date().toISOString()
    }));
    const { error } = await supabase.from('authority_matrix').upsert(chunk, { onConflict: 'action_type' });
    if (error) console.error(`  Error: ${error.message}`);
    else console.log(`  Migrated ${Math.min(i + 100, rows.length)}/${rows.length}`);
  }
}

async function migrateTasks() {
  try {
    const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all();
    console.log(`[tasks] ${rows.length} rows to migrate...`);

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status || 'queued',
        assigned_to: r.assigned_to || 'unassigned',
        priority: r.priority || 'medium',
        project: r.project,
        created_at: r.created_at || new Date().toISOString(),
        started_at: r.started_at,
        completed_at: r.completed_at,
        result: r.result
      }));
      const { error } = await supabase.from('tasks').upsert(chunk, { onConflict: 'id' });
      if (error) console.error(`  Error: ${error.message}`);
      else console.log(`  Migrated ${Math.min(i + 100, rows.length)}/${rows.length}`);
    }
  } catch (e) {
    console.log(`[tasks] Table may not exist locally: ${e.message}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 9 Enterprises — SQLite → Supabase Migration ===');
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Local DB: data/9-memory.db`);
  console.log('');

  await migrateMessages();
  await migrateActions();
  await migrateDecisions();
  await migrateMemory();
  await migrateAuthority();
  await migrateTasks();

  console.log('');
  console.log('=== Migration complete ===');
  db.close();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
