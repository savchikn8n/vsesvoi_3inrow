(function initBoardCore(globalScope, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSGameCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBoardCore() {
  'use strict';

  const DEFAULT_SIZE = 7;
  const DEFAULT_COLORS = 4;

  function idxToPos(index, size = DEFAULT_SIZE) {
    return [Math.floor(index / size), index % size];
  }

  function posToIdx(row, col, size = DEFAULT_SIZE) {
    return row * size + col;
  }

  function areAdjacent(a, b, size = DEFAULT_SIZE) {
    const [ar, ac] = idxToPos(a, size);
    const [br, bc] = idxToPos(b, size);
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
  }

  function randColor(colorCount = DEFAULT_COLORS, rng = Math.random) {
    return Math.floor(rng() * colorCount);
  }

  function makeCell(color = randColor(), special = null) {
    return { color, special };
  }

  function cloneCell(cell) {
    return cell ? { color: cell.color, special: cell.special } : null;
  }

  function cloneBoard(src) {
    return src.map(cloneCell);
  }

  function swapIn(arr, a, b) {
    [arr[a], arr[b]] = [arr[b], arr[a]];
    return arr;
  }

  function cellIdx(primary, secondary, horizontal, size = DEFAULT_SIZE) {
    return horizontal ? posToIdx(primary, secondary, size) : posToIdx(secondary, primary, size);
  }

  function scanLineGroups(arr, horizontal, size = DEFAULT_SIZE) {
    const groups = [];

    for (let primary = 0; primary < size; primary++) {
      let run = [];

      for (let secondary = 0; secondary < size; secondary++) {
        const idx = cellIdx(primary, secondary, horizontal, size);
        const cell = arr[idx];

        if (!cell || cell.special) {
          if (run.length >= 3) {
            groups.push({ cells: [...run], orientation: horizontal ? 'h' : 'v' });
          }
          run = [];
          continue;
        }

        if (run.length === 0) {
          run.push(idx);
          continue;
        }

        const prev = run[run.length - 1];
        if (arr[prev] && cell.color === arr[prev].color) {
          run.push(idx);
        } else {
          if (run.length >= 3) {
            groups.push({ cells: [...run], orientation: horizontal ? 'h' : 'v' });
          }
          run = [idx];
        }
      }

      if (run.length >= 3) {
        groups.push({ cells: [...run], orientation: horizontal ? 'h' : 'v' });
      }
    }

    return groups;
  }

  function findMatchGroups(arr, size = DEFAULT_SIZE) {
    return [...scanLineGroups(arr, true, size), ...scanLineGroups(arr, false, size)];
  }

  function countSameInDirection(arr, row, col, rowDelta, colDelta, color, size = DEFAULT_SIZE) {
    let count = 0;
    let nextRow = row + rowDelta;
    let nextCol = col + colDelta;

    while (nextRow >= 0 && nextRow < size && nextCol >= 0 && nextCol < size) {
      const cell = arr[posToIdx(nextRow, nextCol, size)];
      if (!cell || cell.special || cell.color !== color) break;
      count++;
      nextRow += rowDelta;
      nextCol += colDelta;
    }

    return count;
  }

  function causesImmediateMatchAt(arr, row, col, color, size = DEFAULT_SIZE) {
    const horizontal =
      countSameInDirection(arr, row, col, 0, -1, color, size) +
      countSameInDirection(arr, row, col, 0, 1, color, size);
    const vertical =
      countSameInDirection(arr, row, col, -1, 0, color, size) +
      countSameInDirection(arr, row, col, 1, 0, color, size);
    return horizontal >= 2 || vertical >= 2;
  }

  function shuffledColorPool(colorCount, rng) {
    const pool = Array.from({ length: colorCount }, (_, i) => i);

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool;
  }

  function makeStableCell(arr, row, col, options = {}) {
    const size = options.size || DEFAULT_SIZE;
    const colorCount = options.colorCount || DEFAULT_COLORS;
    const rng = options.rng || Math.random;
    const createCell = options.makeCell || makeCell;
    const pool = shuffledColorPool(colorCount, rng);

    for (const color of pool) {
      if (!causesImmediateMatchAt(arr, row, col, color, size)) {
        return createCell(color, null);
      }
    }

    return createCell(pool[0], null);
  }

  function createBoard(options = {}) {
    const size = options.size || DEFAULT_SIZE;
    const maxAttempts = options.maxAttempts || 200;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const board = Array.from({ length: size * size }, () => null);

      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          board[posToIdx(row, col, size)] = makeStableCell(board, row, col, options);
        }
      }

      if (findMatchGroups(board, size).length === 0 && hasAnyMove(board, size)) {
        return board;
      }
    }

    throw new Error('Unable to create a playable board');
  }

  function normalizeSpawnedCell(cell, fallbackOptions) {
    const source = cell || makeCell(randColor(fallbackOptions.colorCount, fallbackOptions.rng));
    return cloneCell(source);
  }

  function applyGravity(src, options = {}) {
    const size = options.size || DEFAULT_SIZE;
    const colorCount = options.colorCount || DEFAULT_COLORS;
    const rng = options.rng || Math.random;
    const next = cloneBoard(src);
    const spawnCell =
      options.makeCell ||
      ((context) =>
        makeStableCell(context.board, context.row, context.col, {
          size,
          colorCount,
          rng,
        }));

    for (let col = 0; col < size; col++) {
      let write = size - 1;

      for (let row = size - 1; row >= 0; row--) {
        const idx = posToIdx(row, col, size);
        const cell = next[idx];

        if (cell !== null) {
          const moved = cloneCell(cell);
          moved._fall = Math.max(0, write - row);
          next[posToIdx(write, col, size)] = moved;
          if (write !== row) next[idx] = null;
          write--;
        }
      }

      while (write >= 0) {
        const spawned = normalizeSpawnedCell(
          spawnCell({
            row: write,
            col,
            board: next,
            size,
          }),
          { colorCount, rng },
        );
        spawned._fall = write + 1;
        next[posToIdx(write, col, size)] = spawned;
        write--;
      }
    }

    return next;
  }

  function canSwapMakeMatch(arr, a, b, size = DEFAULT_SIZE) {
    const test = cloneBoard(arr);
    swapIn(test, a, b);
    return findMatchGroups(test, size).length > 0;
  }

  function findPotentialMove(arr, size = DEFAULT_SIZE) {
    for (let i = 0; i < arr.length; i++) {
      const [row, col] = idxToPos(i, size);
      const neighbors = [];
      if (col + 1 < size) neighbors.push(posToIdx(row, col + 1, size));
      if (col - 1 >= 0) neighbors.push(posToIdx(row, col - 1, size));
      if (row + 1 < size) neighbors.push(posToIdx(row + 1, col, size));
      if (row - 1 >= 0) neighbors.push(posToIdx(row - 1, col, size));

      for (const neighbor of neighbors) {
        if (arr[i]?.special) return { from: i, to: neighbor };
        const test = cloneBoard(arr);
        swapIn(test, i, neighbor);
        if (findMatchGroups(test, size).length > 0) {
          return { from: i, to: neighbor };
        }
      }
    }

    return null;
  }

  function hasAnyMove(arr, size = DEFAULT_SIZE) {
    return Boolean(findPotentialMove(arr, size));
  }

  return {
    DEFAULT_SIZE,
    DEFAULT_COLORS,
    areAdjacent,
    applyGravity,
    canSwapMakeMatch,
    causesImmediateMatchAt,
    cellIdx,
    cloneBoard,
    countSameInDirection,
    createBoard,
    findMatchGroups,
    findPotentialMove,
    hasAnyMove,
    idxToPos,
    makeCell,
    makeStableCell,
    posToIdx,
    randColor,
    scanLineGroups,
    swapIn,
  };
});
