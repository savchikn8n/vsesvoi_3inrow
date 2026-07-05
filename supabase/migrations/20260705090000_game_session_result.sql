create or replace function public.apply_game_session_result(
  p_telegram_id bigint,
  p_server_score integer,
  p_claps_earned integer
) returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set
    best_score = greatest(coalesce(best_score, 0), greatest(coalesce(p_server_score, 0), 0)),
    clap_balance = coalesce(clap_balance, 0) + greatest(coalesce(p_claps_earned, 0), 0)
  where telegram_id = p_telegram_id;
$$;

revoke all on function public.apply_game_session_result(bigint, integer, integer) from public;
revoke all on function public.apply_game_session_result(bigint, integer, integer) from anon;
revoke all on function public.apply_game_session_result(bigint, integer, integer) from authenticated;
grant execute on function public.apply_game_session_result(bigint, integer, integer) to service_role;
