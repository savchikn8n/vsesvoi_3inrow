import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function avg(items: number[]) {
  if (!items.length) return 0;
  return items.reduce((sum, value) => sum + value, 0) / items.length;
}

function median(items: number[]) {
  if (!items.length) return 0;
  const sorted = [...items].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
    const DASHBOARD_SECRET = Deno.env.get('DASHBOARD_SECRET') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!DASHBOARD_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const providedSecret =
      req.headers.get('x-dashboard-secret') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';
    if (providedSecret !== DASHBOARD_SECRET) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [profilesRes, sessionsRes, eventsRes] = await Promise.all([
      admin
        .from('profiles')
        .select('telegram_id, display_name, best_score, clap_balance, created_at, last_seen_at', { count: 'exact' })
        .order('best_score', { ascending: false })
        .limit(10),
      admin
        .from('analytics_sessions')
        .select(
          'session_id, telegram_id, session_started_at, session_ended_at, duration_sec, end_reason, best_score, claps_earned, claps_spent, moves_count',
        )
        .gte('session_started_at', since7d)
        .order('session_started_at', { ascending: false })
        .limit(1000),
      admin
        .from('analytics_events')
        .select('telegram_id, session_id, event_name, event_payload, event_at')
        .gte('event_at', since7d)
        .order('event_at', { ascending: false })
        .limit(1000),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (sessionsRes.error) throw new Error(sessionsRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);

    const profiles = profilesRes.data || [];
    const sessions = sessionsRes.data || [];
    const events = eventsRes.data || [];

    const recentSessionTelegramIds = [
      ...new Set(
        sessions
          .slice(0, 12)
          .map((item) => item.telegram_id)
          .filter((value) => value !== null && value !== undefined),
      ),
    ];

    let recentSessionProfiles: Array<{ telegram_id: number; display_name: string | null }> = [];
    if (recentSessionTelegramIds.length) {
      const recentProfilesRes = await admin
        .from('profiles')
        .select('telegram_id, display_name')
        .in('telegram_id', recentSessionTelegramIds);
      if (recentProfilesRes.error) throw new Error(recentProfilesRes.error.message);
      recentSessionProfiles = recentProfilesRes.data || [];
    }

    const recentSessionNameMap = new Map(
      recentSessionProfiles.map((item) => [String(item.telegram_id), item.display_name || 'Игрок']),
    );

    const sessions24h = sessions.filter((item) => item.session_started_at >= since24h);
    const endedSessions24h = sessions24h.filter((item) => item.session_ended_at);
    const scores24h = sessions24h.map((item) => Number(item.best_score || 0));
    const clapsSpent24h = sessions24h.map((item) => Number(item.claps_spent || 0));
    const durations24h = endedSessions24h.map((item) => Number(item.duration_sec || 0)).filter((value) => value > 0);

    const active24hUsers = new Set(
      profiles
        .filter((item) => item.last_seen_at && item.last_seen_at >= since24h)
        .map((item) => String(item.telegram_id)),
    );

    const newPlayers24h = profiles.filter((item) => item.created_at && item.created_at >= since24h).length;
    const topPlayers = profiles.map((item, index) => ({
      rank: index + 1,
      telegram_id: item.telegram_id,
      display_name: item.display_name || 'Игрок',
      best_score: Number(item.best_score || 0),
      clap_balance: Number(item.clap_balance || 0),
    }));

    const eventCounts24h = new Map<string, number>();
    events
      .filter((item) => item.event_at >= since24h)
      .forEach((item) => {
        eventCounts24h.set(item.event_name, (eventCounts24h.get(item.event_name) || 0) + 1);
      });

    const topEvents = [...eventCounts24h.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([event_name, count]) => ({ event_name, count }));

    const recentSessions = sessions.slice(0, 12).map((item) => ({
      display_name: recentSessionNameMap.get(String(item.telegram_id)) || 'Игрок',
      telegram_id: item.telegram_id,
      session_started_at: item.session_started_at,
      duration_sec: Number(item.duration_sec || 0),
      best_score: Number(item.best_score || 0),
      claps_spent: Number(item.claps_spent || 0),
      end_reason: item.end_reason || 'active',
      moves_count: Number(item.moves_count || 0),
    }));

    return new Response(
      JSON.stringify({
        generated_at: new Date().toISOString(),
        overview: {
          total_players: profilesRes.count || profiles.length,
          active_players_24h: active24hUsers.size,
          new_players_24h: newPlayers24h,
          sessions_24h: sessions24h.length,
          claps_spent_24h: clapsSpent24h.reduce((sum, value) => sum + value, 0),
          avg_session_duration_sec_24h: Math.round(avg(durations24h)),
          avg_best_score_24h: Math.round(avg(scores24h)),
          median_best_score_24h: Math.round(median(scores24h)),
        },
        top_players: topPlayers,
        top_events_24h: topEvents,
        recent_sessions: recentSessions,
      }),
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Analytics error' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
