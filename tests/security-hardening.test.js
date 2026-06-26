const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('local Supabase backups are excluded from git', () => {
  const gitignore = readRepoFile('.gitignore');

  assert.match(gitignore, /^backups\/$/m);
});

test('dashboard does not poll every 30 seconds after initial load', () => {
  const dashboard = readRepoFile('dashboard.js');

  assert.doesNotMatch(dashboard, /setInterval\(/);
  assert.doesNotMatch(dashboard, /30000/);
  assert.match(dashboard, /refreshDashboardBtnEl/);
  assert.match(dashboard, /document\.addEventListener\('visibilitychange'/);
});

test('Telegram initData verification is shared and rejects stale auth data', () => {
  const sharedAuth = readRepoFile('supabase/functions/_shared/telegram-auth.ts');
  const functionFiles = [
    'analytics-track',
    'claim-broadcast-bonus',
    'feedback-submit',
    'my-gifts',
    'profile-save',
    'promo-action',
    'promo-current',
    'purchase-gift',
    'score-submit',
    'spend-claps',
    'telegram-auth',
    'touch-session',
  ];

  assert.match(sharedAuth, /MAX_INIT_DATA_AGE_SECONDS\s*=\s*24 \* 60 \* 60/);
  assert.match(sharedAuth, /auth_date/);
  assert.match(sharedAuth, /Stale Telegram auth data/);

  for (const functionName of functionFiles) {
    const source = readRepoFile(`supabase/functions/${functionName}/index.ts`);
    assert.match(source, /from '..\/_shared\/telegram-auth\.ts'/, `${functionName} must use shared Telegram auth`);
    assert.doesNotMatch(source, /async function verifyTelegramInitData/, `${functionName} must not keep a local verifier`);
  }
});

test('score-submit requires session evidence for progress increases and audits every attempt', () => {
  const source = readRepoFile('supabase/functions/score-submit/index.ts');
  const analyticsTrack = readRepoFile('supabase/functions/analytics-track/index.ts');
  const purchaseGift = readRepoFile('supabase/functions/purchase-gift/index.ts');
  const migration = readRepoFile('supabase/sql/016_security_score_audit.sql');
  const migrationPath = path.join(repoRoot, 'supabase/migrations/20260625122000_security_score_audit.sql');

  assert.ok(fs.existsSync(migrationPath), 'score audit migration must be available for supabase db push');
  assert.match(migration, /create table if not exists public\.score_submissions/i);
  assert.match(migration, /alter table public\.score_submissions enable row level security/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\./i);

  assert.match(source, /sessionId/);
  assert.match(source, /normalizeSessionId/);
  assert.match(source, /\.from\('analytics_sessions'\)[\s\S]*\.eq\('session_id', sessionId\)/);
  assert.match(source, /incomingBestExceedsSession/);
  assert.match(source, /insertScoreSubmissionAudit/);
  assert.match(source, /score_rejected/);
  assert.match(source, /accepted: false/);
  assert.match(source, /accepted: true/);
  assert.match(analyticsTrack, /function normalizeSessionId/);
  assert.match(purchaseGift, /function randomDiscountCode/);
  assert.match(purchaseGift, /async function sendPurchaseNotification/);
});
