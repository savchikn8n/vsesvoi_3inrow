import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { replayMoves, RULES_VERSION, type GameMove } from '../_shared/rules-engine.ts';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// A human move costs at least a swap animation plus the cascade lock, so
// sustained sub-500ms moves are only reachable by scripted replay farming.
const MIN_MS_PER_MOVE = 500;
const MOVE_TIME_GRACE_MS = 1500;

// The strict seed replay is the strongest anti-cheat, but the live client lets
// players act during cascades ("combo constraint" fast play), which a strictly
// sequential replay cannot reproduce — so honest fast players legitimately fail
// the exact replay. To never silently steal their earned claps, crediting falls
// back to the client-reported score bounded by a per-move ceiling (plus the
// speed/rate/move-count guards). Exact-matching sessions still credit exactly.
const MAX_SCORE_PER_MOVE = 10000;
const CLAPS_PER_SCORE = 10000;

// Cap on the move trail stored for a rejected run. Long enough to investigate a
// real game by hand, short enough that a forged multi-thousand-move payload
// cannot turn the audit trail back into a disk-IO problem.
const MAX_AUDITED_MOVES = 500;

function toNonNegativeInt(value: unknown) {
  const normalized = Math.floor(Number(value ?? 0));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
}

function normalizeSessionId(value: unknown) {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  if (!sessionId || sessionId.length > 128) return null;
  return sessionId;
}

function normalizeMoves(value: unknown): GameMove[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3000).map((move) => ({
    from: Math.floor(Number(move?.from)),
    to: Math.floor(Number(move?.to)),
  }));
}

function movesAreImplausiblyFast(moveCount: number, sessionStartedAt: string | null) {
  if (moveCount <= 0 || !sessionStartedAt) return false;
  const startedAtMs = Date.parse(sessionStartedAt);
  if (!Number.isFinite(startedAtMs)) return false;
  const elapsedMs = Date.now() - startedAtMs;
  return elapsedMs + MOVE_TIME_GRACE_MS < moveCount * MIN_MS_PER_MOVE;
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

    const body = await req.json().catch(() => ({}));
    const initData = typeof body?.initData === 'string' ? body.initData : '';
    if (!initData) {
      return new Response(JSON.stringify({ error: 'initData is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const sessionId = normalizeSessionId(body?.sessionId);
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const user = await verifyTelegramInitData(initData, BOT_TOKEN);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: session, error: sessionError } = await admin
      .from('game_sessions')
      .select('session_id, telegram_id, rules_version, seed, status, started_at, credited_claps')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);

    if (!session?.session_id || Number(session.telegram_id) !== Number(user.id)) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const moves = normalizeMoves(body?.moves);
    const clientFinalScore = toNonNegativeInt(body?.clientFinalScore);
    const clientClapsEarned = toNonNegativeInt(body?.clientClapsEarned);
    const replay = replayMoves({
      seed: String(session.seed || ''),
      moves,
      size: 7,
      colorCount: 4,
    });
    const scoreMatches = replay.score === clientFinalScore;
    const clapsMatch = replay.clapsEarned === clientClapsEarned;
    const implausiblyFast = movesAreImplausiblyFast(moves.length, session.started_at || null);
    const accepted = replay.accepted && scoreMatches && clapsMatch && !implausiblyFast;
    const rejectReason = replay.rejectReason
      || (implausiblyFast ? 'implausible_speed' : null)
      || (!scoreMatches ? 'score_mismatch' : null)
      || (!clapsMatch ? 'claps_mismatch' : null);

    // Score credited to the balance/leaderboard: the exact replay score when it
    // matches, otherwise the client score bounded by the per-move ceiling. Fast
    // farming is never credited. Claps derive from that credited score.
    const boundedClientScore = Math.min(clientFinalScore, moves.length * MAX_SCORE_PER_MOVE);
    const creditScore = implausiblyFast ? 0 : (accepted ? replay.score : boundedClientScore);
    const creditClaps = Math.floor(creditScore / CLAPS_PER_SCORE);

    // Moves are replayed above straight from the request body, so storing them
    // is audit-only. Writing a row per move on every accepted run was the single
    // heaviest write in the project and exhausted the disk IO budget, so only
    // rejected runs are kept now — as one compact JSON blob on the session, which
    // is all a manual cheat investigation needs.
    const rejectedMoves = accepted
      ? null
      : moves.slice(0, MAX_AUDITED_MOVES).map((move) => [move.from, move.to]);

    const { error: validationError } = await admin.from('game_session_validations').insert({
      session_id: sessionId,
      telegram_id: user.id,
      rules_version: String(session.rules_version || RULES_VERSION),
      accepted,
      client_score: clientFinalScore,
      server_score: replay.score,
      client_claps_earned: clientClapsEarned,
      server_claps_earned: replay.clapsEarned,
      move_count: moves.length,
      reject_reason: accepted ? null : rejectReason,
    });
    if (validationError) throw new Error(validationError.message);

    const { error: updateError } = await admin
      .from('game_sessions')
      .update({
        status: 'submitted',
        ended_at: new Date().toISOString(),
        client_final_score: clientFinalScore,
        server_final_score: replay.score,
        client_claps_earned: clientClapsEarned,
        server_claps_earned: replay.clapsEarned,
        validation_status: accepted ? 'accepted' : 'rejected',
        validation_error: accepted ? null : rejectReason,
        rejected_moves: rejectedMoves,
      })
      .eq('session_id', sessionId)
      .eq('telegram_id', user.id);
    if (updateError) throw new Error(updateError.message);

    // Credit progress. The RPC is delta-based and row-locked, so re-submitting a
    // continued run credits only the positive clap delta beyond what this
    // session already credited, and raises best score with GREATEST — idempotent
    // and race-safe against concurrent clap spends. We credit the bounded score
    // (exact when the replay matched) so honest fast players are never underpaid.
    if (creditScore > 0 || creditClaps > 0) {
      const { error: creditError } = await admin.rpc('credit_game_session_result', {
        p_session_id: sessionId,
        p_telegram_id: user.id,
        p_server_score: creditScore,
        p_server_claps_earned: creditClaps,
      });
      if (creditError) throw new Error(creditError.message);
    }

    return new Response(JSON.stringify({
      accepted,
      rejectReason: accepted ? null : rejectReason,
      serverScore: replay.score,
      serverClapsEarned: replay.clapsEarned,
      creditedScore: creditScore,
      creditedClaps: creditClaps,
      movesAttempted: replay.movesAttempted,
      validation_status: accepted ? 'accepted' : 'rejected',
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Session submit error';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
