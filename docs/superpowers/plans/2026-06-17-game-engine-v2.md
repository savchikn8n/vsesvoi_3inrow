# Game Engine V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the match-3 game feel like a real polished mini-game while preserving every player's score, clap balance, profile, purchases, and gift codes.

**Architecture:** Extract the current game into tested pure modules first, then replace rendering and animation in small reversible steps. Progress writes stay behind the existing server endpoints and a narrow progress adapter; the new engine never writes player balances directly.

**Tech Stack:** Static browser app, plain JavaScript IIFE modules, Node `node:test`, Supabase Edge Functions, Telegram Mini App WebApp API.

---

## Non-Negotiable Safety Rules

1. Do not change the storage keys `gold_match_best_score`, `gold_match_claps_balance`, `gold_match_profile`, `gold_match_leaderboard_cache_v1`, `gold_match_runtime_config_cache_v1`, or `gold_match_seen_promo_ids_v1`.
2. Do not change existing Supabase tables that store player state: `profiles`, `shop_purchases`, analytics tables, feedback tables, broadcast tables.
3. Do not change gift IDs, gift prices, or the `purchase-gift` flow in this engine plan.
4. All clap spending stays server-authoritative through `spend-claps` and `purchase-gift`.
5. Score/clap earning sync stays through `score-submit`; the client may keep optimistic local state, but server response remains the source that can overwrite with `forceClapBalance: true`.
6. Keep the dashboard-controlled maintenance screen available for every production deploy that touches live gameplay.

## When To Enable Tech Pause

No tech pause is needed for writing tests, adding pure modules, or local-only verification.

Notify the owner and ask to enable Tech Pause before:

1. Deploying any change that modifies `index.html`, `game.js`, or new gameplay runtime files used by `index.html`.
2. Deploying animation/render changes that could leave the board non-interactive if a browser has cached assets oddly.
3. Deploying timer/scoring changes.

Suggested production gate:

1. Owner enables Tech Pause in dashboard.
2. Deploy frontend.
3. Verify `runtime-config` still returns maintenance enabled.
4. Smoke-test production with a known test account or local Telegram context.
5. Owner disables Tech Pause.

## Out Of Scope Until Mockup Arrives

Do not modify the "Подарки" tab, shop layout, gift catalog UI, discount tab, gift prices, or gift purchase copy in this plan. That work starts only after the owner provides the visual mockup.

## Current Code Map

- `game.js`: one large runtime file. It owns DOM refs, Telegram setup, board state, match rules, cascade logic, animations, sound, timer, auth, profile, shop, popups, feedback, analytics, and progress sync.
- `index.html`: loads `maintenance-config.js` and `game.js`, owns current DOM structure and templates.
- `styles.css`: owns board visuals, tile animation CSS, modals, start screen, shop, and maintenance screen.
- `supabase/functions/score-submit/index.ts`: verifies Telegram `initData`, stores max `best_score`, and stores max `clap_balance`.
- `supabase/functions/spend-claps/index.ts`: verifies Telegram `initData`, reads profile, subtracts clap balance for continue-run.
- `supabase/functions/purchase-gift/index.ts`: verifies Telegram `initData`, conditionally subtracts clap balance, inserts purchase, and rolls back balance if insert fails.

## Target File Structure

- Create: `src/game/core/board-core.js`
  - Pure board utilities: index math, cloning, stable cell creation, match scanning, possible move detection, shuffling, gravity.
- Create: `src/game/core/resolution-core.js`
  - Pure match resolution: special creation, blast areas, special combos, scoring result description.
- Create: `src/game/runtime/progress-adapter.js`
  - Small adapter for local progress merge and score-submit payload building. No fetch inside this module.
- Create: `tests/game-board-core.test.js`
  - Node tests for board utilities and match detection.
- Create: `tests/game-resolution-core.test.js`
  - Node tests for special creation, blast areas, and gravity/scoring effects.
- Create: `tests/progress-adapter.test.js`
  - Node tests for best score/clap merge rules.
- Modify: `index.html`
  - Add new script tags before `game.js` only after modules are ready and tests pass.
- Modify: `game.js`
  - Replace copied logic with calls into `window.VSGameCore`, `window.VSGameResolution`, and `window.VSProgressAdapter` step by step.
- Modify: `styles.css`
  - Later animation pass only, after core extraction is stable.

---

### Task 1: Extract Board Core With Tests

**Files:**
- Create: `src/game/core/board-core.js`
- Create: `tests/game-board-core.test.js`
- Modify: none in live runtime yet

- [ ] **Step 1: Write board core tests**

Create `tests/game-board-core.test.js`:

```js
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
  const board = Array.from({ length: 49 }, () => c(0));
  for (let i = 0; i < 49; i++) board[i] = c((i + Math.floor(i / 7)) % 4);
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
```

- [ ] **Step 2: Run tests and verify they fail because the module does not exist**

Run:

```bash
node --test tests/game-board-core.test.js
```

Expected: FAIL with `Cannot find module '../src/game/core/board-core.js'`.

- [ ] **Step 3: Implement the pure board module**

Create `src/game/core/board-core.js` as an IIFE/CommonJS compatible module:

```js
(function attachBoardCore(globalScope) {
  const DEFAULT_SIZE = 7;
  const DEFAULT_COLORS = 4;

  function randColor(colors = DEFAULT_COLORS, rng = Math.random) {
    return Math.floor(rng() * colors);
  }

  function makeCell(color = randColor(), special = null) {
    return { color, special };
  }

  function idxToPos(index, size = DEFAULT_SIZE) {
    return [Math.floor(index / size), index % size];
  }

  function posToIdx(r, c, size = DEFAULT_SIZE) {
    return r * size + c;
  }

  function areAdjacent(a, b, size = DEFAULT_SIZE) {
    const [ar, ac] = idxToPos(a, size);
    const [br, bc] = idxToPos(b, size);
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
  }

  function cloneBoard(src) {
    return src.map((cell) => (cell ? { color: cell.color, special: cell.special } : null));
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
    for (let p = 0; p < size; p++) {
      let run = [];
      for (let s = 0; s < size; s++) {
        const idx = cellIdx(p, s, horizontal, size);
        const cell = arr[idx];
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
        if (arr[prev] && cell.color === arr[prev].color) {
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

  function findMatchGroups(arr, size = DEFAULT_SIZE) {
    return [...scanLineGroups(arr, true, size), ...scanLineGroups(arr, false, size)];
  }

  function canSwapMakeMatch(arr, a, b, size = DEFAULT_SIZE) {
    const test = cloneBoard(arr);
    swapIn(test, a, b);
    return findMatchGroups(test, size).length > 0;
  }

  function findPotentialMove(arr, size = DEFAULT_SIZE) {
    for (let i = 0; i < arr.length; i++) {
      const [r, c] = idxToPos(i, size);
      const neighbors = [
        c < size - 1 ? posToIdx(r, c + 1, size) : null,
        r < size - 1 ? posToIdx(r + 1, c, size) : null,
      ].filter((x) => x !== null);
      for (const n of neighbors) {
        if (canSwapMakeMatch(arr, i, n, size)) return { from: i, to: n };
      }
    }
    return null;
  }

  function hasAnyMove(arr, size = DEFAULT_SIZE) {
    return Boolean(findPotentialMove(arr, size));
  }

  function applyGravity(board, options = {}) {
    const size = options.size || DEFAULT_SIZE;
    const makeNewCell = options.makeCell || (() => makeCell());
    const next = [...board];
    for (let c = 0; c < size; c++) {
      let write = size - 1;
      for (let r = size - 1; r >= 0; r--) {
        const idx = posToIdx(r, c, size);
        if (next[idx] !== null) {
          const moved = next[idx];
          moved._fall = Math.max(0, write - r);
          next[posToIdx(write, c, size)] = moved;
          if (write !== r) next[idx] = null;
          write--;
        }
      }
      while (write >= 0) {
        const spawned = makeNewCell(write, c);
        spawned._fall = write + 1;
        next[posToIdx(write, c, size)] = spawned;
        write--;
      }
    }
    return next;
  }

  const api = {
    DEFAULT_SIZE,
    DEFAULT_COLORS,
    randColor,
    makeCell,
    idxToPos,
    posToIdx,
    areAdjacent,
    cloneBoard,
    swapIn,
    scanLineGroups,
    findMatchGroups,
    canSwapMakeMatch,
    findPotentialMove,
    hasAnyMove,
    applyGravity,
  };

  globalScope.VSGameCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the board tests**

Run:

```bash
node --test tests/game-board-core.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/core/board-core.js tests/game-board-core.test.js
git commit -m "Extract tested board core"
```

---

### Task 2: Extract Progress Contract Before Touching Gameplay

**Files:**
- Create: `src/game/runtime/progress-adapter.js`
- Create: `tests/progress-adapter.test.js`
- Modify: none in live runtime yet

- [ ] **Step 1: Write progress adapter tests**

Create `tests/progress-adapter.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  mergeProfileProgress,
  buildScoreSubmitPayload,
  shouldSyncProgress,
} = require('../src/game/runtime/progress-adapter.js');

test('mergeProfileProgress never lowers local clap balance unless forced by server', () => {
  const local = { bestScore: 1200, clapBalance: 30 };
  const incoming = { best_score: 900, clap_balance: 12 };

  assert.deepEqual(mergeProfileProgress(local, incoming), {
    bestScore: 900,
    clapBalance: 30,
  });
  assert.deepEqual(mergeProfileProgress(local, incoming, { forceClapBalance: true }), {
    bestScore: 900,
    clapBalance: 12,
  });
});

test('shouldSyncProgress only syncs when best score or claps changed', () => {
  const profile = { best_score: 1000, clap_balance: 10 };
  assert.equal(shouldSyncProgress(profile, 900, 10, false, false), false);
  assert.equal(shouldSyncProgress(profile, 1001, 10, false, false), true);
  assert.equal(shouldSyncProgress(profile, 900, 11, false, false), true);
  assert.equal(shouldSyncProgress(profile, 900, 10, true, false), true);
  assert.equal(shouldSyncProgress(profile, 900, 10, false, true), true);
});

test('buildScoreSubmitPayload preserves existing score-submit shape', () => {
  assert.deepEqual(buildScoreSubmitPayload('tg-init', 1234, 56), {
    initData: 'tg-init',
    bestScore: 1234,
    clapBalance: 56,
  });
});
```

- [ ] **Step 2: Run tests and verify they fail because module does not exist**

Run:

```bash
node --test tests/progress-adapter.test.js
```

Expected: FAIL with `Cannot find module '../src/game/runtime/progress-adapter.js'`.

- [ ] **Step 3: Implement progress adapter**

Create `src/game/runtime/progress-adapter.js`:

```js
(function attachProgressAdapter(globalScope) {
  function toNonNegativeInt(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  function mergeProfileProgress(local, incoming, options = {}) {
    const forceClapBalance = Boolean(options.forceClapBalance);
    const incomingBest = toNonNegativeInt(incoming?.best_score);
    const incomingClaps = toNonNegativeInt(incoming?.clap_balance);
    const localClaps = toNonNegativeInt(local?.clapBalance);
    return {
      bestScore: incomingBest,
      clapBalance: forceClapBalance ? incomingClaps : Math.max(localClaps, incomingClaps),
    };
  }

  function shouldSyncProgress(profile, score, clapBalance, pendingBestScoreSync, pendingClapBalanceSync) {
    const localBest = Math.max(toNonNegativeInt(profile?.best_score), toNonNegativeInt(score));
    const localClaps = Math.max(toNonNegativeInt(profile?.clap_balance), toNonNegativeInt(clapBalance));
    const bestChanged = Boolean(pendingBestScoreSync) || localBest > toNonNegativeInt(profile?.best_score);
    const clapsChanged = Boolean(pendingClapBalanceSync) || localClaps > toNonNegativeInt(profile?.clap_balance);
    return bestChanged || clapsChanged;
  }

  function buildScoreSubmitPayload(initData, bestScore, clapBalance) {
    return {
      initData,
      bestScore: toNonNegativeInt(bestScore),
      clapBalance: toNonNegativeInt(clapBalance),
    };
  }

  const api = {
    toNonNegativeInt,
    mergeProfileProgress,
    shouldSyncProgress,
    buildScoreSubmitPayload,
  };

  globalScope.VSProgressAdapter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
node --test tests/progress-adapter.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/runtime/progress-adapter.js tests/progress-adapter.test.js
git commit -m "Add progress safety adapter"
```

---

### Task 3: Wire Pure Modules Into The Browser Without Behavior Changes

**Files:**
- Modify: `index.html`
- Modify: `game.js`

- [ ] **Step 1: Add browser scripts before `game.js`**

Modify the script section in `index.html`:

```html
<script src="maintenance-config.js"></script>
<script src="src/game/core/board-core.js"></script>
<script src="src/game/runtime/progress-adapter.js"></script>
<script src="game.js"></script>
```

- [ ] **Step 2: Replace low-risk wrappers in `game.js`**

Replace these functions with delegating wrappers:

```js
function idxToPos(index) {
  return window.VSGameCore.idxToPos(index, SIZE);
}

function posToIdx(r, c) {
  return window.VSGameCore.posToIdx(r, c, SIZE);
}

function areAdjacent(a, b) {
  return window.VSGameCore.areAdjacent(a, b, SIZE);
}

function cloneBoard(src = board) {
  return window.VSGameCore.cloneBoard(src);
}

function swapIn(arr, a, b) {
  return window.VSGameCore.swapIn(arr, a, b);
}
```

- [ ] **Step 3: Run syntax and unit tests**

Run:

```bash
node --test tests/game-board-core.test.js tests/progress-adapter.test.js
node --check game.js
```

Expected: PASS and no syntax output.

- [ ] **Step 4: Local smoke test**

Run:

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173/index.html`.

Expected:
- no console errors
- auth modal or start screen appears normally
- board renders after starting a game
- swapping two adjacent pieces still works

- [ ] **Step 5: Commit**

```bash
git add index.html game.js
git commit -m "Wire tested game core modules"
```

---

### Task 4: Extract Match Resolution And Special Rules

**Files:**
- Create: `src/game/core/resolution-core.js`
- Create: `tests/game-resolution-core.test.js`
- Modify: `index.html`
- Modify: `game.js`

- [ ] **Step 1: Write resolution tests**

Create `tests/game-resolution-core.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getBlastArea,
  getBombRocketComboArea,
  getRocketRocketComboArea,
  chooseSpecialIndex,
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
  assert.deepEqual(setValues(getRocketRocketComboArea(24, 7)), [3, 10, 17, 21, 22, 23, 24, 25, 26, 27, 31, 38, 45]);
});

test('chooseSpecialIndex prefers the swapped tile inside a match group', () => {
  assert.equal(chooseSpecialIndex([1, 2, 3, 4], [9, 3]), 3);
  assert.equal(chooseSpecialIndex([1, 2, 3, 4], [2, 9]), 2);
  assert.equal(chooseSpecialIndex([1, 2, 3, 4], null), 3);
});
```

- [ ] **Step 2: Run tests and verify they fail because the module does not exist**

Run:

```bash
node --test tests/game-resolution-core.test.js
```

Expected: FAIL with `Cannot find module '../src/game/core/resolution-core.js'`.

- [ ] **Step 3: Implement resolution module**

Create `src/game/core/resolution-core.js` with pure versions of `chooseSpecialIndex`, `getBlastArea`, `getBombRocketComboArea`, and `getRocketRocketComboArea`. The browser export must be:

```js
globalScope.VSGameResolution = {
  chooseSpecialIndex,
  getBlastArea,
  getBombRocketComboArea,
  getRocketRocketComboArea,
};
```

The CommonJS export must be the same object.

- [ ] **Step 4: Add script tag**

Modify `index.html`:

```html
<script src="src/game/core/board-core.js"></script>
<script src="src/game/core/resolution-core.js"></script>
<script src="src/game/runtime/progress-adapter.js"></script>
<script src="game.js"></script>
```

- [ ] **Step 5: Delegate matching special helpers in `game.js`**

Replace only these wrappers:

```js
function chooseSpecialIndex(cells, swappedPair) {
  return window.VSGameResolution.chooseSpecialIndex(cells, swappedPair);
}

function getBlastArea(center, special) {
  return window.VSGameResolution.getBlastArea(center, special, SIZE);
}

function getBombRocketComboArea(center) {
  return window.VSGameResolution.getBombRocketComboArea(center, SIZE);
}

function getRocketRocketComboArea(center) {
  return window.VSGameResolution.getRocketRocketComboArea(center, SIZE);
}
```

- [ ] **Step 6: Run tests and syntax checks**

Run:

```bash
node --test tests/game-board-core.test.js tests/game-resolution-core.test.js tests/progress-adapter.test.js
node --check game.js
```

Expected: PASS and no syntax output.

- [ ] **Step 7: Commit**

```bash
git add src/game/core/resolution-core.js tests/game-resolution-core.test.js index.html game.js
git commit -m "Extract tested match resolution helpers"
```

---

### Task 5: Production Gate For First Runtime Extraction Deploy

**Files:**
- No code change in this task

- [ ] **Step 1: Notify owner to enable Tech Pause**

Message:

```text
Пора включить Техпаузу: следующий деплой впервые подключает новые gameplay runtime-файлы к live-приложению. Данные игроков не мигрируем и не трогаем, но лучше закрыть вход на время выкладки и smoke-test.
```

- [ ] **Step 2: Verify maintenance is enabled**

Run:

```bash
curl -sS -X POST https://tnngitplssufqeqpxuib.supabase.co/functions/v1/runtime-config
```

Expected JSON contains:

```json
{"config":{"maintenance":{"enabled":true}}}
```

- [ ] **Step 3: Deploy frontend through the confirmed production channel**

Use the real production channel for this repo. If GitHub `main` is the production source:

```bash
git push origin main
```

If a Vercel project is linked locally later:

```bash
npx vercel deploy --prod --yes
```

Expected: deployment succeeds and returns the production URL or CI deployment passes.

- [ ] **Step 4: Smoke-test production while Tech Pause is on**

Expected:
- players see maintenance screen
- dashboard "Техпауза" tab still loads
- `runtime-config-admin` without secret still returns 403
- no console error from missing script files

- [ ] **Step 5: Ask owner to disable Tech Pause after verification**

Message:

```text
Можно выключать Техпаузу: деплой проверен, игра грузится, новые runtime-файлы доступны, ошибок в консоли нет.
```

---

### Task 6: Replace Board Rendering With A Stable Renderer

**Files:**
- Create: `src/game/runtime/board-renderer.js`
- Create: `tests/board-renderer-contract.test.js`
- Modify: `index.html`
- Modify: `game.js`
- Modify: `styles.css`

- [ ] **Step 1: Write renderer contract tests**

Create `tests/board-renderer-contract.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  tileClassListForCell,
  boardRenderModel,
} = require('../src/game/runtime/board-renderer.js');

test('tileClassListForCell preserves current class contract', () => {
  assert.deepEqual(tileClassListForCell({ color: 2, special: null }, {}), ['type-2']);
  assert.deepEqual(tileClassListForCell({ color: 1, special: 'bomb' }, { falling: true }), ['type-1', 'special-bomb', 'falling']);
  assert.deepEqual(tileClassListForCell(null, {}), ['empty']);
});

test('boardRenderModel marks selected, match, blast, and hint classes', () => {
  const board = [{ color: 0, special: null }, { color: 1, special: null }];
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
```

- [ ] **Step 2: Implement renderer contract module**

Create `src/game/runtime/board-renderer.js` that exports:

```js
{
  tileClassListForCell,
  boardRenderModel,
  renderBoardDom
}
```

`renderBoardDom` must accept explicit dependencies:

```js
renderBoardDom({
  boardEl,
  tileTemplate,
  board,
  selected,
  highlight,
  blast,
  hintMove,
  locked,
  directionClass,
  onTileClick,
  onTilePointerDown,
  onTilePointerMove,
  onTilePointerEnd,
});
```

- [ ] **Step 3: Wire renderer into `index.html`**

Add before `game.js`:

```html
<script src="src/game/runtime/board-renderer.js"></script>
```

- [ ] **Step 4: Replace `drawBoard` body in `game.js`**

Keep the function name `drawBoard` but delegate rendering:

```js
function drawBoard(highlight = new Set(), blast = new Set()) {
  window.VSBoardRenderer.renderBoardDom({
    boardEl,
    tileTemplate: tileTpl,
    board,
    selected,
    highlight,
    blast,
    hintMove,
    locked,
    directionClass,
    onTileClick,
    onTilePointerDown,
    onTilePointerMove,
    onTilePointerEnd,
  });

  board.forEach((cell) => {
    if (cell && cell._fall) delete cell._fall;
  });

  syncEffectsLayer();
}
```

- [ ] **Step 5: Run tests and local smoke**

Run:

```bash
node --test tests/game-board-core.test.js tests/game-resolution-core.test.js tests/progress-adapter.test.js tests/board-renderer-contract.test.js
node --check game.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/runtime/board-renderer.js tests/board-renderer-contract.test.js index.html game.js
git commit -m "Extract board renderer contract"
```

---

### Task 7: Animation Quality Pass Without Rule Changes

**Files:**
- Modify: `styles.css`
- Modify: `game.js`

- [ ] **Step 1: Define animation budget**

Use this contract:

```js
const ANIMATION_TIMINGS = Object.freeze({
  swapMs: 180,
  invalidSwapMs: 220,
  matchPopMs: 260,
  gravityMs: 320,
  cascadePauseMs: 120,
  specialBlastMs: 340,
  megaBombMs: 430,
});
```

- [ ] **Step 2: Replace hard-coded cascade waits**

In `resolveCascades`, replace:

```js
await interruptibleDelay(420, sessionId)
await interruptibleDelay(240, sessionId)
```

with:

```js
await interruptibleDelay(ANIMATION_TIMINGS.matchPopMs + ANIMATION_TIMINGS.cascadePauseMs, sessionId)
await interruptibleDelay(ANIMATION_TIMINGS.cascadePauseMs, sessionId)
```

- [ ] **Step 3: Keep game speed by capping total cascade wait**

Add helper:

```js
function cascadeDelay(combo) {
  const base = ANIMATION_TIMINGS.matchPopMs + ANIMATION_TIMINGS.cascadePauseMs;
  return Math.max(180, base - Math.min(combo - 1, 3) * 35);
}
```

Use:

```js
if (!(await interruptibleDelay(cascadeDelay(combo), sessionId))) return false;
```

- [ ] **Step 4: CSS polish**

In `styles.css`, adjust only existing classes:

```css
.tile.falling .gem {
  animation: tile-fall var(--tile-fall-ms, 320ms) cubic-bezier(0.18, 0.78, 0.24, 1) both;
}

.tile.match {
  animation: pop-hit 260ms cubic-bezier(0.2, 0.82, 0.22, 1);
}

.tile.blast {
  animation: blast 340ms cubic-bezier(0.2, 0.82, 0.22, 1);
}
```

- [ ] **Step 5: Verify no scoring/progress files changed**

Run:

```bash
git diff --name-only
```

Expected changed files only include:

```text
game.js
styles.css
```

- [ ] **Step 6: Commit**

```bash
git add game.js styles.css
git commit -m "Polish game animation timings"
```

---

### Task 8: Pre-Release Verification Checklist

**Files:**
- No code change in this task

- [ ] **Step 1: Unit checks**

Run:

```bash
node --test tests/*.test.js
node --check game.js
node --check dashboard.js
node --check maintenance-config.js
```

Expected: all tests pass and syntax checks print no errors.

- [ ] **Step 2: Diff safety check**

Run:

```bash
git diff --check
git diff --name-only
```

Expected:
- no whitespace errors
- no gift UI files changed unless owner provided the mockup in a later scope
- no SQL files changed for `profiles` or `shop_purchases`

- [ ] **Step 3: Local gameplay smoke**

Run:

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173/index.html`.

Expected:
- start/auth flow appears
- board renders
- valid swaps resolve
- invalid swaps return
- timer counts down
- timeout modal appears
- no console errors

- [ ] **Step 4: Production deploy with Tech Pause**

Follow Task 5.

---

## Self-Review

Spec coverage:
- Safe progress preservation is covered by Non-Negotiable Safety Rules, Task 2, and Task 8.
- Engine redesign is covered by Tasks 1, 3, 4, 6, and 7.
- Tech Pause notification is covered by Task 5.
- Gift tab freeze is covered by Out Of Scope Until Mockup Arrives and Task 8.

Placeholder scan:
- The plan avoids empty markers and open-ended implementation steps.
- The only production-channel branch in Task 5 is explicit: use GitHub `main` if that is the confirmed production source, or Vercel only after a real local project link exists.

Type consistency:
- Browser globals use `window.VSGameCore`, `window.VSGameResolution`, `window.VSProgressAdapter`, and `window.VSBoardRenderer`.
- Test imports use matching CommonJS exports from the same files.
