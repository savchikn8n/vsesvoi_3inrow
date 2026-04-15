import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function playerLabel(row: {
  telegram_id: number;
  display_name_snapshot?: string | null;
  telegram_username_snapshot?: string | null;
  telegram_first_name_snapshot?: string | null;
}) {
  const parts = [] as string[];
  if (row.display_name_snapshot) parts.push(row.display_name_snapshot);
  if (row.telegram_first_name_snapshot) parts.push(row.telegram_first_name_snapshot);
  if (row.telegram_username_snapshot) parts.push(`@${row.telegram_username_snapshot}`);
  parts.push(String(row.telegram_id));
  return parts.join(' / ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const DASHBOARD_SECRET = Deno.env.get('DASHBOARD_SECRET') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!DASHBOARD_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required environment variables');

    const providedSecret = req.headers.get('x-dashboard-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (providedSecret !== DASHBOARD_SECRET) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : 'list';

    if (action !== 'list') {
      return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: corsHeaders });
    }

    const { data, error } = await admin
      .from('shop_purchases')
      .select('telegram_id, gift_id, code, display_name_snapshot, telegram_username_snapshot, telegram_first_name_snapshot, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const purchases = (data || []).map((row) => ({
      player_label: playerLabel(row),
      gift_id: row.gift_id,
      code: row.code,
      created_at: row.created_at,
    }));

    return new Response(JSON.stringify({ purchases }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Gift admin error' }), { status: 400, headers: corsHeaders });
  }
});
