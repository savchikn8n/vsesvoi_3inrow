import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const DEFAULT_CONFIG = {
  maintenance: {
    enabled: false,
    title: 'Техническая пауза',
    body: 'Мы делаем игру чуточку лучше',
    note: 'Приносим извинения за доставленные неудобства',
    primaryLabel: 'Повторить',
    secondaryLabel: 'Забронировать столик',
    secondaryUrl: 'https://t.me/+Ew4VcHco7XBjNDU6',
    imageUrl: './assets/maintenance-claps.svg',
    updatedAt: '',
  },
};

function text(value: unknown, fallback: string, max: number) {
  const raw = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return (raw || fallback).slice(0, max);
}

function safeUrl(value: unknown, fallback: string) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.startsWith('./')) return raw;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const url = new URL(raw);
    return ['http:', 'https:', 'tg:'].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function normalizeConfig(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const maintenanceRaw = input.maintenance && typeof input.maintenance === 'object'
    ? input.maintenance as Record<string, unknown>
    : {};
  const fallback = DEFAULT_CONFIG.maintenance;

  return {
    maintenance: {
      enabled: maintenanceRaw.enabled === true,
      title: text(maintenanceRaw.title, fallback.title, 80),
      body: text(maintenanceRaw.body, fallback.body, 160),
      note: text(maintenanceRaw.note, fallback.note, 160),
      primaryLabel: text(maintenanceRaw.primaryLabel, fallback.primaryLabel, 32),
      secondaryLabel: text(maintenanceRaw.secondaryLabel, fallback.secondaryLabel, 40),
      secondaryUrl: safeUrl(maintenanceRaw.secondaryUrl, fallback.secondaryUrl),
      imageUrl: safeUrl(maintenanceRaw.imageUrl, fallback.imageUrl),
      updatedAt: text(maintenanceRaw.updatedAt, fallback.updatedAt, 64),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ config: DEFAULT_CONFIG, fallback: true }), { status: 200, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await admin
      .from('app_runtime_config')
      .select('value, updated_at')
      .eq('key', 'runtime')
      .maybeSingle();

    if (error || !data?.value) {
      return new Response(JSON.stringify({ config: DEFAULT_CONFIG, fallback: true }), { status: 200, headers: corsHeaders });
    }

    const config = normalizeConfig({
      ...(data.value as Record<string, unknown>),
      maintenance: {
        ...(((data.value as Record<string, unknown>).maintenance as Record<string, unknown>) || {}),
        updatedAt: data.updated_at || '',
      },
    });

    return new Response(JSON.stringify({ config, fallback: false }), { status: 200, headers: corsHeaders });
  } catch (_) {
    return new Response(JSON.stringify({ config: DEFAULT_CONFIG, fallback: true }), { status: 200, headers: corsHeaders });
  }
});
