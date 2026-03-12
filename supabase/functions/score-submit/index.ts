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

    const { initData, bestScore } = await req.json();
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const incoming = Number(bestScore);
    if (!Number.isFinite(incoming) || incoming < 0) {
      return new Response(JSON.stringify({ error: 'bestScore must be a positive number' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);

    const { data: existing, error: readError } = await admin
      .from('profiles')
      .select('telegram_id, telegram_username, display_name, avatar_choice, avatar_url, best_score')
      .eq('telegram_id', user.id)
      .maybeSingle();

    if (readError) {
      throw new Error(readError.message);
    }

    const nextBest = Math.max(Number(existing?.best_score || 0), Math.floor(incoming));

    const { data, error } = await admin
      .from('profiles')
      .upsert(
        {
          telegram_id: user.id,
          telegram_username: user.username || null,
          best_score: nextBest,
        },
        { onConflict: 'telegram_id' },
      )
      .select('telegram_id, telegram_username, display_name, avatar_choice, avatar_url, best_score')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return new Response(JSON.stringify({ profile: data }), {
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
