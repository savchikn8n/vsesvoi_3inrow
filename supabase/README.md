## Supabase setup for Telegram auth MVP

1. Run SQL from `supabase/sql/001_init_profiles.sql` in Supabase SQL editor.
2. Run SQL from `supabase/sql/002_inactive_notifications.sql` in Supabase SQL editor.
3. Set Edge Functions secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REMINDER_CRON_SECRET`
4. Deploy functions:
   - `supabase functions deploy telegram-auth`
   - `supabase functions deploy profile-save`
   - `supabase functions deploy leaderboard`
   - `supabase functions deploy score-submit`
   - `supabase functions deploy touch-session`
   - `supabase functions deploy send-inactive-reminders`
5. In frontend, set global variable before loading `game.js`:

```html
<script>
  window.__SUPABASE_URL__ = 'https://YOUR_PROJECT_REF.supabase.co';
</script>
```

6. Endpoints used by frontend:
   - `POST /functions/v1/telegram-auth`
   - `POST /functions/v1/profile-save`
   - `POST /functions/v1/leaderboard`
   - `POST /functions/v1/score-submit`
   - `POST /functions/v1/touch-session`

7. To send reminders after 24 hours of inactivity:
   - schedule `POST /functions/v1/send-inactive-reminders` once per hour
   - pass header `x-cron-secret: YOUR_REMINDER_CRON_SECRET`
   - users are selected when:
     - `notifications_enabled = true`
     - `last_seen_at <= now() - 24 hours`
     - `last_inactive_reminder_at is null` or older than the user's latest `last_seen_at`

8. Example scheduling in Supabase Cron (official approach: `pg_cron + pg_net + Vault`):

```sql
select vault.create_secret('https://tnngitplssufqeqpxuib.supabase.co', 'project_url')
on conflict do nothing;

select vault.create_secret('YOUR_REMINDER_CRON_SECRET', 'reminder_cron_secret')
on conflict do nothing;

select
  cron.schedule(
    'send-inactive-reminders-hourly',
    '0 * * * *',
    $$
    select
      net.http_post(
        url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-inactive-reminders',
        headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
        ),
        body:='{"limit": 100}'::jsonb,
        timeout_milliseconds:=10000
      ) as request_id;
    $$
  );
```

Reference:
- Supabase docs: [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- Supabase docs: [Cron](https://supabase.com/docs/guides/cron)
