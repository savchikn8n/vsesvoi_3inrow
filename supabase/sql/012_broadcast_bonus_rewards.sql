create extension if not exists pgcrypto;

alter table public.broadcast_messages
  add column if not exists bonus_claps integer not null default 0,
  add column if not exists bonus_window_hours integer not null default 0;

create table if not exists public.broadcast_bonus_claims (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcast_messages(id) on delete cascade,
  telegram_id bigint not null,
  claps_awarded integer not null,
  claimed_at timestamptz not null default now()
);

create unique index if not exists broadcast_bonus_claims_broadcast_user_uidx
  on public.broadcast_bonus_claims (broadcast_id, telegram_id);

create index if not exists broadcast_bonus_claims_telegram_idx
  on public.broadcast_bonus_claims (telegram_id, claimed_at desc);
