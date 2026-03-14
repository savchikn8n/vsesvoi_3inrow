import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const BOOKING_URL = 'https://t.me/+Ew4VcHco7XBjNDU6';

const templates = [
  ({ name, score }: { name: string; score: number }) => ({
    text: `Привет, ${name}. Ты не заходил уже 24 часа. Проверь, не побил ли кто-то твой рекорд ${score}.`,
    cta: 'Вернуться в игру',
  }),
  ({ name, score }: { name: string; score: number }) => ({
    text: `${name}, твой лучший результат ${score} все еще в таблице. Самое время проверить, удержался ли он.`,
    cta: 'Открыть игру',
  }),
  ({ name }: { name: string; score: number }) => ({
    text: `${name}, если пока не до игры, тогда хотя бы забронируй столик в "Своих".`,
    cta: 'Забронировать столик',
  }),
  ({ name }: { name: string; score: number }) => ({
    text: `${name}, пора вернуться. А если не хочешь играть, то вот бронь столика в "Своих".`,
    cta: 'Столик в "Своих"',
  }),
];

function pickTemplate(displayName: string, bestScore: number) {
  const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % templates.length;
  const factory = templates[randomIndex];
  return factory({ name: displayName, score: bestScore });
}

function reminderName(item: {
  telegram_first_name?: string | null;
  display_name?: string | null;
}) {
  return item.telegram_first_name?.trim() || item.display_name?.trim() || 'Игрок';
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string, cta: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: cta, url: BOOKING_URL }]],
      },
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || 'Telegram sendMessage failed');
  }
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
    const CRON_SECRET = Deno.env.get('REMINDER_CRON_SECRET') || '';

    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CRON_SECRET) {
      throw new Error('Missing required environment variables');
    }

    const providedSecret =
      req.headers.get('x-cron-secret') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';
    if (providedSecret !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const requestedLimit = Number(body?.limit || 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(300, Math.floor(requestedLimit)))
      : 100;
    const inactiveBeforeIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin
      .from('profiles')
      .select(
        'telegram_id, telegram_first_name, display_name, best_score, last_seen_at, last_inactive_reminder_at, notifications_enabled',
      )
      .eq('notifications_enabled', true)
      .lte('last_seen_at', inactiveBeforeIso)
      .order('last_seen_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    const candidates = (data || []).filter((item) => {
      if (!item?.telegram_id || !item?.last_seen_at) return false;
      if (!item.last_inactive_reminder_at) return true;
      return new Date(item.last_inactive_reminder_at).getTime() < new Date(item.last_seen_at).getTime();
    });

    const results = [];
    for (const item of candidates) {
      const message = pickTemplate(
        reminderName(item),
        Number(item.best_score || 0),
      );

      try {
        await sendTelegramMessage(BOT_TOKEN, Number(item.telegram_id), message.text, message.cta);

        const { error: updateError } = await admin
          .from('profiles')
          .update({ last_inactive_reminder_at: new Date().toISOString() })
          .eq('telegram_id', item.telegram_id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        results.push({ telegram_id: item.telegram_id, status: 'sent' });
      } catch (sendError) {
        results.push({
          telegram_id: item.telegram_id,
          status: 'failed',
          error: sendError instanceof Error ? sendError.message : 'Unknown error',
        });
      }
    }

    return new Response(
      JSON.stringify({
        checked: data?.length || 0,
        eligible: candidates.length,
        results,
      }),
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
