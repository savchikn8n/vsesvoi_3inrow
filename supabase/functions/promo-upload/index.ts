import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function normalizeText(value: unknown, max = 255) {
  return (typeof value === 'string' ? value.trim() : '').slice(0, max);
}

function decodeBase64(base64: string) {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function safeExt(contentType: string, fileName: string) {
  const name = fileName.toLowerCase();
  if (contentType === 'image/png' || name.endsWith('.png')) return 'png';
  if (contentType === 'image/webp' || name.endsWith('.webp')) return 'webp';
  return 'jpg';
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

    const body = await req.json().catch(() => ({}));
    const fileName = normalizeText(body?.fileName, 180) || 'promo-image';
    const contentType = normalizeText(body?.contentType, 80) || 'image/jpeg';
    const dataBase64 = normalizeText(body?.dataBase64, 8_000_000);
    if (!dataBase64) throw new Error('Image data is required');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      throw new Error('Unsupported image type');
    }

    const bytes = decodeBase64(dataBase64);
    if (bytes.byteLength > 5 * 1024 * 1024) {
      throw new Error('Image must be 5MB or smaller');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const ext = safeExt(contentType, fileName);
    const objectPath = `promo/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const bucket = admin.storage.from('promo-assets');
    const { error: uploadError } = await bucket.upload(objectPath, bytes, {
      contentType,
      upsert: false,
      cacheControl: '3600',
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data } = bucket.getPublicUrl(objectPath);
    return new Response(JSON.stringify({ imageUrl: data.publicUrl, objectPath }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Promo upload error' }), { status: 400, headers: corsHeaders });
  }
});
