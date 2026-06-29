import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { validateSessionProgress } from '../_shared/session-validation.ts';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function toNonNegativeInt(value: unknown) {
  const normalized = Math.floor(Number(value ?? 0));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function normalizeSessionId(value: unknown) {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  if (!sessionId || sessionId.length > 128) return null;
  return sessionId;
}

async function insertScoreSubmissionAudit(
  admin: ReturnType<typeof createClient>,
  payload: {
    telegram_id: number;
    session_id: string | null;
    incoming_best_score: number;
    incoming_clap_balance: number;
    previous_best_score: number;
    previous_clap_balance: number;
    recent_session_best_score: number | null;
    recent_session_claps_earned: number | null;
    accepted: boolean;
    reject_reason: string | null;
  },
) {
  const { error } = await admin.from('score_submissions').insert(payload);
  if (error) throw new Error(error.message);
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
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { initData, bestScore, clapBalance, sessionId: rawSessionId } = await req.json();
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const incomingBestScore = toNonNegativeInt(bestScore);
    if (incomingBestScore === null) {
      return new Response(JSON.stringify({ error: 'bestScore must be a positive number' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const incomingClapBalance = toNonNegativeInt(clapBalance);
    if (incomingClapBalance === null) {
      return new Response(JSON.stringify({ error: 'clapBalance must be a positive number' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);
    const sessionId = normalizeSessionId(rawSessionId);

    const { data: existing, error: readError } = await admin
      .from('profiles')
      .select('telegram_id, telegram_username, telegram_first_name, telegram_last_name, display_name, avatar_choice, avatar_url, best_score, clap_balance')
      .eq('telegram_id', user.id)
      .maybeSingle();

    if (readError) {
      throw new Error(readError.message);
    }

    const previousBest = Math.max(0, Number(existing?.best_score || 0));
    const previousClaps = Math.max(0, Number(existing?.clap_balance || 0));
    const bestWouldIncrease = incomingBestScore > previousBest;
    const clapsWouldIncrease = incomingClapBalance > previousClaps;
    let recentSessionBestScore: number | null = null;
    let recentSessionClapsEarned: number | null = null;
    let rejectReason: string | null = null;

    if (bestWouldIncrease || clapsWouldIncrease) {
      if (!sessionId) {
        rejectReason = 'missing_session';
      } else {
        const { data: session, error: sessionError } = await admin
          .from('analytics_sessions')
          .select('session_id, best_score, claps_earned, moves_count, session_started_at')
          .eq('telegram_id', user.id)
          .eq('session_id', sessionId)
          .maybeSingle();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        if (!session?.session_id) {
          rejectReason = 'missing_session';
        } else {
          recentSessionBestScore = Math.max(0, Number(session.best_score || 0));
          recentSessionClapsEarned = Math.max(0, Number(session.claps_earned || 0));
          const recentSessionMovesCount = Math.max(0, Number(session.moves_count || 0));
          const incomingBestExceedsSession = bestWouldIncrease && incomingBestScore > recentSessionBestScore;
          const incomingClapGain = Math.max(0, incomingClapBalance - previousClaps);
          const incomingClapsExceedSession = clapsWouldIncrease && incomingClapGain > recentSessionClapsEarned;
          const progressError = validateSessionProgress({
            bestScore: recentSessionBestScore,
            clapsEarned: recentSessionClapsEarned,
            movesCount: recentSessionMovesCount,
          });

          if (progressError) {
            rejectReason = 'invalid_session_progress';
          } else if (incomingBestExceedsSession) {
            rejectReason = 'score_rejected';
          } else if (incomingClapsExceedSession) {
            rejectReason = 'claps_rejected';
          }
        }
      }
    }

    if (rejectReason) {
      await insertScoreSubmissionAudit(admin, {
        telegram_id: user.id,
        session_id: sessionId,
        incoming_best_score: incomingBestScore,
        incoming_clap_balance: incomingClapBalance,
        previous_best_score: previousBest,
        previous_clap_balance: previousClaps,
        recent_session_best_score: recentSessionBestScore,
        recent_session_claps_earned: recentSessionClapsEarned,
        accepted: false,
        reject_reason: rejectReason,
      });

      return new Response(JSON.stringify({
        error: 'Score submission rejected',
        code: rejectReason,
        profile: existing || null,
      }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    const nextBest = Math.max(previousBest, incomingBestScore);
    const nextClaps = Math.max(previousClaps, incomingClapBalance);

    const { data, error } = await admin
      .from('profiles')
      .upsert(
        {
          telegram_id: user.id,
          telegram_username: user.username || null,
          telegram_first_name: user.first_name || null,
          telegram_last_name: user.last_name || null,
          best_score: nextBest,
          clap_balance: nextClaps,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'telegram_id' },
      )
      .select('telegram_id, telegram_username, telegram_first_name, telegram_last_name, display_name, avatar_choice, avatar_url, best_score, clap_balance, last_seen_at, notifications_enabled')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    await insertScoreSubmissionAudit(admin, {
      telegram_id: user.id,
      session_id: sessionId,
      incoming_best_score: incomingBestScore,
      incoming_clap_balance: incomingClapBalance,
      previous_best_score: previousBest,
      previous_clap_balance: previousClaps,
      recent_session_best_score: recentSessionBestScore,
      recent_session_claps_earned: recentSessionClapsEarned,
      accepted: true,
      reject_reason: null,
    });

    const { data: leader, error: leaderError } = await admin
      .from('profiles')
      .select('telegram_id, best_score')
      .order('best_score', { ascending: false })
      .order('updated_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (leaderError) {
      throw new Error(leaderError.message);
    }

    const improvedThisRun = incomingBestScore > previousBest;
    const shareRecordAvailable = Boolean(
      improvedThisRun &&
      incomingBestScore > 0 &&
      Number(data?.best_score || 0) === incomingBestScore,
    );

    return new Response(JSON.stringify({
      profile: data,
      is_global_top: leader?.telegram_id === user.id,
      global_top_score: Number(leader?.best_score || 0),
      share_record_available: shareRecordAvailable,
      share_record_score: shareRecordAvailable ? incomingBestScore : null,
    }), {
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
