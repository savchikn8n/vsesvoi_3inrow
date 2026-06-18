const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('live game controls remove restart and route exit through confirmation', () => {
  const html = readRepoFile('index.html');
  const game = readRepoFile('game.js');
  const css = readRepoFile('styles.css');

  assert.doesNotMatch(html, /id="restart"/);
  assert.match(html, /id="exit-confirm-modal"/);
  assert.match(html, /id="exit-confirm-cancel"/);
  assert.match(html, /id="exit-confirm-accept"/);
  assert.match(css, /\.control-row\s*{[^}]*justify-content:\s*flex-start/s);
  assert.match(css, /\.exit-confirm-actions\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(game, /exitToMenuBtn\?\.addEventListener\('click', openExitConfirmModal\);/);
  assert.doesNotMatch(game, /exitToMenuBtn\.addEventListener\('click', exitToMenu\);/);
});

test('exit confirmation makes cancel paid after seven seconds through server spend only', () => {
  const game = readRepoFile('game.js');

  assert.match(game, /const EXIT_CANCEL_FREE_MS = 7000;/);
  assert.match(game, /const EXIT_CANCEL_CLAPS_COST = CONTINUE_RUN_CLAPS_COST;/);
  assert.match(game, /function updateExitConfirmCancelState\(\)/);
  assert.match(game, /exitConfirmElapsedMs\(\) >= EXIT_CANCEL_FREE_MS/);
  assert.match(game, /exitConfirmAcceptBtn\.disabled = exitConfirmBusy;/);
  assert.match(game, /postJson\('spend-claps',\s*\{[\s\S]*amount: EXIT_CANCEL_CLAPS_COST,[\s\S]*reason: 'exit_cancel'/);
  assert.match(game, /saveProfile\(result\.profile, \{ forceClapBalance: true, synced: true \}\);/);
  assert.doesNotMatch(game, /clapBalance\s*-=\s*EXIT_CANCEL_CLAPS_COST/);
});

test('board and special effects are visually larger and smoother without changing board rules', () => {
  const css = readRepoFile('styles.css');
  const game = readRepoFile('game.js');

  assert.match(css, /--cell:\s*76px;/);
  assert.match(css, /--cell:\s*calc\(\(100vw - 62px\) \/ 7\);/);
  assert.match(css, /\.effect-rocket\.h\s*{[^}]*animation:\s*rocket-h 460ms cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\) forwards;/s);
  assert.match(css, /\.effect-rocket\.v\s*{[^}]*animation:\s*rocket-v 460ms cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\) forwards;/s);
  assert.match(css, /\.effect-bomb\s*{[^}]*animation:\s*bomb-wave 520ms cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\) forwards;/s);
  assert.match(game, /ANIMATION_TIMINGS\.specialBlastMs/);
  assert.match(game, /ANIMATION_TIMINGS\.megaBombMs/);
});

test('shop segmented control has a moving active plate instead of instant repaint', () => {
  const css = readRepoFile('styles.css');

  assert.match(css, /\.shop-segmented::before\s*{/);
  assert.match(css, /\.shop-screen\[data-active-shop-tab="discounts"\]\s+\.shop-segmented::before\s*{[^}]*transform:\s*translateX\(100%\);/s);
  assert.match(css, /\.shop-tab\.is-active\s*{[^}]*background:\s*transparent/s);
  assert.match(css, /\.shop-tab\s*{[^}]*z-index:\s*1/s);
});

test('new clap block asset replaces the old gold block while keeping the gold avatar key stable', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');
  const game = readRepoFile('game.js');

  assert.ok(fs.existsSync(path.join(repoRoot, 'assets/clapblock.svg')));
  assert.doesNotMatch(css, /assets\/gold\.png/);
  assert.match(css, /background-image:\s*url\("\.\/assets\/clapblock\.svg"\);/);
  assert.match(html, /src="\.\/assets\/clapblock\.svg" alt="Аватар профиля"/);
  assert.match(html, /data-avatar="gold">\s*<img src="\.\/assets\/clapblock\.svg" alt="Аватар gold"/);
  assert.match(game, /gold:\s*'\.\/assets\/clapblock\.svg'/);
});
