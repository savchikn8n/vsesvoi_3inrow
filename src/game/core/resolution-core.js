(function initResolutionCore(globalScope, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSGameResolution = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createResolutionCore() {
  'use strict';

  const DEFAULT_SIZE = 7;

  function idxToPos(index, size = DEFAULT_SIZE) {
    return [Math.floor(index / size), index % size];
  }

  function posToIdx(row, col, size = DEFAULT_SIZE) {
    return row * size + col;
  }

  function chooseSpecialIndex(cells, swappedPair) {
    if (!swappedPair) return cells[Math.floor(cells.length / 2)];

    const [a, b] = swappedPair;
    if (cells.includes(b)) return b;
    if (cells.includes(a)) return a;
    return cells[Math.floor(cells.length / 2)];
  }

  function getBlastArea(center, special, size = DEFAULT_SIZE) {
    const [row, col] = idxToPos(center, size);
    const targets = new Set([center]);

    if (special === 'rocket-h') {
      for (let x = 0; x < size; x++) {
        targets.add(posToIdx(row, x, size));
      }
    } else if (special === 'rocket-v') {
      for (let y = 0; y < size; y++) {
        targets.add(posToIdx(y, col, size));
      }
    } else if (special === 'bomb') {
      for (let rowDelta = -2; rowDelta <= 2; rowDelta++) {
        for (let colDelta = -2; colDelta <= 2; colDelta++) {
          const nextRow = row + rowDelta;
          const nextCol = col + colDelta;
          if (nextRow >= 0 && nextRow < size && nextCol >= 0 && nextCol < size) {
            targets.add(posToIdx(nextRow, nextCol, size));
          }
        }
      }
    }

    return targets;
  }

  function getBombRocketComboArea(center, size = DEFAULT_SIZE) {
    const [row, col] = idxToPos(center, size);
    const targets = new Set();

    for (let nextRow = row - 1; nextRow <= row + 1; nextRow++) {
      if (nextRow < 0 || nextRow >= size) continue;
      for (let x = 0; x < size; x++) {
        targets.add(posToIdx(nextRow, x, size));
      }
    }

    for (let nextCol = col - 1; nextCol <= col + 1; nextCol++) {
      if (nextCol < 0 || nextCol >= size) continue;
      for (let y = 0; y < size; y++) {
        targets.add(posToIdx(y, nextCol, size));
      }
    }

    return targets;
  }

  function getRocketRocketComboArea(center, size = DEFAULT_SIZE) {
    const [row, col] = idxToPos(center, size);
    const targets = new Set();

    for (let x = 0; x < size; x++) {
      targets.add(posToIdx(row, x, size));
    }

    for (let y = 0; y < size; y++) {
      targets.add(posToIdx(y, col, size));
    }

    return targets;
  }

  return {
    chooseSpecialIndex,
    getBlastArea,
    getBombRocketComboArea,
    getRocketRocketComboArea,
  };
});
