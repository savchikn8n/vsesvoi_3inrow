(function initRng(globalScope, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSGameRng = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRngApi() {
  'use strict';

  function normalizeSeed(seed) {
    const value = String(seed || '').trim();
    if (/^[0-9a-f]+$/i.test(value) && value.length >= 8) {
      return value.toLowerCase();
    }
    return Array.from(value || 'vsesvoi')
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  }

  function hashSeed(seed) {
    const normalized = normalizeSeed(seed);
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRng(seed) {
    let state = hashSeed(seed) || 1;
    return function rng() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  return {
    createSeededRng,
    normalizeSeed,
  };
});
