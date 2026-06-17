const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('game animation timing budget is explicit and used by cascades', () => {
  const game = readRepoFile('game.js');

  assert.match(game, /const ANIMATION_TIMINGS = Object\.freeze\(\{/);
  assert.match(game, /swapMs: 180/);
  assert.match(game, /invalidSwapMs: 220/);
  assert.match(game, /matchPopMs: 260/);
  assert.match(game, /gravityMs: 320/);
  assert.match(game, /cascadePauseMs: 120/);
  assert.match(game, /specialBlastMs: 340/);
  assert.match(game, /megaBombMs: 430/);
  assert.match(game, /function cascadeDelay\(combo\)/);
  assert.match(game, /interruptibleDelay\(cascadeDelay\(combo\), sessionId\)/);
  assert.match(game, /interruptibleDelay\(ANIMATION_TIMINGS\.cascadePauseMs, sessionId\)/);
});

test('tile animations use the fast game budget and support reduced motion', () => {
  const css = readRepoFile('styles.css');

  assert.match(
    css,
    /\.tile\.falling \.gem \{\s*animation: tile-fall var\(--tile-fall-ms, 320ms\) cubic-bezier\(0\.18, 0\.78, 0\.24, 1\) both;/,
  );
  assert.match(
    css,
    /\.tile\.match \{\s*animation: pop-hit 260ms cubic-bezier\(0\.2, 0\.82, 0\.22, 1\);/,
  );
  assert.match(
    css,
    /\.tile\.blast \{\s*animation: blast 340ms cubic-bezier\(0\.2, 0\.82, 0\.22, 1\);/,
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.tile\.falling \.gem,\s*\.tile\.match,\s*\.tile\.blast,\s*\.tile\.invalid/);
});
