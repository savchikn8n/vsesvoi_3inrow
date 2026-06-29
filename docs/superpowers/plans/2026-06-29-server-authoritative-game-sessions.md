# Server-Authoritative Game Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-validated future game sessions without resetting or lowering any existing scores, claps, purchases, gifts, discounts, or profile data.

**Architecture:** Build a deterministic rules replay layer, run it in shadow-mode first, then gate future score/clap increases through accepted server validations. All database changes are additive, and `profiles` remains the preserved legacy baseline.

**Tech Stack:** Static browser JavaScript, Node test runner, Supabase SQL, Supabase Edge Functions on Deno, Telegram Mini App `initData`.

---

## File Structure

- Create `src/game/core/rng.js`: deterministic seeded RNG for browser tests and runtime.
- Create `src/game/core/rules-engine.js`: browser/common-js pure replay engine with no DOM, no audio, no Supabase.
- Create `tests/game-rules-engine.test.js`: parity and replay tests for the browser rules engine.
- Create `supabase/functions/_shared/rules-engine.ts`: Deno replay engine used by Edge Functions.
- Create `tests/server-rules-engine-source.test.js`: source-level parity guard between JS and Deno engine constants and exported function names.
- Create `supabase/sql/017_game_sessions.sql`: additive schema for `game_sessions`, `game_session_moves`, and `game_session_validations`.
- Create `supabase/migrations/20260629130000_game_sessions.sql`: migration copy of SQL 017.
- Create `supabase/functions/game-session-start/index.ts`: verified server-issued session and seed.
- Create `supabase/functions/game-session-submit/index.ts`: verified replay submission and validation.
- Modify `supabase/config.toml`: expose the two new public Telegram endpoints.
- Modify `game.js`: start server session, record successful moves, submit replay in shadow-mode.
- Modify `supabase/functions/score-submit/index.ts`: support `legacy | shadow | enforce` runtime mode and accepted validation checks.
- Modify `supabase/functions/runtime-config/index.ts` and `runtime-config-admin/index.ts`: add `scoreValidation.mode` with allowed values `legacy`, `shadow`, and `enforce`.
- Create or extend tests in `tests/security-hardening.test.js`, `tests/browser-module-wiring.test.js`, and `tests/progress-adapter.test.js`.

## Safety Invariants

- Never run `drop`, `truncate`, mass `delete`, or mass `update public.profiles`.
- Do not lower `profiles.best_score`.
- Do not lower `profiles.clap_balance` from score submission.
- Keep spend/purchase endpoints as the only paths that can decrease claps.
- New enforcement must be runtime-configurable: `legacy`, `shadow`, `enforce`.
- Deploy shadow-mode before enforce-mode.

---

### Task 1: Add Deterministic RNG

**Files:**
- Create: `src/game/core/rng.js`
- Create: `tests/game-rules-engine.test.js`
- Modify: `index.html`

- [ ] **Step 1: Write the failing RNG tests**

Add this to `tests/game-rules-engine.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { createSeededRng, normalizeSeed } = require('../src/game/core/rng.js');

test('normalizeSeed returns stable lowercase hex seed', () => {
  assert.equal(normalizeSeed('ABCDEF0123456789'), 'abcdef0123456789');
  assert.equal(normalizeSeed(' bad seed '), '6261642073656564');
});

test('createSeededRng produces deterministic values for the same seed', () => {
  const a = createSeededRng('0123456789abcdef');
  const b = createSeededRng('0123456789abcdef');

  assert.deepEqual(
    [a(), a(), a(), a()].map((value) => Number(value.toFixed(8))),
    [b(), b(), b(), b()].map((value) => Number(value.toFixed(8))),
  );
});

test('createSeededRng produces values in the Math.random range', () => {
  const rng = createSeededRng('0123456789abcdef');
  for (let i = 0; i < 100; i++) {
    const value = rng();
    assert.ok(value >= 0);
    assert.ok(value < 1);
  }
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/game-rules-engine.test.js
```

Expected: FAIL because `src/game/core/rng.js` does not exist.

- [ ] **Step 3: Implement the minimal RNG module**

Create `src/game/core/rng.js`:

```js
(function initRng(globalScope, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSGameRng = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRngApi() {
  'use strict';

  function normalizeSeed(seed) {
    const value = String(seed || '').trim();
    if (/^[0-9a-f]+$/i.test(value) && value.length >= 8) {
      return value.toLowerCase();
    }
    return Array.from(value || 'vsesvoi')
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  }

  function hashSeed(seed) {
    const normalized = normalizeSeed(seed);
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRng(seed) {
    let state = hashSeed(seed) || 1;
    return function rng() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  return {
    createSeededRng,
    normalizeSeed,
  };
});
```

- [ ] **Step 4: Wire the RNG module in the browser**

In `index.html`, insert before `board-core.js`:

```html
<script src="src/game/core/rng.js"></script>
```

- [ ] **Step 5: Run the test**

Run:

```bash
node --test tests/game-rules-engine.test.js
```

Expected: PASS.

- [ ] **Step 6: Run browser wiring test**

Run:

```bash
node --test tests/browser-module-wiring.test.js
```

Expected: PASS after updating or adding an assertion that `rng.js` loads before `board-core.js`.

- [ ] **Step 7: Commit**

```bash
git add index.html src/game/core/rng.js tests/game-rules-engine.test.js tests/browser-module-wiring.test.js
git commit -m "Add deterministic game RNG"
```

---

### Task 2: Add Pure Browser Replay Engine

**Files:**
- Create: `src/game/core/rules-engine.js`
- Modify: `tests/game-rules-engine.test.js`
- Modify: `index.html`

- [ ] **Step 1: Add failing replay tests**

Append to `tests/game-rules-engine.test.js`:

```js
const Rules = require('../src/game/core/rules-engine.js');

test('createInitialState builds a deterministic playable board', () => {
  const a = Rules.createInitialState({ seed: '0123456789abcdef' });
  const b = Rules.createInitialState({ seed: '0123456789abcdef' });

  assert.equal(a.score, 0);
  assert.equal(a.clapsEarned, 0);
  assert.equal(a.movesCount, 0);
  assert.deepEqual(a.board, b.board);
  assert.equal(a.board.length, 49);
});

test('applyMove rejects non-adjacent moves without mutating state', () => {
  const state = Rules.createInitialState({ seed: '0123456789abcdef' });
  const before = JSON.stringify(state.board);
  const result = Rules.applyMove(state, { from: 0, to: 48 });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'non_adjacent');
  assert.equal(JSON.stringify(state.board), before);
});

test('replayMoves returns deterministic result for the same seed and move list', () => {
  const moves = [{ from: 0, to: 1 }, { from: 7, to: 8 }, { from: 14, to: 15 }];
  const a = Rules.replayMoves({ seed: '0123456789abcdef', moves });
  const b = Rules.replayMoves({ seed: '0123456789abcdef', moves });

  assert.deepEqual(a, b);
  assert.equal(a.movesAttempted, 3);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/game-rules-engine.test.js
```

Expected: FAIL because `rules-engine.js` does not exist.

- [ ] **Step 3: Implement the first pure rules engine**

Create `src/game/core/rules-engine.js` using existing `VSGameCore`, `VSGameResolution`, and `VSGameRng` patterns. The initial implementation must export:

```js
createInitialState({ seed, size = 7, colorCount = 4 })
applyMove(state, { from, to })
replayMoves({ seed, moves, size = 7, colorCount = 4 })
```

The implementation must:

- Clone state before mutation.
- Reject out-of-range moves with `reason: 'out_of_range'`.
- Reject non-adjacent moves with `reason: 'non_adjacent'`.
- Reject no-match normal swaps with `reason: 'no_match'`.
- Increment `movesCount` only for accepted moves.
- Compute claps as `Math.floor(score / 10000)`.

- [ ] **Step 4: Wire the rules module in the browser**

In `index.html`, insert after `resolution-core.js`:

```html
<script src="src/game/core/rules-engine.js"></script>
```

- [ ] **Step 5: Run rules tests**

Run:

```bash
node --test tests/game-rules-engine.test.js
```

Expected: PASS.

- [ ] **Step 6: Run full tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add index.html src/game/core/rules-engine.js tests/game-rules-engine.test.js
git commit -m "Add pure game replay engine"
```

---

### Task 3: Move Client Rule Decisions Behind the Rules Engine

**Files:**
- Modify: `game.js`
- Modify: `tests/browser-module-wiring.test.js`
- Modify: `tests/game-board-core.test.js`
- Modify: `tests/game-resolution-core.test.js`

- [ ] **Step 1: Add failing wiring tests**

Extend `tests/browser-module-wiring.test.js` with checks that `game.js` delegates pure rule checks to `window.VSGameRules` for initial state or replay-safe move validation.

Required assertions:

```js
assert.match(game, /window\.VSGameRules/);
assert.match(game, /createInitialState/);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/browser-module-wiring.test.js
```

Expected: FAIL until `game.js` references `window.VSGameRules`.

- [ ] **Step 3: Add non-invasive client integration**

In `game.js`:

- Keep visual board state as-is.
- Add a server/replay move log array, for example `sessionReplayMoves = []`.
- Reset it in `startAnalyticsSession`.
- Push `{ from: a, to: b }` only after accepted successful moves.
- Use `window.VSGameRules.createInitialState` only for new server-authoritative sessions later; do not switch production board generation yet in this task.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test tests/browser-module-wiring.test.js tests/game-board-core.test.js tests/game-resolution-core.test.js
```

Expected: PASS.

- [ ] **Step 5: Run full tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add game.js tests/browser-module-wiring.test.js tests/game-board-core.test.js tests/game-resolution-core.test.js
git commit -m "Prepare client replay move tracking"
```

---

### Task 4: Add Additive Game Session SQL

**Files:**
- Create: `supabase/sql/017_game_sessions.sql`
- Create: `supabase/migrations/20260629130000_game_sessions.sql`
- Modify: `tests/security-hardening.test.js`

- [ ] **Step 1: Add failing SQL safety tests**

Add to `tests/security-hardening.test.js`:

```js
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
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/security-hardening.test.js
```

Expected: FAIL because SQL files do not exist.

- [ ] **Step 3: Create additive SQL**

Create `supabase/sql/017_game_sessions.sql` with:

```sql
create table if not exists public.game_sessions (
  session_id text primary key,
  telegram_id bigint not null,
  rules_version text not null,
  seed text not null,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  client_final_score integer,
  server_final_score integer,
  client_claps_earned integer,
  server_claps_earned integer,
  validation_status text not null default 'pending',
  validation_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.game_session_moves (
  id bigint generated always as identity primary key,
  session_id text not null references public.game_sessions(session_id),
  move_index integer not null,
  from_idx integer not null,
  to_idx integer not null,
  client_score_after integer,
  client_claps_after integer,
  created_at timestamptz not null default now(),
  unique (session_id, move_index)
);

create table if not exists public.game_session_validations (
  id bigint generated always as identity primary key,
  session_id text not null,
  telegram_id bigint not null,
  rules_version text not null,
  accepted boolean not null,
  client_score integer not null default 0,
  server_score integer not null default 0,
  client_claps_earned integer not null default 0,
  server_claps_earned integer not null default 0,
  move_count integer not null default 0,
  reject_reason text,
  created_at timestamptz not null default now()
);

create index if not exists game_sessions_telegram_started_idx
  on public.game_sessions (telegram_id, started_at desc);

create index if not exists game_session_moves_session_idx
  on public.game_session_moves (session_id, move_index);

create index if not exists game_session_validations_telegram_created_idx
  on public.game_session_validations (telegram_id, created_at desc);

alter table public.game_sessions enable row level security;
alter table public.game_session_moves enable row level security;
alter table public.game_session_validations enable row level security;
```

Copy the same content to `supabase/migrations/20260629130000_game_sessions.sql`.

- [ ] **Step 4: Run SQL safety test**

Run:

```bash
node --test tests/security-hardening.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/sql/017_game_sessions.sql supabase/migrations/20260629130000_game_sessions.sql tests/security-hardening.test.js
git commit -m "Add game session validation schema"
```

---

### Task 5: Add Server Session Start Function

**Files:**
- Create: `supabase/functions/game-session-start/index.ts`
- Modify: `supabase/config.toml`
- Modify: `tests/security-hardening.test.js`

- [ ] **Step 1: Add failing function test**

Add to `tests/security-hardening.test.js`:

```js
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
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test tests/security-hardening.test.js
```

Expected: FAIL because the function does not exist.

- [ ] **Step 3: Implement `game-session-start`**

Create `supabase/functions/game-session-start/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const RULES_VERSION = 'match3-v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function createSeed() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required environment variables');

    const { initData } = await req.json().catch(() => ({}));
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), { status: 400, headers: corsHeaders });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const sessionId = crypto.randomUUID();
    const seed = createSeed();

    const { error } = await admin.from('game_sessions').insert({
      session_id: sessionId,
      telegram_id: user.id,
      rules_version: RULES_VERSION,
      seed,
      status: 'started',
    });
    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({
      sessionId,
      seed,
      rulesVersion: RULES_VERSION,
      size: 7,
      colorCount: 4,
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Session start error' }), { status: 401, headers: corsHeaders });
  }
});
```

- [ ] **Step 4: Configure the function**

Add to `supabase/config.toml`:

```toml
[functions.game-session-start]
verify_jwt = false
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/security-hardening.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/game-session-start/index.ts supabase/config.toml tests/security-hardening.test.js
git commit -m "Add server game session start"
```

---

### Task 6: Add Server Session Submit in Shadow Mode

**Files:**
- Create: `supabase/functions/_shared/rules-engine.ts`
- Create: `supabase/functions/game-session-submit/index.ts`
- Modify: `supabase/config.toml`
- Modify: `tests/security-hardening.test.js`
- Create: `tests/server-rules-engine-source.test.js`

- [ ] **Step 1: Add failing tests**

Add source-level tests that require:

```js
assert.match(source, /verifyTelegramInitData/);
assert.match(source, /\.from\('game_sessions'\)/);
assert.match(source, /\.from\('game_session_moves'\)/);
assert.match(source, /\.from\('game_session_validations'\)/);
assert.match(source, /replayMoves/);
assert.match(source, /validation_status/);
assert.doesNotMatch(source, /\.from\('profiles'\)\.(update|upsert|insert)/);
```

Add `tests/server-rules-engine-source.test.js` to compare exported names between `src/game/core/rules-engine.js` and `supabase/functions/_shared/rules-engine.ts`.

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test tests/security-hardening.test.js tests/server-rules-engine-source.test.js
```

Expected: FAIL because Deno shared engine and submit function do not exist.

- [ ] **Step 3: Implement Deno shared rules engine**

Create `supabase/functions/_shared/rules-engine.ts` by copying the completed implementation from `src/game/core/rules-engine.js` and applying these mechanical changes:

- Remove the browser IIFE wrapper.
- Export the same constants and functions with TypeScript `export`.
- Keep function names exactly: `createInitialState`, `applyMove`, `replayMoves`.
- Keep rejection reasons exactly: `out_of_range`, `non_adjacent`, `no_match`.
- Keep constants exactly: `DEFAULT_SIZE = 7`, `DEFAULT_COLORS = 4`, `RULES_VERSION = 'match3-v1'`.
- Add exported types:

```ts
export type GameMove = { from: number; to: number };
export type GameCell = { color: number; special: string | null };
export type GameState = {
  board: Array<GameCell | null>;
  score: number;
  clapsEarned: number;
  movesCount: number;
};
```

Use the JS module as the behavior reference. Keep constants `DEFAULT_SIZE = 7`, `DEFAULT_COLORS = 4`, and `RULES_VERSION = 'match3-v1'`. The parity test must compare these exported names and constants so future edits do not silently diverge.

- [ ] **Step 4: Implement `game-session-submit`**

Create `supabase/functions/game-session-submit/index.ts` that:

- Verifies Telegram auth.
- Loads `game_sessions` by `session_id` and `telegram_id`.
- Rejects missing or foreign sessions with status `403`.
- Normalizes moves to `{ from, to }` integer pairs, max 3000 moves.
- Replays moves.
- Inserts `game_session_moves` rows.
- Inserts one `game_session_validations` row.
- Updates `game_sessions` with `server_final_score`, `server_claps_earned`, and `validation_status`.
- Does not write `profiles`.

- [ ] **Step 5: Configure the function**

Add to `supabase/config.toml`:

```toml
[functions.game-session-submit]
verify_jwt = false
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
node --test tests/security-hardening.test.js tests/server-rules-engine-source.test.js
```

Expected: PASS.

- [ ] **Step 7: Run all tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/rules-engine.ts supabase/functions/game-session-submit/index.ts supabase/config.toml tests/security-hardening.test.js tests/server-rules-engine-source.test.js
git commit -m "Add shadow game session validation"
```

---

### Task 7: Wire Client Shadow Session Flow

**Files:**
- Modify: `game.js`
- Modify: `tests/progress-adapter.test.js`
- Modify: `tests/security-hardening.test.js`

- [ ] **Step 1: Add failing client source tests**

Add assertions that `game.js` references:

```js
game-session-start
game-session-submit
sessionReplayMoves
serverGameSession
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test tests/security-hardening.test.js tests/progress-adapter.test.js
```

Expected: FAIL until client wiring exists.

- [ ] **Step 3: Implement shadow client calls**

In `game.js`:

- Add `let serverGameSession = null;`
- Add `let sessionReplayMoves = [];`
- At run start, call `game-session-start` after Telegram auth is available.
- If start succeeds, store `{ sessionId, seed, rulesVersion }`.
- If start fails, continue legacy guarded gameplay and log analytics event `server_session_start_failed`.
- On accepted successful move, push `{ from: a, to: b }`.
- On timeout/menu exit/lifecycle sync, call `game-session-submit` with moves and client result when `serverGameSession` exists.
- Do not block UI on submit.
- Do not change `profiles` from the submit response in shadow-mode.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test tests/security-hardening.test.js tests/progress-adapter.test.js
```

Expected: PASS.

- [ ] **Step 5: Run full tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add game.js tests/security-hardening.test.js tests/progress-adapter.test.js
git commit -m "Wire client shadow replay sessions"
```

---

### Task 8: Deploy Shadow Mode Safely

**Files:**
- No source changes.
- Local backup under `backups/supabase/<timestamp>-game-sessions-shadow/`

- [ ] **Step 1: Create pre-migration backup**

Run read-only backups for:

```sql
public.profiles
public.shop_purchases
public.analytics_sessions
public.analytics_events
public.score_submissions
```

Save under `backups/supabase/<timestamp>-game-sessions-shadow/` and write SHA-256 manifest.

- [ ] **Step 2: Record pre-migration counts**

Run:

```bash
supabase db query --linked -o csv "select 'profiles' as table_name, count(*) from public.profiles union all select 'shop_purchases', count(*) from public.shop_purchases union all select 'analytics_sessions', count(*) from public.analytics_sessions union all select 'analytics_events', count(*) from public.analytics_events union all select 'score_submissions', count(*) from public.score_submissions;"
```

Expected: counts recorded in terminal notes.

- [ ] **Step 3: Apply migration**

Run:

```bash
supabase db query --linked --file supabase/migrations/20260629130000_game_sessions.sql
```

Expected: success.

- [ ] **Step 4: Record post-migration counts**

Run the same count query from Step 2.

Expected: existing table counts unchanged except organic live traffic during the operation.

- [ ] **Step 5: Deploy functions**

Run:

```bash
supabase functions deploy game-session-start game-session-submit analytics-track score-submit --use-api --no-verify-jwt
```

Expected: all functions deployed.

- [ ] **Step 6: Deploy frontend**

Run:

```bash
npx vercel deploy --prod
```

Expected: production URL and alias update.

- [ ] **Step 7: Smoke test public functions**

Run:

```bash
curl -s -X POST https://tnngitplssufqeqpxuib.functions.supabase.co/game-session-start -H 'Content-Type: application/json' -d '{}'
curl -s -X POST https://tnngitplssufqeqpxuib.functions.supabase.co/game-session-submit -H 'Content-Type: application/json' -d '{}'
```

Expected: `initData is required` style errors, not 404.

- [ ] **Step 8: Commit deployment notes if any source changed**

If no files changed, do not create a commit.

---

### Task 9: Observe Shadow Results Before Enforce

**Files:**
- No source changes in this plan.

- [ ] **Step 1: Query validation health**

Run:

```bash
supabase db query --linked -o csv "select validation_status, count(*) from public.game_sessions group by validation_status order by validation_status;"
```

Expected: sessions appear after real gameplay.

- [ ] **Step 2: Query mismatches**

Run:

```bash
supabase db query --linked -o csv "select accepted, reject_reason, count(*) from public.game_session_validations group by accepted, reject_reason order by count(*) desc;"
```

Expected: no unexpected high mismatch rate before enforce.

- [ ] **Step 3: Record the enforce decision**

Before switching to enforce, record:

- total validated sessions
- accepted validations
- rejected validations
- top reject reasons
- explicit user approval to switch runtime mode

Dashboard cards for these metrics are intentionally outside this first anti-cheat plan. Add them in a separate UI pass after enforce is stable.

- [ ] **Step 4: Do not commit**

This task is operational observation only. If source files changed, stop and split that work into a separate dashboard plan.

---

### Task 10: Enforce Server-Validated Future Progress

**Files:**
- Modify: `supabase/functions/score-submit/index.ts`
- Modify: `supabase/functions/runtime-config/index.ts`
- Modify: `supabase/functions/runtime-config-admin/index.ts`
- Modify: `tests/security-hardening.test.js`

- [ ] **Step 1: Add failing enforce tests**

Add source-level tests requiring:

```js
assert.match(source, /score_validation_mode/);
assert.match(source, /game_session_validations/);
assert.match(source, /validation_required/);
assert.match(source, /accepted/);
assert.match(source, /Math\.max\(previousBest/);
assert.doesNotMatch(source, /best_score:\s*incomingBestScore/);
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test tests/security-hardening.test.js
```

Expected: FAIL until enforce logic exists.

- [ ] **Step 3: Implement runtime mode read**

In `score-submit`, read runtime mode from `app_runtime_config` or existing runtime config source:

- default `legacy`
- allow `shadow`
- allow `enforce`
- unknown values fall back to `legacy`

In `runtime-config` and `runtime-config-admin`, normalize:

```ts
scoreValidation: {
  mode: ['legacy', 'shadow', 'enforce'].includes(rawMode) ? rawMode : 'legacy',
}
```

- [ ] **Step 4: Implement enforce branch**

In `enforce` mode:

- Require `sessionId`.
- Load latest accepted validation for the same `telegram_id` and `session_id`.
- Use `server_score` and `server_claps_earned`.
- Compute `nextBest = Math.max(previousBest, serverScore)`.
- Compute `nextClaps = Math.max(previousClaps, previousClaps + serverClapsEarned)` only once per accepted validation.
- Prevent double-awarding claps by marking validation consumed or storing `consumed_at`.

If `consumed_at` is needed, add an additive SQL migration:

```sql
alter table public.game_session_validations
  add column if not exists consumed_at timestamptz;
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --test tests/security-hardening.test.js
```

Expected: PASS.

- [ ] **Step 6: Run full tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/score-submit/index.ts supabase/sql/*.sql supabase/migrations/*.sql tests/security-hardening.test.js
git commit -m "Enforce validated game session progress"
```

- [ ] **Step 8: Deploy enforce-capable function but keep mode shadow**

Run:

```bash
supabase functions deploy score-submit --use-api --no-verify-jwt
```

Expected: deployed, runtime mode still not `enforce`.

- [ ] **Step 9: Switch runtime config to enforce only after explicit approval**

Do not run this step without explicit user confirmation.

Expected after switch: new records require accepted replay; old profile values remain unchanged.

---

## Final Verification Checklist

- [ ] `node --test tests/*.test.js` passes.
- [ ] Supabase functions deploy successfully.
- [ ] Existing table counts are recorded before and after additive migration.
- [ ] `profiles` row count is unchanged except organic live traffic.
- [ ] No migration contains `drop table`, `truncate`, `delete from public.`, or `update public.profiles`.
- [ ] Shadow-mode records validations before enforce-mode.
- [ ] Enforce-mode is enabled only after explicit approval.
- [ ] Runtime config can return to `legacy` or `shadow` without database rollback.
