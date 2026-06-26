create table if not exists public.score_submissions (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  session_id text,
  incoming_best_score integer not null default 0,
  incoming_clap_balance integer not null default 0,
  previous_best_score integer not null default 0,
  previous_clap_balance integer not null default 0,
  recent_session_best_score integer,
  recent_session_claps_earned integer,
  accepted boolean not null default false,
  reject_reason text,
  created_at timestamptz not null default now()
);

create index if not exists score_submissions_telegram_created_idx
  on public.score_submissions (telegram_id, created_at desc);

create index if not exists score_submissions_session_idx
  on public.score_submissions (session_id);

alter table public.score_submissions enable row level security;
