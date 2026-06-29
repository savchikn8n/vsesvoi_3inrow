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
