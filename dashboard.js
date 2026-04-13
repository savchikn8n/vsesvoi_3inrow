const SUPABASE_URL = window.__SUPABASE_URL__ || '';
const SUMMARY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analytics-summary` : '';
const PROMO_ADMIN_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/promo-admin` : '';
const PROMO_UPLOAD_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/promo-upload` : '';
const DASHBOARD_SECRET_KEY = 'gold_match_dashboard_secret';

const secretInputEl = document.getElementById('dashboard-secret');
const connectBtnEl = document.getElementById('connect-dashboard');
const refreshBtnEl = document.getElementById('refresh-dashboard');
const statusEl = document.getElementById('dashboard-status');
const updatedAtEl = document.getElementById('dashboard-updated-at');
const analyticsTabEl = document.getElementById('tab-analytics');
const promosTabEl = document.getElementById('tab-promos');
const analyticsPanelEl = document.getElementById('analytics-panel');
const promosPanelEl = document.getElementById('promos-panel');

const metricEls = {
  totalPlayers: document.getElementById('metric-total-players'),
  activePlayers: document.getElementById('metric-active-players'),
  newPlayers: document.getElementById('metric-new-players'),
  sessions: document.getElementById('metric-sessions'),
  avgDuration: document.getElementById('metric-avg-duration'),
  avgScore: document.getElementById('metric-avg-score'),
  clapsSpent: document.getElementById('metric-claps-spent'),
};

const topPlayersBodyEl = document.getElementById('top-players-body');
const topEventsListEl = document.getElementById('top-events-list');
const recentSessionsBodyEl = document.getElementById('recent-sessions-body');

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

let refreshTimerId = null;
let currentDashboardTab = 'analytics';
let editingPromoId = null;
let lastPromoRows = [];
let selectedPromoImageFile = null;
let promoPreviewObjectUrl = '';

function loadDashboardSecret() {
  return sessionStorage.getItem(DASHBOARD_SECRET_KEY) || '';
}

function saveDashboardSecret(secret) {
  sessionStorage.setItem(DASHBOARD_SECRET_KEY, secret);
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message || '';
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
  if (!topPlayersBodyEl) return;
  topPlayersBodyEl.replaceChildren();
  if (!items.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="empty-state">Пока нет данных.</td>';
    topPlayersBodyEl.appendChild(row);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.rank}</td>
      <td>${item.display_name}</td>
      <td>${formatNumber(item.best_score)}</td>
      <td>${formatNumber(item.clap_balance)}</td>
    `;
    topPlayersBodyEl.appendChild(row);
  });
}

function renderTopEvents(items = []) {
  if (!topEventsListEl) return;
  topEventsListEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Пока нет событий.';
    topEventsListEl.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.innerHTML = `
      <span class="event-name">${item.event_name}</span>
      <span class="event-count">${formatNumber(item.count)}</span>
    `;
    topEventsListEl.appendChild(row);
  });
}

function renderRecentSessions(items = []) {
  if (!recentSessionsBodyEl) return;
  recentSessionsBodyEl.replaceChildren();
  if (!items.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="8" class="empty-state">Пока нет сессий.</td>';
    recentSessionsBodyEl.appendChild(row);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.display_name || 'Игрок'}</td>
      <td>${item.telegram_id}</td>
      <td>${formatDateTime(item.session_started_at)}</td>
      <td>${formatDuration(item.duration_sec)}</td>
      <td>${formatNumber(item.best_score)}</td>
      <td>${formatNumber(item.claps_spent)}</td>
      <td>${formatNumber(item.moves_count)}</td>
      <td>${item.end_reason || 'active'}</td>
    `;
    recentSessionsBodyEl.appendChild(row);
  });
}

function renderSummary(summary) {
  const overview = summary?.overview || {};
  metricEls.totalPlayers.textContent = formatNumber(overview.total_players);
  metricEls.activePlayers.textContent = formatNumber(overview.active_players_24h);
  metricEls.newPlayers.textContent = formatNumber(overview.new_players_24h);
  metricEls.sessions.textContent = formatNumber(overview.sessions_24h);
  metricEls.avgDuration.textContent = formatDuration(overview.avg_session_duration_sec_24h);
  metricEls.avgScore.textContent = formatNumber(overview.avg_best_score_24h);
  metricEls.clapsSpent.textContent = formatNumber(overview.claps_spent_24h);
  renderTopPlayers(summary?.top_players || []);
  renderTopEvents(summary?.top_events_24h || []);
  renderRecentSessions(summary?.recent_sessions || []);
  updatedAtEl.textContent = `Обновлено: ${formatDateTime(summary?.generated_at)}`;
}

function setActiveTab(tab) {
  currentDashboardTab = tab;
  analyticsTabEl?.classList.toggle('is-active', tab === 'analytics');
  promosTabEl?.classList.toggle('is-active', tab === 'promos');
  analyticsPanelEl?.classList.toggle('is-active', tab === 'analytics');
  promosPanelEl?.classList.toggle('is-active', tab === 'promos');
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
          <span>Показы: ${formatNumber(popup.stats?.views)}</span>
          <span>Отмена: ${formatNumber(popup.stats?.dismisses)}</span>
          <span>Переходы: ${formatNumber(popup.stats?.opens)}</span>
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
  const data = await postDashboardJson(SUMMARY_URL, {});
  renderSummary(data);
}

async function fetchPromos() {
  if (!PROMO_ADMIN_URL) throw new Error('Не задан SUPABASE_URL.');
  const data = await postDashboardJson(PROMO_ADMIN_URL, { action: 'list' });
  renderPromoList(data?.popups || []);
}

async function fetchAllDashboardData() {
  const secret = loadDashboardSecret();
  if (!secret) {
    setStatus('Введите DASHBOARD_SECRET.');
    return;
  }
  setStatus('Загружаем dashboard...');
  await Promise.all([fetchSummary(), fetchPromos()]);
  setStatus('');
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
promosTabEl?.addEventListener('click', () => setActiveTab('promos'));
connectBtnEl?.addEventListener('click', connectDashboard);
refreshBtnEl?.addEventListener('click', () => void fetchAllDashboardData().catch((error) => setStatus(error.message || 'Ошибка обновления')));
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

const savedSecret = loadDashboardSecret();
if (savedSecret && secretInputEl) {
  secretInputEl.value = savedSecret;
  void fetchAllDashboardData().catch((error) => setStatus(error.message || 'Не удалось загрузить dashboard'));
}
resetPromoEditor();
startAutoRefresh();
