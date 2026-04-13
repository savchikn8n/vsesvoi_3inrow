create table if not exists public.analytics_sessions (
  session_id text primary key,
  telegram_id bigint not null,
  session_started_at timestamptz not null default now(),
  session_ended_at timestamptz,
  duration_sec integer not null default 0,
  end_reason text,
  best_score integer not null default 0,
  claps_earned integer not null default 0,
  claps_spent integer not null default 0,
  moves_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.analytics_sessions
  add column if not exists claps_spent integer not null default 0;

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  telegram_id bigint not null,
  session_id text,
  event_name text not null,
  event_payload jsonb not null default '{}'::jsonb,
  event_at timestamptz not null default now()
);

create index if not exists analytics_sessions_started_idx
  on public.analytics_sessions (session_started_at desc);

create index if not exists analytics_sessions_telegram_idx
  on public.analytics_sessions (telegram_id, session_started_at desc);

create index if not exists analytics_events_event_at_idx
  on public.analytics_events (event_at desc);

create index if not exists analytics_events_name_idx
  on public.analytics_events (event_name, event_at desc);

create index if not exists analytics_events_telegram_idx
  on public.analytics_events (telegram_id, event_at desc);
