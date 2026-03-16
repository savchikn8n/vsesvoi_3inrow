const SIZE = 7;
const COLORS = 4;
const TURN_SECONDS = 7;
const HINT_THRESHOLD_SECONDS = 3;

const boardEl = document.getElementById('board');
const boardWrapEl = document.querySelector('.board-wrap');
const effectsLayerEl = document.getElementById('effects-layer');
const ambientLayerEl = document.getElementById('ambient-layer');
const ambientGameMaskEl = document.getElementById('ambient-game-mask');
const startAmbientLayerEl = document.getElementById('start-ambient-layer');
const scoreEl = document.getElementById('score');
const timerEl = document.getElementById('timer');
const restartBtn = document.getElementById('restart');
const exitToMenuBtn = document.getElementById('exit-to-menu');
const statusEl = document.getElementById('status');
const tileTpl = document.getElementById('tile-template');
const startScreenEl = document.getElementById('start-screen');
const bestScoreEl = document.getElementById('best-score');
const scoreTitleEl = document.getElementById('score-title');
const startNewGameBtn = document.getElementById('start-new-game');
const startLeaderboardBtn = document.getElementById('start-leaderboard');
const startSettingsBtn = document.getElementById('start-settings');
const gameOverModalEl = document.getElementById('game-over-modal');
const settingsModalEl = document.getElementById('settings-modal');
const leaderboardModalEl = document.getElementById('leaderboard-modal');
const leaderboardStatusEl = document.getElementById('leaderboard-status');
const leaderboardListEl = document.getElementById('leaderboard-list');
const leaderboardCloseBtn = document.getElementById('leaderboard-close');
const finalScoreEl = document.getElementById('final-score');
const menuNewGameBtn = document.getElementById('menu-new-game');
const menuExitMenuBtn = document.getElementById('menu-exit-menu');
const menuSettingsBtn = document.getElementById('menu-settings');
const soundToggleBtn = document.getElementById('sound-toggle');
const devChannelBtn = document.getElementById('dev-channel');
const settingsCloseBtn = document.getElementById('settings-close');
const authModalEl = document.getElementById('auth-modal');
const authStatusEl = document.getElementById('auth-status');
const authLoginBtn = document.getElementById('auth-login');
const profileModalEl = document.getElementById('profile-modal');
const profileNameEl = document.getElementById('profile-name');
const profileStatusEl = document.getElementById('profile-status');
const profileSaveBtn = document.getElementById('profile-save');
const avatarPickerEl = document.getElementById('avatar-picker');
const profileEntryBtn = document.getElementById('profile-entry');
const profileEntryAvatarEl = document.getElementById('profile-entry-avatar');
const profileEntryNameEl = document.getElementById('profile-entry-name');
const profileCloseBtn = document.getElementById('profile-close');
const giftEntryBtn = document.getElementById('gift-entry');
const giftSoonBadgeEl = document.getElementById('gift-soon-badge');

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
let bestScore = 0;
let profile = null;
let selectedAvatar = 'gold';
let authBusy = false;
let avatarPicked = false;
let leaderboardBusy = false;
let giftBadgeTimer = null;
let touchSessionSent = false;
let cascadeSession = 0;
let activeComboConstraint = null;
let bufferedMove = null;

const BEST_SCORE_KEY = 'gold_match_best_score';
const PROFILE_KEY = 'gold_match_profile';
const LEADERBOARD_CACHE_KEY = 'gold_match_leaderboard_cache_v1';
const LEADERBOARD_CACHE_TTL_MS = 60 * 1000;
const SUPABASE_URL = window.__SUPABASE_URL__ || '';
const SUPABASE_FUNCTIONS_BASE = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '';
const AMBIENT_ICON_SOURCES = [
  { key: 'dualsence', src: './assets/dualsence.png' },
  { key: 'satyr', src: './assets/satyr.png' },
  { key: 'hookah-1', src: './assets/hookah_1.png' },
  { key: 'teapot', src: './assets/teapot.png' },
  { key: 'hookah-2', src: './assets/hookah_2.png' },
];

const ambientState = {
  gameplay: {
    layer: ambientLayerEl,
    items: new Set(),
    timerId: null,
    targetCount: 999,
    mode: 'gameplay',
    lastIconKey: null,
    laneReadyAt: new Map(),
  },
  start: {
    layer: startAmbientLayerEl,
    items: new Set(),
    timerId: null,
    targetCount: 999,
    mode: 'start',
    lastIconKey: null,
    laneReadyAt: new Map(),
  },
};

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

function pickAmbientIcon(state) {
  const pool = AMBIENT_ICON_SOURCES.filter((icon) => icon.key !== state.lastIconKey);
  const source = (pool.length ? pool : AMBIENT_ICON_SOURCES)[
    Math.floor(Math.random() * (pool.length ? pool.length : AMBIENT_ICON_SOURCES.length))
  ];
  if (source) state.lastIconKey = source.key;
  return source || null;
}

function getAmbientZones(state) {
  const layer = state.layer;
  if (!layer) return [];

  const layerRect = layer.getBoundingClientRect();
  const width = layerRect.width;
  const height = layerRect.height;
  if (width < 40 || height < 120) return [];

  if (state.mode === 'start') {
    return [
      {
        left: 0,
        right: width,
        top: 0,
        bottom: height,
      },
    ];
  }

  return [
    {
      left: 0,
      right: width,
      top: 0,
      bottom: height,
    },
  ];
}

function getAmbientLanes(zone, size) {
  const laneGap = 10;
  const laneWidth = Math.max(72, size * 0.82);
  const usableWidth = zone.right - zone.left;
  const laneCount = Math.max(1, Math.floor(usableWidth / laneWidth));
  const lanes = [];

  for (let i = 0; i < laneCount; i++) {
    const laneLeft = zone.left + i * laneWidth;
    const laneCenter = laneLeft + laneWidth / 2;
    const jitter = (Math.random() * 10 - 5) * 0.8;
    const left = laneCenter - size / 2 + jitter;
    if (left < zone.left || left + size > zone.right) continue;
    lanes.push({
      id: `${Math.round(zone.top)}-${i}`,
      left,
      laneWidth,
    });
  }

  return lanes;
}

function createAmbientItem(state) {
  const layer = state.layer;
  if (!layer) return null;

  const zones = getAmbientZones(state);
  if (!zones.length) return null;

  const icon = pickAmbientIcon(state);
  if (!icon) return null;

  const zone = zones[Math.floor(Math.random() * zones.length)];
  const zoneHeight = zone.bottom - zone.top;
  const depthRoll = Math.random();
  let size = 0;
  let duration = 0;
  let swayDuration = 0;

  if (depthRoll < 0.34) {
    size = Math.round(34 + Math.random() * 20);
    duration = 28000 + Math.random() * 12000;
    swayDuration = 3200 + Math.random() * 1600;
  } else if (depthRoll < 0.74) {
    size = Math.round(52 + Math.random() * 28);
    duration = 22000 + Math.random() * 11000;
    swayDuration = 4200 + Math.random() * 2000;
  } else {
    size = Math.round(82 + Math.random() * 36);
    duration = 18000 + Math.random() * 9000;
    swayDuration = 5200 + Math.random() * 2200;
  }

  const lanes = getAmbientLanes(zone, size);
  const now = performance.now();
  const freeLanes = lanes.filter((lane) => (state.laneReadyAt.get(lane.id) || 0) <= now);
  if (!freeLanes.length) return null;

  const lane = freeLanes[Math.floor(Math.random() * freeLanes.length)];
  const left = lane.left;
  const startTop = zone.bottom + size * (0.15 + Math.random() * 0.5);
  const travel = zoneHeight + size * (1.5 + Math.random() * 0.6);
  const tilt = (8 + Math.random() * 14) * (Math.random() > 0.5 ? 1 : -1);
  const shift = 6 + Math.random() * 16;
  const negativeDelay = -1 * Math.round(Math.random() * swayDuration);

  const item = document.createElement('div');
  item.className = 'ambient-item';
  item.style.left = `${left}px`;
  item.style.top = `${startTop}px`;
  item.style.setProperty('--ambient-size', `${size}px`);
  item.style.setProperty('--ambient-duration', `${duration}ms`);
  item.style.setProperty('--ambient-sway-duration', `${swayDuration}ms`);
  item.style.setProperty('--ambient-tilt', `${tilt}deg`);
  item.style.setProperty('--ambient-travel', `${travel}px`);
  item.style.setProperty('--ambient-shift', `${shift}px`);
  item.style.setProperty('--ambient-delay', `${negativeDelay}ms`);

  const inner = document.createElement('div');
  inner.className = 'ambient-item-inner';

  const image = document.createElement('img');
  image.src = icon.src;
  image.alt = '';
  image.loading = 'lazy';
  inner.appendChild(image);
  item.appendChild(inner);
  layer.appendChild(item);

  const pixelsPerMs = travel / duration;
  const safeGapPx = size * (1.45 + Math.random() * 0.35);
  const laneCooldownMs = safeGapPx / Math.max(0.01, pixelsPerMs);
  state.laneReadyAt.set(lane.id, now + laneCooldownMs);

  const record = { node: item, key: icon.key, laneId: lane.id };
  state.items.add(record);

  item.addEventListener(
    'animationend',
    () => {
      item.remove();
      state.items.delete(record);
    },
    { once: true },
  );

  return record;
}

function scheduleAmbientSpawn(state) {
  if (!state.layer) return;
  if (state.timerId) clearTimeout(state.timerId);

  const fillAvailableLanes = () => {
    let spawned = 0;
    while (spawned < 8) {
      const item = createAmbientItem(state);
      if (!item) break;
      spawned++;
    }
  };

  const tick = () => {
    if (state.items.size < state.targetCount) {
      fillAvailableLanes();
    }
    state.timerId = window.setTimeout(tick, 20 + Math.random() * 15);
  };

  fillAvailableLanes();
  state.timerId = window.setTimeout(tick, 40);
}

function setupAmbientLayers() {
  Object.values(ambientState).forEach((state) => {
    if (!state.layer) return;
    scheduleAmbientSpawn(state);
  });
  syncAmbientGameMask();
}

function refreshAmbientLayers() {
  Object.values(ambientState).forEach((state) => {
    state.items.forEach((item) => item.node.remove());
    state.items.clear();
    state.laneReadyAt.clear();
    scheduleAmbientSpawn(state);
  });
  syncAmbientGameMask();
}

function syncAmbientGameMask() {
  if (!ambientGameMaskEl) return;
  if (!startScreenEl?.classList.contains('hidden')) {
    ambientGameMaskEl.classList.add('hidden');
    return;
  }

  const frameRect = document.querySelector('.frame')?.getBoundingClientRect();
  const hudRect = document.querySelector('.hud')?.getBoundingClientRect();
  const controlsRect = document.querySelector('.controls')?.getBoundingClientRect();
  if (!frameRect || !hudRect || !controlsRect) {
    ambientGameMaskEl.classList.add('hidden');
    return;
  }

  const top = Math.max(0, hudRect.top - frameRect.top - 8);
  const bottom = Math.min(frameRect.height, controlsRect.bottom - frameRect.top + 8);
  ambientGameMaskEl.style.left = '0px';
  ambientGameMaskEl.style.right = '0px';
  ambientGameMaskEl.style.top = `${top}px`;
  ambientGameMaskEl.style.height = `${Math.max(0, bottom - top)}px`;
  ambientGameMaskEl.classList.remove('hidden');
}

function randColor() {
  return Math.floor(Math.random() * COLORS);
}

function makeCell(color = randColor(), special = null) {
  return { color, special };
}

function countSameInDirection(r, c, dr, dc, color) {
  let count = 0;
  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
    const cell = board[posToIdx(nr, nc)];
    if (!cell || cell.special || cell.color !== color) break;
    count++;
    nr += dr;
    nc += dc;
  }
  return count;
}

function causesImmediateMatchAt(r, c, color) {
  const horiz =
    countSameInDirection(r, c, 0, -1, color) + countSameInDirection(r, c, 0, 1, color);
  const vert =
    countSameInDirection(r, c, -1, 0, color) + countSameInDirection(r, c, 1, 0, color);
  return horiz >= 2 || vert >= 2;
}

function makeStableCell(r, c) {
  const pool = Array.from({ length: COLORS }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  for (const color of pool) {
    if (!causesImmediateMatchAt(r, c, color)) {
      return makeCell(color);
    }
  }

  return makeCell(pool[0]);
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
  return src.map((cell) => (cell ? { color: cell.color, special: cell.special } : null));
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
  maybeUpdateBestScore();
}

function loadBestScore() {
  const value = Number(localStorage.getItem(BEST_SCORE_KEY) || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function saveBestScore(value) {
  localStorage.setItem(BEST_SCORE_KEY, String(value));
}

function scoreTitle(value) {
  if (value >= 170000 && value < 200000) return 'Своеобразный';
  if (value >= 140000 && value < 170000) return 'Во всём виноваты Свои';
  if (value >= 110000 && value < 140000) return 'ИнтерСвой';
  if (value >= 80000 && value < 110000) return 'Свой против Хищника';
  if (value >= 40000 && value < 80000) return 'Свой среди Своих';
  if (value >= 10000 && value < 40000) return 'В доску Свой';
  return 'Тупо Свой';
}

function updateBestScoreUi() {
  if (bestScoreEl) {
    bestScoreEl.textContent = String(bestScore);
  }
  if (scoreTitleEl) {
    scoreTitleEl.textContent = scoreTitle(bestScore);
  }
}

function maybeUpdateBestScore() {
  if (score <= bestScore) return;
  bestScore = score;
  saveBestScore(bestScore);
  updateBestScoreUi();
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.telegram_id) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveProfile(next) {
  const normalized = {
    ...next,
    auth_verified: true,
  };
  profile = normalized;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
  updateProfileEntry();
}

function setAuthStatus(message) {
  if (authStatusEl) authStatusEl.textContent = message || '';
}

function setProfileStatus(message) {
  if (profileStatusEl) profileStatusEl.textContent = message || '';
}

function setLeaderboardStatus(message) {
  if (!leaderboardStatusEl) return;
  leaderboardStatusEl.classList.remove('loading');
  leaderboardStatusEl.textContent = message || '';
}

function setLeaderboardLoading(loading) {
  if (!leaderboardStatusEl) return;
  if (!loading) {
    leaderboardStatusEl.classList.remove('loading');
    return;
  }
  leaderboardStatusEl.classList.add('loading');
  leaderboardStatusEl.innerHTML =
    'Прогружается <span class="loading-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>';
}

function telegramInitData() {
  return window.Telegram?.WebApp?.initData || '';
}

function hasTelegramContext() {
  return Boolean(window.Telegram?.WebApp);
}

async function touchSession() {
  if (touchSessionSent) return;
  const initData = telegramInitData();
  if (!hasTelegramContext() || !initData) return;

  touchSessionSent = true;
  try {
    const result = await postJson('touch-session', { initData });
    if (result?.profile?.telegram_id) {
      saveProfile({ ...(profile || {}), ...result.profile });
    }
  } catch (_) {
    touchSessionSent = false;
  }
}

function isProfileComplete(userProfile) {
  return Boolean(
    userProfile?.auth_verified === true &&
      userProfile?.telegram_id &&
      userProfile?.display_name &&
      userProfile?.avatar_url,
  );
}

function apiUrl(path) {
  if (!SUPABASE_FUNCTIONS_BASE) return '';
  return `${SUPABASE_FUNCTIONS_BASE}/${path}`;
}

async function postJson(path, payload) {
  return postJsonWithOptions(path, payload, {});
}

async function postJsonWithOptions(path, payload, options = {}) {
  const url = apiUrl(path);
  if (!url) {
    throw new Error(
      'Не задан SUPABASE_URL. Добавьте window.__SUPABASE_URL__ перед game.js или задайте константу.',
    );
  }

  const timeoutMs = Number(options.timeoutMs || 9000);
  const retries = Number(options.retries || 0);
  const headers = options.useJsonHeader
    ? { 'Content-Type': 'application/json' }
    : { 'Content-Type': 'text/plain;charset=UTF-8' };

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Ошибка запроса');
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt === retries) break;
      await delay(220);
    }
  }

  if (lastError?.name === 'AbortError') {
    throw new Error('Превышено время ожидания');
  }
  throw lastError || new Error('Load fail');
}

function loadLeaderboardCache() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.items)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveLeaderboardCache(items) {
  const payload = {
    ts: Date.now(),
    items: Array.isArray(items) ? items : [],
  };
  localStorage.setItem(LEADERBOARD_CACHE_KEY, JSON.stringify(payload));
}

function showAuthModal() {
  hideStartScreen();
  closeAllModals();
  setAuthStatus('');
  showModal(authModalEl);
}

function openProfileModal(nextProfile = null) {
  hideModal(authModalEl);
  if (nextProfile) {
    profile = nextProfile;
  }
  profileNameEl.value = profile?.display_name || '';
  selectedAvatar = profile?.avatar_choice || avatarChoiceFromUrl(profile?.avatar_url) || 'gold';
  avatarPicked = Boolean(profile?.avatar_choice || profile?.avatar_url);
  updateAvatarSelection();
  updateProfileSaveState();
  setProfileStatus('');
  showModal(profileModalEl);
}

function updateAvatarSelection() {
  avatarPickerEl?.querySelectorAll('.avatar-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.avatar === selectedAvatar);
  });
}

function updateProfileSaveState() {
  const canSave = profileNameEl.value.trim().length >= 2 && avatarPicked && Boolean(selectedAvatar);
  if (profileSaveBtn) profileSaveBtn.disabled = !canSave;
}

function updateProfileEntry() {
  if (!profileEntryAvatarEl || !profileEntryNameEl) return;
  const avatarChoice = profile?.avatar_choice || avatarChoiceFromUrl(profile?.avatar_url) || 'gold';
  profileEntryAvatarEl.src = avatarChoiceToUrl(avatarChoice);
  profileEntryNameEl.textContent = profile?.display_name || 'Игрок';
}

function openProfileEditor() {
  openProfileModal(profile || loadProfile());
}

function closeProfileEditor() {
  hideModal(profileModalEl);
  setProfileStatus('');
  const hasProfile = isProfileComplete(profile || loadProfile());
  const startVisible = Boolean(startScreenEl && !startScreenEl.classList.contains('hidden'));

  if (!hasProfile) {
    showAuthModal();
    return;
  }

  if (startVisible) {
    updateBestScoreUi();
    updateProfileEntry();
    syncAmbientGameMask();
    return;
  }

  showStartScreen();
}

function showGiftSoonFlag() {
  if (!giftSoonBadgeEl) return;
  giftSoonBadgeEl.classList.add('show');
  if (giftBadgeTimer) clearTimeout(giftBadgeTimer);
  giftBadgeTimer = setTimeout(() => {
    giftSoonBadgeEl.classList.remove('show');
    giftBadgeTimer = null;
  }, 1400);
}

async function ensureAuthFlow() {
  const localProfile = loadProfile();
  if (localProfile && isProfileComplete(localProfile)) {
    profile = localProfile;
    showStartScreen();
    void touchSession();
    return;
  }

  showAuthModal();
}

function showStartScreen() {
  stopTurnTimer();
  locked = true;
  selected = null;
  clearHint();
  closeAllModals();
  if (!isProfileComplete(profile || loadProfile())) {
    showAuthModal();
    return;
  }
  startScreenEl?.classList.remove('hidden');
  updateBestScoreUi();
  updateProfileEntry();
  refreshAmbientLayers();
  syncAmbientGameMask();
}

function hideStartScreen() {
  startScreenEl?.classList.add('hidden');
  refreshAmbientLayers();
  syncAmbientGameMask();
}

function makeLeaderboardRow(item, index) {
  const row = document.createElement('div');
  row.className = 'leaderboard-row';
  row.dataset.telegramId = String(item.telegram_id || '');

  if (profile?.telegram_id && String(item.telegram_id) === String(profile.telegram_id)) {
    row.classList.add('is-current-user');
  }

  const rank = document.createElement('span');
  rank.className = 'leaderboard-rank';
  rank.textContent = String(index + 1);

  const avatar = document.createElement('img');
  avatar.className = 'leaderboard-avatar';
  avatar.src = avatarChoiceToUrl(item.avatar_choice || avatarChoiceFromUrl(item.avatar_url));
  avatar.alt = 'avatar';

  const name = document.createElement('span');
  name.className = 'leaderboard-name';
  name.textContent = item.display_name || 'Игрок';

  const scoreValue = document.createElement('span');
  scoreValue.className = 'leaderboard-score';
  scoreValue.textContent = String(item.best_score ?? 0);

  row.append(rank, avatar, name, scoreValue);
  return row;
}

function renderLeaderboard(items = [], showEmptyMessage = true) {
  if (!leaderboardListEl) return;
  leaderboardListEl.innerHTML = '';
  if (!items.length) {
    if (!showEmptyMessage) return;
    setLeaderboardStatus('Пока нет результатов. Стань первым!');
    return;
  }
  setLeaderboardStatus('');
  items.forEach((item, idx) => leaderboardListEl.appendChild(makeLeaderboardRow(item, idx)));

  const currentUserRow = leaderboardListEl.querySelector('.leaderboard-row.is-current-user');
  if (currentUserRow) {
    currentUserRow.scrollIntoView({ block: 'nearest' });
  }
}

async function openLeaderboard() {
  if (leaderboardBusy) return;
  leaderboardBusy = true;
  closeAllModals();
  showModal(leaderboardModalEl);
  setLeaderboardLoading(true);
  const cached = loadLeaderboardCache();
  if (cached?.items?.length) {
    renderLeaderboard(cached.items, false);
  } else {
    renderLeaderboard([], false);
  }
  try {
    const { leaderboard } = await postJsonWithOptions(
      'leaderboard',
      { limit: 50 },
      { timeoutMs: 6500, retries: 2 },
    );
    const items = Array.isArray(leaderboard) ? leaderboard : [];
    renderLeaderboard(items);
    saveLeaderboardCache(items);
  } catch (error) {
    setLeaderboardLoading(false);
    const cacheFresh = cached && Date.now() - Number(cached.ts || 0) <= LEADERBOARD_CACHE_TTL_MS;
    if (cacheFresh && cached.items.length) {
      renderLeaderboard(cached.items, false);
      setLeaderboardStatus('Слабая сеть: показаны сохраненные результаты.');
    } else if (!cached?.items?.length) {
      setLeaderboardStatus(error.message || 'Load fail');
    }
  } finally {
    setLeaderboardLoading(false);
    leaderboardBusy = false;
  }
}

function closeLeaderboard() {
  hideModal(leaderboardModalEl);
}

function startNewGameFromHome() {
  hideStartScreen();
  resetGame();
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
  hideModal(leaderboardModalEl);
  hideModal(authModalEl);
  hideModal(profileModalEl);
}

function clearHint() {
  hintMove = null;
}

function makeConstraintFromIndices(indices) {
  const rows = new Set();
  const cols = new Set();
  indices.forEach((idx) => {
    const [r, c] = idxToPos(idx);
    rows.add(r);
    cols.add(c);
  });
  return { rows, cols };
}

function clearComboConstraint() {
  activeComboConstraint = null;
}

function canInteractIndex(index) {
  if (index === null || index === undefined) return false;
  if (!locked) return true;
  if (!activeComboConstraint) return false;
  const [r, c] = idxToPos(index);
  return !activeComboConstraint.rows.has(r) && !activeComboConstraint.cols.has(c);
}

function canInteractPair(a, b) {
  return canInteractIndex(a) && canInteractIndex(b);
}

function queueBufferedMove(from, to) {
  if (!canInteractPair(from, to)) return false;
  bufferedMove = { from, to };
  selected = null;
  return true;
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
      if (cell._fall && cell._fall > 0) {
        tile.classList.add('falling');
        tile.style.setProperty('--fall-distance', String(cell._fall));
      }
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

  board.forEach((cell) => {
    if (cell && cell._fall) {
      delete cell._fall;
    }
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

function spawnSmokeEffect(index, tone = 'default') {
  if (!effectsLayerEl) return;
  const tile = getTile(index);
  if (!tile) return;

  const boardRect = boardEl.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const cx = tileRect.left - boardRect.left + tileRect.width / 2;
  const cy = tileRect.top - boardRect.top + tileRect.height / 2;

  for (let i = 0; i < 3; i++) {
    const smoke = document.createElement('div');
    smoke.className = tone === 'red' ? 'effect-smoke effect-smoke-red' : 'effect-smoke';
    smoke.style.left = `${cx + (Math.random() * 18 - 9)}px`;
    smoke.style.top = `${cy + (Math.random() * 12 - 6)}px`;
    smoke.style.animationDelay = `${i * 45}ms`;
    effectsLayerEl.appendChild(smoke);
    setTimeout(() => smoke.remove(), 760);
  }
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
  // Intentionally disabled: for special clears we only use red smoke.
  void specials;
}

function emitSmokeEffects(indices, tone = 'default') {
  if (!indices || indices.size === 0) return;
  syncEffectsLayer();
  indices.forEach((idx) => spawnSmokeEffect(idx, tone));
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

function handleTileTap(index, bypassSuppress = false) {
  if (!bypassSuppress && Date.now() < suppressClickUntil) return;
  if (locked && !canInteractIndex(index)) return;

  if (selected === null) {
    if (!locked && hasSpecial(index)) {
      activateSpecialMove(index, index);
      return;
    }
    selected = index;
    clearHint();
    drawBoard();
    return;
  }

  if (selected === index) {
    if (!locked && hasSpecial(index)) {
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

  if (locked) {
    if (areAdjacent(selected, index) && queueBufferedMove(selected, index)) {
      drawBoard();
    }
    return;
  }

  trySwap(selected, index);
}

function onTileClick(e) {
  handleTileTap(Number(e.currentTarget.dataset.index));
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
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  const index = Number(e.currentTarget.dataset.index);
  if (!canInteractIndex(index)) return;
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

  const dx = e.clientX - swipeGesture.startX;
  const dy = e.clientY - swipeGesture.startY;
  if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;

  const target = swipeTarget(swipeGesture.fromIndex, dx, dy);
  swipeGesture.finished = true;
  suppressClickUntil = Date.now() + 380;

  if (target === null) return;
  if (!canInteractPair(swipeGesture.fromIndex, target)) return;

  selected = null;
  clearHint();
  drawBoard();
  if (locked) {
    queueBufferedMove(swipeGesture.fromIndex, target);
    drawBoard();
    return;
  }
  trySwap(swipeGesture.fromIndex, target);
}

function onTilePointerEnd(e) {
  if (!swipeGesture) return;
  if (swipeGesture.pointerId !== e.pointerId) return;
  if (!swipeGesture.finished) {
    suppressClickUntil = Date.now() + 220;
    handleTileTap(swipeGesture.fromIndex, true);
  }
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

      // Specials are activated manually and do not auto-trigger from cascade matches.
      if (cell.special) {
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
  if (cells.includes(b)) return b;
  if (cells.includes(a)) return a;
  return cells[Math.floor(cells.length / 2)];
}

function upsertSpecialCreate(map, idx, special, color) {
  const existing = map.get(idx);
  if (!existing || (existing.special !== 'bomb' && special === 'bomb')) {
    map.set(idx, { special, color });
  }
}

function buildMatchResolution(groups, swappedPair = null, preserveIndices = new Set()) {
  const removals = new Set();
  const specialCreates = new Map();
  const smokeCells = new Set();

  groups.forEach((group) => group.cells.forEach((idx) => removals.add(idx)));
  preserveIndices.forEach((idx) => removals.delete(idx));

  groups.forEach((group) => {
    if (group.cells.length !== 3) return;
    group.cells.forEach((idx) => {
      if (removals.has(idx) && !board[idx]?.special) {
        smokeCells.add(idx);
      }
    });
  });

  groups.forEach((group) => {
    if (group.cells.length !== 4) return;
    const pivot = chooseSpecialIndex(group.cells, swappedPair);
    removals.delete(pivot);

    const rocketType =
      swappedPair
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

  return { removals, specialCreates, smokeCells };
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

function getBombRocketComboArea(center) {
  const [r, c] = idxToPos(center);
  const targets = new Set();

  for (let row = r - 1; row <= r + 1; row++) {
    if (row < 0 || row >= SIZE) continue;
    for (let x = 0; x < SIZE; x++) {
      targets.add(posToIdx(row, x));
    }
  }

  for (let col = c - 1; col <= c + 1; col++) {
    if (col < 0 || col >= SIZE) continue;
    for (let y = 0; y < SIZE; y++) {
      targets.add(posToIdx(y, col));
    }
  }

  return targets;
}

function getRocketRocketComboArea(center) {
  const [r, c] = idxToPos(center);
  const targets = new Set();

  for (let x = 0; x < SIZE; x++) {
    targets.add(posToIdx(r, x));
  }

  for (let y = 0; y < SIZE; y++) {
    targets.add(posToIdx(y, c));
  }

  return targets;
}

function applyGravity() {
  for (let c = 0; c < SIZE; c++) {
    let write = SIZE - 1;

    for (let r = SIZE - 1; r >= 0; r--) {
      const idx = posToIdx(r, c);
      if (board[idx] !== null) {
        const moved = board[idx];
        moved._fall = Math.max(0, write - r);
        board[posToIdx(write, c)] = moved;
        if (write !== r) board[idx] = null;
        write--;
      }
    }

    while (write >= 0) {
      const spawned = makeStableCell(write, c);
      spawned._fall = write + 1;
      board[posToIdx(write, c)] = spawned;
      write--;
    }
  }
}

function applyRemoval(
  removals,
  specialCreates = new Map(),
  options = { chainSpecials: true, emitTriggeredEffects: true, smokeTone: null },
) {
  const { chainSpecials = true, emitTriggeredEffects = true, smokeTone = null } = options;
  const blastSet = new Set(removals);

  if (chainSpecials) {
    removals.forEach((idx) => {
      if (board[idx]?.special) collectSpecialBlast(idx, blastSet);
    });
  }

  specialCreates.forEach((_, idx) => {
    blastSet.delete(idx);
  });

  const triggeredSpecials = [];
  blastSet.forEach((idx) => {
    const special = board[idx]?.special;
    if (special) triggeredSpecials.push({ idx, special });
  });

  if (emitTriggeredEffects) {
    emitSpecialEffects(triggeredSpecials);
  }

  if (smokeTone) {
    emitSmokeEffects(blastSet, smokeTone);
  } else if (triggeredSpecials.length > 0) {
    emitSmokeEffects(blastSet, 'red');
  }

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
  const sessionId = ++cascadeSession;
  let combo = 0;

  while (true) {
    if (sessionId !== cascadeSession) return false;
    const groups = findMatchGroups(board);
    if (groups.length === 0) break;

    combo++;
    locked = true;
    const firstSwap = swappedPair && combo === 1 ? swappedPair : null;
    const { removals, specialCreates, smokeCells } = buildMatchResolution(groups, firstSwap);

    emitSmokeEffects(smokeCells, 'default');
    const blastCells = applyRemoval(removals, specialCreates);
    activeComboConstraint = makeConstraintFromIndices(blastCells);
    drawBoard(removals, blastCells);
    if (!(await interruptibleDelay(420, sessionId))) return false;
    applyGravity();
    drawBoard();
    locked = false;
    if (bufferedMove && canSwapMakeMatch(bufferedMove.from, bufferedMove.to)) {
      const move = bufferedMove;
      bufferedMove = null;
      clearComboConstraint();
      await trySwap(move.from, move.to);
      return false;
    }
    if (!(await interruptibleDelay(240, sessionId))) return false;
    locked = true;
    clearComboConstraint();

    swappedPair = null;
  }

  if (combo > 1) {
    score += combo * 20;
    statusEl.textContent = `Каскад x${combo}!`;
  }

  clearComboConstraint();
  return true;
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

async function submitBestScoreIfNeeded() {
  if (!profile?.telegram_id) return;
  const localBest = Math.max(Number(profile.best_score || 0), score);
  if (localBest <= Number(profile.best_score || 0)) return;

  try {
    const initData = telegramInitData();
    if (!initData) return;

    const result = await postJson('score-submit', {
      initData,
      bestScore: localBest,
    });
    if (result?.profile) {
      saveProfile(result.profile);
    } else {
      saveProfile({ ...profile, best_score: localBest });
    }
  } catch (_) {
    // score sync is non-blocking for gameplay
  }
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
  submitBestScoreIfNeeded();
}

function exitToMenu() {
  submitBestScoreIfNeeded();
  showStartScreen();
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

function avatarChoiceToUrl(avatarChoice) {
  const map = {
    gold: './assets/gold.png',
    hookah: './assets/hookah1.png',
    steam: './assets/steam.png',
    cole: './assets/cole.png',
  };
  return map[avatarChoice] || map.gold;
}

function avatarChoiceFromUrl(url = '') {
  const match = String(url).toLowerCase();
  if (match.includes('hookah')) return 'hookah';
  if (match.includes('steam')) return 'steam';
  if (match.includes('cole')) return 'cole';
  return 'gold';
}

async function handleTelegramAuth() {
  if (authBusy) return;
  authBusy = true;
  setAuthStatus('Проверяем Telegram...');

  try {
    const initData = telegramInitData();
    if (!hasTelegramContext() || !initData) {
      throw new Error('Откройте игру внутри Telegram Mini App.');
    }

    const result = await postJson('telegram-auth', { initData });
    const incomingProfile = result?.profile;

    if (!incomingProfile?.telegram_id) {
      throw new Error('Сервер не вернул профиль.');
    }

    saveProfile(incomingProfile);
    touchSessionSent = true;

    if (result?.is_profile_complete) {
      hideModal(authModalEl);
      showStartScreen();
      setAuthStatus('');
    } else {
      openProfileModal(incomingProfile);
    }
  } catch (error) {
    setAuthStatus(error.message || 'Ошибка авторизации.');
  } finally {
    authBusy = false;
  }
}

async function handleProfileSave() {
  if (authBusy) return;
  const displayName = profileNameEl.value.trim();
  if (displayName.length < 2) {
    setProfileStatus('Имя должно быть не короче 2 символов.');
    return;
  }
  if (!selectedAvatar) {
    setProfileStatus('Выберите аватар.');
    return;
  }
  if (!avatarPicked) {
    setProfileStatus('Выберите аватар.');
    return;
  }

  authBusy = true;
  setProfileStatus('Сохраняем профиль...');

  try {
    const initData = telegramInitData();
    if (!initData) {
      throw new Error('Нет данных Telegram для подтверждения.');
    }

    const payload = {
      initData,
      displayName,
      avatarChoice: selectedAvatar,
      avatarUrl: avatarChoiceToUrl(selectedAvatar),
    };
    const result = await postJson('profile-save', payload);
    const savedProfile = result?.profile;

    if (!savedProfile?.telegram_id) {
      throw new Error('Сервер не вернул профиль после сохранения.');
    }

    saveProfile(savedProfile);
    hideModal(profileModalEl);
    setProfileStatus('');
    showStartScreen();
  } catch (error) {
    setProfileStatus(error.message || 'Не удалось сохранить профиль.');
  } finally {
    authBusy = false;
  }
}

function handleProfileNameInput() {
  updateProfileSaveState();
}

async function activateSpecialMove(a, b) {
  const actionSession = ++cascadeSession;
  locked = true;
  selected = null;
  clearHint();
  bufferedMove = null;
  clearComboConstraint();

  if (a !== b) {
    await animateSwap(a, b, true);
    swapIn(board, a, b);
    playSwapSound();
  }

  const preserveIndices = new Set();
  if (board[a]?.special) preserveIndices.add(a);
  if (b !== a && board[b]?.special) preserveIndices.add(b);

  const preGroups = findMatchGroups(board);
  if (preGroups.length > 0) {
    const { removals, specialCreates, smokeCells } = buildMatchResolution(preGroups, [a, b], preserveIndices);
    emitSmokeEffects(smokeCells, 'default');
    const preBlastCells = applyRemoval(removals, specialCreates, {
      chainSpecials: false,
      emitTriggeredEffects: false,
      smokeTone: null,
    });
    drawBoard(removals, preBlastCells);
    if (!(await interruptibleDelay(260, actionSession))) return;
  }

  const activations = [];
  if (board[a]?.special) activations.push({ idx: a, special: board[a].special });
  if (b !== a && board[b]?.special) activations.push({ idx: b, special: board[b].special });

  if (activations.length === 0) {
    locked = false;
    drawBoard();
    return;
  }

  const hasBomb = activations.some((x) => x.special === 'bomb');
  const hasRocket = activations.some((x) => x.special === 'rocket-h' || x.special === 'rocket-v');
  const rocketCount = activations.filter(
    (x) => x.special === 'rocket-h' || x.special === 'rocket-v',
  ).length;

  let blast = new Set();
  if (a !== b && activations.length === 2 && rocketCount === 2) {
    const center = b;
    blast = getRocketRocketComboArea(center);
  } else if (a !== b && activations.length === 2 && hasBomb && hasRocket) {
    const center = b;
    blast = getBombRocketComboArea(center);
  } else {
    activations.forEach(({ idx, special }) => {
      getBlastArea(idx, special).forEach((n) => blast.add(n));
    });
  }

  const blastCells =
    a !== b && activations.length === 2 && hasBomb && hasRocket
      ? applyRemoval(blast, new Map(), {
          chainSpecials: true,
          emitTriggeredEffects: false,
          smokeTone: 'red',
        })
      : applyRemoval(blast, new Map(), { chainSpecials: true, emitTriggeredEffects: true, smokeTone: 'red' });
  drawBoard(new Set(), blastCells);
  await delay(340);
  if (actionSession !== cascadeSession) return;
  applyGravity();
  drawBoard();
  locked = false;
  if (!(await interruptibleDelay(180, actionSession))) return;
  locked = true;

  const cascadesFinished = await resolveCascades();
  if (cascadesFinished === false) {
    return;
  }

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
  if (locked || !canInteractPair(a, b)) return;
  const actionSession = ++cascadeSession;
  bufferedMove = null;
  clearComboConstraint();

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
  if (actionSession !== cascadeSession) return;

  if (!valid) {
    statusEl.textContent = 'Нет совпадения. Попробуйте другой ход.';
    drawBoard();
    locked = false;
    return;
  }

  swapIn(board, a, b);
  playSwapSound();
  drawBoard();
  const cascadesFinished = await resolveCascades([a, b]);
  if (cascadesFinished === false) {
    return;
  }

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

function interruptibleDelay(ms, sessionId) {
  return new Promise((resolve) => {
    const startedAt = performance.now();

    function step() {
      if (sessionId !== cascadeSession) {
        resolve(false);
        return;
      }
      if (performance.now() - startedAt >= ms) {
        resolve(true);
        return;
      }
      requestAnimationFrame(step);
    }

    step();
  });
}

function resetGame() {
  score = 0;
  selected = null;
  locked = false;
  bufferedMove = null;
  clearComboConstraint();
  clearHint();
  hideStartScreen();
  closeAllModals();
  statusEl.textContent = 'Собирайте комбинации по 3+ в ряд.';
  createBoard();
  drawBoard();
  startTurnTimer();
  refreshAmbientLayers();
  syncAmbientGameMask();
}

restartBtn.addEventListener('click', resetGame);
exitToMenuBtn.addEventListener('click', exitToMenu);
menuNewGameBtn.addEventListener('click', resetGame);
menuExitMenuBtn.addEventListener('click', exitToMenu);
menuSettingsBtn.addEventListener('click', openSettingsFromMenu);
startNewGameBtn.addEventListener('click', startNewGameFromHome);
startLeaderboardBtn.addEventListener('click', openLeaderboard);
startSettingsBtn.addEventListener('click', openSettingsFromMenu);
soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  updateSoundToggleLabel();
});
devChannelBtn.addEventListener('click', openDevChannel);
settingsCloseBtn.addEventListener('click', closeSettings);
leaderboardCloseBtn?.addEventListener('click', closeLeaderboard);
authLoginBtn.addEventListener('click', handleTelegramAuth);
profileSaveBtn.addEventListener('click', handleProfileSave);
profileEntryBtn?.addEventListener('click', openProfileEditor);
profileCloseBtn?.addEventListener('click', closeProfileEditor);
profileNameEl?.addEventListener('input', handleProfileNameInput);
giftEntryBtn?.addEventListener('click', showGiftSoonFlag);
avatarPickerEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('.avatar-option');
  if (!btn) return;
  selectedAvatar = btn.dataset.avatar;
  avatarPicked = true;
  updateAvatarSelection();
  updateProfileSaveState();
});
window.addEventListener('resize', () => {
  syncEffectsLayer();
  refreshAmbientLayers();
  syncAmbientGameMask();
});

bestScore = loadBestScore();
profile = loadProfile();
updateBestScoreUi();
updateProfileEntry();
updateSoundToggleLabel();
setupTelegramWebApp();
setupTouchGuards();
setupAmbientLayers();
createBoard();
drawBoard();
ensureAuthFlow();
