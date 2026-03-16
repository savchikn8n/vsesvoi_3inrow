alter table public.profiles
  add column if not exists beta_claps_migrated boolean not null default false;

update public.profiles
set
  clap_balance = clap_balance + floor(greatest(best_score, 0) / 10000.0)::integer,
  beta_claps_migrated = true
where beta_claps_migrated = false;
