export const DEFAULT_SIZE = 7;
export const DEFAULT_COLORS = 4;
export const RULES_VERSION = 'match3-v1';

export type GameMove = { from: number; to: number };
export type GameCell = { color: number; special: string | null };
export type GameState = {
  board: Array<GameCell | null>;
  score: number;
  clapsEarned: number;
  movesCount: number;
  size: number;
  colorCount: number;
  seed: string;
};

function normalizeSeed(seed: unknown) {
  const value = String(seed || '').trim();
  if (/^[0-9a-f]+$/i.test(value) && value.length >= 8) return value.toLowerCase();
  return Array.from(value || 'vsesvoi')
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

function hashSeed(seed: unknown) {
  const normalized = normalizeSeed(seed);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seed: unknown) {
  let state = hashSeed(seed) || 1;
  return function rng() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function idxToPos(index: number, size = DEFAULT_SIZE) {
  return [Math.floor(index / size), index % size];
}

function posToIdx(row: number, col: number, size = DEFAULT_SIZE) {
  return row * size + col;
}

function areAdjacent(a: number, b: number, size = DEFAULT_SIZE) {
  const [ar, ac] = idxToPos(a, size);
  const [br, bc] = idxToPos(b, size);
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

function cloneCell(cell: GameCell | null) {
  return cell ? { color: cell.color, special: cell.special || null } : null;
}

function cleanBoard(board: Array<GameCell | null>) {
  return board.map(cloneCell);
}

function cloneState(state: GameState): GameState {
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

function updateClaps(state: GameState) {
  state.clapsEarned = Math.floor(Math.max(0, state.score) / 10000);
  return state;
}

function randColor(colorCount: number, rng: () => number) {
  return Math.floor(rng() * colorCount);
}

function makeCell(color: number, special: string | null = null): GameCell {
  return { color, special };
}

function cellIdx(primary: number, secondary: number, horizontal: boolean, size = DEFAULT_SIZE) {
  return horizontal ? posToIdx(primary, secondary, size) : posToIdx(secondary, primary, size);
}

function scanLineGroups(board: Array<GameCell | null>, horizontal: boolean, size = DEFAULT_SIZE) {
  const groups: Array<{ cells: number[]; orientation: 'h' | 'v' }> = [];
  for (let primary = 0; primary < size; primary++) {
    let run: number[] = [];
    for (let secondary = 0; secondary < size; secondary++) {
      const idx = cellIdx(primary, secondary, horizontal, size);
      const cell = board[idx];
      if (!cell || cell.special) {
        if (run.length >= 3) groups.push({ cells: [...run], orientation: horizontal ? 'h' : 'v' });
        run = [];
        continue;
      }
      if (run.length === 0) {
        run.push(idx);
        continue;
      }
      const prev = run[run.length - 1];
      if (board[prev] && cell.color === board[prev]?.color) {
        run.push(idx);
      } else {
        if (run.length >= 3) groups.push({ cells: [...run], orientation: horizontal ? 'h' : 'v' });
        run = [idx];
      }
    }
    if (run.length >= 3) groups.push({ cells: [...run], orientation: horizontal ? 'h' : 'v' });
  }
  return groups;
}

function findMatchGroups(board: Array<GameCell | null>, size = DEFAULT_SIZE) {
  return [...scanLineGroups(board, true, size), ...scanLineGroups(board, false, size)];
}

function countSameInDirection(
  board: Array<GameCell | null>,
  row: number,
  col: number,
  rowDelta: number,
  colDelta: number,
  color: number,
  size = DEFAULT_SIZE,
) {
  let count = 0;
  let nextRow = row + rowDelta;
  let nextCol = col + colDelta;
  while (nextRow >= 0 && nextRow < size && nextCol >= 0 && nextCol < size) {
    const cell = board[posToIdx(nextRow, nextCol, size)];
    if (!cell || cell.special || cell.color !== color) break;
    count++;
    nextRow += rowDelta;
    nextCol += colDelta;
  }
  return count;
}

function causesImmediateMatchAt(board: Array<GameCell | null>, row: number, col: number, color: number, size = DEFAULT_SIZE) {
  const horizontal =
    countSameInDirection(board, row, col, 0, -1, color, size) +
    countSameInDirection(board, row, col, 0, 1, color, size);
  const vertical =
    countSameInDirection(board, row, col, -1, 0, color, size) +
    countSameInDirection(board, row, col, 1, 0, color, size);
  return horizontal >= 2 || vertical >= 2;
}

function shuffledColorPool(colorCount: number, rng: () => number) {
  const pool = Array.from({ length: colorCount }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function makeStableCell(board: Array<GameCell | null>, row: number, col: number, size: number, colorCount: number, rng: () => number) {
  const pool = shuffledColorPool(colorCount, rng);
  for (const color of pool) {
    if (!causesImmediateMatchAt(board, row, col, color, size)) return makeCell(color, null);
  }
  return makeCell(pool[0], null);
}

function canSwapMakeMatch(board: Array<GameCell | null>, a: number, b: number, size: number) {
  const test = cleanBoard(board);
  [test[a], test[b]] = [test[b], test[a]];
  return findMatchGroups(test, size).length > 0;
}

function chooseSpecialIndex(cells: number[], swappedPair: [number, number] | null) {
  if (!swappedPair) return cells[Math.floor(cells.length / 2)];
  const [a, b] = swappedPair;
  if (cells.includes(b)) return b;
  if (cells.includes(a)) return a;
  return cells[Math.floor(cells.length / 2)];
}

function upsertSpecialCreate(map: Map<number, { special: string; color: number }>, idx: number, special: string, color: number) {
  const existing = map.get(idx);
  if (!existing || (existing.special !== 'bomb' && special === 'bomb')) {
    map.set(idx, { special, color });
  }
}

function getMatchedComponents(board: Array<GameCell | null>, groups: Array<{ cells: number[] }>, size: number) {
  const matchedSet = new Set<number>();
  groups.forEach((group) => group.cells.forEach((idx) => matchedSet.add(idx)));

  const visited = new Set<number>();
  const components: Array<{ color: number; cells: number[] }> = [];
  matchedSet.forEach((start) => {
    if (visited.has(start)) return;
    const color = board[start]?.color;
    if (color === undefined) return;

    const queue = [start];
    const cells: number[] = [];
    visited.add(start);
    while (queue.length > 0) {
      const idx = queue.shift();
      if (idx === undefined) continue;
      cells.push(idx);
      const [row, col] = idxToPos(idx, size);
      const neighbors = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ];
      neighbors.forEach(([nextRow, nextCol]) => {
        if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) return;
        const nextIdx = posToIdx(nextRow, nextCol, size);
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

function isHorizontalSwap(swappedPair: [number, number] | null, size: number) {
  if (!swappedPair) return false;
  const [a, b] = swappedPair;
  const [ar, ac] = idxToPos(a, size);
  const [br, bc] = idxToPos(b, size);
  return ar === br && Math.abs(ac - bc) === 1;
}

function buildMatchResolution(
  board: Array<GameCell | null>,
  groups: Array<{ cells: number[]; orientation: 'h' | 'v' }>,
  swappedPair: [number, number] | null = null,
  preserveIndices = new Set<number>(),
  size = DEFAULT_SIZE,
) {
  const removals = new Set<number>();
  const specialCreates = new Map<number, { special: string; color: number }>();

  groups.forEach((group) => group.cells.forEach((idx) => removals.add(idx)));
  preserveIndices.forEach((idx) => removals.delete(idx));

  groups.forEach((group) => {
    if (group.cells.length !== 4) return;
    const pivot = chooseSpecialIndex(group.cells, swappedPair);
    const pivotCell = board[pivot];
    if (!pivotCell) return;
    removals.delete(pivot);
    const rocketType = swappedPair
      ? isHorizontalSwap(swappedPair, size) ? 'rocket-h' : 'rocket-v'
      : group.orientation === 'h' ? 'rocket-h' : 'rocket-v';
    upsertSpecialCreate(specialCreates, pivot, rocketType, pivotCell.color);
  });

  getMatchedComponents(board, groups, size).forEach((component) => {
    if (component.cells.length <= 4) return;
    const pivot = chooseSpecialIndex(component.cells, swappedPair);
    removals.delete(pivot);
    upsertSpecialCreate(specialCreates, pivot, 'bomb', component.color);
  });

  return { removals, specialCreates };
}

function getBlastArea(center: number, special: string, size = DEFAULT_SIZE) {
  const [row, col] = idxToPos(center, size);
  const targets = new Set<number>([center]);

  if (special === 'rocket-h') {
    for (let x = 0; x < size; x++) targets.add(posToIdx(row, x, size));
  } else if (special === 'rocket-v') {
    for (let y = 0; y < size; y++) targets.add(posToIdx(y, col, size));
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

function getBombRocketComboArea(center: number, size = DEFAULT_SIZE) {
  const [row, col] = idxToPos(center, size);
  const targets = new Set<number>();
  for (let nextRow = row - 1; nextRow <= row + 1; nextRow++) {
    if (nextRow < 0 || nextRow >= size) continue;
    for (let x = 0; x < size; x++) targets.add(posToIdx(nextRow, x, size));
  }
  for (let nextCol = col - 1; nextCol <= col + 1; nextCol++) {
    if (nextCol < 0 || nextCol >= size) continue;
    for (let y = 0; y < size; y++) targets.add(posToIdx(y, nextCol, size));
  }
  return targets;
}

function getRocketRocketComboArea(center: number, size = DEFAULT_SIZE) {
  const [row, col] = idxToPos(center, size);
  const targets = new Set<number>();
  for (let x = 0; x < size; x++) targets.add(posToIdx(row, x, size));
  for (let y = 0; y < size; y++) targets.add(posToIdx(y, col, size));
  return targets;
}

function collectSpecialBlast(board: Array<GameCell | null>, start: number, resultSet: Set<number>, size: number) {
  const queue = [start];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const idx = queue.shift();
    if (idx === undefined || visited.has(idx)) continue;
    visited.add(idx);

    const cell = board[idx];
    if (!cell?.special) continue;

    getBlastArea(idx, cell.special, size).forEach((next) => {
      if (!resultSet.has(next)) resultSet.add(next);
      if (board[next]?.special && !visited.has(next)) queue.push(next);
    });
  }
}

function applyRemoval(
  state: GameState,
  removals: Set<number>,
  specialCreates = new Map<number, { special: string; color: number }>(),
  options: { chainSpecials?: boolean; scoreMultiplier?: number } = {},
) {
  const chainSpecials = options.chainSpecials !== false;
  const scoreMultiplier = Math.max(0, Number(options.scoreMultiplier) || 1);
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
  state.score += Math.round(scoredCells * 10 * scoreMultiplier);
  updateClaps(state);
}

function applyGravityToState(state: GameState) {
  state.board = applyGravity(state.board, state.size, state.colorCount, makeRefillRng(state));
}

function findPotentialMove(board: Array<GameCell | null>, size = DEFAULT_SIZE) {
  for (let i = 0; i < board.length; i++) {
    const [row, col] = idxToPos(i, size);
    const neighbors: number[] = [];
    if (col + 1 < size) neighbors.push(posToIdx(row, col + 1, size));
    if (col - 1 >= 0) neighbors.push(posToIdx(row, col - 1, size));
    if (row + 1 < size) neighbors.push(posToIdx(row + 1, col, size));
    if (row - 1 >= 0) neighbors.push(posToIdx(row - 1, col, size));
    for (const neighbor of neighbors) {
      if (board[i]?.special) return { from: i, to: neighbor };
      if (canSwapMakeMatch(board, i, neighbor, size)) return { from: i, to: neighbor };
    }
  }
  return null;
}

function createBoard(size: number, colorCount: number, rng: () => number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const board: Array<GameCell | null> = Array.from({ length: size * size }, () => null);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        board[posToIdx(row, col, size)] = makeStableCell(board, row, col, size, colorCount, rng);
      }
    }
    if (findMatchGroups(board, size).length === 0 && findPotentialMove(board, size)) return board;
  }
  throw new Error('Unable to create a playable board');
}

function applyGravity(board: Array<GameCell | null>, size: number, colorCount: number, rng: () => number) {
  const next = cleanBoard(board);
  for (let col = 0; col < size; col++) {
    let write = size - 1;
    for (let row = size - 1; row >= 0; row--) {
      const idx = posToIdx(row, col, size);
      const cell = next[idx];
      if (cell !== null) {
        next[posToIdx(write, col, size)] = cloneCell(cell);
        if (write !== row) next[idx] = null;
        write--;
      }
    }
    while (write >= 0) {
      next[posToIdx(write, col, size)] = makeStableCell(next, write, col, size, colorCount, rng);
      write--;
    }
  }
  return next;
}

export function createInitialState(options: { seed: string; size?: number; colorCount?: number }): GameState {
  const size = options.size || DEFAULT_SIZE;
  const colorCount = options.colorCount || DEFAULT_COLORS;
  const seed = normalizeSeed(options.seed || 'vsesvoi');
  const board = createBoard(size, colorCount, createSeededRng(seed));
  return updateClaps({ board: cleanBoard(board), score: 0, clapsEarned: 0, movesCount: 0, size, colorCount, seed });
}

function makeRefillRng(state: GameState) {
  return createSeededRng(`${state.seed}:${state.movesCount}:${state.score}`);
}

function resolveCascades(state: GameState, swappedPair: [number, number] | null = null) {
  let combo = 0;
  let pair = swappedPair;
  while (true) {
    const groups = findMatchGroups(state.board, state.size);
    if (groups.length === 0) break;
    combo++;
    const firstSwap = pair && combo === 1 ? pair : null;
    const { removals, specialCreates } = buildMatchResolution(state.board, groups, firstSwap, new Set(), state.size);
    applyRemoval(state, removals, specialCreates);
    applyGravityToState(state);
    pair = null;
  }
  if (combo > 1) state.score += combo * 20;
  updateClaps(state);
}

function applySpecialMove(state: GameState, a: number, b: number) {
  if (a !== b) [state.board[a], state.board[b]] = [state.board[b], state.board[a]];

  const preserveIndices = new Set<number>();
  if (state.board[a]?.special) preserveIndices.add(a);
  if (b !== a && state.board[b]?.special) preserveIndices.add(b);

  const preGroups = findMatchGroups(state.board, state.size);
  if (preGroups.length > 0) {
    const { removals, specialCreates } = buildMatchResolution(state.board, preGroups, [a, b], preserveIndices, state.size);
    applyRemoval(state, removals, specialCreates, { chainSpecials: false });
  }

  const activations: Array<{ idx: number; special: string }> = [];
  if (state.board[a]?.special) activations.push({ idx: a, special: String(state.board[a]?.special) });
  if (b !== a && state.board[b]?.special) activations.push({ idx: b, special: String(state.board[b]?.special) });
  if (activations.length === 0) return;

  const hasBomb = activations.some((item) => item.special === 'bomb');
  const hasRocket = activations.some((item) => item.special === 'rocket-h' || item.special === 'rocket-v');
  const rocketCount = activations.filter((item) => item.special === 'rocket-h' || item.special === 'rocket-v').length;
  const bombCount = activations.filter((item) => item.special === 'bomb').length;

  let blast = new Set<number>();
  if (a !== b && activations.length === 2 && bombCount === 2) {
    for (let idx = 0; idx < state.size * state.size; idx++) blast.add(idx);
  } else if (a !== b && activations.length === 2 && rocketCount === 2) {
    blast = getRocketRocketComboArea(b, state.size);
  } else if (a !== b && activations.length === 2 && hasBomb && hasRocket) {
    blast = getBombRocketComboArea(b, state.size);
  } else {
    activations.forEach(({ idx, special }) => {
      getBlastArea(idx, special, state.size).forEach((target) => blast.add(target));
    });
  }

  applyRemoval(state, blast, new Map(), {
    chainSpecials: true,
    scoreMultiplier: a !== b && activations.length === 2 && bombCount === 2 ? 1.5 : 1,
  });
  applyGravityToState(state);
  resolveCascades(state);
}

function isOutOfRange(index: number, size: number) {
  return !Number.isInteger(index) || index < 0 || index >= size * size;
}

export function applyMove(inputState: GameState, move: GameMove): { accepted: boolean; reason: string | null; state: GameState } {
  const state = cloneState(inputState);
  const from = Math.floor(Number(move?.from));
  const to = Math.floor(Number(move?.to));
  if (isOutOfRange(from, state.size) || isOutOfRange(to, state.size)) return { accepted: false, reason: 'out_of_range', state };
  if (!areAdjacent(from, to, state.size)) return { accepted: false, reason: 'non_adjacent', state };

  if (state.board[from]?.special || state.board[to]?.special) {
    applySpecialMove(state, from, to);
    state.movesCount++;
    updateClaps(state);
    return { accepted: true, reason: null, state };
  }

  if (!canSwapMakeMatch(state.board, from, to, state.size)) return { accepted: false, reason: 'no_match', state };

  [state.board[from], state.board[to]] = [state.board[to], state.board[from]];
  resolveCascades(state, [from, to]);
  state.movesCount++;
  updateClaps(state);
  return { accepted: true, reason: null, state };
}

export function replayMoves(options: {
  seed: string;
  moves: GameMove[];
  size?: number;
  colorCount?: number;
}): GameState & { accepted: boolean; rejectReason: string | null; movesAttempted: number } {
  let state = createInitialState(options);
  const moves = Array.isArray(options.moves) ? options.moves : [];
  let movesAttempted = 0;
  for (const move of moves) {
    movesAttempted++;
    const result = applyMove(state, move);
    state = result.state;
    if (!result.accepted) return { ...state, accepted: false, rejectReason: result.reason, movesAttempted };
  }
  return { ...state, accepted: true, rejectReason: null, movesAttempted };
}
