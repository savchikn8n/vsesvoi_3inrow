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
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  try {
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required environment variables');
    const body = await req.json().catch(() => ({}));
    const initData = typeof body?.initData === 'string' ? body.initData : '';
    if (!initData) return new Response(JSON.stringify({ error: 'initData is required' }), { status: 400, headers: corsHeaders });
    await verifyTelegramInitData(initData, BOT_TOKEN);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from('promo_popups')
      .select('id, title, body, image_url, primary_label, primary_url, secondary_label, published_at, active_until')
      .eq('is_active', true)
      .is('archived_at', null)
      .order('published_at', { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    const popup = (data || []).find((item) => !item.active_until || item.active_until > nowIso) || null;
    return new Response(JSON.stringify({ popup }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Promo fetch error' }), { status: 400, headers: corsHeaders });
  }
});
