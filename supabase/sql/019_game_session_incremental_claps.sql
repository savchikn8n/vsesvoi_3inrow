-- Track how many claps each session has already credited so a session can be
-- (re)submitted as a run is extended by a paid continue without double-paying.
alter table public.game_sessions
  add column if not exists credited_claps integer not null default 0;

-- Atomic, idempotent crediting from an accepted server replay. The row lock
-- serializes concurrent submits for the same session, and only the positive
-- delta beyond the already-credited amount is added to the balance. Best score
-- is raised with GREATEST, never lowered.
create or replace function public.credit_game_session_result(
  p_session_id text,
  p_telegram_id bigint,
  p_server_score integer,
  p_server_claps_earned integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev integer;
  v_delta integer;
begin
  select credited_claps into v_prev
    from public.game_sessions
    where session_id = p_session_id
    for update;

  v_prev := coalesce(v_prev, 0);
  v_delta := greatest(0, coalesce(p_server_claps_earned, 0) - v_prev);

  update public.game_sessions
    set credited_claps = greatest(coalesce(credited_claps, 0), coalesce(p_server_claps_earned, 0))
    where session_id = p_session_id;

  update public.profiles
    set
      best_score = greatest(coalesce(best_score, 0), greatest(coalesce(p_server_score, 0), 0)),
      clap_balance = coalesce(clap_balance, 0) + v_delta
    where telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.credit_game_session_result(text, bigint, integer, integer) from public;
revoke all on function public.credit_game_session_result(text, bigint, integer, integer) from anon;
revoke all on function public.credit_game_session_result(text, bigint, integer, integer) from authenticated;
grant execute on function public.credit_game_session_result(text, bigint, integer, integer) to service_role;
