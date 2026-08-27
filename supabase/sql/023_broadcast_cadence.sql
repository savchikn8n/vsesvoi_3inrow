-- Broadcast polling cadence: every minute -> every five minutes.
--
-- The job that polls for scheduled broadcasts ran on '* * * * *': 1440 runs a
-- day, each appending a row to cron.job_run_details and firing an HTTP call.
-- That cadence was the largest standing source of disk IO left after the run
-- history was pruned (see 022). Five-minute delivery latency was accepted as
-- the price of a stable instance.
--
-- The batch limit goes 50 -> 250 at the same time. With five times fewer runs a
-- 50-message batch would stretch a full-audience broadcast across many cycles;
-- 250 covers the entire player base (195 profiles on 2026-08-27) in a single
-- run, so a broadcast still lands in one pass and only its start is delayed.
--
-- Everything here goes through pg_cron's own functions. Supabase revokes write
-- access to cron.job itself, so a direct UPDATE on it fails with "permission
-- denied for table job" and, inside a DO block, rolls back the reschedule that
-- came before it. The command text is carried in a variable rather than
-- retyped, so the vault lookups inside it cannot be lost to a copy-paste slip.
--
-- The job was created outside the repo and had no migration of its own, so this
-- file is also the first time its definition is captured in version control.

do $$
declare
  v_jobid bigint;
  v_command text;
begin
  select jobid, command into v_jobid, v_command
  from cron.job
  where jobname in ('process-scheduled-broadcasts-every-minute',
                    'process-scheduled-broadcasts')
  limit 1;

  if v_jobid is null then
    raise notice 'broadcast job not found; nothing to retune';
    return;
  end if;

  v_command := replace(v_command, '{"limit": 50}', '{"limit": 250}');

  -- unschedule + schedule rather than alter_job: the old name asserts a cadence
  -- that is no longer true, and pg_cron has no supported way to rename a job in
  -- place now that cron.job is read-only to us.
  perform cron.unschedule(v_jobid);
  perform cron.schedule('process-scheduled-broadcasts', '*/5 * * * *', v_command);
end;
$$;
