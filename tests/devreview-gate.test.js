const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('match-3 dev review is hidden behind a seven-tap developer gate on the game logo', () => {
  const html = readRepoFile('index.html');
  const game = readRepoFile('game.js');
  const styles = readRepoFile('styles.css');

  // The trigger sits on the "3 в ряд" logo slide, not the coal-tower slide.
  assert.match(html, /data-devreview-dev-trigger/);
  assert.match(html, /alt="Все Свои 3 в ряд"/);
  assert.match(html, /id="devreview-dev-modal"/);
  assert.match(html, /id="devreview-dev-password"/);
  assert.match(html, /id="devreview-panel"/);
  assert.match(html, /id="devreview-play"/);
  assert.match(html, /id="devreview-exit"/);

  assert.match(styles, /\.devreview-panel/);
  assert.match(styles, /\.devreview-flag/);

  assert.match(game, /let devReviewModeActive = false;/);
  assert.match(game, /devReviewDevTapCount >= 7/);
  assert.match(game, /if \(menuHeroSlide !== 0\) return;/);
  assert.match(game, /postJson\('maintenance-dev-auth'/);
  assert.match(game, /devReviewModeActive = true;/);
});

test('dev review state stays page-load-only with no browser storage', () => {
  const game = readRepoFile('game.js');

  assert.doesNotMatch(game, /localStorage\.(getItem|setItem|removeItem)\([^)]*devReview/i);
  assert.doesNotMatch(game, /sessionStorage\.(getItem|setItem|removeItem)\([^)]*devReview/i);
  assert.doesNotMatch(game, /DEVREVIEW_[A-Z_]*_KEY/);
});

test('dev review experiment flags default OFF so production players never see them', () => {
  const game = readRepoFile('game.js');

  // Flags are initialised to false and reset to false when review closes.
  assert.match(game, /const devFlags = Object\.fromEntries\(DEV_FLAGS\.map\(\(flag\) => \[flag\.id, false\]\)\);/);
  assert.match(game, /DEV_FLAGS\.forEach\(\(flag\) => applyDevFlag\(flag\.id, false\)\);/);
});
