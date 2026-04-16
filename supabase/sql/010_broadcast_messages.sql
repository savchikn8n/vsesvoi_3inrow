create extension if not exists pgcrypto;

create table if not exists public.broadcast_messages (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_message_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcast_messages(id) on delete cascade,
  telegram_id bigint not null,
  status text not null,
  error text,
  sent_at timestamptz not null default now()
);

create index if not exists broadcast_messages_created_idx
  on public.broadcast_messages (created_at desc);

create index if not exists broadcast_message_recipients_broadcast_idx
  on public.broadcast_message_recipients (broadcast_id, sent_at desc);

create index if not exists broadcast_message_recipients_telegram_idx
  on public.broadcast_message_recipients (telegram_id, sent_at desc);
