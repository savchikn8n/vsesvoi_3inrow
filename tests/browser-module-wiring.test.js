const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
}

function functionBody(source, functionName) {
  const match = source.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${functionName} should exist`);
  return match[1];
}

test('browser loads tested game modules before game.js', () => {
  const scripts = scriptSources(readRepoFile('index.html'));
  const maintenanceIndex = scripts.indexOf('maintenance-config.js');
  const boardCoreIndex = scripts.indexOf('src/game/core/board-core.js');
  const progressAdapterIndex = scripts.indexOf('src/game/runtime/progress-adapter.js');
  const gameIndex = scripts.indexOf('game.js');

  assert.notEqual(maintenanceIndex, -1);
  assert.notEqual(boardCoreIndex, -1);
  assert.notEqual(progressAdapterIndex, -1);
  assert.notEqual(gameIndex, -1);
  assert.ok(maintenanceIndex < boardCoreIndex);
  assert.ok(boardCoreIndex < progressAdapterIndex);
  assert.ok(progressAdapterIndex < gameIndex);
});

test('low-risk board wrappers delegate to VSGameCore', () => {
  const game = readRepoFile('game.js');

  assert.match(functionBody(game, 'idxToPos'), /return window\.VSGameCore\.idxToPos\(index, SIZE\);/);
  assert.match(functionBody(game, 'posToIdx'), /return window\.VSGameCore\.posToIdx\(r, c, SIZE\);/);
  assert.match(functionBody(game, 'areAdjacent'), /return window\.VSGameCore\.areAdjacent\(a, b, SIZE\);/);
  assert.match(functionBody(game, 'cloneBoard'), /return window\.VSGameCore\.cloneBoard\(src\);/);
  assert.match(functionBody(game, 'swapIn'), /return window\.VSGameCore\.swapIn\(arr, a, b\);/);
});
