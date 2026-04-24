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
  if (!hash) throw new Error('Missing hash in initData');

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretRaw = await hmacSha256Raw(new TextEncoder().encode('WebAppData'), botToken);
  const calculated = await hmacSha256Hex(secretRaw, dataCheckString);
  if (calculated !== hash) throw new Error('Invalid Telegram signature');

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('Missing Telegram user data');
  const user = JSON.parse(userRaw);
  if (!user?.id) throw new Error('Invalid Telegram user payload');
  return user;
}

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

    const { initData } = await req.json().catch(() => ({}));
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), { status: 400, headers: corsHeaders });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const now = Date.now();
    const since90d = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

    const profileRes = await admin
      .from('profiles')
      .select('telegram_id, telegram_username, telegram_first_name, telegram_last_name, display_name, avatar_choice, avatar_url, best_score, clap_balance, last_seen_at, notifications_enabled')
      .eq('telegram_id', user.id)
      .single();
    if (profileRes.error) throw new Error(profileRes.error.message);
    const profile = profileRes.data;

    const recipientsRes = await admin
      .from('broadcast_message_recipients')
      .select('broadcast_id, sent_at, status')
      .eq('telegram_id', user.id)
      .eq('status', 'sent')
      .gte('sent_at', since90d)
      .order('sent_at', { ascending: false })
      .limit(200);
    if (recipientsRes.error) throw new Error(recipientsRes.error.message);

    const recipients = recipientsRes.data || [];
    const broadcastIds = [...new Set(recipients.map((item) => item.broadcast_id).filter(Boolean))];
    if (!broadcastIds.length) {
      return new Response(JSON.stringify({ awardedClaps: 0, profile }), { status: 200, headers: corsHeaders });
    }

    const broadcastsRes = await admin
      .from('broadcast_messages')
      .select('id, text, created_at, bonus_claps, bonus_window_hours')
      .in('id', broadcastIds)
      .gt('bonus_claps', 0)
      .gt('bonus_window_hours', 0);
    if (broadcastsRes.error) throw new Error(broadcastsRes.error.message);

    const claimsRes = await admin
      .from('broadcast_bonus_claims')
      .select('broadcast_id')
      .eq('telegram_id', user.id)
      .in('broadcast_id', broadcastIds);
    if (claimsRes.error) throw new Error(claimsRes.error.message);

    const claimedIds = new Set((claimsRes.data || []).map((item) => String(item.broadcast_id)));
    const recipientsByBroadcast = new Map(recipients.map((item) => [String(item.broadcast_id), item]));

    const eligible = (broadcastsRes.data || []).filter((broadcast) => {
      const id = String(broadcast.id);
      if (claimedIds.has(id)) return false;
      const recipient = recipientsByBroadcast.get(id);
      if (!recipient?.sent_at) return false;
      const sentAt = new Date(recipient.sent_at).getTime();
      const expiresAt = sentAt + Number(broadcast.bonus_window_hours || 0) * 60 * 60 * 1000;
      return Number.isFinite(expiresAt) && now <= expiresAt;
    });

    if (!eligible.length) {
      return new Response(JSON.stringify({ awardedClaps: 0, profile }), { status: 200, headers: corsHeaders });
    }

    const awardedClaps = eligible.reduce((sum, item) => sum + Math.max(0, Number(item.bonus_claps || 0)), 0);
    const nextClaps = Math.max(0, Number(profile.clap_balance || 0)) + awardedClaps;
    const nowIso = new Date().toISOString();

    const updateRes = await admin
      .from('profiles')
      .update({ clap_balance: nextClaps, last_seen_at: nowIso })
      .eq('telegram_id', user.id)
      .eq('clap_balance', Math.max(0, Number(profile.clap_balance || 0)))
      .select('telegram_id, telegram_username, telegram_first_name, telegram_last_name, display_name, avatar_choice, avatar_url, best_score, clap_balance, last_seen_at, notifications_enabled')
      .single();
    if (updateRes.error) throw new Error(updateRes.error.message);

    const claimRows = eligible.map((item) => ({
      broadcast_id: item.id,
      telegram_id: user.id,
      claps_awarded: Math.max(0, Number(item.bonus_claps || 0)),
      claimed_at: nowIso,
    }));
    const claimInsertRes = await admin.from('broadcast_bonus_claims').insert(claimRows);
    if (claimInsertRes.error) throw new Error(claimInsertRes.error.message);

    return new Response(JSON.stringify({
      awardedClaps,
      profile: updateRes.data,
      broadcasts: eligible.map((item) => ({
        id: item.id,
        title: item.text,
        claps: Math.max(0, Number(item.bonus_claps || 0)),
      })),
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Bonus claim error' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
