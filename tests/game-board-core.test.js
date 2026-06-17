const assert = require('node:assert/strict');
const test = require('node:test');

const {
  idxToPos,
  posToIdx,
  areAdjacent,
  cloneBoard,
  swapIn,
  scanLineGroups,
  findMatchGroups,
  applyGravity,
  hasAnyMove,
} = require('../src/game/core/board-core.js');

function c(color, special = null) {
  return { color, special };
}

test('index math and adjacency match the current 7x7 board contract', () => {
  assert.deepEqual(idxToPos(0, 7), [0, 0]);
  assert.deepEqual(idxToPos(8, 7), [1, 1]);
  assert.equal(posToIdx(6, 6, 7), 48);
  assert.equal(areAdjacent(0, 1, 7), true);
  assert.equal(areAdjacent(0, 7, 7), true);
  assert.equal(areAdjacent(0, 8, 7), false);
});

test('cloneBoard creates independent cell objects and swapIn mutates only the target board', () => {
  const board = [c(0), c(1), null];
  const copy = cloneBoard(board);
  copy[0].color = 3;
  swapIn(copy, 0, 1);

  assert.equal(board[0].color, 0);
  assert.equal(board[1].color, 1);
  assert.equal(copy[0].color, 1);
  assert.equal(copy[1].color, 3);
});

test('findMatchGroups detects horizontal and vertical runs but breaks on specials', () => {
  const board = Array.from({ length: 49 }, (_, i) => c((i + Math.floor(i / 7)) % 4));
  board[0] = c(2);
  board[1] = c(2);
  board[2] = c(2);
  board[7] = c(1);
  board[14] = c(1);
  board[21] = c(1);
  board[30] = c(3);
  board[31] = c(3, 'bomb');
  board[32] = c(3);

  const groups = findMatchGroups(board, 7);
  assert.equal(groups.some((group) => group.orientation === 'h' && group.cells.join(',') === '0,1,2'), true);
  assert.equal(groups.some((group) => group.orientation === 'v' && group.cells.join(',') === '7,14,21'), true);
  assert.equal(groups.some((group) => group.cells.includes(31)), false);
});

test('scanLineGroups reports only runs of three or more', () => {
  const board = [
    c(0), c(0), c(1), c(1), c(1), c(2), c(2),
    c(1), c(2), c(3), c(0), c(1), c(2), c(3),
    c(2), c(3), c(0), c(1), c(2), c(3), c(0),
    c(3), c(0), c(1), c(2), c(3), c(0), c(1),
    c(0), c(1), c(2), c(3), c(0), c(1), c(2),
    c(1), c(2), c(3), c(0), c(1), c(2), c(3),
    c(2), c(3), c(0), c(1), c(2), c(3), c(0),
  ];

  assert.deepEqual(scanLineGroups(board, true, 7), [{ cells: [2, 3, 4], orientation: 'h' }]);
});

test('applyGravity compacts cells downward and marks fall distance without changing colors', () => {
  const board = Array.from({ length: 49 }, () => null);
  board[posToIdx(0, 0, 7)] = c(1);
  board[posToIdx(3, 0, 7)] = c(2);
  const next = applyGravity(board, {
    size: 7,
    makeCell: () => c(9),
  });

  assert.equal(next[posToIdx(6, 0, 7)].color, 2);
  assert.equal(next[posToIdx(5, 0, 7)].color, 1);
  assert.equal(next[posToIdx(6, 0, 7)]._fall, 3);
  assert.equal(next[posToIdx(5, 0, 7)]._fall, 5);
});

test('hasAnyMove returns true for a board with at least one legal swap', () => {
  const board = [
    c(0), c(1), c(0), c(2), c(3), c(1), c(2),
    c(1), c(0), c(2), c(3), c(1), c(2), c(3),
    c(0), c(2), c(1), c(0), c(2), c(3), c(1),
    c(2), c(3), c(0), c(1), c(3), c(0), c(2),
    c(3), c(0), c(1), c(2), c(0), c(1), c(3),
    c(1), c(2), c(3), c(0), c(1), c(2), c(0),
    c(2), c(3), c(1), c(3), c(2), c(0), c(1),
  ];

  assert.equal(hasAnyMove(board, 7), true);
});
