const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1].split('?')[0]);
}

function functionBody(source, functionName) {
  const match = source.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${functionName} should exist`);
  return match[1];
}

test('browser loads tested game modules before game.js', () => {
  const scripts = scriptSources(readRepoFile('index.html'));
  const maintenanceIndex = scripts.indexOf('maintenance-config.js');
  const rngIndex = scripts.indexOf('src/game/core/rng.js');
  const boardCoreIndex = scripts.indexOf('src/game/core/board-core.js');
  const resolutionCoreIndex = scripts.indexOf('src/game/core/resolution-core.js');
  const rulesEngineIndex = scripts.indexOf('src/game/core/rules-engine.js');
  const progressAdapterIndex = scripts.indexOf('src/game/runtime/progress-adapter.js');
  const boardRendererIndex = scripts.indexOf('src/game/runtime/board-renderer.js');
  const gameIndex = scripts.indexOf('game.js');

  assert.notEqual(maintenanceIndex, -1);
  assert.notEqual(rngIndex, -1);
  assert.notEqual(boardCoreIndex, -1);
  assert.notEqual(resolutionCoreIndex, -1);
  assert.notEqual(rulesEngineIndex, -1);
  assert.notEqual(progressAdapterIndex, -1);
  assert.notEqual(boardRendererIndex, -1);
  assert.notEqual(gameIndex, -1);
  assert.ok(maintenanceIndex < boardCoreIndex);
  assert.ok(maintenanceIndex < rngIndex);
  assert.ok(rngIndex < boardCoreIndex);
  assert.ok(boardCoreIndex < resolutionCoreIndex);
  assert.ok(resolutionCoreIndex < rulesEngineIndex);
  assert.ok(rulesEngineIndex < progressAdapterIndex);
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

test('game runtime prepares replay move tracking for server validation', () => {
  const game = readRepoFile('game.js');

  assert.match(game, /window\.VSGameRules/);
  assert.match(game, /createInitialState/);
  assert.match(game, /game-session-start/);
  assert.match(game, /game-session-submit/);
  assert.match(game, /serverGameSession/);
  assert.match(game, /sessionReplayMoves/);
  assert.match(game, /recordReplayMove/);
});

test('game runtime uses seeded board refill and shuffle for replay parity', () => {
  const game = readRepoFile('game.js');

  assert.match(game, /function currentReplaySeed\(\)/);
  assert.match(game, /window\.VSGameRng\.createSeededRng/);
  assert.match(game, /function createRefillRng\(\)/);
  assert.match(game, /\$\{currentReplaySeed\(\)\}:\$\{sessionMovesCount\}:\$\{score\}/);
  assert.match(game, /function createShuffleRng\(\)/);
  assert.match(game, /\$\{currentReplaySeed\(\)\}:shuffle:\$\{sessionMovesCount\}:\$\{score\}/);
  assert.match(functionBody(game, 'applyGravity'), /const refillRng = createRefillRng\(\);/);
  assert.match(functionBody(game, 'shuffleBoard'), /rng: createShuffleRng\(\)/);
});

test('game runtime scripts are cache-busted for Telegram webview updates', () => {
  const html = readRepoFile('index.html');

  assert.match(html, /src="src\/game\/core\/rules-engine\.js\?v=20261028-safearea"/);
  assert.match(html, /src="game\.js\?v=20261028-safearea"/);
});

test('game.js delegates board math to the shared core instead of re-implementing it', () => {
  const game = readRepoFile('game.js');

  // Board/cell primitives must have a single source of truth (src/game/core)
  // so the browser runtime and the server replay cannot silently diverge.
  assert.match(game, /function makeCell\([^)]*\) \{\s*return window\.VSGameCore\.makeCell/);
  assert.match(game, /function makeStableCell\([^)]*\) \{\s*return window\.VSGameCore\.makeStableCell/);
  assert.match(game, /function findMatchGroups\([^)]*\) \{\s*return window\.VSGameCore\.findMatchGroups/);
  assert.match(game, /function findPotentialMove\([^)]*\) \{\s*return window\.VSGameCore\.findPotentialMove/);
  assert.match(game, /function canSwapMakeMatch\([^)]*\) \{\s*return window\.VSGameCore\.canSwapMakeMatch/);

  // The duplicated inline implementations must be gone.
  assert.doesNotMatch(game, /function scanLineGroups\(/);
  assert.doesNotMatch(game, /function causesImmediateMatchAt\(/);
  assert.doesNotMatch(game, /function countSameInDirection\(/);
  assert.doesNotMatch(game, /function randColor\(/);

  // Dead pre-module fallbacks that never ran are removed.
  assert.doesNotMatch(functionBody(game, 'createBoard'), /Array\.from\(\{ length: SIZE \* SIZE \}/);
  assert.doesNotMatch(functionBody(game, 'shuffleBoard'), /Array\.from\(\{ length: SIZE \* SIZE \}/);
});

test('continue-with-claps extends the same seed-replayable run', () => {
  const game = readRepoFile('game.js');
  const timeoutBody = functionBody(game, 'endGameByTimeout');
  const continueBody = game.match(/async function continueRunWithClaps\(\) \{([\s\S]*?)\n\}/)[1];

  // Game over must not finalize the session, so a paid continue can keep going.
  assert.doesNotMatch(timeoutBody, /submitFinalProgressAndEnd/);
  assert.match(timeoutBody, /score > runInitialBestScore/);

  // Continue must resume the existing session, not mint a fresh one that the
  // server replay cannot validate.
  assert.doesNotMatch(continueBody, /startAnalyticsSession\('continue'\)/);
  assert.match(continueBody, /sessionClapsSpent \+= CONTINUE_RUN_CLAPS_COST/);
  assert.match(game, /let runInitialBestScore = 0;/);
  assert.match(game, /runInitialBestScore = bestScore;/);
});
