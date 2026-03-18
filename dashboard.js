const SUPABASE_URL = window.__SUPABASE_URL__ || '';
const SUMMARY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analytics-summary` : '';
const DASHBOARD_SECRET_KEY = 'gold_match_dashboard_secret';

const secretInputEl = document.getElementById('dashboard-secret');
const connectBtnEl = document.getElementById('connect-dashboard');
const refreshBtnEl = document.getElementById('refresh-dashboard');
const statusEl = document.getElementById('dashboard-status');
const updatedAtEl = document.getElementById('dashboard-updated-at');

const metricEls = {
  totalPlayers: document.getElementById('metric-total-players'),
  activePlayers: document.getElementById('metric-active-players'),
  newPlayers: document.getElementById('metric-new-players'),
  sessions: document.getElementById('metric-sessions'),
  avgDuration: document.getElementById('metric-avg-duration'),
  avgScore: document.getElementById('metric-avg-score'),
};

const topPlayersBodyEl = document.getElementById('top-players-body');
const topEventsListEl = document.getElementById('top-events-list');
const recentSessionsBodyEl = document.getElementById('recent-sessions-body');

let refreshTimerId = null;

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
    row.innerHTML = '<td colspan="6" class="empty-state">Пока нет сессий.</td>';
    recentSessionsBodyEl.appendChild(row);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.telegram_id}</td>
      <td>${formatDateTime(item.session_started_at)}</td>
      <td>${formatDuration(item.duration_sec)}</td>
      <td>${formatNumber(item.best_score)}</td>
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

  renderTopPlayers(summary?.top_players || []);
  renderTopEvents(summary?.top_events_24h || []);
  renderRecentSessions(summary?.recent_sessions || []);
  updatedAtEl.textContent = `Обновлено: ${formatDateTime(summary?.generated_at)}`;
}

async function fetchSummary() {
  const secret = loadDashboardSecret();
  if (!secret) {
    setStatus('Введите DASHBOARD_SECRET.');
    return;
  }
  if (!SUMMARY_URL) {
    setStatus('Не задан SUPABASE_URL.');
    return;
  }

  setStatus('Загружаем dashboard...');
  const response = await fetch(SUMMARY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-secret': secret,
    },
    body: '{}',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Не удалось загрузить dashboard');
  }

  renderSummary(data);
  setStatus('');
}

function connectDashboard() {
  const secret = secretInputEl.value.trim();
  if (!secret) {
    setStatus('Введите DASHBOARD_SECRET.');
    return;
  }
  saveDashboardSecret(secret);
  void fetchSummary();
}

function startAutoRefresh() {
  if (refreshTimerId) clearInterval(refreshTimerId);
  refreshTimerId = setInterval(() => {
    if (loadDashboardSecret()) {
      void fetchSummary();
    }
  }, 30000);
}

connectBtnEl?.addEventListener('click', connectDashboard);
refreshBtnEl?.addEventListener('click', () => void fetchSummary());

const savedSecret = loadDashboardSecret();
if (savedSecret && secretInputEl) {
  secretInputEl.value = savedSecret;
  void fetchSummary();
}
startAutoRefresh();
