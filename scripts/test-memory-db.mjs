/**
 * test-memory-db.mjs
 * Smoke test for memory-db.mjs — runs all major methods and prints results.
 * Run with: node scripts/test-memory-db.mjs
 */

import { db } from './memory-db.mjs';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

console.log('\n=== MemoryDB smoke test ===\n');

// ── Messages ──────────────────────────────────────────────────────────────

console.log('[ Messages ]');

const msgId = db.logMessage('telegram', 'in', 'Test message from Tee', { source: 'test-suite' });
assert('logMessage returns id', typeof msgId === 'number' && msgId > 0, `got: ${msgId}`);

const recent = db.getRecentMessages(1);
assert('getRecentMessages finds logged message', recent.some(m => m.id === msgId));

const unread = db.getUnreadMessages();
const unreadMsg = unread.find(m => m.id === msgId);
assert('getUnreadMessages includes new message', !!unreadMsg);

db.markRead(msgId);
const unreadAfter = db.getUnreadMessages();
assert('markRead removes from unread', !unreadAfter.some(m => m.id === msgId));

// Channel filter
const channelMsgs = db.getRecentMessages(1, 'telegram');
assert('getRecentMessages channel filter works', channelMsgs.some(m => m.id === msgId));

const wrongChannel = db.getRecentMessages(1, 'imessage');
const wrongChannelHasMsg = wrongChannel.some(m => m.id === msgId);
assert('getRecentMessages channel filter excludes wrong channel', !wrongChannelHasMsg);

// ── Actions ───────────────────────────────────────────────────────────────

console.log('\n[ Actions ]');

const actionDescription = `Test deploy to production at ${Date.now()}`;
const actionId = db.logAction('deploy', actionDescription, 'completed', { env: 'prod', version: '1.0.0' });
assert('logAction returns id', typeof actionId === 'number' && actionId > 0, `got: ${actionId}`);

const recentActions = db.getRecentActions(1);
assert('getRecentActions finds logged action', recentActions.some(a => a.id === actionId));

const wasCompleted = db.wasActionCompleted(actionDescription);
assert('wasActionCompleted returns true for completed action', wasCompleted === true);

const notCompleted = db.wasActionCompleted('this action never happened ' + Date.now());
assert('wasActionCompleted returns false for unknown action', notCompleted === false);

// ── Authority ─────────────────────────────────────────────────────────────

console.log('\n[ Authority ]');

const perm = 'deploy_without_asking_test_' + Date.now();
db.grantAuthority(perm, 'May deploy code without asking Owner', 'Owner said: ship when ready.');

const check = db.checkAuthority(perm);
assert('checkAuthority returns authorized=true for granted permission', check.authorized === true);
assert('checkAuthority details includes description', check.details.includes('Active since'));

const authorities = db.listAuthorities();
assert('listAuthorities includes new permission', authorities.some(a => a.permission === perm));

db.revokeAuthority(perm);
const checkAfterRevoke = db.checkAuthority(perm);
assert('checkAuthority returns authorized=false after revoke', checkAfterRevoke.authorized === false);

// Unknown permission
const unknownCheck = db.checkAuthority('this_perm_does_not_exist_' + Date.now());
assert('checkAuthority handles unknown permission gracefully', unknownCheck.authorized === false);

// ── Memory ────────────────────────────────────────────────────────────────

console.log('\n[ Memory ]');

const memName = 'test_memory_entry_' + Date.now();
db.saveMemory(memName, 'project', 'A test memory entry', 'This is the full content of the test memory.');

const mem = db.getMemory(memName);
assert('getMemory retrieves saved entry', !!mem && mem.name === memName);
assert('getMemory has correct type', mem?.type === 'project');

// Upsert — update existing
db.saveMemory(memName, 'project', 'Updated description', 'Updated content.');
const memUpdated = db.getMemory(memName);
assert('saveMemory upserts existing entry', memUpdated?.description === 'Updated description');

// Search by name (name never changes on upsert) and by updated content
const searchResults = db.searchMemory('Updated');
assert('searchMemory finds entry by content', searchResults.some(m => m.name === memName));

const listAll = db.listMemories();
assert('listMemories returns entries', listAll.length > 0);

const listByType = db.listMemories('project');
assert('listMemories filters by type', listByType.some(m => m.name === memName));

db.deleteMemory(memName);
const memAfterDelete = db.getMemory(memName);
assert('deleteMemory removes entry', memAfterDelete === null || memAfterDelete === undefined);

// ── Tasks ─────────────────────────────────────────────────────────────────

console.log('\n[ Tasks ]');

const taskId = db.createTask(
  'Test task from Tee',
  'Verify that the task queue works correctly.',
  'Tee',
  'high',
  'BengalOracle'
);
assert('createTask returns id', typeof taskId === 'number' && taskId > 0, `got: ${taskId}`);

const queued = db.getTasksByStatus('queued');
assert('getTasksByStatus finds queued task', queued.some(t => t.id === taskId));

const byAssignee = db.getTasksByAssignee('Tee');
assert('getTasksByAssignee finds task', byAssignee.some(t => t.id === taskId));

const active = db.getActiveTasks();
assert('getActiveTasks includes queued task', active.some(t => t.id === taskId));

db.updateTask(taskId, { status: 'in_progress' });
const inProgress = db.getTasksByStatus('in_progress');
assert('updateTask changes status to in_progress', inProgress.some(t => t.id === taskId));
// started_at should be auto-set
const updatedTask = inProgress.find(t => t.id === taskId);
assert('updateTask auto-sets started_at for in_progress', !!updatedTask?.started_at);

db.completeTask(taskId, 'All assertions passed.');
const completed = db.getTasksByStatus('completed');
assert('completeTask marks task done', completed.some(t => t.id === taskId));
const completedTask = completed.find(t => t.id === taskId);
assert('completeTask stores result', completedTask?.result === 'All assertions passed.');

// ── Context rebuild ───────────────────────────────────────────────────────

console.log('\n[ rebuildContext ]');

const ctx = db.rebuildContext(1);
assert('rebuildContext returns messages array', Array.isArray(ctx.messages));
assert('rebuildContext returns actions array', Array.isArray(ctx.actions));
assert('rebuildContext returns authorities array', Array.isArray(ctx.authorities));
assert('rebuildContext returns active_tasks array', Array.isArray(ctx.active_tasks));
assert('rebuildContext has generated_at', typeof ctx.generated_at === 'string');
assert('rebuildContext messages includes test message', ctx.messages.some(m => m.id === msgId));
assert('rebuildContext actions includes test action', ctx.actions.some(a => a.id === actionId));

console.log('\n--- Context snapshot ---');
console.log(`  Messages (last 1h):   ${ctx.messages.length}`);
console.log(`  Actions  (last 1h):   ${ctx.actions.length}`);
console.log(`  Active authorities:   ${ctx.authorities.length}`);
console.log(`  Active tasks:         ${ctx.active_tasks.length}`);

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

db.close();

if (failed > 0) {
  process.exit(1);
}
