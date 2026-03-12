## Supabase setup for Telegram auth MVP

1. Run SQL from `supabase/sql/001_init_profiles.sql` in Supabase SQL editor.
2. Set Edge Functions secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy functions:
   - `supabase functions deploy telegram-auth`
   - `supabase functions deploy profile-save`
   - `supabase functions deploy leaderboard`
   - `supabase functions deploy score-submit`
4. In frontend, set global variable before loading `game.js`:

```html
<script>
  window.__SUPABASE_URL__ = 'https://YOUR_PROJECT_REF.supabase.co';
</script>
```

5. Endpoints used by frontend:
   - `POST /functions/v1/telegram-auth`
   - `POST /functions/v1/profile-save`
   - `POST /functions/v1/leaderboard`
   - `POST /functions/v1/score-submit`
