const SIZE = 7;
const COLORS = 4;
const TURN_SECONDS = 7;
const HINT_THRESHOLD_SECONDS = 3;

const boardEl = document.getElementById('board');
const boardWrapEl = document.querySelector('.board-wrap');
const effectsLayerEl = document.getElementById('effects-layer');
const scoreEl = document.getElementById('score');
const timerEl = document.getElementById('timer');
const restartBtn = document.getElementById('restart');
const statusEl = document.getElementById('status');
const tileTpl = document.getElementById('tile-template');
const gameOverModalEl = document.getElementById('game-over-modal');
const settingsModalEl = document.getElementById('settings-modal');
const finalScoreEl = document.getElementById('final-score');
const menuNewGameBtn = document.getElementById('menu-new-game');
const menuBookTableBtn = document.getElementById('menu-book-table');
const menuSettingsBtn = document.getElementById('menu-settings');
const soundToggleBtn = document.getElementById('sound-toggle');
const devChannelBtn = document.getElementById('dev-channel');
const settingsCloseBtn = document.getElementById('settings-close');

let board = [];
let score = 0;
let selected = null;
let locked = false;

let turnSecondsLeft = TURN_SECONDS;
let turnTimerId = null;
let hintShownThisTurn = false;
let hintMove = null;
let soundEnabled = true;
let audioCtx = null;
let swipeGesture = null;
let suppressClickUntil = 0;
let touchInsideBoard = false;

function setupTelegramWebApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  tg.ready();
  tg.expand();

  if (typeof tg.disableVerticalSwipes === 'function') {
    tg.disableVerticalSwipes();
  }
}

function setupTouchGuards() {
  if (!boardWrapEl) return;

  const isInsideBoard = (target) =>
    boardWrapEl.contains(target) || boardEl.contains(target) || effectsLayerEl?.contains(target);

  const onTouchStart = (e) => {
    touchInsideBoard = isInsideBoard(e.target);
    if (touchInsideBoard) {
      e.preventDefault();
    }
  };

  const onTouchMove = (e) => {
    if (touchInsideBoard || isInsideBoard(e.target)) {
      e.preventDefault();
    }
  };

  const onTouchEnd = (e) => {
    if (touchInsideBoard || isInsideBoard(e.target)) {
      e.preventDefault();
    }
    touchInsideBoard = false;
  };

  boardWrapEl.addEventListener('touchstart', onTouchStart, { passive: false });
  boardWrapEl.addEventListener('touchmove', onTouchMove, { passive: false });
  boardWrapEl.addEventListener('touchend', onTouchEnd, { passive: false });
  boardWrapEl.addEventListener('touchcancel', onTouchEnd, { passive: false });
}

function randColor() {
  return Math.floor(Math.random() * COLORS);
}

function makeCell(color = randColor(), special = null) {
  return { color, special };
}

function idxToPos(index) {
  return [Math.floor(index / SIZE), index % SIZE];
}

function posToIdx(r, c) {
  return r * SIZE + c;
}

function areAdjacent(a, b) {
  const [ar, ac] = idxToPos(a);
  const [br, bc] = idxToPos(b);
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

function isHorizontalSwap([a, b]) {
  const [ar] = idxToPos(a);
  const [br] = idxToPos(b);
  return ar === br;
}

function cloneBoard(src = board) {
  return src.map((cell) => (cell ? { ...cell } : null));
}

function swapIn(arr, a, b) {
  [arr[a], arr[b]] = [arr[b], arr[a]];
}

function hasSpecial(index) {
  return Boolean(board[index]?.special);
}

function createBoard() {
  do {
    board = Array.from({ length: SIZE * SIZE }, () => makeCell());
  } while (findMatchGroups(board).length > 0 || !hasAnyMove(board));
}

function directionClass(from, to) {
  const [fr, fc] = idxToPos(from);
  const [tr, tc] = idxToPos(to);
  if (fr === tr) return tc > fc ? 'hint-right' : 'hint-left';
  return tr > fr ? 'hint-down' : 'hint-up';
}

function updateHud() {
  scoreEl.textContent = String(score);
  timerEl.textContent = String(turnSecondsLeft);
  timerEl.classList.toggle('warning', turnSecondsLeft <= HINT_THRESHOLD_SECONDS);
}

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new window.AudioContext();
  }
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.03) {
  if (!soundEnabled) return;
  const ctx = ensureAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function playInvalidSound() {
  playTone(170, 0.12, 'sawtooth', 0.028);
}

function playSwapSound() {
  playTone(360, 0.08, 'triangle', 0.022);
}

function playMatchSound() {
  playTone(520, 0.12, 'sine', 0.028);
}

function updateSoundToggleLabel() {
  soundToggleBtn.textContent = soundEnabled ? 'Включен' : 'Выключен';
}

function showModal(el) {
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
}

function hideModal(el) {
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
}

function closeAllModals() {
  hideModal(gameOverModalEl);
  hideModal(settingsModalEl);
}

function clearHint() {
  hintMove = null;
}

function drawBoard(highlight = new Set(), blast = new Set()) {
  boardEl.innerHTML = '';

  let hintDir = '';
  if (hintMove) {
    hintDir = directionClass(hintMove.from, hintMove.to);
  }

  board.forEach((cell, index) => {
    const tile = tileTpl.content.firstElementChild.cloneNode(true);
    if (cell) {
      tile.classList.add(`type-${cell.color}`);
      if (cell.special) tile.classList.add(`special-${cell.special}`);
    } else {
      tile.classList.add('empty');
    }
    tile.dataset.index = index;

    if (selected === index) tile.classList.add('selected');
    if (highlight.has(index)) tile.classList.add('match');
    if (blast.has(index)) tile.classList.add('blast');

    if (!locked && hintMove) {
      if (index === hintMove.from) {
        tile.classList.add('hint-source', hintDir);
      } else if (index === hintMove.to) {
        tile.classList.add('hint-target');
      }
    }

    tile.addEventListener('click', onTileClick);
    tile.addEventListener('pointerdown', onTilePointerDown);
    tile.addEventListener('pointermove', onTilePointerMove);
    tile.addEventListener('pointerup', onTilePointerEnd);
    tile.addEventListener('pointercancel', onTilePointerEnd);
    boardEl.appendChild(tile);
  });

  syncEffectsLayer();
  updateHud();
}

function getTile(index) {
  return boardEl.querySelector(`.tile[data-index="${index}"]`);
}

function syncEffectsLayer() {
  if (!effectsLayerEl) return;
  effectsLayerEl.style.left = `${boardEl.offsetLeft}px`;
  effectsLayerEl.style.top = `${boardEl.offsetTop}px`;
  effectsLayerEl.style.width = `${boardEl.clientWidth}px`;
  effectsLayerEl.style.height = `${boardEl.clientHeight}px`;
}

function spawnFlashEffect(x, y) {
  if (!effectsLayerEl) return;
  const flash = document.createElement('div');
  flash.className = 'effect-flash';
  flash.style.left = `${x}px`;
  flash.style.top = `${y}px`;
  effectsLayerEl.appendChild(flash);
  setTimeout(() => flash.remove(), 260);
}

function spawnRocketEffect(index, special) {
  if (!effectsLayerEl) return;
  const tile = getTile(index);
  if (!tile) return;

  const boardRect = boardEl.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const cx = tileRect.left - boardRect.left + tileRect.width / 2;
  const cy = tileRect.top - boardRect.top + tileRect.height / 2;

  const beam = document.createElement('div');
  const horizontal = special === 'rocket-h';
  beam.className = `effect-rocket ${horizontal ? 'h' : 'v'}`;

  if (horizontal) {
    beam.style.left = '0px';
    beam.style.top = `${cy - 4}px`;
    beam.style.width = `${boardRect.width}px`;
    beam.style.height = '8px';
  } else {
    beam.style.left = `${cx - 4}px`;
    beam.style.top = '0px';
    beam.style.width = '8px';
    beam.style.height = `${boardRect.height}px`;
  }

  effectsLayerEl.appendChild(beam);
  spawnFlashEffect(cx, cy);
  setTimeout(() => beam.remove(), 360);
}

function spawnBombEffect(index) {
  if (!effectsLayerEl) return;
  const tile = getTile(index);
  if (!tile) return;

  const boardRect = boardEl.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const cx = tileRect.left - boardRect.left + tileRect.width / 2;
  const cy = tileRect.top - boardRect.top + tileRect.height / 2;
  const waveSize = tileRect.width * 5;

  const wave = document.createElement('div');
  wave.className = 'effect-bomb';
  wave.style.left = `${cx}px`;
  wave.style.top = `${cy}px`;
  wave.style.width = `${waveSize}px`;
  wave.style.height = `${waveSize}px`;
  effectsLayerEl.appendChild(wave);
  spawnFlashEffect(cx, cy);
  setTimeout(() => wave.remove(), 460);
}

function emitSpecialEffects(specials) {
  if (!specials.length) return;
  syncEffectsLayer();
  specials.forEach(({ idx, special }) => {
    if (special === 'bomb') {
      spawnBombEffect(idx);
      return;
    }
    if (special === 'rocket-h' || special === 'rocket-v') {
      spawnRocketEffect(idx, special);
    }
  });
}

function makeGhostFromTile(tile) {
  const ghost = tile.cloneNode(true);
  ghost.classList.remove(
    'selected',
    'match',
    'blast',
    'invalid',
    'hint-source',
    'hint-target',
    'hint-right',
    'hint-left',
    'hint-up',
    'hint-down',
  );
  ghost.classList.add('ghost-tile');
  return ghost;
}

async function animateSwap(a, b, valid) {
  const t1 = getTile(a);
  const t2 = getTile(b);
  if (!t1 || !t2) return;

  const boardRect = boardEl.getBoundingClientRect();
  const r1 = t1.getBoundingClientRect();
  const r2 = t2.getBoundingClientRect();

  const g1 = makeGhostFromTile(t1);
  const g2 = makeGhostFromTile(t2);

  g1.style.left = `${r1.left - boardRect.left}px`;
  g1.style.top = `${r1.top - boardRect.top}px`;
  g2.style.left = `${r2.left - boardRect.left}px`;
  g2.style.top = `${r2.top - boardRect.top}px`;

  boardEl.append(g1, g2);
  t1.style.visibility = 'hidden';
  t2.style.visibility = 'hidden';

  const dx = r2.left - r1.left;
  const dy = r2.top - r1.top;

  const ease = 'cubic-bezier(0.22, 0.8, 0.2, 1)';
  const key1 = valid
    ? [{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px, ${dy}px)` }]
    : [
        { transform: 'translate(0,0)' },
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0,0)' },
      ];
  const key2 = valid
    ? [{ transform: 'translate(0,0)' }, { transform: `translate(${-dx}px, ${-dy}px)` }]
    : [
        { transform: 'translate(0,0)' },
        { transform: `translate(${-dx}px, ${-dy}px)` },
        { transform: 'translate(0,0)' },
      ];

  const duration = valid ? 210 : 320;
  const a1 = g1.animate(key1, { duration, easing: ease, fill: 'forwards' });
  const a2 = g2.animate(key2, { duration, easing: ease, fill: 'forwards' });

  await Promise.all([a1.finished, a2.finished]);

  g1.remove();
  g2.remove();
  t1.style.visibility = '';
  t2.style.visibility = '';

  if (!valid) {
    t1.classList.add('invalid');
    t2.classList.add('invalid');
    playInvalidSound();
    await delay(330);
  }
}

function onTileClick(e) {
  if (Date.now() < suppressClickUntil) return;
  if (locked) return;

  const index = Number(e.currentTarget.dataset.index);

  if (selected === null) {
    selected = index;
    clearHint();
    drawBoard();
    return;
  }

  if (selected === index) {
    if (hasSpecial(index)) {
      activateSpecialMove(index, index);
      return;
    }
    selected = null;
    drawBoard();
    return;
  }

  if (!areAdjacent(selected, index)) {
    selected = index;
    clearHint();
    drawBoard();
    return;
  }

  trySwap(selected, index);
}

function swipeTarget(fromIndex, dx, dy) {
  const [r, c] = idxToPos(fromIndex);
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  if (horizontal) {
    const nc = dx > 0 ? c + 1 : c - 1;
    if (nc < 0 || nc >= SIZE) return null;
    return posToIdx(r, nc);
  }

  const nr = dy > 0 ? r + 1 : r - 1;
  if (nr < 0 || nr >= SIZE) return null;
  return posToIdx(nr, c);
}

function onTilePointerDown(e) {
  if (locked) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  const index = Number(e.currentTarget.dataset.index);
  swipeGesture = {
    pointerId: e.pointerId,
    fromIndex: index,
    startX: e.clientX,
    startY: e.clientY,
    finished: false,
  };

  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch (_) {
    // no-op
  }
}

function onTilePointerMove(e) {
  if (!swipeGesture || swipeGesture.finished) return;
  if (swipeGesture.pointerId !== e.pointerId) return;
  if (locked) return;

  const dx = e.clientX - swipeGesture.startX;
  const dy = e.clientY - swipeGesture.startY;
  if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;

  const target = swipeTarget(swipeGesture.fromIndex, dx, dy);
  swipeGesture.finished = true;
  suppressClickUntil = Date.now() + 380;

  if (target === null) return;

  selected = null;
  clearHint();
  drawBoard();
  trySwap(swipeGesture.fromIndex, target);
}

function onTilePointerEnd(e) {
  if (!swipeGesture) return;
  if (swipeGesture.pointerId !== e.pointerId) return;
  swipeGesture = null;
}

function cellIdx(primary, secondary, horizontal) {
  return horizontal ? posToIdx(primary, secondary) : posToIdx(secondary, primary);
}

function scanLineGroups(arr, horizontal) {
  const groups = [];

  for (let p = 0; p < SIZE; p++) {
    let run = [];
    for (let s = 0; s < SIZE; s++) {
      const idx = cellIdx(p, s, horizontal);
      const cell = arr[idx];

      if (!cell) {
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

function findMatchGroups(arr = board) {
  return [...scanLineGroups(arr, true), ...scanLineGroups(arr, false)];
}

function chooseSpecialIndex(cells, swappedPair) {
  if (!swappedPair) return cells[Math.floor(cells.length / 2)];
  const [a, b] = swappedPair;
  if (cells.includes(a)) return a;
  if (cells.includes(b)) return b;
  return cells[Math.floor(cells.length / 2)];
}

function upsertSpecialCreate(map, idx, special, color) {
  const existing = map.get(idx);
  if (!existing || (existing.special !== 'bomb' && special === 'bomb')) {
    map.set(idx, { special, color });
  }
}

function getMatchedComponents(groups) {
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
      const [r, c] = idxToPos(idx);
      const neighbors = [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ];

      neighbors.forEach(([nr, nc]) => {
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return;
        const nIdx = posToIdx(nr, nc);
        if (visited.has(nIdx) || !matchedSet.has(nIdx)) return;
        if (board[nIdx]?.color !== color) return;
        visited.add(nIdx);
        queue.push(nIdx);
      });
    }

    components.push({ color, cells });
  });

  return components;
}

function collectSpecialBlast(start, resultSet) {
  const queue = [start];
  const visited = new Set();

  while (queue.length > 0) {
    const idx = queue.shift();
    if (visited.has(idx)) continue;
    visited.add(idx);

    const cell = board[idx];
    if (!cell?.special) continue;

    const blastCells = getBlastArea(idx, cell.special);
    blastCells.forEach((n) => {
      if (!resultSet.has(n)) resultSet.add(n);
      if (board[n]?.special && !visited.has(n)) queue.push(n);
    });
  }
}

function getBlastArea(center, special) {
  const [r, c] = idxToPos(center);
  const targets = new Set([center]);

  if (special === 'rocket-h') {
    for (let x = 0; x < SIZE; x++) targets.add(posToIdx(r, x));
  } else if (special === 'rocket-v') {
    for (let y = 0; y < SIZE; y++) targets.add(posToIdx(y, c));
  } else if (special === 'bomb') {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
          targets.add(posToIdx(nr, nc));
        }
      }
    }
  }

  return targets;
}

function applyGravity() {
  for (let c = 0; c < SIZE; c++) {
    let write = SIZE - 1;

    for (let r = SIZE - 1; r >= 0; r--) {
      const idx = posToIdx(r, c);
      if (board[idx] !== null) {
        board[posToIdx(write, c)] = board[idx];
        if (write !== r) board[idx] = null;
        write--;
      }
    }

    while (write >= 0) {
      board[posToIdx(write, c)] = makeCell();
      write--;
    }
  }
}

function applyRemoval(removals, specialCreates = new Map()) {
  const blastSet = new Set(removals);

  removals.forEach((idx) => {
    if (board[idx]?.special) collectSpecialBlast(idx, blastSet);
  });

  const triggeredSpecials = [];
  blastSet.forEach((idx) => {
    const special = board[idx]?.special;
    if (special) triggeredSpecials.push({ idx, special });
  });
  emitSpecialEffects(triggeredSpecials);

  blastSet.forEach((idx) => {
    board[idx] = null;
  });

  specialCreates.forEach(({ special, color }, idx) => {
    if (board[idx] === null) {
      board[idx] = makeCell(color, special);
    } else {
      board[idx].color = color;
      board[idx].special = special;
    }
  });

  score += blastSet.size * 10;
  if (blastSet.size > 0) playMatchSound();
  return blastSet;
}

async function resolveCascades(swappedPair = null) {
  let combo = 0;

  while (true) {
    const groups = findMatchGroups(board);
    if (groups.length === 0) break;

    combo++;
    const removals = new Set();
    const specialCreates = new Map();

    groups.forEach((group) => group.cells.forEach((idx) => removals.add(idx)));

    groups.forEach((group) => {
      if (group.cells.length !== 4) return;
      const pivot = chooseSpecialIndex(group.cells, swappedPair);
      removals.delete(pivot);

      const rocketType =
        swappedPair && combo === 1
          ? isHorizontalSwap(swappedPair)
            ? 'rocket-h'
            : 'rocket-v'
          : group.orientation === 'h'
            ? 'rocket-h'
            : 'rocket-v';

      upsertSpecialCreate(specialCreates, pivot, rocketType, board[pivot].color);
    });

    const components = getMatchedComponents(groups);
    components.forEach((component) => {
      if (component.cells.length <= 4) return;
      const pivot = chooseSpecialIndex(component.cells, swappedPair);
      removals.delete(pivot);
      upsertSpecialCreate(specialCreates, pivot, 'bomb', component.color);
    });

    const blastCells = applyRemoval(removals, specialCreates);
    drawBoard(removals, blastCells);
    await delay(260);
    applyGravity();
    drawBoard();
    await delay(220);

    swappedPair = null;
  }

  if (combo > 1) {
    score += combo * 20;
    statusEl.textContent = `Каскад x${combo}!`;
  }
}

function canSwapMakeMatch(a, b) {
  const test = cloneBoard(board);
  swapIn(test, a, b);
  return findMatchGroups(test).length > 0;
}

function findPotentialMove(arr = board) {
  for (let i = 0; i < arr.length; i++) {
    const [r, c] = idxToPos(i);
    const neighbors = [];
    if (c + 1 < SIZE) neighbors.push(posToIdx(r, c + 1));
    if (c - 1 >= 0) neighbors.push(posToIdx(r, c - 1));
    if (r + 1 < SIZE) neighbors.push(posToIdx(r + 1, c));
    if (r - 1 >= 0) neighbors.push(posToIdx(r - 1, c));

    for (const n of neighbors) {
      if (arr[i]?.special) return { from: i, to: n };
      const test = cloneBoard(arr);
      swapIn(test, i, n);
      if (findMatchGroups(test).length > 0) return { from: i, to: n };
    }
  }
  return null;
}

function hasAnyMove(arr = board) {
  return Boolean(findPotentialMove(arr));
}

function shuffleBoard() {
  do {
    board = Array.from({ length: SIZE * SIZE }, () => makeCell());
  } while (findMatchGroups(board).length > 0 || !hasAnyMove(board));
}

function stopTurnTimer() {
  if (turnTimerId) {
    clearInterval(turnTimerId);
    turnTimerId = null;
  }
}

function resetTurnTimer() {
  turnSecondsLeft = TURN_SECONDS;
  hintShownThisTurn = false;
  clearHint();
  updateHud();
}

function showHintMove() {
  hintShownThisTurn = true;
  hintMove = findPotentialMove(board);

  if (!hintMove) {
    shuffleBoard();
    statusEl.textContent = 'Поле перемешано: ходов не осталось.';
    resetTurnTimer();
  }

  drawBoard();
}

function handleTurnTimeout() {
  endGameByTimeout();
}

function startTurnTimer() {
  stopTurnTimer();
  resetTurnTimer();

  turnTimerId = setInterval(() => {
    if (locked) {
      updateHud();
      return;
    }

    turnSecondsLeft = Math.max(0, turnSecondsLeft - 1);

    if (turnSecondsLeft <= HINT_THRESHOLD_SECONDS && !hintShownThisTurn) {
      showHintMove();
    }

    if (turnSecondsLeft === 0) {
      handleTurnTimeout();
    }

    updateHud();
  }, 1000);
}

function registerSuccessfulMove() {
  resetTurnTimer();
}

function endGameByTimeout() {
  stopTurnTimer();
  locked = true;
  selected = null;
  clearHint();
  statusEl.textContent = 'Время вышло. Игра окончена.';
  finalScoreEl.textContent = `Ваш счёт: ${score}`;
  drawBoard();
  showModal(gameOverModalEl);
}

function openBookTable() {
  window.open('https://t.me/+Ew4VcHco7XBjNDU6', '_blank', 'noopener,noreferrer');
}

function openDevChannel() {
  window.open('https://t.me/+fW5W6DGXAQxiZTAy', '_blank', 'noopener,noreferrer');
}

function openSettingsFromMenu() {
  showModal(settingsModalEl);
}

function closeSettings() {
  hideModal(settingsModalEl);
}

async function activateSpecialMove(a, b) {
  locked = true;
  selected = null;
  clearHint();

  if (a !== b) {
    await animateSwap(a, b, true);
    swapIn(board, a, b);
    playSwapSound();
  }

  const activations = [];
  if (board[a]?.special) activations.push({ idx: a, special: board[a].special });
  if (b !== a && board[b]?.special) activations.push({ idx: b, special: board[b].special });

  if (activations.length === 0) {
    locked = false;
    drawBoard();
    return;
  }

  const blast = new Set();
  activations.forEach(({ idx, special }) => {
    getBlastArea(idx, special).forEach((n) => blast.add(n));
  });

  const blastCells = applyRemoval(blast);
  drawBoard(new Set(), blastCells);
  await delay(260);
  applyGravity();
  drawBoard();
  await delay(220);

  await resolveCascades();

  if (!hasAnyMove()) {
    shuffleBoard();
    statusEl.textContent = 'Поле перемешано: ходов не осталось.';
  } else {
    statusEl.textContent = 'Спец-фишка активирована!';
  }

  registerSuccessfulMove();
  drawBoard();
  locked = false;
}

async function trySwap(a, b) {
  if (locked) return;

  const specialMove = hasSpecial(a) || hasSpecial(b);
  if (specialMove) {
    await activateSpecialMove(a, b);
    return;
  }

  locked = true;
  selected = null;
  clearHint();

  const valid = canSwapMakeMatch(a, b);
  await animateSwap(a, b, valid);

  if (!valid) {
    statusEl.textContent = 'Нет совпадения. Попробуйте другой ход.';
    drawBoard();
    locked = false;
    return;
  }

  swapIn(board, a, b);
  playSwapSound();
  drawBoard();
  await resolveCascades([a, b]);

  if (!hasAnyMove()) {
    shuffleBoard();
    statusEl.textContent = 'Поле перемешано: ходов не осталось.';
  } else {
    statusEl.textContent = 'Отличный ход.';
  }

  registerSuccessfulMove();
  drawBoard();
  locked = false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetGame() {
  score = 0;
  selected = null;
  locked = false;
  clearHint();
  closeAllModals();
  statusEl.textContent = 'Собирайте комбинации по 3+ в ряд.';
  createBoard();
  drawBoard();
  startTurnTimer();
}

restartBtn.addEventListener('click', resetGame);
menuNewGameBtn.addEventListener('click', resetGame);
menuBookTableBtn.addEventListener('click', openBookTable);
menuSettingsBtn.addEventListener('click', openSettingsFromMenu);
soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  updateSoundToggleLabel();
});
devChannelBtn.addEventListener('click', openDevChannel);
settingsCloseBtn.addEventListener('click', closeSettings);
window.addEventListener('resize', syncEffectsLayer);

updateSoundToggleLabel();
setupTelegramWebApp();
setupTouchGuards();
resetGame();
