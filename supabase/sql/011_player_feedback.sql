create table if not exists public.player_feedback (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  message text not null,
  display_name_snapshot text,
  telegram_username_snapshot text,
  telegram_first_name_snapshot text,
  created_at timestamptz not null default now()
);

create index if not exists player_feedback_created_at_idx
  on public.player_feedback (created_at desc);

create index if not exists player_feedback_telegram_id_idx
  on public.player_feedback (telegram_id, created_at desc);
