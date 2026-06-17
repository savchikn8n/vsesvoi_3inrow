const assert = require('node:assert/strict');
const test = require('node:test');

const {
  chooseSpecialIndex,
  getBlastArea,
  getBombRocketComboArea,
  getRocketRocketComboArea,
} = require('../src/game/core/resolution-core.js');

function setValues(set) {
  return [...set].sort((a, b) => a - b);
}

test('rocket blast areas match current 7x7 rules', () => {
  assert.deepEqual(setValues(getBlastArea(24, 'rocket-h', 7)), [21, 22, 23, 24, 25, 26, 27]);
  assert.deepEqual(setValues(getBlastArea(24, 'rocket-v', 7)), [3, 10, 17, 24, 31, 38, 45]);
});

test('bomb blast area is a clipped 5x5 square', () => {
  assert.deepEqual(setValues(getBlastArea(0, 'bomb', 7)), [0, 1, 2, 7, 8, 9, 14, 15, 16]);
});

test('special combos match current target counts', () => {
  assert.equal(getBombRocketComboArea(24, 7).size, 33);
  assert.deepEqual(setValues(getRocketRocketComboArea(24, 7)), [
    3, 10, 17, 21, 22, 23, 24, 25, 26, 27, 31, 38, 45,
  ]);
});

test('chooseSpecialIndex prefers the swapped tile inside a match group', () => {
  assert.equal(chooseSpecialIndex([1, 2, 3, 4], [9, 3]), 3);
  assert.equal(chooseSpecialIndex([1, 2, 3, 4], [2, 9]), 2);
  assert.equal(chooseSpecialIndex([1, 2, 3, 4], null), 3);
});
