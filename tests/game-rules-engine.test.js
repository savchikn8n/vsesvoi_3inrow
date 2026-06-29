const assert = require('node:assert/strict');
const test = require('node:test');

const { createSeededRng, normalizeSeed } = require('../src/game/core/rng.js');

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
