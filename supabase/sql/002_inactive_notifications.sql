alter table public.profiles
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists notifications_enabled boolean not null default true,
  add column if not exists last_inactive_reminder_at timestamptz;

update public.profiles
set
  last_seen_at = coalesce(last_seen_at, updated_at, created_at, now()),
  notifications_enabled = coalesce(notifications_enabled, true)
where true;

create index if not exists profiles_last_seen_idx
  on public.profiles (notifications_enabled, last_seen_at);

