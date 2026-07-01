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

  assert.match(game, /MAINTENANCE_DEV_BYPASS_KEY/);
  assert.match(game, /maintenanceDevTapCount/);
  assert.match(game, /maintenanceDevTapCount >= 3/);
  assert.match(game, /postJson\('maintenance-dev-auth'/);
  assert.match(game, /sessionStorage\.setItem\(MAINTENANCE_DEV_BYPASS_KEY/);
  assert.match(game, /isMaintenanceDevBypassActive\(\)/);
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
