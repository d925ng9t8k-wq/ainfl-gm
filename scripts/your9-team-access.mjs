#!/usr/bin/env node
/**
 * your9-team-access.mjs — Human Team Member Access & Collaboration Layer
 * Your9 by 9 Enterprises
 *
 * Lets founders invite human team members into their Your9 instance with
 * role-based permissions. Human members can message agents, approve/reject
 * agent work, and add context to tasks — all with a full audit trail that
 * tags every action as human or AI.
 *
 * Roles:
 *   owner   — full control (same as founder; typically one person)
 *   manager — approve/reject agent actions, view everything, send instructions
 *   member  — message agents directly, view dashboard, add task context
 *   viewer  — read-only dashboard access
 *
 * Storage:
 *   instances/{id}/config/team.json          — team roster + role assignments
 *   instances/{id}/data/invites/             — pending invite tokens (one file each)
 *   instances/{id}/data/audit/team-actions.jsonl — append-only human/AI action log
 *
 * Exported functions (library mode):
 *   inviteTeamMember(instanceDir, opts)
 *   setPermissions(instanceDir, memberId, role)
 *   listTeamMembers(instanceDir)
 *   checkPermission(instanceDir, memberId, action)
 *
 * HTTP server (standalone mode):
 *   POST /invite           — invite a team member
 *   POST /accept           — accept an invite via token
 *   GET  /members          — list all members
 *   POST /members/:id/role — change a member's role
 *   POST /members/:id/remove — remove a member
 *   POST /message          — member sends message to an agent
 *   POST /approve          — member approves an agent action
 *   POST /reject           — member rejects an agent action
 *   POST /context          — member adds context to a task
 *   GET  /activity         — recent team activity feed
 *   GET  /health           — liveness check
 *
 * Usage:
 *   node scripts/your9-team-access.mjs --instance <customer-id>
 *   node scripts/your9-team-access.mjs --instance <customer-id> --port 4350
 */

import http from 'http';
import https from 'https';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync, unlinkSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, randomBytes, createHmac } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Roles and their capabilities
// ---------------------------------------------------------------------------

const ROLES = ['owner', 'manager', 'member', 'viewer'];

// What each role can do. Lower roles inherit nothing — explicit list.
const ROLE_PERMISSIONS = {
  owner: [
    'invite',          // invite new team members
    'remove',          // remove team members
    'set_role',        // change roles
    'approve',         // approve agent actions
    'reject',          // reject agent actions
    'message_agent',   // send instructions to agents
    'add_context',     // add context to tasks
    'view_dashboard',  // read dashboard
    'view_audit',      // read audit log
    'control_agent',   // pause/resume agents
    'edit_task',       // edit queued tasks
    'cancel_task',     // cancel queued tasks
  ],
  manager: [
    'approve',
    'reject',
    'message_agent',
    'add_context',
    'view_dashboard',
    'view_audit',
    'control_agent',
    'edit_task',
    'cancel_task',
  ],
  member: [
    'message_agent',
    'add_context',
    'view_dashboard',
  ],
  viewer: [
    'view_dashboard',
  ],
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const TEAM_LOG = join(ROOT, 'logs', 'your9-team-access.log');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] TEAM: ${msg}`;
  console.log(line);
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(TEAM_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// .env loader
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return {};
  const vars = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    vars[key] = val;
  }
  return vars;
}

const ENV = loadEnv();
const RESEND_API_KEY = ENV.RESEND_API_KEY || ENV.RESEND_API_KEY_FULL;
const EMAIL_FROM = ENV.YOUR9_AUTH_EMAIL_FROM || 'team@your9.ai';
const BASE_URL = ENV.YOUR9_AUTH_BASE_URL || 'https://your9.ai';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function instanceDir(customerId) {
  return join(INSTANCES_DIR, customerId);
}

function teamConfigPath(customerId) {
  return join(instanceDir(customerId), 'config', 'team.json');
}

function invitesDir(customerId) {
  return join(instanceDir(customerId), 'data', 'invites');
}

function auditLogPath(customerId) {
  return join(instanceDir(customerId), 'data', 'audit', 'team-actions.jsonl');
}

function tasksDir(customerId) {
  return join(instanceDir(customerId), 'data', 'tasks');
}

function sharedContextPath(customerId) {
  return join(instanceDir(customerId), 'data', 'shared-context.json');
}

// ---------------------------------------------------------------------------
// Directory setup
// ---------------------------------------------------------------------------

function ensureInstanceDirs(customerId) {
  const iDir = instanceDir(customerId);
  if (!existsSync(iDir)) {
    throw new Error(`Instance not found: ${customerId}`);
  }
  mkdirSync(join(iDir, 'config'), { recursive: true });
  mkdirSync(join(iDir, 'data', 'invites'), { recursive: true });
  mkdirSync(join(iDir, 'data', 'audit'), { recursive: true });
  mkdirSync(join(iDir, 'data', 'tasks'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Team config storage
// Stored in instances/{id}/config/team.json
//
// Shape:
// {
//   "customerId": "...",
//   "members": [
//     {
//       "id": "tmem_...",
//       "email": "alice@example.com",
//       "name": "Alice",
//       "role": "manager",
//       "status": "active",       // active | suspended
//       "invitedBy": "tmem_...",  // member id of inviter (or "founder")
//       "invitedAt": "...",
//       "acceptedAt": "...",
//       "lastActiveAt": null
//     }
//   ],
//   "updatedAt": "..."
// }
// ---------------------------------------------------------------------------

function loadTeamConfig(customerId) {
  const p = teamConfigPath(customerId);
  if (!existsSync(p)) {
    return { customerId, members: [], updatedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { customerId, members: [], updatedAt: new Date().toISOString() };
  }
}

function saveTeamConfig(customerId, config) {
  config.updatedAt = new Date().toISOString();
  const p = teamConfigPath(customerId);
  mkdirSync(join(instanceDir(customerId), 'config'), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Invite token storage
// One file per invite: instances/{id}/data/invites/{token}.json
// ---------------------------------------------------------------------------

function saveInvite(customerId, invite) {
  const dir = invitesDir(customerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${invite.token}.json`), JSON.stringify(invite, null, 2));
}

function loadInvite(customerId, token) {
  const p = join(invitesDir(customerId), `${token}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function deleteInvite(customerId, token) {
  const p = join(invitesDir(customerId), `${token}.json`);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* non-fatal */ }
  }
}

function listPendingInvites(customerId) {
  const dir = invitesDir(customerId);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(dir, f), 'utf8'));
        } catch { return null; }
      })
      .filter(inv => inv && inv.status === 'pending' && new Date(inv.expiresAt) > new Date());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Audit log — append-only JSONL
// Every human or AI action gets a record here.
// ---------------------------------------------------------------------------

function auditLog(customerId, entry) {
  const p = auditLogPath(customerId);
  mkdirSync(join(instanceDir(customerId), 'data', 'audit'), { recursive: true });
  const record = {
    id: `tact_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    timestamp: new Date().toISOString(),
    actorType: 'human',   // always 'human' from this module — AI actions logged separately
    ...entry,
  };
  try {
    appendFileSync(p, JSON.stringify(record) + '\n');
  } catch (e) {
    log(`Audit write failed: ${e.message}`);
  }
  return record;
}

function readAuditLog(customerId, limit = 100) {
  const p = auditLogPath(customerId);
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-limit)
      .reverse(); // newest first
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Email — raw HTTPS, matches auth.mjs pattern
// ---------------------------------------------------------------------------

function sendEmail({ to, subject, html, text }) {
  return new Promise((resolve) => {
    if (!RESEND_API_KEY) {
      log(`Email skipped (no RESEND_API_KEY): to=${to} subject="${subject}"`);
      resolve({ skipped: true });
      return;
    }
    const body = JSON.stringify({ from: EMAIL_FROM, to, subject, html, text });
    const opts = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const timer = setTimeout(() => {
      log(`Email timeout: to=${to}`);
      resolve({ skipped: true, reason: 'timeout' });
    }, 10000);
    const req = https.request(opts, res => {
      clearTimeout(timer);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            log(`Resend error ${res.statusCode}: ${JSON.stringify(parsed)}`);
            resolve({ skipped: true, reason: `resend_${res.statusCode}` });
          } else {
            log(`Email sent: to=${to} id=${parsed.id}`);
            resolve(parsed);
          }
        } catch (e) {
          resolve({ skipped: true, reason: e.message });
        }
      });
    });
    req.on('error', e => { clearTimeout(timer); resolve({ skipped: true, reason: e.message }); });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function inviteEmailHtml(inviterName, instanceName, role, acceptUrl) {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#111">
<h2>You've been invited to join ${escHtml(instanceName)} on Your9</h2>
<p>${escHtml(inviterName)} has invited you to join their AI-powered team workspace as a <strong>${escHtml(role)}</strong>.</p>
<p>Your9 gives you a dedicated AI team that handles operations, research, communications, and more — running 24/7 in the background.</p>
<p style="margin:32px 0">
  <a href="${acceptUrl}" style="background:#000;color:#fff;padding:14px 28px;text-decoration:none;border-radius:4px;font-weight:600">Accept Invitation</a>
</p>
<p style="color:#666;font-size:13px">This invitation expires in 7 days. If you were not expecting this, you can ignore it safely.</p>
<hr style="border:none;border-top:1px solid #eee;margin:32px 0">
<p style="color:#888;font-size:12px">Your9 by 9 Enterprises</p>
</body></html>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Core exported functions
// ---------------------------------------------------------------------------

/**
 * Invite a human team member to the instance.
 *
 * opts:
 *   email        {string}  — invitee email (required)
 *   role         {string}  — owner | manager | member | viewer (default: member)
 *   name         {string}  — invitee display name (optional)
 *   invitedBy    {string}  — member id of the inviter, or "founder"
 *   instanceName {string}  — human-readable name shown in the invite email
 *
 * Returns: { invite, acceptUrl }
 * Sends an invite email if RESEND_API_KEY is configured.
 */
async function inviteTeamMember(customerId, opts = {}) {
  ensureInstanceDirs(customerId);

  const { email, role = 'member', name = '', invitedBy = 'founder', instanceName = customerId } = opts;

  if (!email || typeof email !== 'string') {
    throw new Error('email is required');
  }
  if (!ROLES.includes(role)) {
    throw new Error(`Invalid role "${role}". Must be one of: ${ROLES.join(', ')}`);
  }

  const normalEmail = email.toLowerCase().trim();

  // Check for duplicate — already a member?
  const config = loadTeamConfig(customerId);
  const existing = config.members.find(m => m.email === normalEmail && m.status === 'active');
  if (existing) {
    throw new Error(`${normalEmail} is already a team member with role "${existing.role}"`);
  }

  // Check for existing pending invite
  const pending = listPendingInvites(customerId).find(inv => inv.email === normalEmail);
  if (pending) {
    throw new Error(`A pending invite already exists for ${normalEmail} — expires ${pending.expiresAt}`);
  }

  const token = randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const invite = {
    token,
    customerId,
    email: normalEmail,
    name: name.trim(),
    role,
    invitedBy,
    instanceName,
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  };

  saveInvite(customerId, invite);
  log(`Invite created: ${normalEmail} as ${role} for instance ${customerId}`);

  const acceptUrl = `${BASE_URL}/team/accept?token=${token}&instance=${customerId}`;

  // Audit
  const inviterLabel = invitedBy === 'founder' ? 'founder' : `member:${invitedBy}`;
  auditLog(customerId, {
    action: 'invite_sent',
    actorId: invitedBy,
    actorLabel: inviterLabel,
    targetEmail: normalEmail,
    role,
    inviteToken: token,
  });

  // Send email (non-blocking — resolve regardless of email success)
  const inviterName = invitedBy === 'founder' ? 'Your team admin' : `A team member`;
  sendEmail({
    to: normalEmail,
    subject: `You've been invited to ${instanceName} on Your9`,
    html: inviteEmailHtml(inviterName, instanceName, role, acceptUrl),
    text: `You've been invited to join ${instanceName} as a ${role}. Accept here: ${acceptUrl}`,
  }).catch(e => log(`Invite email failed: ${e.message}`));

  return { invite, acceptUrl };
}

/**
 * Accept an invite token and create the team member record.
 *
 * opts:
 *   token {string} — invite token from the invite link
 *   name  {string} — member's display name (can override invite name)
 *
 * Returns: the new team member object.
 */
function acceptInvite(customerId, opts = {}) {
  ensureInstanceDirs(customerId);

  const { token, name } = opts;
  if (!token) throw new Error('token is required');

  const invite = loadInvite(customerId, token);
  if (!invite) throw new Error('Invite not found or already used');
  if (invite.status !== 'pending') throw new Error(`Invite already ${invite.status}`);
  if (new Date(invite.expiresAt) <= new Date()) throw new Error('Invite has expired');

  const config = loadTeamConfig(customerId);

  // Re-check for duplicate (race condition guard)
  const dup = config.members.find(m => m.email === invite.email && m.status === 'active');
  if (dup) {
    deleteInvite(customerId, token);
    throw new Error(`${invite.email} is already a team member`);
  }

  const memberId = `tmem_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = new Date().toISOString();
  const member = {
    id: memberId,
    email: invite.email,
    name: (name && name.trim()) || invite.name || invite.email.split('@')[0],
    role: invite.role,
    status: 'active',
    invitedBy: invite.invitedBy,
    invitedAt: invite.createdAt,
    acceptedAt: now,
    lastActiveAt: now,
  };

  config.members.push(member);
  saveTeamConfig(customerId, config);

  // Consume invite
  invite.status = 'accepted';
  invite.acceptedAt = now;
  invite.memberId = memberId;
  saveInvite(customerId, invite);

  log(`Invite accepted: ${invite.email} joined as ${invite.role} (${memberId})`);

  auditLog(customerId, {
    action: 'invite_accepted',
    actorId: memberId,
    actorLabel: member.name,
    memberId,
    email: invite.email,
    role: invite.role,
  });

  return member;
}

/**
 * Set (or update) a team member's role.
 *
 * memberId  — the team member's id (tmem_...)
 * newRole   — owner | manager | member | viewer
 * changedBy — id of the person making the change
 */
function setPermissions(customerId, memberId, newRole, changedBy = 'founder') {
  if (!ROLES.includes(newRole)) {
    throw new Error(`Invalid role "${newRole}". Must be one of: ${ROLES.join(', ')}`);
  }

  const config = loadTeamConfig(customerId);
  const member = config.members.find(m => m.id === memberId);
  if (!member) throw new Error(`Member not found: ${memberId}`);
  if (member.status !== 'active') throw new Error(`Member ${memberId} is not active`);

  const oldRole = member.role;
  member.role = newRole;
  member.roleChangedAt = new Date().toISOString();
  member.roleChangedBy = changedBy;

  saveTeamConfig(customerId, config);
  log(`Role change: ${memberId} ${oldRole} -> ${newRole} by ${changedBy}`);

  auditLog(customerId, {
    action: 'role_changed',
    actorId: changedBy,
    actorLabel: changedBy === 'founder' ? 'founder' : `member:${changedBy}`,
    targetMemberId: memberId,
    targetName: member.name,
    oldRole,
    newRole,
  });

  return member;
}

/**
 * List all team members for an instance.
 * Returns array of member objects, active members first.
 */
function listTeamMembers(customerId) {
  const config = loadTeamConfig(customerId);
  const members = config.members || [];

  // Sort: active first, then by acceptedAt desc
  return [...members].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return new Date(b.acceptedAt || 0) - new Date(a.acceptedAt || 0);
  });
}

/**
 * Check if a team member has a specific permission.
 *
 * memberId — the team member's id, or "founder"
 * action   — permission string (see ROLE_PERMISSIONS)
 *
 * Returns: { allowed: boolean, role: string | null, reason: string }
 */
function checkPermission(customerId, memberId, action) {
  // Founder always has full access
  if (memberId === 'founder') {
    return { allowed: true, role: 'owner', reason: 'founder' };
  }

  const config = loadTeamConfig(customerId);
  const member = config.members.find(m => m.id === memberId);

  if (!member) {
    return { allowed: false, role: null, reason: 'member_not_found' };
  }
  if (member.status !== 'active') {
    return { allowed: false, role: member.role, reason: 'member_suspended' };
  }

  const perms = ROLE_PERMISSIONS[member.role] || [];
  const allowed = perms.includes(action);

  return {
    allowed,
    role: member.role,
    reason: allowed ? 'permitted' : `role_${member.role}_cannot_${action}`,
  };
}

/**
 * Remove a team member (sets status to 'suspended').
 * Hard-delete is not done — preserves audit history.
 */
function removeTeamMember(customerId, memberId, removedBy = 'founder') {
  const config = loadTeamConfig(customerId);
  const member = config.members.find(m => m.id === memberId);
  if (!member) throw new Error(`Member not found: ${memberId}`);

  member.status = 'suspended';
  member.removedAt = new Date().toISOString();
  member.removedBy = removedBy;

  saveTeamConfig(customerId, config);
  log(`Member removed: ${memberId} (${member.email}) by ${removedBy}`);

  auditLog(customerId, {
    action: 'member_removed',
    actorId: removedBy,
    actorLabel: removedBy === 'founder' ? 'founder' : `member:${removedBy}`,
    targetMemberId: memberId,
    targetEmail: member.email,
    targetName: member.name,
  });

  return { removed: true, memberId };
}

/**
 * Human team member sends a message/instruction to an agent or the CEO.
 * Writes to tasks dir so the hub picks it up. Also records in audit log.
 *
 * opts:
 *   memberId  {string} — sender's team member id
 *   agentId   {string} — target agent id, or "ceo"
 *   message   {string} — instruction text (max 4000 chars)
 */
function sendMessageToAgent(customerId, opts = {}) {
  const { memberId, agentId, message } = opts;
  if (!memberId || !agentId || !message) {
    throw new Error('memberId, agentId, and message are required');
  }

  const perm = checkPermission(customerId, memberId, 'message_agent');
  if (!perm.allowed) {
    throw new Error(`Permission denied: ${perm.reason}`);
  }

  // Resolve member name for readability
  const config = loadTeamConfig(customerId);
  const member = config.members.find(m => m.id === memberId);
  const memberName = member ? member.name : memberId;

  // Update lastActiveAt
  if (member) {
    member.lastActiveAt = new Date().toISOString();
    saveTeamConfig(customerId, config);
  }

  const ts = Date.now();
  const taskId = `${ts}-team-msg`;
  const task = {
    id: taskId,
    type: 'team_member_instruction',
    agentId,
    task: message.slice(0, 4000),
    source: 'team_member',
    actorType: 'human',
    actorId: memberId,
    actorName: memberName,
    status: 'queued',
    loggedAt: new Date().toISOString(),
  };

  const tDir = tasksDir(customerId);
  mkdirSync(tDir, { recursive: true });
  writeFileSync(join(tDir, `${taskId}-task.json`), JSON.stringify(task, null, 2));

  // Also push to shared context so hub sees it immediately
  const ctxPath = sharedContextPath(customerId);
  let ctx = { lastUpdated: null, entries: {} };
  if (existsSync(ctxPath)) {
    try { ctx = JSON.parse(readFileSync(ctxPath, 'utf8')); } catch {}
  }
  if (!ctx.entries) ctx.entries = {};
  ctx.entries[`team_instruction_${ts}`] = {
    value: `Team member ${memberName} to ${agentId}: ${message.slice(0, 300)}`,
    writtenBy: memberId,
    writtenByType: 'human',
    writtenAt: new Date().toISOString(),
  };
  ctx.lastUpdated = new Date().toISOString();
  writeFileSync(ctxPath, JSON.stringify(ctx, null, 2));

  const auditEntry = auditLog(customerId, {
    action: 'message_sent',
    actorId: memberId,
    actorName: memberName,
    targetAgentId: agentId,
    messagePreview: message.slice(0, 200),
    taskId,
  });

  log(`Team message: ${memberName} -> ${agentId}: "${message.slice(0, 60)}..."`);
  return { taskId, auditEntry };
}

/**
 * Human team member approves an agent action.
 * Writes an approval record to audit and to data/controls/.
 *
 * opts:
 *   memberId    {string} — approver's member id
 *   actionId    {string} — the agent action id being approved
 *   note        {string} — optional note (max 1000 chars)
 */
function approveAgentAction(customerId, opts = {}) {
  const { memberId, actionId, note = '' } = opts;
  if (!memberId || !actionId) throw new Error('memberId and actionId are required');

  const perm = checkPermission(customerId, memberId, 'approve');
  if (!perm.allowed) throw new Error(`Permission denied: ${perm.reason}`);

  const config = loadTeamConfig(customerId);
  const member = config.members.find(m => m.id === memberId);
  const memberName = member ? member.name : memberId;

  if (member) {
    member.lastActiveAt = new Date().toISOString();
    saveTeamConfig(customerId, config);
  }

  // Write approval to controls dir so hub/CEO picks it up
  const controlsDir = join(instanceDir(customerId), 'data', 'controls');
  mkdirSync(controlsDir, { recursive: true });
  const ts = Date.now();
  const controlRecord = {
    type: 'team_approval',
    actionId,
    approvedBy: memberId,
    approverName: memberName,
    approverRole: member ? member.role : 'unknown',
    actorType: 'human',
    note: note.slice(0, 1000),
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  writeFileSync(
    join(controlsDir, `${ts}-approval-${actionId.slice(0, 20)}.json`),
    JSON.stringify(controlRecord, null, 2)
  );

  const auditEntry = auditLog(customerId, {
    action: 'action_approved',
    actorId: memberId,
    actorName: memberName,
    actionId,
    note: note.slice(0, 500),
  });

  log(`Approval: ${memberName} approved action ${actionId}`);
  return { approved: true, actionId, auditEntry };
}

/**
 * Human team member rejects an agent action.
 *
 * opts:
 *   memberId {string} — rejector's member id
 *   actionId {string} — the agent action id being rejected
 *   reason   {string} — required rejection reason (max 2000 chars)
 */
function rejectAgentAction(customerId, opts = {}) {
  const { memberId, actionId, reason = '' } = opts;
  if (!memberId || !actionId) throw new Error('memberId and actionId are required');
  if (!reason.trim()) throw new Error('reason is required for rejection');

  const perm = checkPermission(customerId, memberId, 'reject');
  if (!perm.allowed) throw new Error(`Permission denied: ${perm.reason}`);

  const config = loadTeamConfig(customerId);
  const member = config.members.find(m => m.id === memberId);
  const memberName = member ? member.name : memberId;

  if (member) {
    member.lastActiveAt = new Date().toISOString();
    saveTeamConfig(customerId, config);
  }

  const controlsDir = join(instanceDir(customerId), 'data', 'controls');
  mkdirSync(controlsDir, { recursive: true });
  const ts = Date.now();
  const controlRecord = {
    type: 'team_rejection',
    actionId,
    rejectedBy: memberId,
    rejectorName: memberName,
    rejectorRole: member ? member.role : 'unknown',
    actorType: 'human',
    reason: reason.slice(0, 2000),
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  writeFileSync(
    join(controlsDir, `${ts}-rejection-${actionId.slice(0, 20)}.json`),
    JSON.stringify(controlRecord, null, 2)
  );

  // Also write a reconsider task for the CEO (same pattern as dashboard.mjs challenges)
  const tDir = tasksDir(customerId);
  mkdirSync(tDir, { recursive: true });
  const taskId = `${ts}-team-reject`;
  const task = {
    id: taskId,
    type: 'reconsider',
    agentId: 'ceo',
    task: `Team member ${memberName} rejected action ${actionId}. Reason: ${reason.slice(0, 500)}`,
    rejectedActionId: actionId,
    rejectionReason: reason.slice(0, 2000),
    actorType: 'human',
    actorId: memberId,
    actorName: memberName,
    status: 'queued',
    loggedAt: new Date().toISOString(),
  };
  writeFileSync(join(tDir, `${taskId}-task.json`), JSON.stringify(task, null, 2));

  const auditEntry = auditLog(customerId, {
    action: 'action_rejected',
    actorId: memberId,
    actorName: memberName,
    actionId,
    reason: reason.slice(0, 500),
    taskId,
  });

  log(`Rejection: ${memberName} rejected action ${actionId}: "${reason.slice(0, 60)}"`);
  return { rejected: true, actionId, taskId, auditEntry };
}

/**
 * Human team member adds context to an existing task.
 * Appends context to the task file and shared context map.
 *
 * opts:
 *   memberId {string} — member adding context
 *   taskId   {string} — target task id (without -task.json suffix)
 *   context  {string} — context text (max 2000 chars)
 */
function addContextToTask(customerId, opts = {}) {
  const { memberId, taskId, context } = opts;
  if (!memberId || !taskId || !context) {
    throw new Error('memberId, taskId, and context are required');
  }

  const perm = checkPermission(customerId, memberId, 'add_context');
  if (!perm.allowed) throw new Error(`Permission denied: ${perm.reason}`);

  const config = loadTeamConfig(customerId);
  const member = config.members.find(m => m.id === memberId);
  const memberName = member ? member.name : memberId;

  if (member) {
    member.lastActiveAt = new Date().toISOString();
    saveTeamConfig(customerId, config);
  }

  const tDir = tasksDir(customerId);
  const taskFile = join(tDir, `${taskId}-task.json`);
  if (!existsSync(taskFile)) throw new Error(`Task not found: ${taskId}`);

  const task = JSON.parse(readFileSync(taskFile, 'utf8'));

  // Append context entries array to task
  if (!task.humanContext) task.humanContext = [];
  task.humanContext.push({
    addedBy: memberId,
    addedByName: memberName,
    addedAt: new Date().toISOString(),
    text: context.slice(0, 2000),
  });
  writeFileSync(taskFile, JSON.stringify(task, null, 2));

  // Also push to shared context
  const ctxPath = sharedContextPath(customerId);
  let ctx = { lastUpdated: null, entries: {} };
  if (existsSync(ctxPath)) {
    try { ctx = JSON.parse(readFileSync(ctxPath, 'utf8')); } catch {}
  }
  if (!ctx.entries) ctx.entries = {};
  const ts = Date.now();
  ctx.entries[`team_context_${ts}`] = {
    value: `Context from ${memberName} on task ${taskId}: ${context.slice(0, 300)}`,
    writtenBy: memberId,
    writtenByType: 'human',
    writtenAt: new Date().toISOString(),
  };
  ctx.lastUpdated = new Date().toISOString();
  writeFileSync(ctxPath, JSON.stringify(ctx, null, 2));

  const auditEntry = auditLog(customerId, {
    action: 'context_added',
    actorId: memberId,
    actorName: memberName,
    taskId,
    contextPreview: context.slice(0, 200),
  });

  log(`Context added: ${memberName} -> task ${taskId}`);
  return { contextAdded: true, taskId, auditEntry };
}

// ---------------------------------------------------------------------------
// Dashboard panel data — for embedding in your9-dashboard.mjs output
// ---------------------------------------------------------------------------

/**
 * Build the team panel data for the dashboard.
 * Returns a plain object — caller renders it as HTML.
 */
function buildTeamPanelData(customerId) {
  const members = listTeamMembers(customerId);
  const recentActivity = readAuditLog(customerId, 20);
  const pendingInvites = listPendingInvites(customerId);

  return {
    members,
    pendingInvites,
    recentActivity,
    summary: {
      total: members.filter(m => m.status === 'active').length,
      owners: members.filter(m => m.role === 'owner' && m.status === 'active').length,
      managers: members.filter(m => m.role === 'manager' && m.status === 'active').length,
      members: members.filter(m => m.role === 'member' && m.status === 'active').length,
      viewers: members.filter(m => m.role === 'viewer' && m.status === 'active').length,
      pendingInvites: pendingInvites.length,
    },
  };
}

/**
 * Render the team panel as an HTML string for embedding in the dashboard.
 */
function renderTeamPanelHtml(customerId) {
  const data = buildTeamPanelData(customerId);
  const { members, pendingInvites, recentActivity, summary } = data;

  const roleBadge = r => {
    const colors = {
      owner: '#000',
      manager: '#1a56db',
      member: '#0e9f6e',
      viewer: '#6b7280',
    };
    const bg = colors[r] || '#6b7280';
    return `<span style="background:${bg};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase">${escHtml(r)}</span>`;
  };

  const memberRows = members.map(m => {
    const lastActive = m.lastActiveAt
      ? new Date(m.lastActiveAt).toLocaleDateString()
      : 'Never';
    const statusBadge = m.status === 'active'
      ? '<span style="color:#0e9f6e;font-size:12px">Active</span>'
      : '<span style="color:#9ca3af;font-size:12px">Removed</span>';
    return `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 8px">
          <div style="font-weight:500;font-size:14px">${escHtml(m.name)}</div>
          <div style="color:#6b7280;font-size:12px">${escHtml(m.email)}</div>
        </td>
        <td style="padding:10px 8px">${roleBadge(m.role)}</td>
        <td style="padding:10px 8px">${statusBadge}</td>
        <td style="padding:10px 8px;color:#6b7280;font-size:12px">${lastActive}</td>
      </tr>`;
  }).join('');

  const inviteRows = pendingInvites.length === 0
    ? '<tr><td colspan="3" style="padding:10px 8px;color:#9ca3af;font-size:13px">No pending invitations</td></tr>'
    : pendingInvites.map(inv => `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px">${escHtml(inv.email)}</td>
        <td style="padding:8px">${roleBadge(inv.role)}</td>
        <td style="padding:8px;color:#6b7280;font-size:12px">Expires ${new Date(inv.expiresAt).toLocaleDateString()}</td>
      </tr>`).join('');

  const activityRows = recentActivity.length === 0
    ? '<p style="color:#9ca3af;font-size:13px">No team activity yet.</p>'
    : recentActivity.slice(0, 10).map(a => {
        const ts = new Date(a.timestamp).toLocaleString();
        const label = a.actorName || a.actorLabel || a.actorId || 'unknown';
        return `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px">
          <span style="color:#6b7280">${ts}</span> —
          <strong>${escHtml(label)}</strong> ${escHtml(a.action.replace(/_/g, ' '))}
          ${a.targetAgentId ? `<span style="color:#6b7280"> → ${escHtml(a.targetAgentId)}</span>` : ''}
        </div>`;
      }).join('');

  return `
<div style="font-family:sans-serif;color:#111;padding:24px;max-width:900px">
  <h2 style="margin:0 0 4px;font-size:20px">Team Access</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px">
    ${summary.total} active member${summary.total !== 1 ? 's' : ''} &bull;
    ${summary.pendingInvites} pending invite${summary.pendingInvites !== 1 ? 's' : ''}
  </p>

  <!-- Summary badges -->
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
    ${summary.owners ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:80px;text-align:center"><div style="font-size:22px;font-weight:700">${summary.owners}</div><div style="font-size:11px;color:#6b7280;text-transform:uppercase">Owner${summary.owners !== 1 ? 's' : ''}</div></div>` : ''}
    ${summary.managers ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:80px;text-align:center"><div style="font-size:22px;font-weight:700">${summary.managers}</div><div style="font-size:11px;color:#6b7280;text-transform:uppercase">Manager${summary.managers !== 1 ? 's' : ''}</div></div>` : ''}
    ${summary.members ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:80px;text-align:center"><div style="font-size:22px;font-weight:700">${summary.members}</div><div style="font-size:11px;color:#6b7280;text-transform:uppercase">Member${summary.members !== 1 ? 's' : ''}</div></div>` : ''}
    ${summary.viewers ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:80px;text-align:center"><div style="font-size:22px;font-weight:700">${summary.viewers}</div><div style="font-size:11px;color:#6b7280;text-transform:uppercase">Viewer${summary.viewers !== 1 ? 's' : ''}</div></div>` : ''}
  </div>

  <!-- Active members table -->
  <h3 style="font-size:15px;margin:0 0 12px">Team Members</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:32px">
    <thead>
      <tr style="text-align:left;border-bottom:2px solid #e5e7eb">
        <th style="padding:8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Member</th>
        <th style="padding:8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Role</th>
        <th style="padding:8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Status</th>
        <th style="padding:8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Last Active</th>
      </tr>
    </thead>
    <tbody>${memberRows || '<tr><td colspan="4" style="padding:10px 8px;color:#9ca3af;font-size:13px">No team members yet. Invite your first member below.</td></tr>'}</tbody>
  </table>

  <!-- Pending invites -->
  <h3 style="font-size:15px;margin:0 0 12px">Pending Invitations</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:32px">
    <thead>
      <tr style="text-align:left;border-bottom:2px solid #e5e7eb">
        <th style="padding:8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Email</th>
        <th style="padding:8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Role</th>
        <th style="padding:8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase">Expiry</th>
      </tr>
    </thead>
    <tbody>${inviteRows}</tbody>
  </table>

  <!-- Recent activity -->
  <h3 style="font-size:15px;margin:0 0 12px">Recent Team Activity</h3>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px">
    ${activityRows}
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// HTTP request body reader
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 65536) reject(new Error('Body too large')); });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// HTTP response helpers
// ---------------------------------------------------------------------------

function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Your9-Module': 'team-access',
  });
  res.end(body);
}

function err(res, status, message) {
  json(res, status, { error: message });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function startServer(customerId, port) {
  ensureInstanceDirs(customerId);
  log(`Starting team-access server: instance=${customerId} port=${port}`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = req.method.toUpperCase();

    try {
      // Health
      if (method === 'GET' && path === '/health') {
        return json(res, 200, {
          status: 'ok',
          module: 'your9-team-access',
          instance: customerId,
          port,
          timestamp: new Date().toISOString(),
        });
      }

      // Invite a team member
      // POST /invite { email, role, name, invitedBy, instanceName }
      if (method === 'POST' && path === '/invite') {
        const body = await readBody(req);
        const result = await inviteTeamMember(customerId, body);
        return json(res, 201, { success: true, ...result });
      }

      // Accept an invite
      // POST /accept { token, name }
      if (method === 'POST' && path === '/accept') {
        const body = await readBody(req);
        const member = acceptInvite(customerId, body);
        return json(res, 200, { success: true, member });
      }

      // List members
      // GET /members
      if (method === 'GET' && path === '/members') {
        const members = listTeamMembers(customerId);
        const pending = listPendingInvites(customerId);
        return json(res, 200, { members, pendingInvites: pending });
      }

      // Change member role
      // POST /members/:id/role { role, changedBy }
      const roleMatch = path.match(/^\/members\/([^/]+)\/role$/);
      if (method === 'POST' && roleMatch) {
        const memberId = decodeURIComponent(roleMatch[1]);
        const body = await readBody(req);
        const member = setPermissions(customerId, memberId, body.role, body.changedBy || 'founder');
        return json(res, 200, { success: true, member });
      }

      // Remove a member
      // POST /members/:id/remove { removedBy }
      const removeMatch = path.match(/^\/members\/([^/]+)\/remove$/);
      if (method === 'POST' && removeMatch) {
        const memberId = decodeURIComponent(removeMatch[1]);
        const body = await readBody(req);
        const result = removeTeamMember(customerId, memberId, body.removedBy || 'founder');
        return json(res, 200, { success: true, ...result });
      }

      // Check a permission
      // GET /permission?member=tmem_...&action=approve
      if (method === 'GET' && path === '/permission') {
        const memberId = url.searchParams.get('member') || '';
        const action = url.searchParams.get('action') || '';
        if (!memberId || !action) return err(res, 400, 'member and action query params required');
        const result = checkPermission(customerId, memberId, action);
        return json(res, 200, result);
      }

      // Member sends a message to an agent
      // POST /message { memberId, agentId, message }
      if (method === 'POST' && path === '/message') {
        const body = await readBody(req);
        const result = sendMessageToAgent(customerId, body);
        return json(res, 201, { success: true, ...result });
      }

      // Member approves an agent action
      // POST /approve { memberId, actionId, note }
      if (method === 'POST' && path === '/approve') {
        const body = await readBody(req);
        const result = approveAgentAction(customerId, body);
        return json(res, 200, { success: true, ...result });
      }

      // Member rejects an agent action
      // POST /reject { memberId, actionId, reason }
      if (method === 'POST' && path === '/reject') {
        const body = await readBody(req);
        const result = rejectAgentAction(customerId, body);
        return json(res, 200, { success: true, ...result });
      }

      // Member adds context to a task
      // POST /context { memberId, taskId, context }
      if (method === 'POST' && path === '/context') {
        const body = await readBody(req);
        const result = addContextToTask(customerId, body);
        return json(res, 200, { success: true, ...result });
      }

      // Team activity feed
      // GET /activity?limit=50
      if (method === 'GET' && path === '/activity') {
        const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50'));
        const activity = readAuditLog(customerId, limit);
        return json(res, 200, { activity, count: activity.length });
      }

      // Dashboard panel — HTML for embedding
      // GET /panel
      if (method === 'GET' && path === '/panel') {
        const html = renderTeamPanelHtml(customerId);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      // Dashboard panel — JSON data
      // GET /panel/data
      if (method === 'GET' && path === '/panel/data') {
        const data = buildTeamPanelData(customerId);
        return json(res, 200, data);
      }

      return err(res, 404, `Route not found: ${method} ${path}`);

    } catch (e) {
      log(`Request error: ${method} ${path} — ${e.message}`);
      return err(res, e.message.includes('Permission denied') ? 403 : 400, e.message);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log(`Team access server live: http://127.0.0.1:${port}`);
    log(`Instance: ${customerId}`);
    log(`Roles available: ${ROLES.join(', ')}`);
  });

  server.on('error', e => {
    log(`Server error: ${e.message}`);
    if (e.code === 'EADDRINUSE') {
      log(`Port ${port} in use — try a different port with --port`);
      process.exit(1);
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv);
  const customerId = args.instance;

  if (!customerId) {
    console.error('Usage: node scripts/your9-team-access.mjs --instance <customer-id>');
    console.error('       node scripts/your9-team-access.mjs --instance <customer-id> --port 4350');
    process.exit(1);
  }

  const iDir = join(INSTANCES_DIR, customerId);
  if (!existsSync(iDir)) {
    console.error(`Instance not found: ${iDir}`);
    console.error('Run your9-provision.mjs first to create the instance.');
    process.exit(1);
  }

  // Derive port: hub port (hash-based 4000-4899) + 150
  // This avoids collision with hub (+0) and dashboard (+100)
  function deriveTeamPort(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return 4150 + (hash % 750);
  }

  const port = args.port ? parseInt(args.port) : deriveTeamPort(customerId);
  startServer(customerId, port);
}

// ---------------------------------------------------------------------------
// Exports — library mode
// ---------------------------------------------------------------------------

export {
  inviteTeamMember,
  setPermissions,
  listTeamMembers,
  checkPermission,
  acceptInvite,
  removeTeamMember,
  sendMessageToAgent,
  approveAgentAction,
  rejectAgentAction,
  addContextToTask,
  buildTeamPanelData,
  renderTeamPanelHtml,
  ROLES,
  ROLE_PERMISSIONS,
};
