alter table public.shop_purchases
  add column if not exists issued_at timestamptz;
