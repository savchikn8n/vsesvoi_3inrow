const DASHBOARD_SECRET_KEY = 'vs_dashboard_secret';
const SUPABASE_URL = window.__SUPABASE_URL__ || '';
const SUMMARY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analytics-summary` : '';
const GIFT_ADMIN_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/gift-admin` : '';
const MESSAGE_ADMIN_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/messages-admin` : '';
const PROMO_ADMIN_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/promo-admin` : '';
const PROMO_UPLOAD_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/promo-upload` : '';

const statusEl = document.getElementById('dashboard-status');
const loadingEl = document.getElementById('dashboard-loading');
const secretInputEl = document.getElementById('dashboard-secret');
const connectBtnEl = document.getElementById('connect-dashboard');
const toggleSecretBtnEl = document.getElementById('toggle-secret');
const authPanelEl = document.getElementById('auth-panel');

const analyticsTabEl = document.getElementById('tab-analytics');
const sessionsTabEl = document.getElementById('tab-sessions');
const giftsTabEl = document.getElementById('tab-gifts');
const messagesTabEl = document.getElementById('tab-messages');
const promosTabEl = document.getElementById('tab-promos');

const analyticsPanelEl = document.getElementById('analytics-panel');
const sessionsPanelEl = document.getElementById('sessions-panel');
const giftsPanelEl = document.getElementById('gifts-panel');
const messagesPanelEl = document.getElementById('messages-panel');
const promosPanelEl = document.getElementById('promos-panel');

const periodSwitchEl = document.querySelector('.period-switch');
const topPlayersListEl = document.getElementById('top-players-list');
const recentSessionsBodyEl = document.getElementById('recent-sessions-body');
const sessionsClapsToggleEl = document.getElementById('sessions-claps-toggle');
const updatedAtEl = document.getElementById('dashboard-updated-at');
const messageImpactListEl = document.getElementById('message-impact-list');
const broadcastHistoryBodyEl = document.getElementById('broadcast-history-body');

const giftSearchEl = document.getElementById('gift-search');
const giftFilterItemEl = document.getElementById('gift-filter-item');
const giftFilterStatusEl = document.getElementById('gift-filter-status');
const giftPurchasesBodyEl = document.getElementById('gift-purchases-body');

const broadcastTextEl = document.getElementById('broadcast-text');
const broadcastDryRunBtnEl = document.getElementById('broadcast-dry-run');
const broadcastSendBtnEl = document.getElementById('broadcast-send');
const broadcastResultEl = document.getElementById('broadcast-result');

const promoEditorSubtabEl = document.getElementById('promo-subtab-editor');
const promoArchiveSubtabEl = document.getElementById('promo-subtab-archive');
const promoGridEl = document.querySelector('.promo-grid');
const promoEditorNoteEl = document.getElementById('promo-editor-note');
const promoTitleInputEl = document.getElementById('promo-title-input');
const promoBodyInputEl = document.getElementById('promo-body-input');
const promoImageFileInputEl = document.getElementById('promo-image-file-input');
const promoImageInputEl = document.getElementById('promo-image-input');
const promoSecondaryLabelInputEl = document.getElementById('promo-secondary-label-input');
const promoPrimaryLabelInputEl = document.getElementById('promo-primary-label-input');
const promoPrimaryUrlInputEl = document.getElementById('promo-primary-url-input');
const promoSaveDraftBtnEl = document.getElementById('promo-save-draft');
const promoPublishBtnEl = document.getElementById('promo-publish');
const promoResetBtnEl = document.getElementById('promo-reset');
const promoPreviewImageEl = document.getElementById('promo-preview-image');
const promoPreviewPlaceholderEl = document.getElementById('promo-preview-placeholder');
const promoPreviewTitleEl = document.getElementById('promo-preview-title');
const promoPreviewBodyEl = document.getElementById('promo-preview-body');
const promoPreviewSecondaryEl = document.getElementById('promo-preview-secondary');
const promoPreviewPrimaryEl = document.getElementById('promo-preview-primary');
const promoListEl = document.getElementById('promo-list');

const metricEls = {
  totalPlayers: document.getElementById('metric-total-players'),
  activePlayers: document.getElementById('metric-active-players'),
  newPlayers: document.getElementById('metric-new-players'),
  sessions: document.getElementById('metric-sessions'),
  avgDuration: document.getElementById('metric-avg-duration'),
  avgScore: document.getElementById('metric-avg-score'),
  clapsSpent: document.getElementById('metric-claps-spent'),
  clapsEarned: document.getElementById('metric-claps-earned'),
  giftsPurchased: document.getElementById('metric-gifts-purchased'),
  avgSpend: document.getElementById('metric-avg-spend'),
  returningPlayers: document.getElementById('metric-returning-players'),
  messageRetention: document.getElementById('metric-message-retention'),
  peakHour: document.getElementById('metric-peak-hour'),
  sessionsPerPlayer: document.getElementById('metric-sessions-per-player'),
  timeoutShare: document.getElementById('metric-timeout-share'),
  menuExitShare: document.getElementById('metric-menu-exit-share'),
};

let refreshTimerId = null;
let currentDashboardTab = 'analytics';
let currentAnalyticsPeriod = '24h';
let currentPromoSubtab = 'editor';
let editingPromoId = null;
let lastPromoRows = [];
let lastGiftPurchases = [];
let selectedPromoImageFile = null;
let promoPreviewObjectUrl = '';
let currentSessionsClapsMode = 'earned';
let lastSessionHistory = [];

const EVENT_COLORS = ['#f7c83e', '#f3a620', '#ffdf7b', '#d9a83a', '#8cd18f', '#78a5ff', '#f98080', '#b58cff', '#63d6d6', '#f7edc0'];

function loadDashboardSecret() {
  return sessionStorage.getItem(DASHBOARD_SECRET_KEY) || '';
}

function saveDashboardSecret(secret) {
  sessionStorage.setItem(DASHBOARD_SECRET_KEY, secret);
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message || '';
}

function setLoading(loading) {
  loadingEl?.classList.toggle('is-active', Boolean(loading));
}

function setSecretPanelCollapsed(collapsed) {
  authPanelEl?.classList.toggle('is-collapsed', Boolean(collapsed));
}

function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(Number(value || 0));
}

function formatDuration(sec) {
  const value = Math.max(0, Number(sec || 0));
  const min = Math.floor(value / 60);
  const rem = value % 60;
  return `${min}м ${String(rem).padStart(2, '0')}с`;
}

function formatDateTime(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatPercent(value) {
  return `${formatNumber(value)}%`;
}

function truncate(value, limit = 140) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function revokePromoPreviewObjectUrl() {
  if (!promoPreviewObjectUrl) return;
  URL.revokeObjectURL(promoPreviewObjectUrl);
  promoPreviewObjectUrl = '';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',').pop() : result;
      if (!base64) {
        reject(new Error('Не удалось прочитать файл.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

async function uploadPromoImageIfNeeded() {
  if (!selectedPromoImageFile) {
    return promoImageInputEl?.value.trim() || '';
  }
  if (!PROMO_UPLOAD_URL) throw new Error('Не задан SUPABASE_URL.');
  if (selectedPromoImageFile.size > 5 * 1024 * 1024) {
    throw new Error('Изображение должно быть не больше 5 МБ.');
  }

  const base64 = await fileToBase64(selectedPromoImageFile);
  const data = await postDashboardJson(PROMO_UPLOAD_URL, {
    fileName: selectedPromoImageFile.name,
    contentType: selectedPromoImageFile.type || 'image/png',
    dataBase64: base64,
  });

  const imageUrl = data?.imageUrl || '';
  if (!imageUrl) throw new Error('Upload не вернул URL изображения.');
  if (promoImageInputEl) promoImageInputEl.value = imageUrl;
  if (promoImageFileInputEl) promoImageFileInputEl.value = '';
  selectedPromoImageFile = null;
  return imageUrl;
}

async function postDashboardJson(url, payload) {
  const secret = loadDashboardSecret();
  if (!secret) throw new Error('Введите DASHBOARD_SECRET.');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-secret': secret,
    },
    body: JSON.stringify(payload || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Ошибка dashboard-запроса');
  return data;
}

function renderTopPlayers(items = []) {
  if (!topPlayersListEl) return;
  topPlayersListEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Пока нет данных.';
    topPlayersListEl.appendChild(empty);
    return;
  }

  items.slice(0, 10).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `
      <div class="rank-index">#${item.rank}</div>
      <div class="rank-player">${item.display_name}</div>
      <div class="rank-score">${formatNumber(item.best_score)}</div>
      <div class="rank-claps">${formatNumber(item.clap_balance)}</div>
    `;
    topPlayersListEl.appendChild(row);
  });
}

function computeBehaviorMetrics(summary) {
  const generatedAt = summary?.generated_at ? new Date(summary.generated_at).getTime() : Date.now();
  const hours = currentAnalyticsPeriod === '30d' ? 30 * 24 : currentAnalyticsPeriod === '7d' ? 7 * 24 : 24;
  const sinceMs = generatedAt - hours * 60 * 60 * 1000;
  const sessions = Array.isArray(summary?.session_history)
    ? summary.session_history.filter((item) => new Date(item.session_started_at).getTime() >= sinceMs)
    : [];

  if (!sessions.length) {
    return {
      peakHourLabel: '-',
      sessionsPerPlayerLabel: '0',
      timeoutShareLabel: '0%',
      menuExitShareLabel: '0%',
    };
  }

  const hourCounts = new Map();
  const playerIds = new Set();
  let timeoutCount = 0;
  let menuExitCount = 0;

  sessions.forEach((item) => {
    const date = new Date(item.session_started_at);
    const hour = date.getHours();
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    playerIds.add(String(item.telegram_id));
    if (item.end_reason === 'timeout') timeoutCount += 1;
    if (item.end_reason === 'menu_exit') menuExitCount += 1;
  });

  let peakHour = 0;
  let peakHourCount = -1;
  hourCounts.forEach((count, hour) => {
    if (count > peakHourCount) {
      peakHour = hour;
      peakHourCount = count;
    }
  });

  const nextHour = (peakHour + 1) % 24;
  return {
    peakHourLabel: `${String(peakHour).padStart(2, '0')}:00–${String(nextHour).padStart(2, '0')}:00`,
    sessionsPerPlayerLabel: playerIds.size ? (sessions.length / playerIds.size).toFixed(1) : '0',
    timeoutShareLabel: `${Math.round((timeoutCount / sessions.length) * 100)}%`,
    menuExitShareLabel: `${Math.round((menuExitCount / sessions.length) * 100)}%`,
  };
}

function renderSessions(items = []) {
  lastSessionHistory = Array.isArray(items) ? items : [];
  if (!recentSessionsBodyEl) return;
  recentSessionsBodyEl.replaceChildren();
  if (!lastSessionHistory.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="8" class="empty-state">Пока нет сессий.</td>';
    recentSessionsBodyEl.appendChild(row);
    return;
  }
  if (sessionsClapsToggleEl) {
    sessionsClapsToggleEl.textContent = currentSessionsClapsMode === 'earned' ? 'Ладошки: +' : 'Ладошки: -';
  }
  lastSessionHistory.forEach((item) => {
    const clapsValue = currentSessionsClapsMode === 'earned'
      ? Number(item.claps_earned || 0)
      : Number(item.claps_spent || 0);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.display_name || 'Игрок'}</td>
      <td>${item.telegram_id}</td>
      <td>${formatDateTime(item.session_started_at)}</td>
      <td>${formatDuration(item.duration_sec)}</td>
      <td>${formatNumber(item.best_score)}</td>
      <td>${formatNumber(clapsValue)}</td>
      <td>${formatNumber(item.moves_count)}</td>
      <td>${item.end_reason || 'active'}</td>
    `;
    recentSessionsBodyEl.appendChild(row);
  });
}

function renderBroadcasts(items = []) {
  if (broadcastHistoryBodyEl) {
    broadcastHistoryBodyEl.replaceChildren();
    if (!items.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="6" class="empty-state">Пока нет отправленных сообщений.</td>';
      broadcastHistoryBodyEl.appendChild(row);
    } else {
      items.forEach((item) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${formatDateTime(item.created_at)}</td>
          <td>${truncate(item.text, 110)}</td>
          <td>${formatNumber(item.sent_count)}</td>
          <td>${formatNumber(item.failed_count)}</td>
          <td>${formatNumber(item.returned_count)}</td>
          <td>${formatPercent(item.retention_rate)}</td>
        `;
        broadcastHistoryBodyEl.appendChild(row);
      });
    }
  }

  if (messageImpactListEl) {
    messageImpactListEl.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Пока нет отправленных сообщений.';
      messageImpactListEl.appendChild(empty);
      return;
    }

    items.slice(0, 6).forEach((item) => {
      const card = document.createElement('div');
      card.className = 'broadcast-item';
      card.innerHTML = `
        <div class="broadcast-item-top">
          <span class="broadcast-date">${formatDateTime(item.created_at)}</span>
          <span class="broadcast-rate">${formatPercent(item.retention_rate)}</span>
        </div>
        <div class="broadcast-text">${truncate(item.text, 180)}</div>
        <div class="broadcast-stats">
          <span>Отправлено: ${formatNumber(item.sent_count)}</span>
          <span>Ошибки: ${formatNumber(item.failed_count)}</span>
          <span>Вернулись: ${formatNumber(item.returned_count)}</span>
        </div>
      `;
      messageImpactListEl.appendChild(card);
    });
  }
}

function renderGiftPurchases(items = []) {
  if (!giftPurchasesBodyEl) return;
  giftPurchasesBodyEl.replaceChildren();
  const search = giftSearchEl?.value.trim().toLowerCase() || '';
  const giftFilter = giftFilterItemEl?.value || '';
  const statusFilter = giftFilterStatusEl?.value || '';
  const filteredItems = items.filter((item) => {
    const haystack = `${item.player_label || ''} ${item.code || ''}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (giftFilter && item.gift_id !== giftFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    return true;
  });
  if (!filteredItems.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="7" class="empty-state">Пока нет покупок.</td>';
    giftPurchasesBodyEl.appendChild(row);
    return;
  }
  filteredItems.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.player_label || 'Игрок'}</td>
      <td>${item.gift_id}</td>
      <td>${item.code}</td>
      <td>${formatDateTime(item.created_at)}</td>
      <td><span class="status-pill ${item.status}">${item.status === 'issued' ? 'Выдан' : 'Не выдан'}</span></td>
      <td><button type="button" class="dashboard-ghost-btn" data-gift-action="toggle-issued" data-code="${item.code}">${item.status === 'issued' ? 'Снять' : 'Выдать'}</button></td>
      <td><button type="button" class="dashboard-danger-btn" data-gift-action="delete" data-code="${item.code}">Удалить</button></td>
    `;
    giftPurchasesBodyEl.appendChild(row);
  });
}

function renderSummary(summary) {
  const overview = summary?.overview || {};
  const behavior = computeBehaviorMetrics(summary);
  metricEls.totalPlayers.textContent = formatNumber(overview.total_players);
  metricEls.activePlayers.textContent = formatNumber(overview.active_players_24h);
  metricEls.newPlayers.textContent = formatNumber(overview.new_players_24h);
  metricEls.sessions.textContent = formatNumber(overview.sessions_24h);
  metricEls.avgDuration.textContent = formatDuration(overview.avg_session_duration_sec_24h);
  metricEls.avgScore.textContent = formatNumber(overview.avg_best_score_24h);
  metricEls.clapsSpent.textContent = formatNumber(overview.claps_spent_24h);
  metricEls.clapsEarned.textContent = formatNumber(overview.claps_earned_24h);
  metricEls.giftsPurchased.textContent = formatNumber(overview.gifts_purchased_24h);
  metricEls.avgSpend.textContent = formatNumber(overview.avg_claps_spent_per_buyer_24h);
  metricEls.returningPlayers.textContent = formatNumber(overview.returning_players_24h);
  metricEls.messageRetention.textContent = overview.message_retention_rate
    ? formatPercent(overview.message_retention_rate)
    : formatNumber(overview.message_returned_users || 0);
  metricEls.peakHour.textContent = behavior.peakHourLabel;
  metricEls.sessionsPerPlayer.textContent = behavior.sessionsPerPlayerLabel;
  metricEls.timeoutShare.textContent = behavior.timeoutShareLabel;
  metricEls.menuExitShare.textContent = behavior.menuExitShareLabel;

  renderTopPlayers(summary?.top_players || []);
  renderSessions(summary?.session_history || []);
  renderBroadcasts(summary?.broadcasts || []);
  if (updatedAtEl) updatedAtEl.textContent = `Обновлено: ${formatDateTime(summary?.generated_at)}`;
}

function setActiveTab(tab) {
  currentDashboardTab = tab;
  analyticsTabEl?.classList.toggle('is-active', tab === 'analytics');
  sessionsTabEl?.classList.toggle('is-active', tab === 'sessions');
  giftsTabEl?.classList.toggle('is-active', tab === 'gifts');
  messagesTabEl?.classList.toggle('is-active', tab === 'messages');
  promosTabEl?.classList.toggle('is-active', tab === 'promos');
  analyticsPanelEl?.classList.toggle('is-active', tab === 'analytics');
  sessionsPanelEl?.classList.toggle('is-active', tab === 'sessions');
  giftsPanelEl?.classList.toggle('is-active', tab === 'gifts');
  messagesPanelEl?.classList.toggle('is-active', tab === 'messages');
  promosPanelEl?.classList.toggle('is-active', tab === 'promos');
}

function setBroadcastResult(message, isError = false) {
  if (!broadcastResultEl) return;
  broadcastResultEl.textContent = message || '';
  broadcastResultEl.classList.toggle('is-error', Boolean(isError));
}

function setPromoSubtab(tab) {
  currentPromoSubtab = tab;
  promoEditorSubtabEl?.classList.toggle('is-active', tab === 'editor');
  promoArchiveSubtabEl?.classList.toggle('is-active', tab === 'archive');
  promoGridEl?.classList.toggle('is-archive', tab === 'archive');
  promoListEl?.closest('.promo-list-card')?.classList.toggle('is-hidden', tab === 'editor');
  promoEditorNoteEl?.closest('.promo-editor-card')?.classList.toggle('is-hidden', tab !== 'editor');
  promoPreviewImageEl?.closest('.promo-preview-card')?.classList.toggle('is-hidden', tab !== 'editor');
}

function promoFormValue() {
  return {
    id: editingPromoId,
    title: promoTitleInputEl?.value.trim() || '',
    body: promoBodyInputEl?.value.trim() || '',
    image_url: promoImageInputEl?.value.trim() || '',
    secondary_label: promoSecondaryLabelInputEl?.value.trim() || 'Уже',
    primary_label: promoPrimaryLabelInputEl?.value.trim() || 'Перейти',
    primary_url: promoPrimaryUrlInputEl?.value.trim() || '',
  };
}

function resetPromoEditor() {
  editingPromoId = null;
  selectedPromoImageFile = null;
  revokePromoPreviewObjectUrl();
  if (promoEditorNoteEl) promoEditorNoteEl.textContent = 'Новый попап';
  if (promoTitleInputEl) promoTitleInputEl.value = '';
  if (promoBodyInputEl) promoBodyInputEl.value = '';
  if (promoImageInputEl) promoImageInputEl.value = '';
  if (promoImageFileInputEl) promoImageFileInputEl.value = '';
  if (promoSecondaryLabelInputEl) promoSecondaryLabelInputEl.value = 'Уже';
  if (promoPrimaryLabelInputEl) promoPrimaryLabelInputEl.value = 'Перейти';
  if (promoPrimaryUrlInputEl) promoPrimaryUrlInputEl.value = '';
  updatePromoPreview();
}

function fillPromoEditor(popup) {
  editingPromoId = popup?.id || null;
  selectedPromoImageFile = null;
  revokePromoPreviewObjectUrl();
  if (promoEditorNoteEl) promoEditorNoteEl.textContent = popup?.is_active ? 'Редактирование активного попапа' : 'Редактирование попапа';
  if (promoTitleInputEl) promoTitleInputEl.value = popup?.title || '';
  if (promoBodyInputEl) promoBodyInputEl.value = popup?.body || '';
  if (promoImageInputEl) promoImageInputEl.value = popup?.image_url || '';
  if (promoImageFileInputEl) promoImageFileInputEl.value = '';
  if (promoSecondaryLabelInputEl) promoSecondaryLabelInputEl.value = popup?.secondary_label || 'Уже';
  if (promoPrimaryLabelInputEl) promoPrimaryLabelInputEl.value = popup?.primary_label || 'Перейти';
  if (promoPrimaryUrlInputEl) promoPrimaryUrlInputEl.value = popup?.primary_url || '';
  updatePromoPreview();
  setPromoSubtab('editor');
  setActiveTab('promos');
}

function updatePromoPreview() {
  const data = promoFormValue();
  if (promoPreviewTitleEl) promoPreviewTitleEl.textContent = data.title || 'Заголовок попапа';
  if (promoPreviewBodyEl) promoPreviewBodyEl.textContent = data.body || 'Описание появится здесь после заполнения формы.';
  if (promoPreviewSecondaryEl) promoPreviewSecondaryEl.textContent = data.secondary_label || 'Уже';
  if (promoPreviewPrimaryEl) promoPreviewPrimaryEl.textContent = data.primary_label || 'Перейти';
  const imageSrc = selectedPromoImageFile
    ? (() => {
        revokePromoPreviewObjectUrl();
        promoPreviewObjectUrl = URL.createObjectURL(selectedPromoImageFile);
        return promoPreviewObjectUrl;
      })()
    : data.image_url || '';
  if (promoPreviewImageEl) {
    promoPreviewImageEl.src = imageSrc;
    promoPreviewImageEl.style.display = imageSrc ? 'block' : 'none';
  }
  if (promoPreviewPlaceholderEl) {
    promoPreviewPlaceholderEl.style.display = imageSrc ? 'none' : 'grid';
  }
}

function renderPromoList(items = []) {
  lastPromoRows = Array.isArray(items) ? items : [];
  if (!promoListEl) return;
  promoListEl.replaceChildren();
  if (!lastPromoRows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Пока нет попапов.';
    promoListEl.appendChild(empty);
    return;
  }
  lastPromoRows.forEach((popup) => {
    const card = document.createElement('article');
    card.className = 'promo-item';
    const status = popup.archived_at ? 'Архив' : popup.is_active ? 'Активен' : 'Черновик';
    const views = Number(popup.stats?.views || 0);
    const opens = Number(popup.stats?.opens || 0);
    const dismisses = Number(popup.stats?.dismisses || 0);
    const ctr = views ? Math.round((opens / views) * 100) : 0;
    const dismissRate = views ? Math.round((dismisses / views) * 100) : 0;
    card.innerHTML = `
      <div class="promo-item-thumb">${popup.image_url ? `<img src="${popup.image_url}" alt="${popup.title}" />` : ''}</div>
      <div class="promo-item-copy">
        <div class="promo-item-title-row">
          <span class="promo-item-title">${popup.title}</span>
          <span class="promo-status-pill">${status}</span>
        </div>
        <div class="promo-item-body">${popup.body}</div>
        <div class="promo-item-meta">${popup.primary_label} → ${popup.primary_url}</div>
        <div class="promo-item-stats">
          <span>Показы: ${formatNumber(views)}</span>
          <span>Закрытия: ${formatNumber(dismisses)} (${dismissRate}%)</span>
          <span>Переходы: ${formatNumber(opens)} (${ctr}%)</span>
        </div>
      </div>
      <div class="promo-item-actions">
        <button type="button" data-action="edit" data-id="${popup.id}" class="dashboard-ghost-btn">Редактировать</button>
        <button type="button" data-action="activate" data-id="${popup.id}">${popup.is_active ? 'Активен' : 'Запустить'}</button>
        <button type="button" data-action="deactivate" data-id="${popup.id}" class="dashboard-ghost-btn">Стоп</button>
        <button type="button" data-action="archive" data-id="${popup.id}" class="dashboard-ghost-btn">В архив</button>
      </div>
    `;
    promoListEl.appendChild(card);
  });
}

async function fetchSummary() {
  if (!SUMMARY_URL) throw new Error('Не задан SUPABASE_URL.');
  const data = await postDashboardJson(SUMMARY_URL, { period: currentAnalyticsPeriod });
  renderSummary(data);
}

async function fetchPromos() {
  if (!PROMO_ADMIN_URL) throw new Error('Не задан SUPABASE_URL.');
  const data = await postDashboardJson(PROMO_ADMIN_URL, { action: 'list' });
  renderPromoList(data?.popups || []);
}

async function fetchGiftPurchases() {
  if (!GIFT_ADMIN_URL) throw new Error('Не задан SUPABASE_URL.');
  const data = await postDashboardJson(GIFT_ADMIN_URL, { action: 'list' });
  lastGiftPurchases = data?.purchases || [];
  renderGiftPurchases(lastGiftPurchases);
}

async function runGiftAction(action, code) {
  if (action === 'delete' && !window.confirm('Удалить покупку из системы?')) {
    return;
  }
  await postDashboardJson(GIFT_ADMIN_URL, { action, code });
  await fetchGiftPurchases();
}

async function runBroadcast(dryRun) {
  if (!MESSAGE_ADMIN_URL) throw new Error('Не задан SUPABASE_URL.');
  const text = broadcastTextEl?.value.trim() || '';
  if (!text) throw new Error('Введите текст сообщения.');
  const data = await postDashboardJson(MESSAGE_ADMIN_URL, {
    text,
    dryRun: Boolean(dryRun),
    limit: 2000,
  });

  if (dryRun) {
    setBroadcastResult(`Получателей: ${formatNumber(data?.recipients || 0)}`);
    return;
  }

  setBroadcastResult(`Отправлено: ${formatNumber(data?.sent || 0)}. Ошибок: ${formatNumber(data?.failed || 0)}.`);
  await fetchSummary();
}

async function fetchAllDashboardData() {
  const secret = loadDashboardSecret();
  if (!secret) {
    setStatus('');
    setSecretPanelCollapsed(false);
    return;
  }
  setLoading(true);
  try {
    await Promise.all([fetchSummary(), fetchGiftPurchases(), fetchPromos()]);
    setStatus('');
    setSecretPanelCollapsed(true);
  } finally {
    setLoading(false);
  }
}

async function savePromo(isActive) {
  const uploadedImageUrl = await uploadPromoImageIfNeeded();
  const payload = { ...promoFormValue(), image_url: uploadedImageUrl };
  if (!payload.title || !payload.body || !payload.image_url || !payload.primary_url) {
    throw new Error('Заполните заголовок, описание, изображение и ссылку.');
  }
  await postDashboardJson(PROMO_ADMIN_URL, {
    action: 'save',
    popup: {
      ...payload,
      is_active: Boolean(isActive),
    },
  });
  await fetchPromos();
  resetPromoEditor();
}

async function runPromoAction(action, popupId) {
  await postDashboardJson(PROMO_ADMIN_URL, { action, popupId });
  await fetchPromos();
}

function connectDashboard() {
  const secret = secretInputEl?.value.trim();
  if (!secret) {
    setStatus('Введите DASHBOARD_SECRET.');
    setSecretPanelCollapsed(false);
    return;
  }
  saveDashboardSecret(secret);
  void fetchAllDashboardData().catch((error) => setStatus(error.message || 'Не удалось загрузить dashboard'));
}

function startAutoRefresh() {
  if (refreshTimerId) clearInterval(refreshTimerId);
  refreshTimerId = setInterval(() => {
    if (loadDashboardSecret()) {
      void fetchAllDashboardData().catch(() => {});
    }
  }, 30000);
}

analyticsTabEl?.addEventListener('click', () => setActiveTab('analytics'));
sessionsTabEl?.addEventListener('click', () => setActiveTab('sessions'));
giftsTabEl?.addEventListener('click', () => setActiveTab('gifts'));
messagesTabEl?.addEventListener('click', () => setActiveTab('messages'));
promosTabEl?.addEventListener('click', () => setActiveTab('promos'));
promoEditorSubtabEl?.addEventListener('click', () => setPromoSubtab('editor'));
promoArchiveSubtabEl?.addEventListener('click', () => setPromoSubtab('archive'));
connectBtnEl?.addEventListener('click', connectDashboard);
toggleSecretBtnEl?.addEventListener('click', () => {
  const collapsed = authPanelEl?.classList.contains('is-collapsed');
  setSecretPanelCollapsed(!collapsed);
});
promoSaveDraftBtnEl?.addEventListener('click', () => void savePromo(false).catch((error) => setStatus(error.message || 'Не удалось сохранить попап')));
promoPublishBtnEl?.addEventListener('click', () => void savePromo(true).catch((error) => setStatus(error.message || 'Не удалось запустить попап')));
promoResetBtnEl?.addEventListener('click', resetPromoEditor);
promoListEl?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action][data-id]');
  if (!button) return;
  const action = button.dataset.action;
  const popupId = button.dataset.id;
  if (!action || !popupId) return;
  if (action === 'edit') {
    const popup = lastPromoRows.find((item) => item.id === popupId);
    if (popup) fillPromoEditor(popup);
    return;
  }
  void runPromoAction(action, popupId).catch((error) => setStatus(error.message || 'Не удалось изменить попап'));
});
[promoTitleInputEl, promoBodyInputEl, promoImageInputEl, promoSecondaryLabelInputEl, promoPrimaryLabelInputEl, promoPrimaryUrlInputEl].forEach((el) => {
  el?.addEventListener('input', updatePromoPreview);
});
promoImageFileInputEl?.addEventListener('change', () => {
  selectedPromoImageFile = promoImageFileInputEl.files?.[0] || null;
  updatePromoPreview();
});
periodSwitchEl?.addEventListener('click', (event) => {
  const button = event.target.closest('.period-btn');
  if (!button) return;
  const nextPeriod = button.dataset.period || '24h';
  currentAnalyticsPeriod = nextPeriod;
  periodSwitchEl.querySelectorAll('.period-btn').forEach((node) => {
    node.classList.toggle('is-active', node === button);
  });
  void fetchSummary().catch((error) => setStatus(error.message || 'Не удалось обновить аналитику'));
});
[giftSearchEl, giftFilterItemEl, giftFilterStatusEl].forEach((el) => {
  el?.addEventListener('input', () => renderGiftPurchases(lastGiftPurchases));
  el?.addEventListener('change', () => renderGiftPurchases(lastGiftPurchases));
});
giftPurchasesBodyEl?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-gift-action][data-code]');
  if (!button) return;
  void runGiftAction(button.dataset.giftAction || '', button.dataset.code || '').catch((error) =>
    setStatus(error.message || 'Не удалось обновить статус подарка'),
  );
});
sessionsClapsToggleEl?.addEventListener('click', () => {
  currentSessionsClapsMode = currentSessionsClapsMode === 'earned' ? 'spent' : 'earned';
  renderSessions(lastSessionHistory);
});
broadcastDryRunBtnEl?.addEventListener('click', () => {
  void runBroadcast(true).catch((error) => setBroadcastResult(error.message || 'Не удалось проверить аудиторию', true));
});
broadcastSendBtnEl?.addEventListener('click', () => {
  void runBroadcast(false).catch((error) => setBroadcastResult(error.message || 'Не удалось отправить сообщение', true));
});

const savedSecret = loadDashboardSecret();
if (savedSecret && secretInputEl) {
  secretInputEl.value = savedSecret;
  void fetchAllDashboardData().catch((error) => setStatus(error.message || 'Не удалось загрузить dashboard'));
} else {
  setSecretPanelCollapsed(false);
}
resetPromoEditor();
setPromoSubtab('editor');
startAutoRefresh();
