-- Operational-log diet.
--
-- The game wrote one row per move into game_session_moves on every submitted
-- run. The anti-cheat never reads that table: game-session-submit replays the
-- moves straight from the request body and only writes them afterwards, so the
-- table was audit-only while carrying the heaviest write volume in the project.
-- That write amplification, plus log tables that were never pruned, exhausted
-- the disk IO budget and took the database offline.
--
-- After this migration accepted runs write no move rows at all, rejected runs
-- keep one compact JSON copy on the session, and every log table is pruned on a
-- retention window. Player-facing data (profiles, balances, best scores, shop
-- purchases, gifts) is never touched by any of this.

-- 1. Compact audit trail for rejected runs, so a suspicious game can still be
--    reconstructed by hand without a row per move.
alter table public.game_sessions
  add column if not exists rejected_moves jsonb;

-- 2. Pruning reads by timestamp, so each log table needs a leading timestamp
--    index. Without these every retention pass is a sequential scan, which is
--    exactly the IO cost we are trying to remove.
create index if not exists game_sessions_created_at_idx
  on public.game_sessions (created_at);

create index if not exists game_session_validations_created_at_idx
  on public.game_session_validations (created_at);

create index if not exists score_submissions_created_at_idx
  on public.score_submissions (created_at);

create index if not exists game_session_moves_created_at_idx
  on public.game_session_moves (created_at);

-- 3. Retention.
--
-- Deletes run in bounded batches: an unbounded DELETE over a backlog would spike
-- WAL and disk IO hard enough to repeat the outage it is meant to prevent. Each
-- call removes at most p_batch_limit rows per table and reports what it did, so
-- a large backlog is drained over several runs instead of one stampede.
--
-- analytics_sessions is deliberately NOT pruned: it holds one aggregate row per
-- session and feeds the dashboard's all-time overview.
create or replace function public.prune_operational_logs(
  p_events_retention_days integer default 90,
  p_audit_retention_days integer default 90,
  p_batch_limit integer default 20000
)
returns table (pruned_table text, deleted_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events_cutoff timestamptz := now() - make_interval(days => greatest(p_events_retention_days, 1));
  v_audit_cutoff timestamptz := now() - make_interval(days => greatest(p_audit_retention_days, 1));
  v_limit integer := greatest(least(p_batch_limit, 100000), 1);
  v_deleted bigint;
begin
  -- Detailed analytics events: the largest and least valuable backlog.
  with victims as (
    select ctid from public.analytics_events
    where event_at < v_events_cutoff
    limit v_limit
  )
  delete from public.analytics_events e
  using victims v
  where e.ctid = v.ctid;
  get diagnostics v_deleted = row_count;
  pruned_table := 'analytics_events';
  deleted_rows := v_deleted;
  return next;

  -- Move rows are no longer written, so this drains whatever is already stored.
  with victims as (
    select ctid from public.game_session_moves
    where created_at < v_audit_cutoff
    limit v_limit
  )
  delete from public.game_session_moves m
  using victims v
  where m.ctid = v.ctid;
  get diagnostics v_deleted = row_count;
  pruned_table := 'game_session_moves';
  deleted_rows := v_deleted;
  return next;

  with victims as (
    select ctid from public.game_session_validations
    where created_at < v_audit_cutoff
    limit v_limit
  )
  delete from public.game_session_validations gv
  using victims v
  where gv.ctid = v.ctid;
  get diagnostics v_deleted = row_count;
  pruned_table := 'game_session_validations';
  deleted_rows := v_deleted;
  return next;

  with victims as (
    select ctid from public.score_submissions
    where created_at < v_audit_cutoff
    limit v_limit
  )
  delete from public.score_submissions s
  using victims v
  where s.ctid = v.ctid;
  get diagnostics v_deleted = row_count;
  pruned_table := 'score_submissions';
  deleted_rows := v_deleted;
  return next;

  -- Sessions go last: game_session_moves references them, so their own rows must
  -- be gone first. Only sessions with no surviving move rows are removed, which
  -- keeps the foreign key satisfied without needing a cascade.
  with victims as (
    select gs.ctid from public.game_sessions gs
    where gs.created_at < v_audit_cutoff
      and not exists (
        select 1 from public.game_session_moves m
        where m.session_id = gs.session_id
      )
    limit v_limit
  )
  delete from public.game_sessions g
  using victims v
  where g.ctid = v.ctid;
  get diagnostics v_deleted = row_count;
  pruned_table := 'game_sessions';
  deleted_rows := v_deleted;
  return next;

  return;
end;
$$;

revoke all on function public.prune_operational_logs(integer, integer, integer) from public;
revoke all on function public.prune_operational_logs(integer, integer, integer) from anon;
revoke all on function public.prune_operational_logs(integer, integer, integer) from authenticated;

-- 4. Daily schedule. pg_cron may be unavailable depending on the plan, so this
--    degrades to a no-op rather than failing the migration; the function can
--    still be called manually or from the existing cron-triggered function.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'prune-operational-logs';

    perform cron.schedule(
      'prune-operational-logs',
      '17 3 * * *',
      $cron$select public.prune_operational_logs();$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function then
    raise notice 'pg_cron not scheduled; call prune_operational_logs() manually';
end;
$$;
