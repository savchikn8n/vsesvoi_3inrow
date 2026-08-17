const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('dashboard never renders a raw error body into the header', () => {
  const dashboard = readRepoFile('dashboard.js');

  // A failing gateway wraps the origin HTML error page into its JSON envelope.
  // Rendering data.error unfiltered once buried the header under a full
  // Cloudflare 522 document.
  assert.doesNotMatch(dashboard, /throw new Error\(data\?\.error \|\|/);
  assert.match(dashboard, /describeRequestFailure\(response\.status, data\?\.error\)/);
  assert.match(dashboard, /text\.startsWith\('<'\)/);
  assert.match(dashboard, /text\.slice\(0, 200\)/);
});

test('dashboard separates a rejected key from an unavailable backend', () => {
  const dashboard = readRepoFile('dashboard.js');

  // Reading a 5xx as a bad key sent a real investigation down the wrong path.
  assert.match(dashboard, /status === 401 \|\| status === 403/);
  assert.match(dashboard, /DASHBOARD_SECRET/);
  assert.match(dashboard, /status >= 500/);
  assert.match(dashboard, /не ключ/i);
});

test('status line owns a header row instead of covering the tabs', () => {
  const html = readRepoFile('dashboard.html');
  const css = readRepoFile('dashboard.css');

  // Sharing the right-hand tools column let a long message push out across the
  // nowrap tabs and hide the navigation.
  assert.doesNotMatch(html, /dashboard-header-tools[\s\S]{0,400}id="dashboard-status"/);
  assert.match(html, /<\/div>\s*\n\s*<p id="dashboard-status"/);
  assert.match(css, /\.dashboard-status\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.dashboard-status:empty\s*\{\s*display:\s*none/);
});

test('dashboard assets are cache-busted like the game runtime', () => {
  const html = readRepoFile('dashboard.html');

  // Without a version query the browser serves a stale dashboard.js/css after a
  // deploy, which reads as "the fix did not work".
  assert.match(html, /\.\/dashboard\.css\?v=[\w-]+/);
  assert.match(html, /\.\/dashboard\.js\?v=[\w-]+/);
  assert.match(html, /\.\/maintenance-config\.js\?v=[\w-]+/);
});

test('dashboard requests cannot hang forever on a stalled database', () => {
  const dashboard = readRepoFile('dashboard.js');

  assert.match(dashboard, /const REQUEST_TIMEOUT_MS = \d+/);
  assert.match(dashboard, /signal: AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  assert.match(dashboard, /База не отвечает/);
});
