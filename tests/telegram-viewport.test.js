const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function setupTelegramSource() {
  const game = readRepoFile('game.js');
  const start = game.indexOf('function setupTelegramWebApp()');
  const end = game.indexOf('function setupTouchGuards()');
  assert.ok(start >= 0 && end > start, 'setupTelegramWebApp must exist');
  return game.slice(start, end);
}

test('fullscreen is requested once and only on clients that support it', () => {
  const source = setupTelegramSource();

  // Re-requesting on every viewportChanged fought a player leaving fullscreen
  // and logged an error on each call for clients below Bot API 8.0.
  assert.match(source, /fullscreenRequested \|\| tg\.isFullscreen \|\| !supports\('8\.0'\)/);
  assert.equal((source.match(/requestFullscreenOnce\(\)/g) || []).length, 1);
  assert.doesNotMatch(source, /viewportChanged[\s\S]{0,120}requestFullscreen/);
  assert.doesNotMatch(source, /setTimeout\([^)]*Fullscreen/);
});

test('vertical swipes are disabled only where Telegram supports it', () => {
  const source = setupTelegramSource();
  assert.match(source, /supports\('7\.7'\) && typeof tg\.disableVerticalSwipes === 'function'/);
});

test('layout insets come from Telegram instead of a fixed 84px offset', () => {
  const css = readRepoFile('styles.css');

  assert.doesNotMatch(css, /--tg-ui-offset:\s*84px/);
  assert.match(css, /--tg-ui-offset: var\(--tg-content-safe-area-inset-top, 0px\)/);
  assert.match(css, /--safe-top: max\(env\(safe-area-inset-top, 0px\), var\(--tg-safe-area-inset-top, 0px\)\)/);
  assert.match(css, /--safe-bottom: max\(env\(safe-area-inset-bottom, 0px\), var\(--tg-safe-area-inset-bottom, 0px\)\)/);
  // Every inset goes through the shared variables, not a bare env().
  assert.doesNotMatch(css.replace(/--safe-(top|bottom):[^;]+;/g, ''), /env\(safe-area-inset/);
});

test('the stylesheet is cache-busted with the scripts', () => {
  const html = readRepoFile('index.html');
  assert.match(html, /href="styles\.css\?v=20261028-safearea"/);
});
