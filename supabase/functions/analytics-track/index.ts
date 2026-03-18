import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(keyRaw: Uint8Array, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return toHex(signature);
}

async function hmacSha256Raw(keyRaw: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

async function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new Error('Missing hash in initData');
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretRaw = await hmacSha256Raw(new TextEncoder().encode('WebAppData'), botToken);
  const calculated = await hmacSha256Hex(secretRaw, dataCheckString);

  if (calculated !== hash) {
    throw new Error('Invalid Telegram signature');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('Missing Telegram user data');
  }

  const user = JSON.parse(userRaw);
  if (!user?.id) {
    throw new Error('Invalid Telegram user payload');
  }

  return user;
}

function normalizeSessionId(sessionId: unknown) {
  const value = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!value || value.length > 128) {
    throw new Error('Invalid sessionId');
  }
  return value;
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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const initData = typeof body?.initData === 'string' ? body.initData : '';
    const eventType = typeof body?.eventType === 'string' ? body.eventType.trim() : '';
    const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};

    if (!initData) {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    if (!eventType) {
      return new Response(JSON.stringify({ error: 'eventType is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);

    if (eventType === 'session_start') {
      const sessionId = normalizeSessionId(payload.sessionId);
      const { error } = await admin.from('analytics_sessions').upsert(
        {
          session_id: sessionId,
          telegram_id: user.id,
          session_started_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' },
      );

      if (error) throw new Error(error.message);
    } else if (eventType === 'session_end') {
      const sessionId = normalizeSessionId(payload.sessionId);
      const durationSec = Math.max(0, Math.floor(Number(payload.durationSec || 0)));
      const bestScore = Math.max(0, Math.floor(Number(payload.bestScore || 0)));
      const clapsEarned = Math.max(0, Math.floor(Number(payload.clapsEarned || 0)));
      const movesCount = Math.max(0, Math.floor(Number(payload.movesCount || 0)));
      const endReason =
        typeof payload.endReason === 'string' && payload.endReason.trim() ? payload.endReason.trim().slice(0, 32) : null;

      const { error } = await admin.from('analytics_sessions').upsert(
        {
          session_id: sessionId,
          telegram_id: user.id,
          session_ended_at: new Date().toISOString(),
          duration_sec: durationSec,
          end_reason: endReason,
          best_score: bestScore,
          claps_earned: clapsEarned,
          moves_count: movesCount,
        },
        { onConflict: 'session_id' },
      );

      if (error) throw new Error(error.message);
    } else {
      const sessionId =
        typeof payload.sessionId === 'string' && payload.sessionId.trim() ? payload.sessionId.trim().slice(0, 128) : null;

      const { error } = await admin.from('analytics_events').insert({
        telegram_id: user.id,
        session_id: sessionId,
        event_name: eventType.slice(0, 64),
        event_payload: payload,
      });

      if (error) throw new Error(error.message);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Analytics error' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
