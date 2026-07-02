const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('maintenance screen exposes hidden triple-tap dev password bypass', () => {
  const html = readRepoFile('index.html');
  const game = readRepoFile('game.js');
  const styles = readRepoFile('styles.css');

  assert.match(html, /id="maintenance-dev-trigger"/);
  assert.match(html, /id="maintenance-dev-modal"/);
  assert.match(html, /id="maintenance-dev-password"/);
  assert.match(html, />password</);

  assert.match(styles, /\.maintenance-dev-trigger/);
  assert.match(styles, /\.dev-password-input/);

  assert.match(game, /maintenanceDevTapCount/);
  assert.match(game, /maintenanceDevTapCount >= 3/);
  assert.match(game, /postJson\('maintenance-dev-auth'/);
  assert.match(game, /let maintenanceDevBypassActive = false;/);
  assert.match(game, /maintenanceDevBypassActive = true;/);
  assert.doesNotMatch(game, /MAINTENANCE_DEV_BYPASS_KEY/);
  assert.doesNotMatch(game, /sessionStorage\.(getItem|setItem|removeItem)\([^)]*maintenance/i);
  assert.match(game, /isMaintenanceDevBypassActive\(\)/);
});

test('maintenance retry button uses the dedicated refresh icon asset', () => {
  const html = readRepoFile('index.html');
  const styles = readRepoFile('styles.css');

  assert.match(html, /id="maintenance-retry"/);
  assert.match(html, /src="\.\/assets\/retry-counterclockwise\.png"/);
  assert.doesNotMatch(html, /class="maintenance-retry-icon"[\s\S]*?<svg/);
  assert.match(styles, /\.maintenance-retry-icon img/);
});

test('maintenance dev auth is backed by Supabase secret and configured as public function', () => {
  const source = readRepoFile('supabase/functions/maintenance-dev-auth/index.ts');
  const config = readRepoFile('supabase/config.toml');

  assert.match(source, /MAINTENANCE_DEV_PASSWORD/);
  assert.match(source, /Deno\.env\.get\('MAINTENANCE_DEV_PASSWORD'\)/);
  assert.match(source, /password is required/);
  assert.match(source, /Forbidden/);
  assert.doesNotMatch(source, /vsesvoi|password123|admin|secret/i);
  assert.match(config, /\[functions\.maintenance-dev-auth\]/);
  assert.match(config, /verify_jwt = false/);
});

test('alpha GameHub is hidden behind coal tower five-tap developer gate', () => {
  const html = readRepoFile('index.html');
  const game = readRepoFile('game.js');
  const styles = readRepoFile('styles.css');

  assert.match(html, /id="alpha-gamehub-screen"/);
  assert.match(html, /id="gamehub-dev-modal"/);
  assert.match(html, /id="gamehub-dev-password"/);
  assert.match(html, /data-gamehub-dev-trigger/);
  assert.match(html, />Все Свои: Угольная башня</);

  assert.match(styles, /\.alpha-gamehub-screen/);
  assert.match(styles, /\.alpha-gamehub-card/);

  assert.match(game, /let gamehubDevTapCount = 0;/);
  assert.match(game, /let gamehubDevModeActive = false;/);
  assert.match(game, /gamehubDevTapCount >= 5/);
  assert.match(game, /postJson\('maintenance-dev-auth'/);
  assert.match(game, /gamehubDevModeActive = true;/);
  assert.doesNotMatch(game, /sessionStorage\.(getItem|setItem|removeItem)\([^)]*gamehub/i);
});
