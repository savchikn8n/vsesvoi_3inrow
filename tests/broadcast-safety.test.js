const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function runBroadcastSource() {
  const dashboard = readRepoFile('dashboard.js');
  const start = dashboard.indexOf('async function runBroadcast(');
  const end = dashboard.indexOf('function applyFormatToBroadcast(');
  assert.ok(start >= 0 && end > start, 'runBroadcast must exist');
  return dashboard.slice(start, end);
}

test('a mass send asks for confirmation with the real audience first', () => {
  const source = runBroadcastSource();

  // One tap on a phone used to message every player and credit claps.
  const audienceAt = source.indexOf('dryRun: true', source.indexOf('if (dryRun)') + 20);
  const confirmAt = source.indexOf('window.confirm(');
  const sendAt = source.indexOf('dryRun: false');
  assert.ok(audienceAt > 0 && confirmAt > audienceAt && sendAt > confirmAt);
  assert.match(source, /ладошек/);
});

test('broadcast buttons are locked while a request is in flight', () => {
  const dashboard = readRepoFile('dashboard.js');
  const source = runBroadcastSource();

  assert.match(source, /if \(isBroadcastBusy\) return;/);
  assert.match(source, /setBroadcastBusy\(true\)/);
  assert.match(source, /finally \{\s*setBroadcastBusy\(false\);/);
  assert.match(dashboard, /broadcastSendBtnEl, broadcastScheduleSendBtnEl, broadcastDryRunBtnEl/);
});

test('a retried broadcast reuses its id and the real send outlasts the normal timeout', () => {
  const dashboard = readRepoFile('dashboard.js');
  const source = runBroadcastSource();

  assert.match(source, /pendingBroadcast\.key !== broadcastKey/);
  assert.match(source, /broadcastId: pendingBroadcast\.id/);
  assert.match(source, /BROADCAST_TIMEOUT_MS\)/);
  assert.match(dashboard, /async function postDashboardJson\(url, payload, timeoutMs = REQUEST_TIMEOUT_MS\)/);
  assert.match(dashboard, /AbortSignal\.timeout\(timeoutMs\)/);
});

test('messages-admin rejects a repeated broadcast id instead of sending twice', () => {
  const fn = readRepoFile('supabase/functions/messages-admin/index.ts');

  assert.match(fn, /normalizeBroadcastId\(body\?\.broadcastId\)/);
  assert.match(fn, /id: broadcastId,/);
  assert.doesNotMatch(fn, /const broadcastId = crypto\.randomUUID\(\);/);
  // Both the immediate and the scheduled insert must stop on a duplicate key.
  assert.equal((fn.match(/insertError\?\.code === '23505'\) return duplicateBroadcastResponse/g) || []).length, 2);
  assert.match(fn, /status: 409/);
});
