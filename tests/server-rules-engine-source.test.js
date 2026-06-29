const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('Deno rules engine exports the same replay contract as the browser engine', () => {
  const browserSource = readRepoFile('src/game/core/rules-engine.js');
  const denoSource = readRepoFile('supabase/functions/_shared/rules-engine.ts');

  for (const name of ['DEFAULT_SIZE', 'DEFAULT_COLORS', 'RULES_VERSION']) {
    assert.match(browserSource, new RegExp(name));
    assert.match(denoSource, new RegExp(`export const ${name}`));
  }

  for (const name of ['createInitialState', 'applyMove', 'replayMoves']) {
    assert.match(browserSource, new RegExp(name));
    assert.match(denoSource, new RegExp(`export function ${name}`));
  }

  for (const reason of ['out_of_range', 'non_adjacent', 'no_match']) {
    assert.match(browserSource, new RegExp(reason));
    assert.match(denoSource, new RegExp(reason));
  }
});
