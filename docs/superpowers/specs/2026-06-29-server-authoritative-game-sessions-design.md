# Server-Authoritative Game Sessions Design

## Goal

Make future score and clap progress honest, reproducible, and auditable without lowering or resetting any existing player data.

Current `profiles.best_score`, `profiles.clap_balance`, purchases, gifts, discounts, and player profile fields stay intact. The new system validates future game sessions before they are allowed to increase score or claps.

## Non-Goals

- Do not reset or recalculate historical player balances.
- Do not mass-update `profiles`.
- Do not move the whole app away from Supabase in this phase.
- Do not validate every move synchronously in real time if it can create gameplay latency.
- Do not rewrite visual animations as part of the anti-cheat migration.

## Current State

The game is a static Telegram Mini App using `game.js`, pure browser modules in `src/game/core`, and Supabase Edge Functions.

Relevant code paths:

- `game.js` owns runtime state, UI, animations, scoring side effects, session analytics, and `score-submit`.
- `src/game/core/board-core.js` owns pure board primitives: board creation, matches, gravity, swaps, move detection.
- `src/game/core/resolution-core.js` owns pure blast geometry and special-combo target areas.
- `supabase/functions/analytics-track` records session snapshots.
- `supabase/functions/score-submit` updates `profiles.best_score` and `profiles.clap_balance`.
- `supabase/functions/_shared/session-validation.ts` currently blocks obviously impossible client-reported progress.

The remaining trust gap is that the client still reports final score and claps. The server checks plausibility, but it does not yet replay the game rules from a server-known seed and move list.

## Data Safety Model

All database changes must be additive:

- `create table if not exists`
- `create index if not exists`
- `alter table add column if not exists`
- RLS policies for new tables

Forbidden in the migration path:

- `drop table`
- `truncate`
- mass `delete`
- mass `update public.profiles`
- recalculating historical `best_score` or `clap_balance`

Before any production migration:

- Create a local backup of gameplay tables.
- Record row counts for `profiles`, `shop_purchases`, `analytics_sessions`, `analytics_events`, and new anti-cheat tables.
- Run the migration.
- Re-check row counts for existing gameplay tables.

## New Tables

### `public.game_sessions`

Stores the server-issued session envelope.

Columns:

- `session_id text primary key`
- `telegram_id bigint not null`
- `rules_version text not null`
- `seed text not null`
- `status text not null default 'started'`
- `started_at timestamptz not null default now()`
- `ended_at timestamptz`
- `client_final_score integer`
- `server_final_score integer`
- `client_claps_earned integer`
- `server_claps_earned integer`
- `validation_status text not null default 'pending'`
- `validation_error text`
- `created_at timestamptz not null default now()`

### `public.game_session_moves`

Stores compact move replay data.

Columns:

- `id bigint generated always as identity primary key`
- `session_id text not null references public.game_sessions(session_id)`
- `move_index integer not null`
- `from_idx integer not null`
- `to_idx integer not null`
- `client_score_after integer`
- `client_claps_after integer`
- `created_at timestamptz not null default now()`

Constraint:

- unique `(session_id, move_index)`

### `public.game_session_validations`

Stores replay results and mismatch evidence.

Columns:

- `id bigint generated always as identity primary key`
- `session_id text not null`
- `telegram_id bigint not null`
- `rules_version text not null`
- `accepted boolean not null`
- `client_score integer not null default 0`
- `server_score integer not null default 0`
- `client_claps_earned integer not null default 0`
- `server_claps_earned integer not null default 0`
- `move_count integer not null default 0`
- `reject_reason text`
- `created_at timestamptz not null default now()`

## Edge Functions

All new enforcement is controlled by runtime config:

- `legacy`: current guarded score path; replay data may be ignored.
- `shadow`: replay validation runs and records evidence, but `profiles` still follow the current guarded path.
- `enforce`: only accepted replay validations can increase future score or earned claps.

The fallback from `enforce` to `shadow` or `legacy` must not require a database rollback.

### `game-session-start`

Input:

- `initData`

Behavior:

- Verifies Telegram initData with shared verifier.
- Creates server seed.
- Creates `game_sessions` row.
- Returns `session_id`, `seed`, `rules_version`, board size, and color count.

No `profiles` write.

### `game-session-submit`

Input:

- `initData`
- `sessionId`
- `moves`
- `clientFinalScore`
- `clientClapsEarned`

Behavior:

- Verifies Telegram initData.
- Loads `game_sessions` for the same Telegram user.
- Rejects sessions not owned by the user.
- Replays the game from `seed` and `rules_version`.
- Inserts move rows and a validation row.
- Updates `game_sessions` validation fields.
- In shadow-mode, does not update `profiles`.
- In enforce-mode, returns server-confirmed score and claps for `score-submit`.

### `score-submit`

Phase behavior:

- Legacy mode: current behavior with plausibility validation.
- Shadow mode: accepts current score path, but also links to `game_sessions` when available and records mismatches.
- Enforce mode: increases `profiles.best_score` and `profiles.clap_balance` only from an accepted server validation.

Existing balances are never reduced by this function. If validation fails, it returns a rejection and keeps the current profile unchanged.

## Shared Replay Engine

Add a new pure module, for example `src/game/core/rules-engine.js`.

Responsibilities:

- Deterministic RNG from server seed.
- Initial board generation.
- Move validation.
- Match resolution.
- Special creation.
- Special activation.
- Gravity and deterministic refill.
- Scoring.
- Clap earning.
- No DOM, no sound, no animation, no Supabase calls.

The browser UI uses the same engine for rule decisions. Edge Functions use the same rules ported or bundled for Deno.

Required tests:

- Same seed creates same board.
- Same move list creates same final board and score.
- Invalid non-adjacent move is rejected.
- Invalid no-match swap is rejected.
- Rocket, bomb, rocket+rocket, bomb+rocket, bomb+bomb combos replay exactly.
- Cascades produce stable scores.
- Clap earnings match `floor(score / 10000)` or the chosen production rule.

## Client Flow

Start game:

1. Client calls `game-session-start`.
2. Server returns `session_id` and `seed`.
3. Client initializes board from the shared rules engine.
4. UI animations remain client-side.

During game:

1. Client records successful moves: `{ from, to }`.
2. Optional snapshots may be sent for observability, but not trusted as truth.

End game:

1. Client calls `game-session-submit`.
2. Server replays moves.
3. In shadow-mode, client still uses current `score-submit` path.
4. In enforce-mode, `score-submit` requires accepted validation.

## Rollout Phases

### Phase 1: Pure Rules Extraction

Refactor scoring and resolution logic out of `game.js` into a pure rules module.

Safety:

- No database changes.
- No production behavior switch.
- Tests must prove existing board and special rules remain compatible.

### Phase 2: Additive Database Migration

Create new session and validation tables.

Safety:

- No changes to existing tables except optional additive columns.
- No existing row modification.
- Backup and row-count verification before and after.

### Phase 3: Shadow Mode

Deploy `game-session-start` and `game-session-submit`.

Behavior:

- New validations are recorded.
- Existing `score-submit` remains the source of production progress.
- Dashboard can show mismatch counts later, but this is optional for the first release.

Success criteria:

- At least several real sessions validate without unexpected mismatch.
- No drop in successful ordinary gameplay.
- No player support complaints about missing progress.

### Phase 4: Enforce Mode

Switch future score increases to accepted server validations.

Behavior:

- Existing `best_score` remains.
- New `best_score` can only increase from accepted replay.
- Existing `clap_balance` remains.
- New earned claps can only increase from accepted replay or existing server-authoritative spend/reward endpoints.

Rollback:

- Runtime config flag returns `score-submit` to legacy guarded mode.
- New tables remain for analysis.
- No profile data needs restoration because enforce-mode never lowers values.

## Failure Handling

If session start fails:

- Show a clear retry state.
- Do not start a score-bearing run.

If session submit fails due to network:

- Keep local UI result visible.
- Retry submit when possible.
- Do not lower profile.

If validation fails:

- Do not write new best score or earned claps.
- Keep old profile unchanged.
- Record validation failure for audit.

If server replay has a bug:

- Disable enforce-mode with runtime config.
- Continue legacy guarded mode.
- Fix replay under tests.

## Security Properties

The attacker cannot gain a new record by only changing `bestScore` in the request.

The attacker cannot gain a new record by only changing `analytics-track`, because analytics is not authoritative.

The attacker cannot gain a new record by inventing arbitrary moves unless those moves replay from the server seed to the claimed result.

The attacker cannot affect other players because every session is tied to verified Telegram `initData` and `telegram_id`.

## Open Implementation Choices

Recommended defaults:

- Use replay-at-submit, not server roundtrip per move.
- Use shadow-mode before enforce-mode.
- Keep old `profiles` values as baseline.
- Keep a runtime config flag for `legacy | shadow | enforce`.

Questions to settle during planning:

- Exact seed format.
- Whether the Deno function imports the JS rules module directly or uses a Deno-specific copy generated from the same source.
- How long to retain raw move rows.
- Whether dashboard needs anti-cheat monitoring in the first implementation pass or second pass.
