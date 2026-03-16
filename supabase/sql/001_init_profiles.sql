create table if not exists public.profiles (
  telegram_id bigint primary key,
  telegram_username text,
  display_name text,
  avatar_choice text,
  avatar_url text,
  best_score integer not null default 0,
  clap_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Чтение лидерборда (только безопасные поля).
drop policy if exists "profiles_read_public" on public.profiles;
create policy "profiles_read_public"
on public.profiles
for select
using (true);

-- Запись только через service role (Edge Functions).
drop policy if exists "profiles_no_direct_insert" on public.profiles;
create policy "profiles_no_direct_insert"
on public.profiles
for insert
with check (false);

drop policy if exists "profiles_no_direct_update" on public.profiles;
create policy "profiles_no_direct_update"
on public.profiles
for update
using (false)
with check (false);
