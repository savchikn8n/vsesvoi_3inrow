const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('operational log diet migration mirrors its sql source', () => {
  const sql = readRepoFile('supabase/sql/020_operational_log_diet.sql');
  const migration = readRepoFile('supabase/migrations/20260817030000_operational_log_diet.sql');

  assert.equal(sql, migration);
});

test('operational log diet never touches player-facing data', () => {
  const sql = readRepoFile('supabase/sql/020_operational_log_diet.sql');

  // Balances, best scores, purchases and gifts must survive the cleanup
  // untouched: only audit and analytics logs are in scope.
  assert.doesNotMatch(sql, /public\.profiles/i);
  assert.doesNotMatch(sql, /public\.shop_purchases/i);
  assert.doesNotMatch(sql, /drop table|truncate/i);

  // The session aggregate table feeds the dashboard's all-time overview, so it
  // is deliberately excluded from pruning.
  assert.doesNotMatch(sql, /delete from public\.analytics_sessions/i);
});

test('retention deletes are bounded so pruning cannot repeat the IO outage', () => {
  const sql = readRepoFile('supabase/sql/020_operational_log_diet.sql');

  assert.match(sql, /create or replace function public\.prune_operational_logs/i);
  assert.match(sql, /p_batch_limit integer default 20000/);
  assert.match(sql, /limit v_limit/);

  // Every pruned table needs a leading-timestamp index, otherwise each pass is
  // a sequential scan and the cleanup costs more IO than it frees.
  assert.match(sql, /create index if not exists game_sessions_created_at_idx/i);
  assert.match(sql, /create index if not exists game_session_validations_created_at_idx/i);
  assert.match(sql, /create index if not exists score_submissions_created_at_idx/i);
  assert.match(sql, /create index if not exists game_session_moves_created_at_idx/i);

  // analytics_events is pruned by event_at, which already carries an index from
  // the original analytics migration.
  const analytics = readRepoFile('supabase/sql/006_analytics.sql');
  assert.match(analytics, /create index if not exists analytics_events_event_at_idx/i);
});

test('retention prunes sessions only after their move rows are gone', () => {
  const sql = readRepoFile('supabase/sql/020_operational_log_diet.sql');

  // game_session_moves carries a foreign key to game_sessions, so deleting a
  // session that still owns move rows would fail.
  const movesDeleteAt = sql.indexOf('delete from public.game_session_moves');
  const sessionsDeleteAt = sql.indexOf('delete from public.game_sessions');

  assert.ok(movesDeleteAt > -1 && sessionsDeleteAt > -1);
  assert.ok(movesDeleteAt < sessionsDeleteAt);
  assert.match(sql, /not exists \(\s*select 1 from public\.game_session_moves/i);
});

test('retention function is not exposed to client roles', () => {
  const sql = readRepoFile('supabase/sql/020_operational_log_diet.sql');

  assert.match(sql, /revoke all on function public\.prune_operational_logs\(integer, integer, integer\) from anon/i);
  assert.match(sql, /revoke all on function public\.prune_operational_logs\(integer, integer, integer\) from authenticated/i);
});

test('game-session-submit no longer writes a row per move', () => {
  const source = readRepoFile('supabase/functions/game-session-submit/index.ts');

  // The replay reads moves from the request body, so per-move rows were
  // audit-only while being the heaviest write in the project.
  assert.doesNotMatch(source, /\.from\('game_session_moves'\)/);
  assert.doesNotMatch(source, /move_index:/);
});

test('game-session-submit keeps a bounded move trail for rejected runs only', () => {
  const source = readRepoFile('supabase/functions/game-session-submit/index.ts');

  assert.match(source, /const rejectedMoves = accepted\s*\?\s*null/);
  assert.match(source, /moves\.slice\(0, MAX_AUDITED_MOVES\)/);
  assert.match(source, /const MAX_AUDITED_MOVES = \d+/);
  assert.match(source, /rejected_moves: rejectedMoves/);
});

test('rejected move trail column is added additively', () => {
  const sql = readRepoFile('supabase/sql/020_operational_log_diet.sql');

  assert.match(sql, /alter table public\.game_sessions\s*\n\s*add column if not exists rejected_moves jsonb/i);
});
