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

function resolveCascades(state: GameState) {
  let combo = 0;
  while (true) {
    const groups = findMatchGroups(state.board, state.size);
    if (groups.length === 0) break;
    combo++;
    const removals = new Set<number>();
    groups.forEach((group) => group.cells.forEach((idx) => removals.add(idx)));
    removals.forEach((idx) => {
      state.board[idx] = null;
    });
    state.score += removals.size * 10;
    state.board = applyGravity(state.board, state.size, state.colorCount, makeRefillRng(state));
  }
  if (combo > 1) state.score += combo * 20;
  updateClaps(state);
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
  if (!canSwapMakeMatch(state.board, from, to, state.size)) return { accepted: false, reason: 'no_match', state };

  [state.board[from], state.board[to]] = [state.board[to], state.board[from]];
  resolveCascades(state);
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
