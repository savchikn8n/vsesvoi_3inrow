import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function normalizeText(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || 'Telegram sendMessage failed');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const DASHBOARD_SECRET = Deno.env.get('DASHBOARD_SECRET') || '';
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!DASHBOARD_SECRET || !BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const providedSecret =
      req.headers.get('x-dashboard-secret')
      || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      || '';
    if (providedSecret !== DASHBOARD_SECRET) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const messageText = normalizeText(body?.text, 1000);
    const requestedLimit = Number(body?.limit || 2000);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(5000, Math.floor(requestedLimit)))
      : 2000;
    const dryRun = Boolean(body?.dryRun);

    if (!messageText) {
      return new Response(JSON.stringify({ error: 'Text is required' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await admin
      .from('profiles')
      .select('telegram_id, notifications_enabled')
      .eq('notifications_enabled', true)
      .not('telegram_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);

    const recipients = (data || []).filter((item) => item?.telegram_id);
    if (dryRun) {
      return new Response(JSON.stringify({
        dryRun: true,
        recipients: recipients.length,
      }), { status: 200, headers: corsHeaders });
    }

    const results = [];
    for (const item of recipients) {
      try {
        await sendTelegramMessage(BOT_TOKEN, Number(item.telegram_id), messageText);
        results.push({ telegram_id: item.telegram_id, status: 'sent' });
      } catch (sendError) {
        results.push({
          telegram_id: item.telegram_id,
          status: 'failed',
          error: sendError instanceof Error ? sendError.message : 'Unknown error',
        });
      }
    }

    return new Response(JSON.stringify({
      sent: results.filter((item) => item.status === 'sent').length,
      failed: results.filter((item) => item.status === 'failed').length,
      total: recipients.length,
      results,
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Messages admin error' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
