import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function normalizeText(value: unknown, max = 500) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, max);
}

function normalizeUrl(value: unknown) {
  const text = normalizeText(value, 1000);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.toString();
  } catch {
    throw new Error('Invalid URL');
  }
}

function normalizeDateTime(value: unknown) {
  const text = normalizeText(value, 64);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    throw new Error('Invalid promo end time');
  }
  return new Date(timestamp).toISOString();
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
    const action = normalizeText(body?.action, 32) || 'list';

    if (action === 'list') {
      const [popupsRes, eventsRes] = await Promise.all([
        admin.from('promo_popups').select('*').order('updated_at', { ascending: false }).limit(100),
        admin.from('promo_popup_events').select('popup_id, action, event_at').order('event_at', { ascending: false }).limit(5000),
      ]);
      if (popupsRes.error) throw new Error(popupsRes.error.message);
      if (eventsRes.error) throw new Error(eventsRes.error.message);

      const counts = new Map<string, { views: number; dismisses: number; opens: number }>();
      for (const row of eventsRes.data || []) {
        const bucket = counts.get(row.popup_id) || { views: 0, dismisses: 0, opens: 0 };
        if (row.action === 'view') bucket.views += 1;
        if (row.action === 'dismiss') bucket.dismisses += 1;
        if (row.action === 'open') bucket.opens += 1;
        counts.set(row.popup_id, bucket);
      }

      const popups = (popupsRes.data || []).map((item) => ({
        ...item,
        stats: counts.get(item.id) || { views: 0, dismisses: 0, opens: 0 },
      }));

      return new Response(JSON.stringify({ popups }), { status: 200, headers: corsHeaders });
    }

    if (action === 'save') {
      const popup = body?.popup && typeof body.popup === 'object' ? body.popup : {};
      const id = normalizeText(popup.id, 64) || null;
      const row = {
        title: normalizeText(popup.title, 80),
        body: normalizeText(popup.body, 280),
        image_url: normalizeUrl(popup.image_url),
        primary_label: normalizeText(popup.primary_label || 'Перейти', 24) || 'Перейти',
        primary_url: normalizeUrl(popup.primary_url),
        secondary_label: normalizeText(popup.secondary_label || 'Уже', 24) || 'Уже',
        active_until: normalizeDateTime(popup.active_until),
        is_active: Boolean(popup.is_active),
      };
      if (!row.title || !row.body || !row.image_url || !row.primary_url) {
        throw new Error('Missing popup fields');
      }

      if (row.is_active) {
        const { error } = await admin.from('promo_popups').update({ is_active: false }).eq('is_active', true);
        if (error) throw new Error(error.message);
      }

      const payload = row.is_active ? { ...row, published_at: new Date().toISOString(), archived_at: null } : row;
      const query = admin.from('promo_popups');
      const { data, error } = id
        ? await query.update(payload).eq('id', id).select('*').single()
        : await query.insert(payload).select('*').single();
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ popup: data }), { status: 200, headers: corsHeaders });
    }

    if (action === 'activate') {
      const popupId = normalizeText(body?.popupId, 64);
      if (!popupId) throw new Error('popupId is required');
      const { error: resetError } = await admin.from('promo_popups').update({ is_active: false }).eq('is_active', true);
      if (resetError) throw new Error(resetError.message);
      const { data, error } = await admin
        .from('promo_popups')
        .update({ is_active: true, published_at: new Date().toISOString(), archived_at: null })
        .eq('id', popupId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ popup: data }), { status: 200, headers: corsHeaders });
    }

    if (action === 'deactivate') {
      const popupId = normalizeText(body?.popupId, 64);
      if (!popupId) throw new Error('popupId is required');
      const { data, error } = await admin
        .from('promo_popups')
        .update({ is_active: false })
        .eq('id', popupId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ popup: data }), { status: 200, headers: corsHeaders });
    }

    if (action === 'archive') {
      const popupId = normalizeText(body?.popupId, 64);
      if (!popupId) throw new Error('popupId is required');
      const { data, error } = await admin
        .from('promo_popups')
        .update({ is_active: false, archived_at: new Date().toISOString() })
        .eq('id', popupId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ popup: data }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Promo admin error' }), { status: 400, headers: corsHeaders });
  }
});
