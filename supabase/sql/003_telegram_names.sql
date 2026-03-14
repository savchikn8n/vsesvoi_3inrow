alter table public.profiles
  add column if not exists telegram_first_name text,
  add column if not exists telegram_last_name text;

