import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

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
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const initData = typeof body?.initData === 'string' ? body.initData : '';
    if (!initData) {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Leaderboard exposes telegram_id + display names, so it must not be an
    // anonymous scrape endpoint.
    const user = await verifyTelegramInitData(initData, BOT_TOKEN);

    const requestedLimit = Number(body?.limit || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(50, Math.floor(requestedLimit)))
      : 50;

    const { data, error } = await admin
      .from('profiles')
      .select('telegram_id, display_name, avatar_choice, avatar_url, best_score')
      .order('best_score', { ascending: false })
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    const leaderboard = data || [];

    // Always resolve the caller's own rank + record so the client can pin their
    // position even when they are outside the returned top slice.
    let me: {
      telegram_id: number;
      display_name: string | null;
      avatar_choice: string | null;
      avatar_url: string | null;
      best_score: number;
      rank: number | null;
    } | null = null;

    const { data: selfProfile, error: selfError } = await admin
      .from('profiles')
      .select('telegram_id, display_name, avatar_choice, avatar_url, best_score')
      .eq('telegram_id', user.id)
      .maybeSingle();
    if (selfError) throw new Error(selfError.message);

    if (selfProfile?.telegram_id) {
      const selfBest = Math.max(0, Number(selfProfile.best_score || 0));
      // Rank = how many players are strictly ahead + 1. Unranked (no score yet).
      const { count: ahead, error: rankError } = await admin
        .from('profiles')
        .select('telegram_id', { count: 'exact', head: true })
        .gt('best_score', selfBest);
      if (rankError) throw new Error(rankError.message);

      me = {
        telegram_id: selfProfile.telegram_id,
        display_name: selfProfile.display_name,
        avatar_choice: selfProfile.avatar_choice,
        avatar_url: selfProfile.avatar_url,
        best_score: selfBest,
        rank: selfBest > 0 ? Number(ahead || 0) + 1 : null,
      };
    }

    return new Response(JSON.stringify({ leaderboard, me }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }
});
