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

test('score-submit requires server validated game session evidence for progress increases', () => {
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
  assert.doesNotMatch(source, /\.from\('analytics_sessions'\)/);
  assert.match(source, /\.from\('game_session_validations'\)[\s\S]*\.eq\('session_id', sessionId\)/);
  assert.match(source, /accepted', true/);
  assert.match(source, /server_score/);
  assert.match(source, /lastAcceptedSubmission/);
  assert.match(source, /\.gt\('created_at', lastAcceptedAt\)/);
  assert.match(source, /acceptedValidations\.reduce/);
  assert.match(source, /incomingBestExceedsSession/);
  assert.match(source, /insertScoreSubmissionAudit/);
  assert.match(source, /score_rejected/);
  assert.match(source, /accepted: false/);
  assert.match(source, /accepted: true/);
  assert.match(analyticsTrack, /function normalizeSessionId/);
  assert.match(purchaseGift, /function randomDiscountCode/);
  assert.match(purchaseGift, /async function sendPurchaseNotification/);
});

test('score-submit never raises clap balance from client-reported numbers', () => {
  const source = readRepoFile('supabase/functions/score-submit/index.ts');

  assert.match(source, /const nextClaps = previousClaps;/);
  assert.doesNotMatch(source, /Math\.max\(previousClaps, incomingClapBalance\)/);
  assert.doesNotMatch(source, /clapsWouldIncrease/);
  assert.doesNotMatch(source, /claps_rejected/);
});

test('client final progress submits server validation before score-submit', () => {
  const source = readRepoFile('game.js');

  assert.match(source, /async function submitFinalProgressAndEnd/);
  assert.match(source, /await flushServerGameSession/);
  assert.match(source, /syncProgressIfNeeded\(\{[\s\S]*submitServerSession: true/);
  assert.match(source, /endAnalyticsSession\(reason, \{ skipServerSubmit: true/);
});

test('client lifecycle progress flush submits server validation before score-submit', () => {
  const source = readRepoFile('game.js');
  const match = source.match(/function flushProgressLifecycleIfNeeded\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'flushProgressLifecycleIfNeeded should exist');
  const body = match[1];

  assert.match(body, /flushServerGameSession\(\{ useLifecycleTransport: true \}\)/);
  assert.ok(
    body.indexOf('flushServerGameSession({ useLifecycleTransport: true })')
      < body.indexOf("postLifecycleJson('score-submit'"),
    'lifecycle validation submit must happen before score-submit',
  );
});

test('client does not buffer cascade-time moves that server replay cannot reproduce', () => {
  const source = readRepoFile('game.js');

  assert.doesNotMatch(source, /let bufferedMove/);
  assert.doesNotMatch(source, /queueBufferedMove/);
  assert.doesNotMatch(source, /if \(bufferedMove && canSwapMakeMatch/);
});

test('analytics-track rejects impossible session progress but cannot verify score-submit', () => {
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
  assert.doesNotMatch(scoreSubmit, /validateSessionProgress/);
});

test('analytics-summary prefers accepted game session claps over stale analytics rows', () => {
  const source = readRepoFile('supabase/functions/analytics-summary/index.ts');

  assert.match(source, /\.from\('game_sessions'\)/);
  assert.match(source, /\.eq\('validation_status', 'accepted'\)/);
  assert.match(source, /const gameSessionMap = new Map/);
  assert.match(source, /const normalizedSessions = sessions\.map\(normalizeSession\)/);
  assert.match(source, /claps_earned: Math\.max\(Number\(item\.claps_earned \|\| 0\), Number\(gameSession\?\.claps_earned \|\| 0\)\)/);
  assert.match(source, /const currentSessions = normalizedSessions\.filter/);
  assert.match(source, /const sessionHistory = normalizedSessions\.map/);
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

test('game-session-start verifies Telegram auth and does not write profiles', () => {
  const source = readRepoFile('supabase/functions/game-session-start/index.ts');
  const config = readRepoFile('supabase/config.toml');

  assert.match(source, /verifyTelegramInitData/);
  assert.match(source, /\.from\('game_sessions'\)\.insert/);
  assert.match(source, /crypto\.randomUUID/);
  assert.match(source, /seed/);
  assert.doesNotMatch(source, /\.from\('profiles'\)/);
  assert.match(config, /\[functions\.game-session-start\]/);
  assert.match(config, /verify_jwt = false/);
});

test('game-session-submit credits progress incrementally from the server replay', () => {
  const source = readRepoFile('supabase/functions/game-session-submit/index.ts');
  const config = readRepoFile('supabase/config.toml');

  assert.match(source, /verifyTelegramInitData/);
  assert.match(source, /\.from\('game_sessions'\)/);
  assert.match(source, /\.from\('game_session_moves'\)/);
  assert.match(source, /\.from\('game_session_validations'\)/);
  assert.match(source, /replayMoves/);
  assert.match(source, /validation_status/);
  // Progress is credited via the race-safe delta RPC, never via direct profile
  // writes. Honest fast players fail the strictly-sequential replay, so credit
  // falls back to the client score bounded by a per-move ceiling instead of
  // silently paying zero.
  assert.match(source, /rpc\('credit_game_session_result'/);
  assert.match(source, /const boundedClientScore = Math\.min\(clientFinalScore, moves\.length \* MAX_SCORE_PER_MOVE\)/);
  assert.match(source, /const creditScore = implausiblyFast \? 0 : \(accepted \? replay\.score : boundedClientScore\)/);
  assert.match(source, /p_server_claps_earned: creditClaps/);
  assert.match(source, /credited_claps/);
  assert.doesNotMatch(source, /\.from\('profiles'\)/);
  // Anti-farm guards remain: sub-human move rate earns zero, and the per-move
  // ceiling bounds any fabricated score.
  assert.match(source, /MIN_MS_PER_MOVE/);
  assert.match(source, /implausible_speed/);
  assert.match(source, /MAX_SCORE_PER_MOVE/);
  assert.match(config, /\[functions\.game-session-submit\]/);
  assert.match(config, /verify_jwt = false/);
});

test('game session result crediting migration is additive and service-role only', () => {
  const sql = readRepoFile('supabase/sql/018_game_session_result.sql');
  const migration = readRepoFile('supabase/migrations/20260705090000_game_session_result.sql');

  assert.equal(sql, migration);
  assert.match(sql, /create or replace function public\.apply_game_session_result/i);
  assert.match(sql, /greatest\(coalesce\(best_score, 0\)/i);
  assert.match(sql, /clap_balance = coalesce\(clap_balance, 0\) \+ greatest/i);
  assert.match(sql, /revoke all on function public\.apply_game_session_result[\s\S]*from anon/i);
  assert.match(sql, /grant execute on function public\.apply_game_session_result[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /drop table|truncate|delete from public\./i);
});

test('incremental clap crediting migration is additive, delta-based and race-safe', () => {
  const sql = readRepoFile('supabase/sql/019_game_session_incremental_claps.sql');
  const migration = readRepoFile('supabase/migrations/20260705120000_game_session_incremental_claps.sql');

  assert.equal(sql, migration);
  assert.match(sql, /add column if not exists credited_claps integer not null default 0/i);
  assert.match(sql, /create or replace function public\.credit_game_session_result/i);
  // Row lock + positive delta only => idempotent, no double credit on resubmit.
  assert.match(sql, /for update/i);
  assert.match(sql, /v_delta := greatest\(0, coalesce\(p_server_claps_earned, 0\) - v_prev\)/i);
  assert.match(sql, /clap_balance = coalesce\(clap_balance, 0\) \+ v_delta/i);
  assert.match(sql, /best_score = greatest\(coalesce\(best_score, 0\)/i);
  assert.match(sql, /grant execute on function public\.credit_game_session_result[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /drop table|truncate|delete from public\./i);
});

test('client keeps claps optimistic in-run and banks them before spending', () => {
  const game = readRepoFile('game.js');

  // No mid-run score-submit round trip that would revert the optimistic clap.
  const awardBody = game.match(/function maybeAwardClapsFromScore\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(awardBody, /syncProgressIfNeeded/);

  // Session submit reports claps actually earned, not the spend-corrupted delta.
  assert.match(game, /clientClapsEarned: Math\.max\(0, Math\.floor\(Number\(clapsAwardedThisRun/);

  // Spends bank the run first so the debit applies to a balance that already
  // includes the earned claps.
  const continueBody = game.match(/async function continueRunWithClaps\(\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(
    continueBody.indexOf('flushServerGameSession({ force: true })') <
      continueBody.indexOf("postJson('spend-claps'"),
    'continue must bank the session before spending',
  );
  const cancelBody = game.match(/async function cancelExitConfirm\(\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(
    cancelBody.indexOf('flushServerGameSession({ force: true })') <
      cancelBody.indexOf("postJson('spend-claps'"),
    'paid exit-cancel must bank the session before spending',
  );

  // Session is re-submittable as a run is extended.
  assert.match(game, /let lastSubmittedMoveCount = -1;/);
  assert.doesNotMatch(game, /serverGameSession\.submitted = true/);
});

test('game-session-start rate limits session creation per player', () => {
  const source = readRepoFile('supabase/functions/game-session-start/index.ts');

  assert.match(source, /SESSION_RATE_LIMIT/);
  assert.match(source, /session_rate_limited/);
  assert.match(source, /\.gte\('started_at', rateCutoffIso\)/);
});

test('spend-claps debits balance with a compare-and-set guard', () => {
  const source = readRepoFile('supabase/functions/spend-claps/index.ts');

  assert.match(source, /\.eq\('clap_balance', currentClaps\)/);
  assert.match(source, /balance_conflict/);
});

test('leaderboard requires Telegram auth and orders deterministically', () => {
  const source = readRepoFile('supabase/functions/leaderboard/index.ts');
  const game = readRepoFile('game.js');

  assert.match(source, /verifyTelegramInitData/);
  assert.match(source, /initData is required/);
  assert.match(source, /\.order\('updated_at', \{ ascending: true \}\)/);
  assert.match(game, /'leaderboard',\s*\{ initData: telegramInitData\(\), limit: 50 \}/);
});

test('dashboard escapes user-controlled values before innerHTML rendering', () => {
  const source = readRepoFile('dashboard.js');

  assert.match(source, /function escapeHtml\(/);
  assert.match(source, /escapeHtml\(item\.display_name\)/);
  assert.match(source, /escapeHtml\(item\.player_label \|\| 'Игрок'\)/);
  assert.match(source, /escapeHtml\(item\.code\)/);
  assert.match(source, /escapeHtml\(popup\.title\)/);
  assert.doesNotMatch(source, /innerHTML = `[^`]*\$\{item\.display_name\}/);
  assert.doesNotMatch(source, /innerHTML = `[^`]*\$\{popup\.title\}/);
});

test('client builds the board once from the resolved session without a late swap', () => {
  const source = readRepoFile('game.js');

  // The board must be built once from the authoritative session; adopting a
  // late session and re-drawing caused a visible one-frame board flip.
  assert.doesNotMatch(source, /adoptLateGameSession/);
  assert.doesNotMatch(source, /watchLateGameSession/);
  assert.doesNotMatch(source, /pendingLateGameSessionRequest/);
  assert.match(source, /Wait for the authoritative session before building the board/);
});
