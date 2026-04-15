create table if not exists public.shop_purchases (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  gift_id text not null,
  code text not null unique,
  claps_spent integer not null,
  display_name_snapshot text,
  telegram_username_snapshot text,
  telegram_first_name_snapshot text,
  created_at timestamptz not null default now()
);

create index if not exists shop_purchases_created_idx
  on public.shop_purchases (created_at desc);

create index if not exists shop_purchases_telegram_idx
  on public.shop_purchases (telegram_id, created_at desc);

alter table public.shop_purchases enable row level security;

drop policy if exists "shop_purchases_no_public_select" on public.shop_purchases;
create policy "shop_purchases_no_public_select"
on public.shop_purchases
for select
using (false);

drop policy if exists "shop_purchases_no_public_insert" on public.shop_purchases;
create policy "shop_purchases_no_public_insert"
on public.shop_purchases
for insert
with check (false);

drop policy if exists "shop_purchases_no_public_update" on public.shop_purchases;
create policy "shop_purchases_no_public_update"
on public.shop_purchases
for update
using (false)
with check (false);
