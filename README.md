# Все Свои: 3 в ряд

Telegram Mini App для кальянной "Все свои": мобильная match-3 игра с профилем игрока, рекордами, балансом "ладошек", магазином подарков/скидок, промо, рассылками, обратной связью и операционным dashboard для команды.

Текущий статус:

- Поверхность продукта: Telegram-first Mini App, не самостоятельное iOS/Android приложение.
- Фронтенд в production: статический HTML/CSS/JS, Vercel project `vsesvoi-3inrow`.
- Бэкенд: Supabase Edge Functions + SQL migrations.
- Supabase project id: `tnngitplssufqeqpxuib`.
- Среда выполнения: browser JavaScript, Deno Edge Functions, встроенный Node.js test runner.
- Менеджер пакетов: отсутствует; в корне нет `package.json`.
- Модель хранения: Supabase как источник истины для профиля, баланса, рекордов, покупок, аналитики, промо и game-session validation; browser storage используется только как локальный кэш/UX fallback.

## Содержание

- [Границы проекта](#границы-проекта)
- [Текущие возможности](#текущие-возможности)
- [Архитектура](#архитектура)
- [Потоки данных](#потоки-данных)
- [Модель хранения](#модель-хранения)
- [Безопасность и приватность](#безопасность-и-приватность)
- [Переменные окружения](#переменные-окружения)
- [Локальная разработка](#локальная-разработка)
- [Проверка](#проверка)
- [Деплой](#деплой)
- [Карта кода](#карта-кода)
- [API-контракт](#api-контракт)
- [Известные ограничения](#известные-ограничения)
- [Версионирование и журнал изменений](#версионирование-и-журнал-изменений)
- [Дорожная карта и будущие интеграции](#дорожная-карта-и-будущие-интеграции)
- [Передача контекста агентам](#передача-контекста-агентам)

## Границы проекта

Этот репозиторий содержит:

- статический фронтенд Telegram Mini App;
- игровую match-3 логику и browser runtime;
- Supabase Edge Functions;
- SQL setup/migrations для Supabase;
- dashboard для staff/admin операций;
- тесты для правил игры, wiring, anti-cheat, магазина, maintenance и security hardening;
- planning/spec документы для крупных изменений.

В репозитории нет:

- npm/pnpm/yarn build pipeline;
- отдельного mobile wrapper на Capacitor/Swift/Kotlin;
- отдельного backend server process вне Supabase;
- standalone auth flow вне Telegram Web App `initData`.

## Текущие возможности

Игрок в Mini App:

- инициализация Telegram Web App через `window.Telegram.WebApp`;
- Telegram `initData` auth через Supabase function `telegram-auth`;
- match-3 gameplay на 7x7 board с seeded session support;
- server-issued game sessions: `game-session-start` выдает seed/session, `game-session-submit` replay-валидирует ходы;
- синхронизация score/clap progress через `score-submit`;
- server-side guard: увеличение рекорда или баланса требует принятой записи `game_session_validations`;
- редактор профиля: display name, avatar choice, Telegram identity fields;
- leaderboard;
- магазин:
  - подарки;
  - скидки;
  - серверное списание ладошек;
  - уникальные коды покупок;
  - cooldown для скидок;
- modal со своими gift/discount codes;
- форма обратной связи;
- runtime maintenance screen;
- скрытый page-load-only dev bypass для тестирования maintenance/GameHub;
- promo popups и отслеживание promo actions;
- claim flow для broadcast bonus;
- share record flow через Telegram link.

Админская поверхность:

- `dashboard.html` + `dashboard.js`.
- Dashboard secret хранится только в browser `sessionStorage`.
- Analytics summary.
- Администрирование gift/discount purchases.
- Модерация feedback.
- Создание и планирование broadcast.
- Редактор promo popup и загрузка изображений в Supabase Storage bucket `promo-assets`.
- Редактор runtime maintenance config.

Альфа/инкубационная поверхность:

- Hidden alpha GameHub entry существует для "Угольной башни".
- "Угольная башня" описана как alpha/future internal module.
- Реальный Coal Tower gameplay еще не production-ready в этом репозитории.

## Архитектура

```text
Мобильный клиент Telegram
  -> index.html / styles.css / game.js
  -> pure browser modules в src/game/* и src/shop/catalog.js
  -> Supabase Edge Functions в supabase/functions/*
  -> Supabase Postgres tables из supabase/sql/* и supabase/migrations/*
  -> Telegram Bot API для messages/reminders/admin purchase notifications

Браузер администратора
  -> dashboard.html / dashboard.css / dashboard.js
  -> admin Edge Functions с защитой DASHBOARD_SECRET
  -> Supabase Postgres + Supabase Storage
```

Ключевые архитектурные правила:

- `game.js` пока остается главным browser orchestrator: UI, animations, modal state, analytics, Supabase calls, session lifecycle.
- Pure match-3 rules живут в `src/game/core/*` и mirrored/ported для Deno в `supabase/functions/_shared/rules-engine.ts`.
- Browser не считается доверенным источником увеличения score или claps. Client-reported progress должен подтверждаться server validation.
- Edge Functions настроены с `verify_jwt = false`, потому что Telegram Mini App clients не используют Supabase Auth JWT. Functions должны самостоятельно проверять Telegram `initData` или dashboard/cron secrets.
- Database changes должны быть additive. Existing player balances, purchases и records нельзя сбрасывать как часть feature work.

## Потоки данных

### Обычный вход игрока

1. Telegram открывает `index.html` внутри WebView.
2. `index.html` задает `window.__SUPABASE_URL__`.
3. Browser scripts загружаются в таком порядке:
   - `maintenance-config.js`
   - `src/game/core/rng.js`
   - `src/game/core/board-core.js`
   - `src/game/core/resolution-core.js`
   - `src/game/core/rules-engine.js`
   - `src/game/runtime/progress-adapter.js`
   - `src/game/runtime/board-renderer.js`
   - `src/shop/catalog.js`
   - `game.js`
4. `game.js` читает Telegram Web App context и `initData`.
5. Runtime config загружается через `runtime-config`.
6. `telegram-auth` проверяет `initData`, делает upsert профиля и возвращает текущий profile/progress.
7. Игрок может запустить match-3, открыть leaderboard/shop/feedback или взаимодействовать с promos.

### Match-3 сессия и прогресс

1. Client вызывает `game-session-start` с Telegram `initData` (server применяет rate limit сессий на игрока).
2. Server проверяет Telegram auth, создает `game_sessions` и возвращает `sessionId`, `seed`, `rulesVersion`, `size`, `colorCount`.
3. Client инициализирует board через shared deterministic rules. Если ответ сервера опоздал, client стартует локально и принимает «опоздавшую» сессию только до первого хода.
4. Client локально записывает принятые ходы.
5. При завершении или lifecycle flush client вызывает `game-session-submit` с moves и client final progress.
6. Server делает replay от seed, проверяет правдоподобную скорость ходов и пишет `game_session_moves` + `game_session_validations`. Session можно submit повторно — paid continue продлевает тот же run, и client банкует его перед каждым списанием.
7. Если replay принят, server сам начисляет прогресс в `profiles` через атомарный RPC `credit_game_session_result`: `best_score = GREATEST(...)`, а claps — только дельтой сверх `game_sessions.credited_claps` (идемпотентно, без двойного начисления при пересабмите).
8. Client дополнительно вызывает `score-submit` с final best score и `sessionId`; увеличение best score принимается только при подтвержденной validation window. Clap balance из client-репорта никогда не повышается — он server-authoritative.
9. Existing `profiles.best_score` и `profiles.clap_balance` этим путем никогда не уменьшаются.

### Покупка в магазине

1. Игрок выбирает gift или discount из `src/shop/catalog.js`.
2. Client вызывает `purchase-gift` с `initData` и `giftId`.
3. Server проверяет Telegram auth.
4. Server читает `profiles.clap_balance`.
5. Для скидок server проверяет 5-дневный discount cooldown.
6. Server делает защищенное списание balance с previous balance в update condition.
7. Server вставляет `shop_purchases` с generated unique code.
8. Если insert покупки падает после списания, function восстанавливает previous clap balance.
9. Optional admin Telegram notification отправляется, если настроены admin bot secrets.

### Операции dashboard

1. Staff открывает `dashboard.html`.
2. Staff вводит `DASHBOARD_SECRET`.
3. `dashboard.js` отправляет secret через `x-dashboard-secret` или `Authorization: Bearer`.
4. Admin functions читают/пишут analytics, gifts, feedback, broadcasts, promos и runtime config.
5. Dashboard secret хранится в `sessionStorage`, не в persistent local storage.

## Модель хранения

Supabase Postgres tables и поверхности:

- `profiles`: Telegram identity, display profile, avatar, best score, clap balance, notification fields.
- `analytics_sessions`: session-level analytics.
- `analytics_events`: event-level analytics и dashboard behavior data.
- `shop_purchases`: gift/discount purchases, generated codes, status и display snapshots.
- `promo_popups`: dashboard-managed promo popup definitions.
- `promo_popup_events`: promo impressions/actions.
- `player_feedback`: user feedback messages и moderation state.
- `broadcast_messages`: broadcast content, scheduling и status.
- `broadcast_message_recipients`: recipient delivery records.
- `broadcast_bonus_claims`: one-time broadcast bonus claims.
- `app_runtime_config`: runtime maintenance/config document.
- `score_submissions`: audit log для accepted/rejected score-submit attempts.
- `game_sessions`: server-issued game session envelopes (single `started -> submitted` transition).
- `game_session_moves`: compact replay move rows.
- `game_session_validations`: server replay results и mismatch evidence.

SQL функции:

- `credit_game_session_result(session_id, telegram_id, server_score, server_claps_earned)`: атомарное идемпотентное начисление из accepted replay — best через GREATEST, claps положительной дельтой сверх `game_sessions.credited_claps` под row lock (security definer, execute только для service_role). Актуальный путь.
- `apply_game_session_result(telegram_id, server_score, claps_earned)`: предыдущая версия (оставлена, не используется game-session-submit).

Хранилище Supabase:

- `promo-assets`: public bucket для uploaded promo images.

Хранилище браузера:

- `gold_match_best_score`: local best-score cache.
- `gold_match_claps_balance`: local clap-balance cache.
- `gold_match_profile`: local profile cache.
- `gold_match_leaderboard_cache_v1`: short-lived leaderboard cache.
- `gold_match_runtime_config_cache_v1`: short-lived runtime config cache.
- `gold_match_seen_promo_ids_v1`: local set уже увиденных promo IDs.

Важный storage invariant:

- Maintenance/GameHub dev bypass должен оставаться page-load-only state. Не сохранять его в `localStorage` или `sessionStorage`.

## Безопасность и приватность

Что уходит с клиента:

- Telegram Web App `initData` отправляется в player-facing Edge Functions.
- Profile fields, selected avatar, score/clap progress, replay moves, analytics events, feedback text, shop purchase requests и promo actions отправляются в Supabase.
- Telegram Bot API получает outbound messages для reminders, broadcasts и optional admin purchase notifications.

Что хранится server-side:

- Telegram IDs и Telegram display fields.
- Player display names и avatars.
- Scores, clap balances, purchases, generated gift/discount codes.
- Analytics sessions/events.
- Feedback.
- Promo и broadcast events.
- Game-session replay/validation evidence.

Модель безопасности:

- Пользовательские functions должны проверять Telegram `initData` через `TELEGRAM_BOT_TOKEN`.
- Admin functions должны требовать `DASHBOARD_SECRET`.
- Cron/broadcast reminder endpoints должны требовать `REMINDER_CRON_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` предназначен только для Edge Functions. Никогда не раскрывать его в browser code.
- `window.__SUPABASE_URL__` можно раскрывать; это только project URL.
- Supabase function JWT verification отключена config-ом, поэтому каждая function должна держать собственную защиту.
- RLS включен на ключевых tables, но Edge Functions используют service-role access. Function-level validation считается основной границей.
- Clap balance повышается только server-side: accepted game-session replay (RPC `apply_game_session_result`), broadcast bonus claim и обратные операции покупок. Client-reported clap balance — только audit.
- Все списания баланса используют compare-and-set по previous balance.
- Dashboard рендерит player-controlled строки (display names, event names, codes, promo fields) только через `escapeHtml` перед `innerHTML` — dashboard работает в контексте `DASHBOARD_SECRET`, stored XSS недопустим.

Приватность и compliance:

- App является Telegram-first и хранит identifiable Telegram profile data.
- Standalone публикация в App Store / Google Play требует privacy policy, deletion flow, store metadata и решений по non-Telegram auth.
- Tobacco/hookah-themed reward content, особенно `Бесплатный покур кальяна`, является major store-policy risk.

## Переменные окружения

Секреты Edge Functions:

| Переменная | Обязательность | Где используется | Назначение |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Да | Player auth, profile, game, shop, analytics, promo, feedback, messaging | Проверяет Telegram `initData`; отправляет Telegram messages для bot flows. |
| `SUPABASE_URL` | Да | Most Edge Functions | Supabase project URL для service-role client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Да | Most Edge Functions | Server-side database/storage access. Никогда не раскрывать в browser. |
| `DASHBOARD_SECRET` | Да для dashboard/admin | `analytics-summary`, `gift-admin`, `messages-admin`, `feedback-admin`, `promo-admin`, `promo-upload`, `runtime-config-admin`, `process-scheduled-broadcasts` | Защита staff/admin access. |
| `REMINDER_CRON_SECRET` | Да для cron/broadcast endpoints | `send-inactive-reminders`, `broadcast-message` | Защищает scheduled/bulk message endpoints. |
| `MAINTENANCE_DEV_PASSWORD` | Да для dev bypass | `maintenance-dev-auth` | Password для page-load-only maintenance/GameHub test access. |
| `ADMIN_GIFTS_BOT_TOKEN` | Опционально | `purchase-gift` | Отправляет admin notification при успешной покупке. |
| `ADMIN_GIFTS_CHAT_ID` | Опционально | `purchase-gift` | Target chat для purchase notifications. |

Глобальная переменная фронтенда:

```html
<script>
  window.__SUPABASE_URL__ = 'https://tnngitplssufqeqpxuib.supabase.co';
</script>
```

Минимальная форма local `.env` для Supabase functions:

```bash
TELEGRAM_BOT_TOKEN=...
SUPABASE_URL=https://tnngitplssufqeqpxuib.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
DASHBOARD_SECRET=...
REMINDER_CRON_SECRET=...
MAINTENANCE_DEV_PASSWORD=...
ADMIN_GIFTS_BOT_TOKEN=...
ADMIN_GIFTS_CHAT_ID=...
```

Не коммитить реальные значения secrets.

## Локальная разработка

В текущем состоянии репозитория нет шага `npm install`.

Запустить static app:

```bash
python3 -m http.server 4180
```

Затем открыть:

```text
http://127.0.0.1:4180/index.html
http://127.0.0.1:4180/dashboard.html
```

Примечания:

- Вне Telegram нет `window.Telegram.WebApp.initData`, поэтому authenticated player flows будут падать или показывать auth prompts.
- Static UI, rendering, local game interactions и dashboard shell можно проверять локально.
- Browser code ожидает, что `window.__SUPABASE_URL__` задан до `game.js`.
- Для локального тестирования real Supabase functions используйте Supabase CLI и env file с secrets:

```bash
supabase functions serve --env-file .env.local
```

Deployed frontend сейчас указывает на production Supabase URL в `index.html`. Перед write-тестами против production нужна осторожность.

## Проверка

Запустить весь local test suite:

```bash
node --test tests/*.test.js
```

Фокусные проверки:

```bash
node --test tests/security-hardening.test.js
node --test tests/game-start-stability.test.js
node --test tests/maintenance-dev-bypass.test.js
node --test tests/shop-catalog.test.js tests/shop-discounts-backend.test.js
node --test tests/game-rules-engine.test.js tests/server-rules-engine-source.test.js
```

Что покрывают tests:

- deterministic match-3 rules и seeded replay;
- board core и resolution contracts;
- browser module load order;
- renderer contract;
- progress adapter behavior;
- protection от game-start race;
- server-authoritative score/clap validation;
- maintenance dev bypass без browser storage;
- shop catalog, discounts, backend contracts и dashboard labels;
- static UI timing/control invariants.

Перед изменением live score, balance, purchase или session logic:

1. Запустить focused security/game-session tests.
2. Запустить полный `node --test tests/*.test.js`.
3. Проверить, затрагивает ли migration existing player data.
4. Не делать production writes, пока не понятны row counts/backups.

## Деплой

Фронтенд:

- Static files деплоятся через Vercel project `vsesvoi-3inrow`.
- Предыдущие production deploys использовали:

```bash
npx vercel deploy --prod --yes
```

Supabase:

- Project id в `supabase/config.toml`: `tnngitplssufqeqpxuib`.
- Functions перечислены в `supabase/config.toml` с `verify_jwt = false`.
- Для initial/manual setup применять SQL по порядку из `supabase/sql/*`.
- Также есть migration files в `supabase/migrations/*` для later Supabase CLI flow.

Типовой deploy shape:

```bash
supabase db push
supabase functions deploy telegram-auth --use-api --no-verify-jwt
supabase functions deploy profile-save --use-api --no-verify-jwt
supabase functions deploy leaderboard --use-api --no-verify-jwt
supabase functions deploy score-submit --use-api --no-verify-jwt
supabase functions deploy game-session-start --use-api --no-verify-jwt
supabase functions deploy game-session-submit --use-api --no-verify-jwt
supabase functions deploy spend-claps --use-api --no-verify-jwt
```

Важно про порядок деплоя security-обновления session crediting:

1. Сначала `supabase db push` — миграции `20260705090000_game_session_result.sql` (RPC) и `20260705120000_game_session_incremental_claps.sql` (колонка `credited_claps` + RPC `credit_game_session_result`).
2. Затем `game-session-submit`, `game-session-start`, `score-submit`, `spend-claps`, `leaderboard`.
3. Затем frontend deploy (client шлет `initData` в `leaderboard` — старый клиент против нового `leaderboard` получит 400, поэтому frontend деплоить сразу после functions).

Замечание про crediting: `game-session-submit` ссылается на `game_sessions.credited_claps` и RPC `credit_game_session_result`, поэтому миграцию `db push` надо применять до деплоя функции (иначе submit будет падать на отсутствующем столбце/RPC).

Каждую измененную function деплоить явно. Не считать, что frontend deploy обновляет Supabase functions.

Запланированные задачи:

- `send-inactive-reminders` нужно запускать hourly с `x-cron-secret: REMINDER_CRON_SECRET`.
- `process-scheduled-broadcasts` является scheduled broadcast processor.
- `broadcast-message` является protected bulk message endpoint.

## Карта кода

```text
index.html
  Основной Mini App document, modal markup, script order, Supabase URL global.

styles.css
  Visual system игрока и responsive layout.

game.js
  Основной browser runtime: Telegram setup, UI state, game lifecycle, Supabase calls,
  analytics, shop interactions, maintenance/GameHub gates и match-3 orchestration.

maintenance-config.js
  Defaults и sanitization для runtime maintenance config.

dashboard.html
dashboard.css
dashboard.js
  Staff dashboard для analytics, purchases, feedback, broadcasts, promos и runtime config.

src/game/core/rng.js
src/game/core/board-core.js
src/game/core/resolution-core.js
src/game/core/rules-engine.js
  Pure browser-side game rules, deterministic replay primitives и board logic.

src/game/runtime/progress-adapter.js
src/game/runtime/board-renderer.js
  Runtime adapters для progress sync и DOM board rendering.

src/shop/catalog.js
  Browser shop catalog и discount code helper.

supabase/functions/_shared/telegram-auth.ts
  Verifier для Telegram initData.

supabase/functions/_shared/rules-engine.ts
  Deno/server версия deterministic match-3 replay engine.

supabase/functions/_shared/session-validation.ts
  Server-side plausibility validation helpers.

supabase/functions/_shared/shop-catalog.ts
  Server shop catalog, который используют purchase functions.

supabase/functions/*
  Edge Functions для auth, profile, leaderboard, scoring, sessions, analytics,
  shop, feedback, promos, broadcasts, runtime config и maintenance dev auth.

supabase/sql/*
  Ordered SQL setup files для текущей schema.

supabase/migrations/*
  Supabase CLI migration files для отдельных later changes.

tests/*.test.js
  Node test suite.

docs/superpowers/specs/*
docs/superpowers/plans/*
  Design specs и implementation plans для крупных product/security changes.
```

## API-контракт

Все endpoints являются Supabase Edge Functions под:

```text
{SUPABASE_URL}/functions/v1/{function-name}
```

Все functions поддерживают `OPTIONS` CORS preflight и обычно требуют `POST`.

### Эндпоинты игрока и auth

`POST /telegram-auth`

Запрос:

```ts
{ initData: string }
```

Ответ:

```ts
{
  profile: Profile;
  is_profile_complete: boolean;
}
```

Поведение:

- проверяет Telegram `initData`;
- делает upsert Telegram identity fields в `profiles`;
- возвращает profile и completion status.

`POST /profile-save`

- Проверяет Telegram `initData`.
- Сохраняет player display profile/avatar.
- Возвращает updated `profile`.

`POST /touch-session`

- Проверяет Telegram `initData`.
- Обновляет `last_seen_at` и notification/session fields.

### Игровые и session-эндпоинты

`POST /game-session-start`

Запрос:

```ts
{ initData: string }
```

Ответ:

```ts
{
  sessionId: string;
  seed: string;
  rulesVersion: 'match3-v1';
  size: 7;
  colorCount: 4;
}
```

`POST /game-session-submit`

Запрос:

```ts
{
  initData: string;
  sessionId: string;
  moves: Array<{ from: number; to: number }>;
  clientFinalScore: number;
  clientClapsEarned: number;
}
```

Лимиты и поведение:

- move list ограничен 3000 entries;
- session должна принадлежать Telegram user;
- session можно submit повторно (paid continue продлевает тот же seed-replayable run); crediting идемпотентен;
- ходы, отправленные быстрее физически возможного темпа (менее ~500ms на ход от `started_at`), отклоняются с `rejectReason: 'implausible_speed'`;
- server делает replay deterministic rules от seed и пишет validation evidence;
- при accepted replay server начисляет прогресс в `profiles` через RPC `credit_game_session_result`: best score через GREATEST, а claps — только положительной **дельтой** сверх уже начисленного этой сессией (`game_sessions.credited_claps`, под row lock). Это единственный путь повышения clap balance из gameplay и он не двойно-начисляет при пересабмите.

Ответ:

```ts
{
  accepted: boolean;
  rejectReason: string | null;
  serverScore: number;
  serverClapsEarned: number;
  movesAttempted: number;
  validation_status: 'accepted' | 'rejected';
}
```

`POST /score-submit`

Запрос:

```ts
{
  initData: string;
  bestScore: number;
  clapBalance: number;
  sessionId?: string;
}
```

Поведение:

- проверяет Telegram `initData`;
- отклоняет best-score increases без accepted game-session evidence;
- clap balance из client-репорта записывается только в audit и никогда не повышает stored balance (claps начисляет `game-session-submit`);
- audit-ит каждую accepted/rejected submission в `score_submissions`;
- этим путем никогда не уменьшает existing profile best score или clap balance.

Ответ rejected progress использует HTTP `409`:

```ts
{
  error: 'Score submission rejected';
  code: 'missing_session' | 'score_rejected';
  profile: Profile | null;
}
```

`POST /leaderboard`

- Требует Telegram `initData` (endpoint раскрывает telegram_id и display names).
- Читает top profiles, отсортированные по `best_score` с tie-break по `updated_at`.
- Дополнительно возвращает `me: { telegram_id, display_name, avatar_choice, avatar_url, best_score, rank }` — глобальную позицию и рекорд вызывающего игрока (rank = число игроков строго выше + 1; `null`, если рекорда ещё нет). Клиент закрепляет этот блок под списком, если игрок не попал в top-50.

### Эндпоинты магазина

`POST /purchase-gift`

Запрос:

```ts
{
  initData: string;
  giftId: string;
}
```

Ответ:

```ts
{
  profile: Profile;
  purchase: {
    gift_id: string;
    item_type: 'gift' | 'discount';
    discount_percent: number | null;
    code: string;
    claps_spent: number;
  };
  bot_notification: {
    status: 'sent' | 'skipped' | 'failed';
    error: string | null;
  };
}
```

Поведение:

- проверяет Telegram auth;
- проверяет profile и balance;
- применяет discount cooldown;
- списывает claps server-side;
- вставляет purchase code;
- восстанавливает balance, если purchase insert падает.

`POST /my-gifts`

- Проверяет Telegram auth.
- Возвращает purchases/codes текущего player.

`POST /spend-claps`

- Проверяет Telegram auth.
- Выполняет server-side clap debit для gameplay UX actions вроде continue/cancel flows.
- Списание защищено compare-and-set по previous balance; при конкурентном изменении возвращает HTTP `409` с `code: 'balance_conflict'`.

`POST /game-session-start` (rate limit)

- Не более 60 сессий на игрока в час; при превышении HTTP `429` с `code: 'session_rate_limited'`.

### Эндпоинты аналитики, promo и feedback

`POST /analytics-track`

- Проверяет Telegram auth.
- Записывает session и event analytics.
- Отклоняет impossible session progress, но score truth все равно определяется game-session validation и `score-submit`.

`POST /promo-current`

- Проверяет Telegram auth.
- Возвращает current active promo popup, если он есть.

`POST /promo-action`

- Проверяет Telegram auth.
- Записывает promo action/impression.

`POST /claim-broadcast-bonus`

- Проверяет Telegram auth.
- Claim-ит eligible broadcast bonus один раз на message/recipient.

`POST /feedback-submit`

Запрос:

```ts
{
  initData: string;
  message: string;
}
```

- Проверяет Telegram auth.
- Сохраняет player feedback.

### Админские/dashboard-эндпоинты

Admin endpoints требуют `DASHBOARD_SECRET` через `x-dashboard-secret` или `Authorization: Bearer ...`:

- `analytics-summary`
- `gift-admin`
- `messages-admin`
- `feedback-admin`
- `promo-admin`
- `promo-upload`
- `runtime-config-admin`
- `process-scheduled-broadcasts`

Плановые и массовые endpoints:

- `send-inactive-reminders` требует `REMINDER_CRON_SECRET`.
- `broadcast-message` требует `REMINDER_CRON_SECRET`.

`POST /maintenance-dev-auth`

Запрос:

```ts
{ password: string }
```

Ответ:

```ts
{ ok: true; expiresAt: number }
```

Поведение:

- сравнивает password с `MAINTENANCE_DEV_PASSWORD`;
- возвращает short dev-session timestamp;
- client должен держать bypass state только page-local.

## Известные ограничения

- App плотно связан с Telegram Web App context. Вне Telegram authenticated flows не работают без mocked `initData`.
- В текущем repo нет npm project metadata или build command.
- `game.js` большой и все еще владеет многими responsibilities. Refactors должны быть incremental и backed by tests.
- Frontend указывает на конкретный Supabase project URL в `index.html`; осторожно тестировать write flows.
- Supabase Edge Functions имеют `verify_jwt = false`; function-level guards обязательны.
- Store publication заблокирована Telegram-only auth и hookah/tobacco-themed reward content, если product direction не изменится.
- Coal Tower пока только alpha/planning. Не описывать его как production game, пока он не implemented и validated.
- Dashboard auth использует shared secret model, а не per-staff identity.

## Версионирование и журнал изменений

Текущее версионирование неформальное:

- script cache-busting query strings в `index.html` несут date/scope labels вроде `v=20260704-clapfix`;
- product/version metadata не централизована в package file;
- planning specs лежат в `docs/superpowers/specs/*`;
- implementation plans лежат в `docs/superpowers/plans/*`.

Когда меняется поведение:

- обновить этот README, если меняются setup, API, storage, deploy или security behavior;
- обновить или добавить spec/plan в `docs/superpowers/*` для крупных architecture/product changes;
- обновить cache-busting query strings в `index.html`, если нужно принудительно освежить Telegram WebView cache;
- добавить или обновить focused tests для измененного поведения.

## Дорожная карта и будущие интеграции

"Угольная башня" / GameHub:

- Оставить один repo и один Telegram Mini App client.
- Оставить общие Telegram auth, profile, clap economy, shop, dashboard и runtime config.
- Добавлять новую игру как internal module, а не как отдельный project.
- Использовать стабильный `game_key = 'coal_tower'`.
- Текущее match-3 поведение держать под `game_key = 'match3'`.
- Backend/database changes для второй игры должны быть additive.
- Target scoring для "Угольной башни" из design spec:
  - endless Tower Bloxx-like stacking из hookah-coal cubes;
  - fail при overlap ниже примерно 35%;
  - увеличение swing amplitude каждые 15-20 blocks;
  - camera follows после того, как tower пересекает half-screen;
  - `1 ладошка = 10 accepted blocks`;
  - server-authoritative validation с самого начала.

Публикация в сторах/mobile:

- Принять решение: оставить current hookah venue theme или создать store-safe variant.
- Добавить non-Telegram auth или аккуратно определенный companion-app auth flow.
- Добавить privacy policy, account/data deletion URL и app-store metadata.
- Решить требования Sign in with Apple / Google Sign-In при публикации standalone mobile apps.
- Перед implementation повторно проверить App Store и Google Play policy, потому что policy requirements могут измениться.

## Передача контекста агентам

Сначала читать:

1. `PRODUCT.md` для product tone и trust principles.
2. `index.html` для loaded scripts и live Supabase URL.
3. `game.js` для runtime flow и текущей UI orchestration.
4. `src/game/core/rules-engine.js` и `supabase/functions/_shared/rules-engine.ts` для replay parity.
5. `supabase/functions/score-submit/index.ts`, `game-session-start/index.ts`, `game-session-submit/index.ts` для score/clap trust.
6. `src/shop/catalog.js` и `supabase/functions/purchase-gift/index.ts` для shop changes.
7. `tests/security-hardening.test.js`, `tests/game-start-stability.test.js`, `tests/maintenance-dev-bypass.test.js` перед изменением sensitive flows.

Инварианты, которые нельзя ломать:

- Не уменьшать и не пересчитывать existing `profiles.best_score` или `profiles.clap_balance`, если пользователь явно не одобрил production data operation.
- Не сохранять maintenance/GameHub dev bypass в browser storage.
- Не возвращать cascade-time move buffering, который server replay не может воспроизвести.
- Не доверять client-reported score/clap increases без accepted server validation.
- Не повышать clap balance из client-reported чисел ни в одной function: начисление только через `credit_game_session_result`, бонусы и покупки.
- Начисление ладошек за сессию должно оставаться дельта-based и идемпотентным (`credited_claps`), чтобы пересабмит продлённого continue-рана не начислял дважды.
- Клиент должен банкать сессию (`flushServerGameSession`) перед любым списанием ладошек (continue, платная отмена выхода), чтобы заработанное было в балансе до spend.
- Не вставлять player-controlled строки в dashboard `innerHTML` без `escapeHtml`.
- Не раскрывать service-role secrets в browser files.
- Не превращать Coal Tower planning в production behavior без явного scope approval.
- Держать database migrations additive для player-facing production data.

Рекомендуемая проверка перед handoff:

```bash
node --test tests/*.test.js
```

Во время итераций использовать narrower tests, затем запускать full suite перед заявлением о готовности.

Предосторожности при деплое:

- Frontend и Supabase Functions деплоятся отдельно.
- Supabase production inspection ранее работал через `supabase db query --linked`.
- Для live balance/player-data work начинать с read-only diagnostics и явных backups/row counts.
- `npx vercel deploy --prod --yes` и `supabase functions deploy ... --use-api --no-verify-jwt` требуют network/auth и должны запускаться только когда deploy входит в requested task.
