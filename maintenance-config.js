(function attachMaintenanceConfig(globalScope) {
  const DEFAULT_MAINTENANCE_CONFIG = Object.freeze({
    enabled: false,
    title: 'Техническая пауза',
    body: 'Мы делаем игру чуточку лучше',
    note: 'Приносим извинения за доставленные неудобства',
    primaryLabel: 'Повторить',
    secondaryLabel: 'Забронировать столик',
    secondaryUrl: 'https://t.me/+Ew4VcHco7XBjNDU6',
    imageUrl: './assets/maintenance-claps.svg',
    updatedAt: '',
  });

  const DEFAULT_RUNTIME_CONFIG = Object.freeze({
    maintenance: DEFAULT_MAINTENANCE_CONFIG,
  });

  function cleanText(value, fallback, maxLength) {
    const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (!text) return fallback;
    return text.slice(0, maxLength);
  }

  function isSafeUrl(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text) return false;
    if (text.startsWith('./')) return true;
    if (text.startsWith('/') && !text.startsWith('//')) return true;
    try {
      const url = new URL(text);
      return ['http:', 'https:', 'tg:'].includes(url.protocol);
    } catch (_) {
      return false;
    }
  }

  function cleanUrl(value, fallback) {
    const text = typeof value === 'string' ? value.trim() : '';
    return isSafeUrl(text) ? text : fallback;
  }

  function normalizeRuntimeConfig(value) {
    const input = value && typeof value === 'object' ? value : {};
    const maintenance = input.maintenance && typeof input.maintenance === 'object' ? input.maintenance : {};

    return {
      maintenance: {
        enabled: maintenance.enabled === true,
        title: cleanText(maintenance.title, DEFAULT_MAINTENANCE_CONFIG.title, 80),
        body: cleanText(maintenance.body, DEFAULT_MAINTENANCE_CONFIG.body, 160),
        note: cleanText(maintenance.note, DEFAULT_MAINTENANCE_CONFIG.note, 160),
        primaryLabel: cleanText(maintenance.primaryLabel, DEFAULT_MAINTENANCE_CONFIG.primaryLabel, 32),
        secondaryLabel: cleanText(maintenance.secondaryLabel, DEFAULT_MAINTENANCE_CONFIG.secondaryLabel, 40),
        secondaryUrl: cleanUrl(maintenance.secondaryUrl, DEFAULT_MAINTENANCE_CONFIG.secondaryUrl),
        imageUrl: cleanUrl(maintenance.imageUrl, DEFAULT_MAINTENANCE_CONFIG.imageUrl),
        updatedAt: cleanText(maintenance.updatedAt, DEFAULT_MAINTENANCE_CONFIG.updatedAt, 64),
      },
    };
  }

  function shouldUseCachedMaintenance(cacheEntry, nowMs, ttlMs) {
    if (!cacheEntry || typeof cacheEntry !== 'object') return false;
    const cachedAt = Number(cacheEntry.cachedAt || 0);
    if (!Number.isFinite(cachedAt) || cachedAt <= 0) return false;
    if (Math.max(0, nowMs - cachedAt) > ttlMs) return false;
    return normalizeRuntimeConfig(cacheEntry.config).maintenance.enabled === true;
  }

  const api = {
    DEFAULT_MAINTENANCE_CONFIG,
    DEFAULT_RUNTIME_CONFIG,
    normalizeRuntimeConfig,
    shouldUseCachedMaintenance,
  };

  globalScope.VSRuntimeConfig = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
