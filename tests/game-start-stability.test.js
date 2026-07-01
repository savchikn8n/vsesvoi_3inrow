const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function functionBody(source, functionName) {
  const match = source.match(new RegExp(`(?:async )?function ${functionName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${functionName} should exist`);
  return match[1];
}

test('home start keeps the menu up until the next board is ready', () => {
  const game = readRepoFile('game.js');
  const body = functionBody(game, 'startNewGameFromHome');

  assert.doesNotMatch(body, /hideStartScreen\(\)/);
  assert.match(body, /void resetGame\(\)/);
});

test('resetGame rejects overlapping starts so a stale session cannot replace an active board', () => {
  const game = readRepoFile('game.js');
  const body = functionBody(game, 'resetGame');

  assert.match(game, /let gameStartInProgress = false;/);
  assert.match(game, /let gameStartRunId = 0;/);
  assert.match(body, /if \(gameStartInProgress\) return;/);
  assert.match(body, /gameStartInProgress = true;/);
  assert.match(body, /const startRunId = \+\+gameStartRunId;/);
  assert.match(body, /await startServerGameSession\(\)/);
  assert.match(body, /if \(startRunId !== gameStartRunId\) return;/);
  assert.match(body, /finally \{\s*if \(startRunId === gameStartRunId\) \{\s*gameStartInProgress = false;/);
});
