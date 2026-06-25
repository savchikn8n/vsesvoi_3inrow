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
  const resolutionCoreIndex = scripts.indexOf('src/game/core/resolution-core.js');
  const progressAdapterIndex = scripts.indexOf('src/game/runtime/progress-adapter.js');
  const boardRendererIndex = scripts.indexOf('src/game/runtime/board-renderer.js');
  const gameIndex = scripts.indexOf('game.js');

  assert.notEqual(maintenanceIndex, -1);
  assert.notEqual(boardCoreIndex, -1);
  assert.notEqual(resolutionCoreIndex, -1);
  assert.notEqual(progressAdapterIndex, -1);
  assert.notEqual(boardRendererIndex, -1);
  assert.notEqual(gameIndex, -1);
  assert.ok(maintenanceIndex < boardCoreIndex);
  assert.ok(boardCoreIndex < resolutionCoreIndex);
  assert.ok(resolutionCoreIndex < progressAdapterIndex);
  assert.ok(progressAdapterIndex < boardRendererIndex);
  assert.ok(boardRendererIndex < gameIndex);
  assert.ok(progressAdapterIndex < gameIndex);
});

test('dashboard declares a lightweight favicon asset', () => {
  const dashboardHtml = readRepoFile('dashboard.html');
  const faviconPath = path.join(repoRoot, 'assets', 'dashboard-favicon.png');

  assert.match(
    dashboardHtml,
    /<link rel="icon" type="image\/png" href="\.\/assets\/dashboard-favicon\.png" \/>/,
  );
  assert.ok(fs.existsSync(faviconPath), 'dashboard favicon asset should exist');
  assert.ok(fs.statSync(faviconPath).size < 100 * 1024, 'dashboard favicon should stay under 100KB');
});

test('low-risk board wrappers delegate to VSGameCore', () => {
  const game = readRepoFile('game.js');

  assert.match(functionBody(game, 'idxToPos'), /return window\.VSGameCore\.idxToPos\(index, SIZE\);/);
  assert.match(functionBody(game, 'posToIdx'), /return window\.VSGameCore\.posToIdx\(r, c, SIZE\);/);
  assert.match(functionBody(game, 'areAdjacent'), /return window\.VSGameCore\.areAdjacent\(a, b, SIZE\);/);
  assert.match(functionBody(game, 'cloneBoard'), /return window\.VSGameCore\.cloneBoard\(src\);/);
  assert.match(functionBody(game, 'swapIn'), /return window\.VSGameCore\.swapIn\(arr, a, b\);/);
});

test('match resolution wrappers delegate to VSGameResolution', () => {
  const game = readRepoFile('game.js');

  assert.match(
    functionBody(game, 'chooseSpecialIndex'),
    /return window\.VSGameResolution\.chooseSpecialIndex\(cells, swappedPair\);/,
  );
  assert.match(
    functionBody(game, 'getBlastArea'),
    /return window\.VSGameResolution\.getBlastArea\(center, special, SIZE\);/,
  );
  assert.match(
    functionBody(game, 'getBombRocketComboArea'),
    /return window\.VSGameResolution\.getBombRocketComboArea\(center, SIZE\);/,
  );
  assert.match(
    functionBody(game, 'getRocketRocketComboArea'),
    /return window\.VSGameResolution\.getRocketRocketComboArea\(center, SIZE\);/,
  );
});

test('drawBoard delegates DOM rendering to VSBoardRenderer', () => {
  const game = readRepoFile('game.js');

  assert.match(game, /function drawBoard\(highlight = new Set\(\), blast = new Set\(\)\) \{/);
  assert.match(game, /window\.VSBoardRenderer\.renderBoardDom\(\{/);
  assert.match(game, /tileTemplate: tileTpl/);
  assert.match(game, /onTilePointerEnd/);
  assert.match(game, /syncEffectsLayer\(\);/);
  assert.match(game, /updateHud\(\);/);
});
