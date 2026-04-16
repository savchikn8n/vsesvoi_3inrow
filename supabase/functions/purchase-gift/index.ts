import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const SHOP_ITEMS = {
  hookah: { id: 'hookah', price: 350, title: 'Бесплатный покур кальяна' },
  tea: { id: 'tea', price: 200, title: 'Чайник китайского чая, любого на ваш выбор' },
  mundshtuk: { id: 'mundshtuk', price: 75, title: 'Фирменный мундштук' },
  tshirt: { id: 'tshirt', price: 500, title: 'Эксклюзивная футболка' },
} as const;

type ShopGiftId = keyof typeof SHOP_ITEMS;

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

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let body = '';
  for (const byte of bytes) {
    body += alphabet[byte % alphabet.length];
  }
  return `VS-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

async function makeUniqueCode(admin: ReturnType<typeof createClient>) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomCode();
    const { data, error } = await admin.from('shop_purchases').select('id').eq('code', code).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.id) return code;
  }
  throw new Error('Не удалось создать код покупки');
}

function buyerName(existing: {
  telegram_first_name?: string | null;
  telegram_username?: string | null;
  display_name?: string | null;
  telegram_id?: number | null;
}) {
  return existing.telegram_first_name?.trim()
    || existing.telegram_username?.trim()
    || existing.display_name?.trim()
    || String(existing.telegram_id || '');
}

async function sendPurchaseNotification(
  botToken: string,
  chatId: string,
  playerName: string,
  giftTitle: string,
  code: string,
) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `Игрок приобрёл подарок: ${giftTitle}!🎁\nКод подарка: ${code}\nИгрок: ${playerName}`,
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
    const ADMIN_GIFTS_BOT_TOKEN = Deno.env.get('ADMIN_GIFTS_BOT_TOKEN') || '';
    const ADMIN_GIFTS_CHAT_ID = Deno.env.get('ADMIN_GIFTS_CHAT_ID') || '';
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { initData, giftId } = await req.json();
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const normalizedGiftId = typeof giftId === 'string' ? giftId.trim().toLowerCase() as ShopGiftId : '' as ShopGiftId;
    const shopItem = SHOP_ITEMS[normalizedGiftId];
    if (!shopItem) {
      return new Response(JSON.stringify({ error: 'giftId is invalid' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);

    const { data: existing, error: readError } = await admin
      .from('profiles')
      .select('telegram_id, telegram_username, telegram_first_name, telegram_last_name, display_name, avatar_choice, avatar_url, best_score, clap_balance, last_seen_at, notifications_enabled')
      .eq('telegram_id', user.id)
      .maybeSingle();

    if (readError) throw new Error(readError.message);
    if (!existing?.telegram_id) throw new Error('Профиль не найден.');

    const currentClaps = Math.max(0, Number(existing.clap_balance || 0));
    if (currentClaps < shopItem.price) {
      return new Response(JSON.stringify({ error: 'Недостаточно ладошек.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const code = await makeUniqueCode(admin);
    const nextClaps = currentClaps - shopItem.price;
    const nowIso = new Date().toISOString();

    const { data: profileData, error: updateError } = await admin
      .from('profiles')
      .update({
        clap_balance: nextClaps,
        telegram_username: user.username || null,
        telegram_first_name: user.first_name || null,
        telegram_last_name: user.last_name || null,
        last_seen_at: nowIso,
      })
      .eq('telegram_id', user.id)
      .eq('clap_balance', currentClaps)
      .select('telegram_id, telegram_username, telegram_first_name, telegram_last_name, display_name, avatar_choice, avatar_url, best_score, clap_balance, last_seen_at, notifications_enabled')
      .single();

    if (updateError || !profileData?.telegram_id) {
      throw new Error(updateError?.message || 'Не удалось списать ладошки.');
    }

    const { error: insertError } = await admin.from('shop_purchases').insert({
      telegram_id: user.id,
      gift_id: shopItem.id,
      code,
      claps_spent: shopItem.price,
      display_name_snapshot: existing.display_name || null,
      telegram_username_snapshot: user.username || existing.telegram_username || null,
      telegram_first_name_snapshot: user.first_name || existing.telegram_first_name || null,
      created_at: nowIso,
    });

    if (insertError) {
      await admin
        .from('profiles')
        .update({ clap_balance: currentClaps, last_seen_at: nowIso })
        .eq('telegram_id', user.id);
      throw new Error(insertError.message);
    }

    let botNotificationStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
    let botNotificationError: string | null = null;

    if (ADMIN_GIFTS_BOT_TOKEN && ADMIN_GIFTS_CHAT_ID) {
      try {
        await sendPurchaseNotification(
          ADMIN_GIFTS_BOT_TOKEN,
          ADMIN_GIFTS_CHAT_ID,
          buyerName(existing),
          shopItem.title,
          code,
        );
        botNotificationStatus = 'sent';
      } catch (error) {
        botNotificationStatus = 'failed';
        botNotificationError = error instanceof Error ? error.message : 'Telegram notify failed';
        console.error('[purchase-gift] notify failed', botNotificationError);
      }
    }

    return new Response(JSON.stringify({
      profile: profileData,
      purchase: {
        gift_id: shopItem.id,
        code,
        claps_spent: shopItem.price,
      },
      bot_notification: {
        status: botNotificationStatus,
        error: botNotificationError,
      },
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Purchase error' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
