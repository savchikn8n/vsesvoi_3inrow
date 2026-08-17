-- One-off backlog drain. RUN MANUALLY, STEP BY STEP — this is not a migration
-- and must not be applied automatically.
--
-- After 020 the project stops producing per-move rows, but everything written
-- since March is still on disk and still costs autovacuum IO every day. This
-- drains it on a database that is already short of disk IO, so the whole point
-- is to go slowly: a single unbounded DELETE over the backlog would spike WAL
-- and repeat the outage.
--
-- Player data is out of scope here: profiles, balances, best scores, purchases
-- and gifts are never touched by any statement below.

-- STEP 1 — measure first. Run this alone and keep the output.
select relname as table_name,
       n_live_tup as live_rows,
       n_dead_tup as dead_rows,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       last_autovacuum
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 15;

-- STEP 2 — drop the move backlog.
--
-- game_session_moves is no longer written or read by anything, so once its rows
-- are gone the table stays empty. TRUNCATE reclaims the space immediately and,
-- unlike DELETE, writes almost no WAL and leaves no dead rows for autovacuum to
-- chew through afterwards — on a disk-starved instance that difference is the
-- whole game.
--
-- The foreign key from game_session_moves to game_sessions points outward, so
-- truncating this table alone keeps every session row intact.
--
-- Uncomment to run:
-- truncate table public.game_session_moves;

-- STEP 3 — drain the remaining logs in batches.
--
-- Run this repeatedly until every row of the result reports 0. Wait ~30 seconds
-- between calls and watch Disk IO in the Supabase Infrastructure panel: if it
-- pins at 100%, wait longer between runs rather than raising the batch size.
select * from public.prune_operational_logs(
  p_events_retention_days => 90,
  p_audit_retention_days => 90,
  p_batch_limit => 5000
);

-- STEP 4 — reclaim the freed space, one table at a time.
--
-- Plain VACUUM returns space to the table for reuse without the exclusive lock
-- (and without the temporary double disk usage) that VACUUM FULL requires.
-- These cannot run inside a transaction block, so execute them individually.
--
-- vacuum (analyze) public.analytics_events;
-- vacuum (analyze) public.game_session_validations;
-- vacuum (analyze) public.score_submissions;
-- vacuum (analyze) public.game_sessions;

-- STEP 5 — confirm. Re-run STEP 1 and compare: live_rows and total_size should
-- be down sharply and dead_rows near zero. Then verify balances survived:
select count(*) as players,
       sum(clap_balance) as total_claps,
       max(best_score) as top_score
from public.profiles;
