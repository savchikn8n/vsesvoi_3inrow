const assert = require('node:assert/strict');
const test = require('node:test');

const {
  boardRenderModel,
  renderBoardDom,
  tileClassListForCell,
} = require('../src/game/runtime/board-renderer.js');

function c(color, special = null, extra = {}) {
  return { color, special, ...extra };
}

class FakeClassList {
  constructor() {
    this.values = [];
  }

  add(...classes) {
    this.values.push(...classes);
  }

  includes(className) {
    return this.values.includes(className);
  }
}

class FakeTile {
  constructor() {
    this.classList = new FakeClassList();
    this.dataset = {};
    this.listeners = {};
    this.styleValues = {};
    this.style = {
      setProperty: (name, value) => {
        this.styleValues[name] = value;
      },
    };
  }

  cloneNode() {
    return new FakeTile();
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

class FakeBoard {
  constructor() {
    this.children = [];
  }

  set innerHTML(value) {
    this.clearedWith = value;
    this.children = [];
  }

  appendChild(node) {
    this.children.push(node);
  }
}

test('tileClassListForCell preserves current class contract', () => {
  assert.deepEqual(tileClassListForCell(c(2), {}), ['type-2']);
  assert.deepEqual(tileClassListForCell(c(1, 'bomb'), { falling: true }), [
    'type-1',
    'special-bomb',
    'falling',
  ]);
  assert.deepEqual(tileClassListForCell(null, {}), ['empty']);
});

test('boardRenderModel marks selected, match, blast, and hint classes', () => {
  const board = [c(0), c(1)];
  const model = boardRenderModel(board, {
    selected: 0,
    highlight: new Set([1]),
    blast: new Set([1]),
    hintMove: { from: 0, to: 1 },
    locked: false,
    directionClass: () => 'hint-right',
  });

  assert.deepEqual(model[0].classes, ['type-0', 'selected', 'hint-source', 'hint-right']);
  assert.deepEqual(model[1].classes, ['type-1', 'match', 'blast', 'hint-target']);
});

test('boardRenderModel suppresses hints while locked and carries fall distance', () => {
  const model = boardRenderModel([c(3, 'rocket-h', { _fall: 2 })], {
    hintMove: { from: 0, to: 1 },
    locked: true,
    directionClass: () => 'hint-right',
  });

  assert.deepEqual(model[0].classes, ['type-3', 'special-rocket-h', 'falling']);
  assert.equal(model[0].fallDistance, 2);
});

test('boardRenderModel exposes tile position variables for motion choreography', () => {
  const model = boardRenderModel(Array.from({ length: 49 }, (_, index) => c(index % 4)));

  assert.deepEqual(
    model.map((item) => ({
      index: item.index,
      row: item.row,
      col: item.col,
      popDelayMs: item.popDelayMs,
      dropDelayMs: item.dropDelayMs,
    })).slice(0, 9),
    [
      { index: 0, row: 0, col: 0, popDelayMs: 0, dropDelayMs: 0 },
      { index: 1, row: 0, col: 1, popDelayMs: 8, dropDelayMs: 6 },
      { index: 2, row: 0, col: 2, popDelayMs: 16, dropDelayMs: 12 },
      { index: 3, row: 0, col: 3, popDelayMs: 24, dropDelayMs: 18 },
      { index: 4, row: 0, col: 4, popDelayMs: 32, dropDelayMs: 24 },
      { index: 5, row: 0, col: 5, popDelayMs: 40, dropDelayMs: 30 },
      { index: 6, row: 0, col: 6, popDelayMs: 48, dropDelayMs: 36 },
      { index: 7, row: 1, col: 0, popDelayMs: 8, dropDelayMs: 0 },
      { index: 8, row: 1, col: 1, popDelayMs: 16, dropDelayMs: 6 },
    ],
  );
});

test('renderBoardDom creates tiles with classes, data-index, styles, and handlers', () => {
  const boardEl = new FakeBoard();
  const tileTemplate = {
    content: {
      firstElementChild: new FakeTile(),
    },
  };
  const handlers = {
    onTileClick() {},
    onTilePointerDown() {},
    onTilePointerMove() {},
    onTilePointerEnd() {},
  };

  const model = renderBoardDom({
    boardEl,
    tileTemplate,
    board: [c(0), null, c(1, 'bomb', { _fall: 3 })],
    selected: 0,
    highlight: new Set([2]),
    blast: new Set([2]),
    hintMove: { from: 0, to: 2 },
    locked: false,
    directionClass: () => 'hint-right',
    ...handlers,
  });

  assert.equal(boardEl.clearedWith, '');
  assert.equal(boardEl.children.length, 3);
  assert.deepEqual(model.map((item) => item.index), [0, 1, 2]);

  assert.deepEqual(boardEl.children[0].classList.values, [
    'type-0',
    'selected',
    'hint-source',
    'hint-right',
  ]);
  assert.deepEqual(boardEl.children[1].classList.values, ['empty']);
  assert.deepEqual(boardEl.children[2].classList.values, [
    'type-1',
    'special-bomb',
    'falling',
    'match',
    'blast',
    'hint-target',
  ]);
  assert.equal(boardEl.children[2].styleValues['--fall-distance'], '3');
  assert.equal(boardEl.children[2].styleValues['--tile-row'], '0');
  assert.equal(boardEl.children[2].styleValues['--tile-col'], '2');
  assert.equal(boardEl.children[2].styleValues['--tile-pop-delay'], '16ms');
  assert.equal(boardEl.children[2].styleValues['--tile-drop-delay'], '12ms');
  assert.equal(boardEl.children[2].dataset.index, '2');
  assert.equal(boardEl.children[2].listeners.click, handlers.onTileClick);
  assert.equal(boardEl.children[2].listeners.pointercancel, handlers.onTilePointerEnd);
});
