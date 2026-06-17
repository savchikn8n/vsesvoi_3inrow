const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_MAINTENANCE_CONFIG,
  normalizeRuntimeConfig,
  shouldUseCachedMaintenance,
} = require('../maintenance-config.js');

test('normalizes missing runtime config to disabled maintenance defaults', () => {
  const config = normalizeRuntimeConfig(null);

  assert.deepEqual(config.maintenance, DEFAULT_MAINTENANCE_CONFIG);
});

test('normalizes enabled maintenance content and safe links', () => {
  const config = normalizeRuntimeConfig({
    maintenance: {
      enabled: true,
      title: '  Техническая пауза  ',
      body: '  Мы делаем игру чуточку лучше  ',
      note: '  Приносим извинения  ',
      primaryLabel: ' Повторить ',
      secondaryLabel: ' Забронировать столик ',
      secondaryUrl: 'https://t.me/+Ew4VcHco7XBjNDU6',
      imageUrl: './assets/maintenance-claps.svg',
      updatedAt: '2026-06-17T08:00:00.000Z',
    },
  });

  assert.equal(config.maintenance.enabled, true);
  assert.equal(config.maintenance.title, 'Техническая пауза');
  assert.equal(config.maintenance.body, 'Мы делаем игру чуточку лучше');
  assert.equal(config.maintenance.note, 'Приносим извинения');
  assert.equal(config.maintenance.primaryLabel, 'Повторить');
  assert.equal(config.maintenance.secondaryLabel, 'Забронировать столик');
  assert.equal(config.maintenance.secondaryUrl, 'https://t.me/+Ew4VcHco7XBjNDU6');
  assert.equal(config.maintenance.imageUrl, './assets/maintenance-claps.svg');
  assert.equal(config.maintenance.updatedAt, '2026-06-17T08:00:00.000Z');
});

test('rejects unsafe dashboard-provided links while keeping maintenance enabled', () => {
  const config = normalizeRuntimeConfig({
    maintenance: {
      enabled: true,
      secondaryUrl: 'javascript:alert(1)',
      imageUrl: '//evil.example/image.svg',
    },
  });

  assert.equal(config.maintenance.enabled, true);
  assert.equal(config.maintenance.secondaryUrl, DEFAULT_MAINTENANCE_CONFIG.secondaryUrl);
  assert.equal(config.maintenance.imageUrl, DEFAULT_MAINTENANCE_CONFIG.imageUrl);
});

test('uses cached maintenance only while the cache is fresh and enabled', () => {
  const now = 1_786_000_000_000;
  const fresh = { cachedAt: now - 30_000, config: { maintenance: { enabled: true } } };
  const stale = { cachedAt: now - 130_000, config: { maintenance: { enabled: true } } };
  const disabled = { cachedAt: now - 30_000, config: { maintenance: { enabled: false } } };

  assert.equal(shouldUseCachedMaintenance(fresh, now, 120_000), true);
  assert.equal(shouldUseCachedMaintenance(stale, now, 120_000), false);
  assert.equal(shouldUseCachedMaintenance(disabled, now, 120_000), false);
});
