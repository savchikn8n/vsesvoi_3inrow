import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { replayMoves, RULES_VERSION, type GameMove } from '../_shared/rules-engine.ts';
import { verifyTelegramInitData } from '../_shared/telegram-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

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
      .select('session_id, telegram_id, rules_version, seed')
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
    const accepted = replay.accepted && scoreMatches && clapsMatch;
    const rejectReason = replay.rejectReason
      || (!scoreMatches ? 'score_mismatch' : null)
      || (!clapsMatch ? 'claps_mismatch' : null);

    if (moves.length > 0) {
      const moveRows = moves.map((move, index) => ({
        session_id: sessionId,
        move_index: index,
        from_idx: move.from,
        to_idx: move.to,
      }));
      const { error: movesError } = await admin
        .from('game_session_moves')
        .upsert(moveRows, { onConflict: 'session_id,move_index' });
      if (movesError) throw new Error(movesError.message);
    }

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
      })
      .eq('session_id', sessionId)
      .eq('telegram_id', user.id);
    if (updateError) throw new Error(updateError.message);

    return new Response(JSON.stringify({
      accepted,
      rejectReason: accepted ? null : rejectReason,
      serverScore: replay.score,
      serverClapsEarned: replay.clapsEarned,
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
