import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { initData } = await req.json();
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);

    const { data, error } = await admin
      .from('profiles')
      .upsert(
        {
          telegram_id: user.id,
          telegram_username: user.username || null,
          telegram_first_name: user.first_name || null,
          telegram_last_name: user.last_name || null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'telegram_id' },
      )
      .select('telegram_id, telegram_username, telegram_first_name, telegram_last_name, display_name, avatar_choice, avatar_url, best_score, clap_balance, last_seen_at, notifications_enabled')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    const isProfileComplete = Boolean(data?.display_name && data?.avatar_url);

    return new Response(JSON.stringify({ profile: data, is_profile_complete: isProfileComplete }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }
});
