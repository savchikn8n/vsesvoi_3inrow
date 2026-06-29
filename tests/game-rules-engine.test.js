const assert = require('node:assert/strict');
const test = require('node:test');

const Core = require('../src/game/core/board-core.js');
const { createSeededRng, normalizeSeed } = require('../src/game/core/rng.js');
const Rules = require('../src/game/core/rules-engine.js');

test('normalizeSeed returns stable lowercase hex seed', () => {
  assert.equal(normalizeSeed('ABCDEF0123456789'), 'abcdef0123456789');
  assert.equal(normalizeSeed(' bad seed '), '6261642073656564');
});

test('createSeededRng produces deterministic values for the same seed', () => {
  const a = createSeededRng('0123456789abcdef');
  const b = createSeededRng('0123456789abcdef');

  assert.deepEqual(
    [a(), a(), a(), a()].map((value) => Number(value.toFixed(8))),
    [b(), b(), b(), b()].map((value) => Number(value.toFixed(8))),
  );
});

test('createSeededRng produces values in the Math.random range', () => {
  const rng = createSeededRng('0123456789abcdef');
  for (let i = 0; i < 100; i++) {
    const value = rng();
    assert.ok(value >= 0);
    assert.ok(value < 1);
  }
});

test('createInitialState builds a deterministic playable board', () => {
  const a = Rules.createInitialState({ seed: '0123456789abcdef' });
  const b = Rules.createInitialState({ seed: '0123456789abcdef' });

  assert.equal(a.score, 0);
  assert.equal(a.clapsEarned, 0);
  assert.equal(a.movesCount, 0);
  assert.deepEqual(a.board, b.board);
  assert.equal(a.board.length, 49);
});

test('applyMove rejects non-adjacent moves without mutating state', () => {
  const state = Rules.createInitialState({ seed: '0123456789abcdef' });
  const before = JSON.stringify(state.board);
  const result = Rules.applyMove(state, { from: 0, to: 48 });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'non_adjacent');
  assert.equal(JSON.stringify(state.board), before);
});

test('replayMoves returns deterministic result for the same seed and move list', () => {
  const initial = Rules.createInitialState({ seed: '0123456789abcdef' });
  const move = Core.findPotentialMove(initial.board, 7);
  assert.ok(move, 'seed should create a playable board');
  const moves = [move];
  const a = Rules.replayMoves({ seed: '0123456789abcdef', moves });
  const b = Rules.replayMoves({ seed: '0123456789abcdef', moves });

  assert.deepEqual(a, b);
  assert.equal(a.movesAttempted, 1);
  assert.equal(a.accepted, true);
});
