const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildScoreSubmitPayload,
  mergeProfileProgress,
  shouldSyncProgress,
  toNonNegativeInt,
} = require('../src/game/runtime/progress-adapter.js');

test('toNonNegativeInt floors valid values and rejects unsafe values', () => {
  assert.equal(toNonNegativeInt('42.9'), 42);
  assert.equal(toNonNegativeInt(0), 0);
  assert.equal(toNonNegativeInt(-7), 0);
  assert.equal(toNonNegativeInt('nope'), 0);
  assert.equal(toNonNegativeInt(Number.POSITIVE_INFINITY), 0);
});

test('mergeProfileProgress never lowers best score or claps from stale profile data', () => {
  const local = {
    bestScore: 320,
    clapBalance: 18,
    profile: {
      telegram_id: 777,
      display_name: 'Player',
      best_score: 250,
      clap_balance: 12,
    },
  };

  const merged = mergeProfileProgress(local, {
    telegram_id: 777,
    display_name: 'Player Fresh Name',
    best_score: 99,
    clap_balance: 3,
  });

  assert.equal(merged.bestScore, 320);
  assert.equal(merged.clapBalance, 18);
  assert.equal(merged.profile.best_score, 320);
  assert.equal(merged.profile.clap_balance, 18);
  assert.equal(merged.profile.display_name, 'Player Fresh Name');
});

test('mergeProfileProgress can accept an authoritative clap decrease after a confirmed spend', () => {
  const merged = mergeProfileProgress(
    {
      bestScore: 320,
      clapBalance: 18,
      profile: {
        telegram_id: 777,
        best_score: 320,
        clap_balance: 18,
      },
    },
    {
      telegram_id: 777,
      best_score: 300,
      clap_balance: 8,
    },
    { forceClapBalance: true },
  );

  assert.equal(merged.bestScore, 320);
  assert.equal(merged.clapBalance, 8);
  assert.equal(merged.profile.best_score, 320);
  assert.equal(merged.profile.clap_balance, 8);
});

test('shouldSyncProgress returns sanitized payload values only when progress changed', () => {
  assert.deepEqual(
    shouldSyncProgress(
      { telegram_id: 777, best_score: 100, clap_balance: 5 },
      130,
      5,
      false,
      false,
    ),
    {
      shouldSync: true,
      bestScore: 130,
      clapBalance: 5,
      bestChanged: true,
      clapsChanged: false,
    },
  );

  assert.deepEqual(
    shouldSyncProgress(
      { telegram_id: 777, best_score: 130, clap_balance: 5 },
      120,
      5,
      false,
      false,
    ),
    {
      shouldSync: false,
      bestScore: 130,
      clapBalance: 5,
      bestChanged: false,
      clapsChanged: false,
    },
  );

  assert.deepEqual(shouldSyncProgress(null, 999, 999, true, true), {
    shouldSync: false,
    bestScore: 999,
    clapBalance: 999,
    bestChanged: false,
    clapsChanged: false,
  });
});

test('buildScoreSubmitPayload refuses missing initData and sanitizes numbers', () => {
  assert.equal(buildScoreSubmitPayload('', 100, 20), null);
  assert.deepEqual(buildScoreSubmitPayload('tg-init', '100.9', '-20', ' session-1 '), {
    initData: 'tg-init',
    bestScore: 100,
    clapBalance: 0,
    sessionId: 'session-1',
  });
});
