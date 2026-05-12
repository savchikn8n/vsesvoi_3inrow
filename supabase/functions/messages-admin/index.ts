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

function normalizePositiveInt(value: unknown, max: number) {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(max, Math.floor(raw)));
}

function normalizeScheduledFor(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    throw new Error('Неверная дата отложенного сообщения');
  }
  return new Date(timestamp).toISOString();
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || 'Telegram sendMessage failed');
  }
}

async function fetchRecipients(admin: ReturnType<typeof createClient>, limit: number) {
  const { data, error } = await admin
    .from('profiles')
    .select('telegram_id, notifications_enabled')
    .eq('notifications_enabled', true)
    .not('telegram_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []).filter((item) => item?.telegram_id);
}

async function dispatchBroadcast(
  admin: ReturnType<typeof createClient>,
  botToken: string,
  payload: {
    id: string;
    text: string;
    bonusClaps: number;
    bonusWindowHours: number;
    createdAt: string;
  },
  limit: number,
) {
  const recipients = await fetchRecipients(admin, limit);
  const recipientRows = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const item of recipients) {
    try {
      await sendTelegramMessage(botToken, Number(item.telegram_id), payload.text);
      sentCount += 1;
      recipientRows.push({
        id: crypto.randomUUID(),
        broadcast_id: payload.id,
        telegram_id: Number(item.telegram_id),
        status: 'sent',
        error: null,
        sent_at: new Date().toISOString(),
      });
    } catch (sendError) {
      failedCount += 1;
      recipientRows.push({
        id: crypto.randomUUID(),
        broadcast_id: payload.id,
        telegram_id: Number(item.telegram_id),
        status: 'failed',
        error: sendError instanceof Error ? sendError.message : 'Unknown error',
        sent_at: new Date().toISOString(),
      });
    }
  }

  if (recipientRows.length) {
    const { error: recipientsInsertError } = await admin
      .from('broadcast_message_recipients')
      .insert(recipientRows);
    if (recipientsInsertError) throw new Error(recipientsInsertError.message);
  }

  const sentAt = new Date().toISOString();
  const finalStatus = sentCount > 0 ? 'sent' : 'failed';
  const { error: broadcastUpdateError } = await admin
    .from('broadcast_messages')
    .update({
      status: finalStatus,
      sent_at: sentAt,
      sent_count: sentCount,
      failed_count: failedCount,
    })
    .eq('id', payload.id);
  if (broadcastUpdateError) throw new Error(broadcastUpdateError.message);

  const { error: analyticsEventError } = await admin
    .from('analytics_events')
    .insert({
      telegram_id: 0,
      session_id: `broadcast:${payload.id}`,
      event_name: 'broadcast_sent',
      event_payload: {
        broadcast_id: payload.id,
        recipients: recipients.length,
        sent: sentCount,
        failed: failedCount,
        bonus_claps: payload.bonusClaps,
        bonus_window_hours: payload.bonusWindowHours,
      },
      event_at: sentAt,
    });
  if (analyticsEventError) throw new Error(analyticsEventError.message);

  return {
    total: recipients.length,
    sent: sentCount,
    failed: failedCount,
  };
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
    const bonusClaps = normalizePositiveInt(body?.bonusClaps, 100000);
    const bonusWindowHours = normalizePositiveInt(body?.bonusWindowHours, 24 * 30);
    const limit = Math.max(1, Math.min(5000, normalizePositiveInt(body?.limit, 5000) || 2000));
    const dryRun = Boolean(body?.dryRun);
    const scheduledFor = normalizeScheduledFor(body?.scheduledFor);

    if (!messageText) {
      return new Response(JSON.stringify({ error: 'Text is required' }), { status: 400, headers: corsHeaders });
    }
    if (bonusClaps > 0 && bonusWindowHours <= 0) {
      return new Response(JSON.stringify({ error: 'Bonus window is required when bonus claps are set' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    if (dryRun) {
      const recipients = await fetchRecipients(admin, limit);
      return new Response(JSON.stringify({
        dryRun: true,
        recipients: recipients.length,
      }), { status: 200, headers: corsHeaders });
    }

    if (scheduledFor && Date.parse(scheduledFor) > Date.now() + 60 * 1000) {
      const row = {
        id: crypto.randomUUID(),
        text: messageText,
        bonus_claps: bonusClaps,
        bonus_window_hours: bonusWindowHours,
        created_at: new Date().toISOString(),
        scheduled_for: scheduledFor,
        sent_at: null,
        status: 'scheduled',
        sent_count: 0,
        failed_count: 0,
      };
      const { error: insertError } = await admin.from('broadcast_messages').insert(row);
      if (insertError) throw new Error(insertError.message);

      const { error: analyticsEventError } = await admin
        .from('analytics_events')
        .insert({
          telegram_id: 0,
          session_id: `broadcast:${row.id}`,
          event_name: 'broadcast_scheduled',
          event_payload: {
            broadcast_id: row.id,
            scheduled_for: scheduledFor,
            bonus_claps: bonusClaps,
            bonus_window_hours: bonusWindowHours,
          },
          event_at: row.created_at,
        });
      if (analyticsEventError) throw new Error(analyticsEventError.message);

      return new Response(JSON.stringify({
        broadcastId: row.id,
        scheduled: true,
        scheduledFor,
      }), { status: 200, headers: corsHeaders });
    }

    const broadcastId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const { error: insertError } = await admin
      .from('broadcast_messages')
      .insert({
        id: broadcastId,
        text: messageText,
        bonus_claps: bonusClaps,
        bonus_window_hours: bonusWindowHours,
        created_at: createdAt,
        sent_at: null,
        status: 'sending',
        sent_count: 0,
        failed_count: 0,
      });
    if (insertError) throw new Error(insertError.message);

    const result = await dispatchBroadcast(
      admin,
      BOT_TOKEN,
      {
        id: broadcastId,
        text: messageText,
        bonusClaps,
        bonusWindowHours,
        createdAt,
      },
      limit,
    );

    return new Response(JSON.stringify({
      broadcastId,
      sent: result.sent,
      failed: result.failed,
      total: result.total,
      bonusClaps,
      bonusWindowHours,
      scheduled: false,
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Messages admin error' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
