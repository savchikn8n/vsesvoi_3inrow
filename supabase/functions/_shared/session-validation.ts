export const MAX_SCORE_PER_MOVE = 10000;
export const MAX_CLAPS_FROM_SCORE_BUFFER = 1;

export type SessionProgressValidationInput = {
  bestScore: number;
  clapsEarned: number;
  movesCount: number;
};

export function validateSessionProgress({
  bestScore,
  clapsEarned,
  movesCount,
}: SessionProgressValidationInput): string | null {
  if (bestScore > 0 && movesCount <= 0) {
    return 'invalid_session_progress';
  }

  if (bestScore > movesCount * MAX_SCORE_PER_MOVE) {
    return 'invalid_session_progress';
  }

  if (clapsEarned > Math.floor(bestScore / 10000) + MAX_CLAPS_FROM_SCORE_BUFFER) {
    return 'invalid_session_progress';
  }

  return null;
}
