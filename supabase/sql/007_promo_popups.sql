create table if not exists public.promo_popups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text not null,
  primary_label text not null default 'Перейти',
  primary_url text not null,
  secondary_label text not null default 'Уже',
  is_active boolean not null default false,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promo_popup_events (
  id bigint generated always as identity primary key,
  popup_id uuid not null references public.promo_popups(id) on delete cascade,
  telegram_id bigint not null,
  action text not null check (action in ('view', 'dismiss', 'open')),
  event_at timestamptz not null default now()
);

create index if not exists promo_popups_active_idx on public.promo_popups (is_active, updated_at desc);
create index if not exists promo_popup_events_popup_idx on public.promo_popup_events (popup_id, event_at desc);
create index if not exists promo_popup_events_action_idx on public.promo_popup_events (action, event_at desc);

create or replace function public.set_promo_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_promo_popups_updated_at on public.promo_popups;
create trigger set_promo_popups_updated_at
before update on public.promo_popups
for each row execute function public.set_promo_updated_at();
