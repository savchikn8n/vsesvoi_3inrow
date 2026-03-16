alter table public.profiles
  add column if not exists clap_balance integer not null default 0;
