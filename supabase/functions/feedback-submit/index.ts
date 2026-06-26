import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
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

    const { initData, message } = await req.json();
    const normalizedMessage = typeof message === 'string' ? message.trim().slice(0, 600) : '';
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), { status: 400, headers: corsHeaders });
    }
    if (!normalizedMessage) {
      return new Response(JSON.stringify({ error: 'message is required' }), { status: 400, headers: corsHeaders });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);
    const { data: existing, error: profileError } = await admin
      .from('profiles')
      .select('telegram_id, display_name, telegram_username, telegram_first_name')
      .eq('telegram_id', user.id)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!existing?.telegram_id) throw new Error('Профиль не найден.');

    const nowIso = new Date().toISOString();
    const { error: insertError } = await admin
      .from('player_feedback')
      .insert({
        telegram_id: user.id,
        message: normalizedMessage,
        display_name_snapshot: existing.display_name || null,
        telegram_username_snapshot: user.username || existing.telegram_username || null,
        telegram_first_name_snapshot: user.first_name || existing.telegram_first_name || null,
        created_at: nowIso,
      });
    if (insertError) throw new Error(insertError.message);

    return new Response(JSON.stringify({ ok: true, created_at: nowIso }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Feedback submit error' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
