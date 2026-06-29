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

test('analytics-track rejects impossible session progress before it can verify score-submit', () => {
  const source = readRepoFile('supabase/functions/analytics-track/index.ts');
  const scoreSubmit = readRepoFile('supabase/functions/score-submit/index.ts');
  const sharedValidation = readRepoFile('supabase/functions/_shared/session-validation.ts');

  assert.match(sharedValidation, /MAX_SCORE_PER_MOVE/);
  assert.match(sharedValidation, /MAX_CLAPS_FROM_SCORE_BUFFER/);
  assert.match(sharedValidation, /export function validateSessionProgress/);
  assert.match(sharedValidation, /bestScore > movesCount \* MAX_SCORE_PER_MOVE/);
  assert.match(sharedValidation, /clapsEarned > Math\.floor\(bestScore \/ 10000\) \+ MAX_CLAPS_FROM_SCORE_BUFFER/);

  assert.match(source, /validateSessionProgress/);
  assert.match(source, /invalid_session_progress/);
  assert.match(scoreSubmit, /validateSessionProgress/);
  assert.match(scoreSubmit, /invalid_session_progress/);
});

test('game session migration is additive and protects existing profile data', () => {
  const sql = readRepoFile('supabase/sql/017_game_sessions.sql');
  const migration = readRepoFile('supabase/migrations/20260629130000_game_sessions.sql');

  assert.equal(sql, migration);
  assert.match(sql, /create table if not exists public\.game_sessions/i);
  assert.match(sql, /create table if not exists public\.game_session_moves/i);
  assert.match(sql, /create table if not exists public\.game_session_validations/i);
  assert.match(sql, /alter table public\.game_sessions enable row level security/i);
  assert.match(sql, /alter table public\.game_session_moves enable row level security/i);
  assert.match(sql, /alter table public\.game_session_validations enable row level security/i);
  assert.doesNotMatch(sql, /drop table|truncate|delete from public\.|update public\.profiles/i);
});
