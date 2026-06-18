alter table public.shop_purchases add column if not exists item_type text not null default 'gift';
alter table public.shop_purchases add column if not exists discount_percent integer;

create index if not exists shop_purchases_item_type_idx
  on public.shop_purchases (item_type, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shop_purchases_item_type_check'
  ) then
    alter table public.shop_purchases
      add constraint shop_purchases_item_type_check
      check (item_type in ('gift', 'discount'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'shop_purchases_discount_percent_check'
  ) then
    alter table public.shop_purchases
      add constraint shop_purchases_discount_percent_check
      check (
        (item_type = 'gift' and discount_percent is null)
        or
        (item_type = 'discount' and discount_percent in (10, 20, 30, 40))
      );
  end if;
end $$;
