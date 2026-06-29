(function initRulesEngine(globalScope, factory) {
  const deps =
    typeof module === 'object' && module.exports
      ? {
          core: require('./board-core.js'),
          resolution: require('./resolution-core.js'),
          rng: require('./rng.js'),
        }
      : {
          core: globalScope.VSGameCore,
          resolution: globalScope.VSGameResolution,
          rng: globalScope.VSGameRng,
        };
  const api = factory(deps);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSGameRules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRulesEngine(deps) {
  'use strict';

  const { core, resolution, rng } = deps;
  const DEFAULT_SIZE = 7;
  const DEFAULT_COLORS = 4;
  const RULES_VERSION = 'match3-v1';

  function cloneCell(cell) {
    return cell ? { color: cell.color, special: cell.special || null } : null;
  }

  function cleanBoard(board) {
    return board.map(cloneCell);
  }

  function cloneState(state) {
    return {
      board: cleanBoard(state.board),
      score: Math.max(0, Math.floor(Number(state.score || 0))),
      clapsEarned: Math.max(0, Math.floor(Number(state.clapsEarned || 0))),
      movesCount: Math.max(0, Math.floor(Number(state.movesCount || 0))),
      size: state.size || DEFAULT_SIZE,
      colorCount: state.colorCount || DEFAULT_COLORS,
      seed: state.seed || '',
    };
  }

  function updateClaps(state) {
    state.clapsEarned = Math.floor(Math.max(0, state.score) / 10000);
    return state;
  }

  function createInitialState(options = {}) {
    const size = options.size || DEFAULT_SIZE;
    const colorCount = options.colorCount || DEFAULT_COLORS;
    const seed = rng.normalizeSeed(options.seed || 'vsesvoi');
    const seededRng = rng.createSeededRng(seed);
    const board = core.createBoard({ size, colorCount, rng: seededRng });

    return updateClaps({
      board: cleanBoard(board),
      score: 0,
      clapsEarned: 0,
      movesCount: 0,
      size,
      colorCount,
      seed,
    });
  }

  function isOutOfRange(index, size) {
    return !Number.isInteger(index) || index < 0 || index >= size * size;
  }

  function chooseSpecialIndex(cells, swappedPair) {
    return resolution.chooseSpecialIndex(cells, swappedPair);
  }

  function upsertSpecialCreate(map, idx, special, color) {
    const existing = map.get(idx);
    if (!existing || (existing.special !== 'bomb' && special === 'bomb')) {
      map.set(idx, { special, color });
    }
  }

  function getMatchedComponents(board, groups, size) {
    const matchedSet = new Set();
    groups.forEach((group) => group.cells.forEach((idx) => matchedSet.add(idx)));

    const visited = new Set();
    const components = [];

    matchedSet.forEach((start) => {
      if (visited.has(start)) return;

      const color = board[start]?.color;
      if (color === undefined) return;

      const queue = [start];
      visited.add(start);
      const cells = [];

      while (queue.length > 0) {
        const idx = queue.shift();
        cells.push(idx);
        const [row, col] = core.idxToPos(idx, size);
        const neighbors = [
          [row - 1, col],
          [row + 1, col],
          [row, col - 1],
          [row, col + 1],
        ];

        neighbors.forEach(([nextRow, nextCol]) => {
          if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) return;
          const nextIdx = core.posToIdx(nextRow, nextCol, size);
          if (visited.has(nextIdx) || !matchedSet.has(nextIdx)) return;
          if (board[nextIdx]?.color !== color) return;
          visited.add(nextIdx);
          queue.push(nextIdx);
        });
      }

      components.push({ color, cells });
    });

    return components;
  }

  function isHorizontalSwap(swappedPair, size) {
    if (!swappedPair) return false;
    const [a, b] = swappedPair;
    const [ar, ac] = core.idxToPos(a, size);
    const [br, bc] = core.idxToPos(b, size);
    return ar === br && Math.abs(ac - bc) === 1;
  }

  function buildMatchResolution(board, groups, swappedPair = null, preserveIndices = new Set(), size = DEFAULT_SIZE) {
    const removals = new Set();
    const specialCreates = new Map();

    groups.forEach((group) => group.cells.forEach((idx) => removals.add(idx)));
    preserveIndices.forEach((idx) => removals.delete(idx));

    groups.forEach((group) => {
      if (group.cells.length !== 4) return;
      const pivot = chooseSpecialIndex(group.cells, swappedPair);
      removals.delete(pivot);

      const rocketType = swappedPair
        ? isHorizontalSwap(swappedPair, size)
          ? 'rocket-h'
          : 'rocket-v'
        : group.orientation === 'h'
          ? 'rocket-h'
          : 'rocket-v';

      upsertSpecialCreate(specialCreates, pivot, rocketType, board[pivot].color);
    });

    const components = getMatchedComponents(board, groups, size);
    components.forEach((component) => {
      if (component.cells.length <= 4) return;
      const pivot = chooseSpecialIndex(component.cells, swappedPair);
      removals.delete(pivot);
      upsertSpecialCreate(specialCreates, pivot, 'bomb', component.color);
    });

    return { removals, specialCreates };
  }

  function collectSpecialBlast(board, start, resultSet, size) {
    const queue = [start];
    const visited = new Set();

    while (queue.length > 0) {
      const idx = queue.shift();
      if (visited.has(idx)) continue;
      visited.add(idx);

      const cell = board[idx];
      if (!cell?.special) continue;

      const blastCells = resolution.getBlastArea(idx, cell.special, size);
      blastCells.forEach((next) => {
        if (!resultSet.has(next)) resultSet.add(next);
        if (board[next]?.special && !visited.has(next)) queue.push(next);
      });
    }
  }

  function makeRefillRng(state) {
    return rng.createSeededRng(`${state.seed}:${state.movesCount}:${state.score}`);
  }

  function applyRemoval(state, removals, specialCreates = new Map(), options = {}) {
    const { chainSpecials = true, scoreMultiplier = 1 } = options;
    const blastSet = new Set(removals);
    let preservedMatchedCells = 0;

    if (chainSpecials) {
      removals.forEach((idx) => {
        if (state.board[idx]?.special) collectSpecialBlast(state.board, idx, blastSet, state.size);
      });
    }

    specialCreates.forEach((_, idx) => {
      if (removals.has(idx)) preservedMatchedCells++;
      blastSet.delete(idx);
    });

    blastSet.forEach((idx) => {
      state.board[idx] = null;
    });

    specialCreates.forEach(({ special, color }, idx) => {
      state.board[idx] = { color, special };
    });

    const scoredCells = blastSet.size + preservedMatchedCells;
    state.score += Math.round(scoredCells * 10 * Math.max(0, Number(scoreMultiplier) || 1));
    updateClaps(state);
    return blastSet;
  }

  function applyGravityToState(state) {
    state.board = core
      .applyGravity(state.board, {
        size: state.size,
        colorCount: state.colorCount,
        rng: makeRefillRng(state),
      })
      .map(cloneCell);
  }

  function resolveCascades(state, swappedPair = null) {
    let combo = 0;
    let pair = swappedPair;

    while (true) {
      const groups = core.findMatchGroups(state.board, state.size);
      if (groups.length === 0) break;

      combo++;
      const firstSwap = pair && combo === 1 ? pair : null;
      const { removals, specialCreates } = buildMatchResolution(state.board, groups, firstSwap, new Set(), state.size);
      applyRemoval(state, removals, specialCreates);
      applyGravityToState(state);
      pair = null;
    }

    if (combo > 1) {
      state.score += combo * 20;
      updateClaps(state);
    }
  }

  function canSwapMakeMatch(board, a, b, size) {
    const test = cleanBoard(board);
    core.swapIn(test, a, b);
    return core.findMatchGroups(test, size).length > 0;
  }

  function applySpecialMove(state, a, b) {
    if (a !== b) core.swapIn(state.board, a, b);

    const preserveIndices = new Set();
    if (state.board[a]?.special) preserveIndices.add(a);
    if (b !== a && state.board[b]?.special) preserveIndices.add(b);

    const preGroups = core.findMatchGroups(state.board, state.size);
    if (preGroups.length > 0) {
      const { removals, specialCreates } = buildMatchResolution(state.board, preGroups, [a, b], preserveIndices, state.size);
      applyRemoval(state, removals, specialCreates, { chainSpecials: false });
    }

    const activations = [];
    if (state.board[a]?.special) activations.push({ idx: a, special: state.board[a].special });
    if (b !== a && state.board[b]?.special) activations.push({ idx: b, special: state.board[b].special });
    if (activations.length === 0) return;

    const hasBomb = activations.some((item) => item.special === 'bomb');
    const hasRocket = activations.some((item) => item.special === 'rocket-h' || item.special === 'rocket-v');
    const rocketCount = activations.filter((item) => item.special === 'rocket-h' || item.special === 'rocket-v').length;
    const bombCount = activations.filter((item) => item.special === 'bomb').length;

    let blast = new Set();
    if (a !== b && activations.length === 2 && bombCount === 2) {
      for (let idx = 0; idx < state.size * state.size; idx++) blast.add(idx);
    } else if (a !== b && activations.length === 2 && rocketCount === 2) {
      blast = resolution.getRocketRocketComboArea(b, state.size);
    } else if (a !== b && activations.length === 2 && hasBomb && hasRocket) {
      blast = resolution.getBombRocketComboArea(b, state.size);
    } else {
      activations.forEach(({ idx, special }) => {
        resolution.getBlastArea(idx, special, state.size).forEach((target) => blast.add(target));
      });
    }

    applyRemoval(state, blast, new Map(), {
      chainSpecials: true,
      scoreMultiplier: a !== b && activations.length === 2 && bombCount === 2 ? 1.5 : 1,
    });
    applyGravityToState(state);
    resolveCascades(state);
  }

  function applyMove(inputState, move) {
    const state = cloneState(inputState);
    const from = Math.floor(Number(move?.from));
    const to = Math.floor(Number(move?.to));

    if (isOutOfRange(from, state.size) || isOutOfRange(to, state.size)) {
      return { accepted: false, reason: 'out_of_range', state };
    }
    if (!core.areAdjacent(from, to, state.size)) {
      return { accepted: false, reason: 'non_adjacent', state };
    }

    const specialMove = Boolean(state.board[from]?.special || state.board[to]?.special);
    if (specialMove) {
      applySpecialMove(state, from, to);
      state.movesCount++;
      updateClaps(state);
      return { accepted: true, reason: null, state };
    }

    if (!canSwapMakeMatch(state.board, from, to, state.size)) {
      return { accepted: false, reason: 'no_match', state };
    }

    core.swapIn(state.board, from, to);
    resolveCascades(state, [from, to]);
    state.movesCount++;
    updateClaps(state);
    return { accepted: true, reason: null, state };
  }

  function replayMoves(options = {}) {
    let state = createInitialState(options);
    const moves = Array.isArray(options.moves) ? options.moves : [];
    let movesAttempted = 0;

    for (const move of moves) {
      movesAttempted++;
      const result = applyMove(state, move);
      state = result.state;
      if (!result.accepted) {
        return {
          ...state,
          accepted: false,
          rejectReason: result.reason,
          movesAttempted,
        };
      }
    }

    return {
      ...state,
      accepted: true,
      rejectReason: null,
      movesAttempted,
    };
  }

  return {
    DEFAULT_COLORS,
    DEFAULT_SIZE,
    RULES_VERSION,
    applyMove,
    createInitialState,
    replayMoves,
  };
});
