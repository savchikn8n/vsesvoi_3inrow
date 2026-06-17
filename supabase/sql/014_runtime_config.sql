create table if not exists public.app_runtime_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_app_runtime_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_runtime_config_updated_at on public.app_runtime_config;
create trigger set_app_runtime_config_updated_at
before update on public.app_runtime_config
for each row execute function public.set_app_runtime_config_updated_at();

insert into public.app_runtime_config (key, value)
values (
  'runtime',
  jsonb_build_object(
    'maintenance',
    jsonb_build_object(
      'enabled', false,
      'title', 'Техническая пауза',
      'body', 'Мы делаем игру чуточку лучше',
      'note', 'Приносим извинения за доставленные неудобства',
      'primaryLabel', 'Повторить',
      'secondaryLabel', 'Забронировать столик',
      'secondaryUrl', 'https://t.me/+Ew4VcHco7XBjNDU6',
      'imageUrl', './assets/maintenance-claps.svg',
      'updatedAt', ''
    )
  )
)
on conflict (key) do nothing;

alter table public.app_runtime_config enable row level security;

drop policy if exists "app_runtime_config_no_public_select" on public.app_runtime_config;
create policy "app_runtime_config_no_public_select"
on public.app_runtime_config
for select
using (false);

drop policy if exists "app_runtime_config_no_public_insert" on public.app_runtime_config;
create policy "app_runtime_config_no_public_insert"
on public.app_runtime_config
for insert
with check (false);

drop policy if exists "app_runtime_config_no_public_update" on public.app_runtime_config;
create policy "app_runtime_config_no_public_update"
on public.app_runtime_config
for update
using (false)
with check (false);
