import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

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

async function dispatchScheduledBroadcast(
  admin: ReturnType<typeof createClient>,
  botToken: string,
  row: {
    id: string;
    text: string;
    bonus_claps: number | null;
    bonus_window_hours: number | null;
  },
  limit: number,
) {
  const recipients = await fetchRecipients(admin, limit);
  const recipientRows = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const item of recipients) {
    try {
      await sendTelegramMessage(botToken, Number(item.telegram_id), row.text);
      sentCount += 1;
      recipientRows.push({
        id: crypto.randomUUID(),
        broadcast_id: row.id,
        telegram_id: Number(item.telegram_id),
        status: 'sent',
        error: null,
        sent_at: new Date().toISOString(),
      });
    } catch (sendError) {
      failedCount += 1;
      recipientRows.push({
        id: crypto.randomUUID(),
        broadcast_id: row.id,
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
    .eq('id', row.id);
  if (broadcastUpdateError) throw new Error(broadcastUpdateError.message);

  const { error: analyticsEventError } = await admin
    .from('analytics_events')
    .insert({
      telegram_id: 0,
      session_id: `broadcast:${row.id}`,
      event_name: 'broadcast_sent',
      event_payload: {
        broadcast_id: row.id,
        recipients: recipients.length,
        sent: sentCount,
        failed: failedCount,
        bonus_claps: Number(row.bonus_claps || 0),
        bonus_window_hours: Number(row.bonus_window_hours || 0),
      },
      event_at: sentAt,
    });
  if (analyticsEventError) throw new Error(analyticsEventError.message);

  return { sent: sentCount, failed: failedCount, total: recipients.length };
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
    const limitRaw = Number(body?.limit || 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(250, Math.floor(limitRaw))) : 50;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();
    const { data: dueRows, error: dueError } = await admin
      .from('broadcast_messages')
      .select('id, text, bonus_claps, bonus_window_hours, scheduled_for, status')
      .eq('status', 'scheduled')
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: true })
      .limit(limit);
    if (dueError) throw new Error(dueError.message);

    const processed = [];
    for (const row of dueRows || []) {
      const { data: lockedRows, error: lockError } = await admin
        .from('broadcast_messages')
        .update({ status: 'sending' })
        .eq('id', row.id)
        .eq('status', 'scheduled')
        .select('id, text, bonus_claps, bonus_window_hours')
        .limit(1);
      if (lockError) throw new Error(lockError.message);
      const lockedRow = lockedRows?.[0];
      if (!lockedRow) continue;
      try {
        const result = await dispatchScheduledBroadcast(admin, BOT_TOKEN, lockedRow, 2000);
        processed.push({
          id: row.id,
          ...result,
        });
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : 'Scheduled broadcast failed';
        await admin
          .from('broadcast_messages')
          .update({ status: 'failed' })
          .eq('id', row.id);
        processed.push({
          id: row.id,
          sent: 0,
          failed: 0,
          total: 0,
          error: failureMessage,
        });
      }
    }

    return new Response(JSON.stringify({ processed }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Scheduled broadcasts error' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
