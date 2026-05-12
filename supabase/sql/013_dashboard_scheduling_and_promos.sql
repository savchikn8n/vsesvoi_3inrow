create extension if not exists pgcrypto;

alter table public.broadcast_messages
  add column if not exists scheduled_for timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists status text not null default 'sent';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'broadcast_messages_status_check'
  ) then
    alter table public.broadcast_messages
      add constraint broadcast_messages_status_check
      check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled'));
  end if;
end $$;

create index if not exists broadcast_messages_status_schedule_idx
  on public.broadcast_messages (status, scheduled_for asc);

alter table public.promo_popups
  add column if not exists active_until timestamptz;
