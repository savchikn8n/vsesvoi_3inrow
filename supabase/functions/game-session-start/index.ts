import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const RULES_VERSION = 'match3-v1';

// A human restarting instantly still needs ~30-60s per run; scripted farming
// wants hundreds of sessions per hour. 60/hour caps bots without touching players.
const SESSION_RATE_WINDOW_MS = 60 * 60 * 1000;
const SESSION_RATE_LIMIT = 60;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function createSeed() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

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

    const { initData } = await req.json().catch(() => ({}));
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const rateCutoffIso = new Date(Date.now() - SESSION_RATE_WINDOW_MS).toISOString();
    const { count: recentSessions, error: rateError } = await admin
      .from('game_sessions')
      .select('session_id', { count: 'exact', head: true })
      .eq('telegram_id', user.id)
      .gte('started_at', rateCutoffIso);
    if (rateError) throw new Error(rateError.message);
    if (Number(recentSessions || 0) >= SESSION_RATE_LIMIT) {
      return new Response(JSON.stringify({
        error: 'Too many game sessions, try again later',
        code: 'session_rate_limited',
      }), {
        status: 429,
        headers: corsHeaders,
      });
    }

    const sessionId = crypto.randomUUID();
    const seed = createSeed();

    const { error } = await admin.from('game_sessions').insert({
      session_id: sessionId,
      telegram_id: user.id,
      rules_version: RULES_VERSION,
      seed,
      status: 'started',
    });
    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({
      sessionId,
      seed,
      rulesVersion: RULES_VERSION,
      size: 7,
      colorCount: 4,
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Session start error';
    return new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: corsHeaders,
    });
  }
});
