-- Cron run-history diet.
--
-- The August 2026 outage was blamed on per-move audit rows, but the measurement
-- taken on 2026-08-27 told a different story: game_session_moves held 0 rows and
-- 32 kB, while cron.job_run_details held 154169 rows and 110 MB — by far the
-- largest object in the database. pg_cron appends one row per job run and never
-- prunes it. With process-scheduled-broadcasts-every-minute on a '* * * * *'
-- schedule that is 1440 rows a day, roughly 107 days of accumulation, kept hot
-- by autovacuum. That was the disk IO burner that held the instance down.
--
-- This adds the retention pass that pg_cron does not ship with. No player data
-- is involved: profiles, balances, best scores, purchases and gifts are not
-- touched by anything here.

create or replace function public.prune_cron_run_history(
  p_retention_days integer default 3,
  p_batch_limit integer default 20000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_retention_days, 1));
  v_limit integer := greatest(least(p_batch_limit, 100000), 1);
  v_deleted bigint;
begin
  -- Bounded like prune_operational_logs: an unbounded DELETE over a backlog of
  -- this size would spike WAL hard enough to repeat the outage it prevents.
  with victims as (
    select ctid from cron.job_run_details
    where end_time < v_cutoff
    limit v_limit
  )
  delete from cron.job_run_details d
  using victims v
  where d.ctid = v.ctid;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_cron_run_history(integer, integer) from public;
revoke all on function public.prune_cron_run_history(integer, integer) from anon;
revoke all on function public.prune_cron_run_history(integer, integer) from authenticated;

-- Daily, offset from the 03:17 operational-log pass so the two never overlap.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'prune-cron-run-history';

    perform cron.schedule(
      'prune-cron-run-history',
      '43 3 * * *',
      $cron$select public.prune_cron_run_history();$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function then
    raise notice 'pg_cron not scheduled; call prune_cron_run_history() manually';
end;
$$;
