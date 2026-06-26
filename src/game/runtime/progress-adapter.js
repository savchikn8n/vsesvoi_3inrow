(function initProgressAdapter(globalScope, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSProgressAdapter = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createProgressAdapter() {
  'use strict';

  function toNonNegativeInt(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.floor(number));
  }

  function hasFiniteValue(value) {
    return Number.isFinite(Number(value));
  }

  function profileBestScore(profile) {
    return toNonNegativeInt(profile?.best_score);
  }

  function profileClapBalance(profile) {
    return toNonNegativeInt(profile?.clap_balance);
  }

  function mergeProfileProgress(local = {}, incoming = {}, options = {}) {
    const baseProfile = local.profile || {};
    const incomingProfile = incoming || {};
    const nextProfile = {
      ...baseProfile,
      ...incomingProfile,
    };

    const localBest = Math.max(toNonNegativeInt(local.bestScore), profileBestScore(baseProfile));
    const incomingBest = profileBestScore(incomingProfile);
    const bestScore = Math.max(localBest, incomingBest);

    const localClaps = Math.max(toNonNegativeInt(local.clapBalance), profileClapBalance(baseProfile));
    const incomingHasClaps = hasFiniteValue(incomingProfile.clap_balance);
    const incomingClaps = incomingHasClaps ? profileClapBalance(incomingProfile) : localClaps;
    const clapBalance = options.forceClapBalance
      ? incomingClaps
      : Math.max(localClaps, incomingClaps);

    nextProfile.best_score = bestScore;
    nextProfile.clap_balance = clapBalance;

    return {
      bestScore,
      clapBalance,
      pendingBestScoreSync: options.synced ? false : Boolean(local.pendingBestScoreSync),
      pendingClapBalanceSync: options.synced ? false : Boolean(local.pendingClapBalanceSync),
      profile: nextProfile,
    };
  }

  function shouldSyncProgress(
    profile,
    score,
    clapBalance,
    pendingBestScoreSync = false,
    pendingClapBalanceSync = false,
  ) {
    const scoreValue = toNonNegativeInt(score);
    const clapValue = toNonNegativeInt(clapBalance);

    if (!profile?.telegram_id) {
      return {
        shouldSync: false,
        bestScore: scoreValue,
        clapBalance: clapValue,
        bestChanged: false,
        clapsChanged: false,
      };
    }

    const remoteBest = profileBestScore(profile);
    const remoteClaps = profileClapBalance(profile);
    const bestScore = Math.max(remoteBest, scoreValue);
    const claps = Math.max(remoteClaps, clapValue);
    const bestChanged = Boolean(pendingBestScoreSync) || bestScore > remoteBest;
    const clapsChanged = Boolean(pendingClapBalanceSync) || claps > remoteClaps;

    return {
      shouldSync: bestChanged || clapsChanged,
      bestScore,
      clapBalance: claps,
      bestChanged,
      clapsChanged,
    };
  }

  function normalizeSessionId(sessionId) {
    const value = typeof sessionId === 'string' ? sessionId.trim() : '';
    return value || null;
  }

  function buildScoreSubmitPayload(initData, bestScore, clapBalance, sessionId = null) {
    if (typeof initData !== 'string' || initData.trim().length === 0) {
      return null;
    }

    return {
      initData,
      bestScore: toNonNegativeInt(bestScore),
      clapBalance: toNonNegativeInt(clapBalance),
      sessionId: normalizeSessionId(sessionId),
    };
  }

  return {
    buildScoreSubmitPayload,
    mergeProfileProgress,
    shouldSyncProgress,
    toNonNegativeInt,
  };
});
