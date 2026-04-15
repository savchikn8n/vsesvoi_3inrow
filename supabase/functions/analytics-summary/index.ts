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

function periodHours(period: string) {
  if (period === '7d') return 7 * 24;
  if (period === '30d') return 30 * 24;
  return 24;
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

    const body = await req.json().catch(() => ({}));
    const period = typeof body?.period === 'string' ? body.period.trim() : '24h';
    const hours = periodHours(period);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const now = Date.now();
    const since = new Date(now - hours * 60 * 60 * 1000).toISOString();
    const previousSince = new Date(now - hours * 2 * 60 * 60 * 1000).toISOString();
    const since120d = new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString();

    const [profilesRes, sessionsRes, eventsRes, purchasesRes] = await Promise.all([
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
        .gte('session_started_at', since120d)
        .order('session_started_at', { ascending: false })
        .limit(10000),
      admin
        .from('analytics_events')
        .select('telegram_id, session_id, event_name, event_payload, event_at')
        .gte('event_at', previousSince)
        .order('event_at', { ascending: false })
        .limit(5000),
      admin
        .from('shop_purchases')
        .select('telegram_id, gift_id, created_at')
        .gte('created_at', previousSince)
        .order('created_at', { ascending: false })
        .limit(5000),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (sessionsRes.error) throw new Error(sessionsRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (purchasesRes.error) throw new Error(purchasesRes.error.message);

    const profiles = profilesRes.data || [];
    const sessions = sessionsRes.data || [];
    const events = eventsRes.data || [];
    const purchases = purchasesRes.data || [];

    const currentSessions = sessions.filter((item) => item.session_started_at >= since);
    const previousSessions = sessions.filter((item) => item.session_started_at < since);
    const endedSessions = currentSessions.filter((item) => item.session_ended_at);
    const currentScores = currentSessions.map((item) => Number(item.best_score || 0));
    const currentClapsSpent = currentSessions.map((item) => Number(item.claps_spent || 0));
    const currentClapsEarned = currentSessions.map((item) => Number(item.claps_earned || 0));
    const durations = endedSessions.map((item) => Number(item.duration_sec || 0)).filter((value) => value > 0);
    const currentPurchases = purchases.filter((item) => item.created_at >= since);

    const activePlayerIds = new Set(
      profiles.filter((item) => item.last_seen_at && item.last_seen_at >= since).map((item) => String(item.telegram_id)),
    );
    const newPlayers = profiles.filter((item) => item.created_at && item.created_at >= since).length;
    const currentSessionUserIds = new Set(currentSessions.map((item) => String(item.telegram_id)));
    const previousSessionUserIds = new Set(previousSessions.map((item) => String(item.telegram_id)));
    const returningPlayers = [...currentSessionUserIds].filter((id) => previousSessionUserIds.has(id)).length;

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

    const topPlayers = profiles.map((item, index) => ({
      rank: index + 1,
      telegram_id: item.telegram_id,
      display_name: item.display_name || 'Игрок',
      best_score: Number(item.best_score || 0),
      clap_balance: Number(item.clap_balance || 0),
    }));

    const eventCounts = new Map<string, number>();
    events
      .filter((item) => item.event_at >= since)
      .forEach((item) => {
        eventCounts.set(item.event_name, (eventCounts.get(item.event_name) || 0) + 1);
      });

    const topEvents = [...eventCounts.entries()]
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

    const spentTotal = currentClapsSpent.reduce((sum, value) => sum + value, 0);
    const earnedTotal = currentClapsEarned.reduce((sum, value) => sum + value, 0);
    const buyersCount = new Set(currentPurchases.map((item) => String(item.telegram_id))).size;

    return new Response(
      JSON.stringify({
        generated_at: new Date().toISOString(),
        overview: {
          total_players: profilesRes.count || profiles.length,
          active_players_24h: activePlayerIds.size,
          new_players_24h: newPlayers,
          sessions_24h: currentSessions.length,
          claps_spent_24h: spentTotal,
          claps_earned_24h: earnedTotal,
          gifts_purchased_24h: currentPurchases.length,
          avg_claps_spent_per_buyer_24h: buyersCount ? Math.round(spentTotal / buyersCount) : 0,
          returning_players_24h: returningPlayers,
          avg_session_duration_sec_24h: Math.round(avg(durations)),
          avg_best_score_24h: Math.round(avg(currentScores)),
          median_best_score_24h: Math.round(median(currentScores)),
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
