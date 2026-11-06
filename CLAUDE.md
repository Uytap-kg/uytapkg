# CLAUDE.md — UyTap (платформа недвижимости Кыргызстана)

Основная работа: **фиксы багов и новые фичи**. Этот файл — карта проекта, чтобы не перечитывать репозиторий целиком. Общайся с пользователем на русском.

## Стек и структура

| Папка | Что это |
|---|---|
| `back-end/` | Express 4 REST API, Node ≥22, ESM (`"type": "module"`), Zod 4, Supabase JS (service_role) + `pg` Pool, sharp, multer |
| `front-end/` | Next.js 16 (App Router, Turbopack), React 19, Tailwind 4 + CSS Modules, JS/JSX (без TS), leaflet |
| `supabase/migrations/` | **Единственный источник истины схемы БД** (`YYYYMMDDHHMMSS_name.sql`) |
| `docs/` | `testing.md`, `deploy.md`, `db-schema-inventory.md` (таблицы/колонки/RPC — смотреть при работе с БД) |
| `render.yaml`, `deploy/` | Деплой (Render). Push в `main` → CI → автодеплой |

Игнорировать (не трогать, не читать без нужды): `_cleanup_review/`, `promo-video/`, `node_modules/`, большие отчёты в корне (`PRE_RELEASE_AUDIT.md`, `LOAD_READINESS.md`, `SECURITY_AUDIT.md`, `DEPLOY.md`, `Readme_Documentation.txt`, `FRONTEND_API_REPORT.md`) — это исторические аудиты, читать только если задача прямо про них.
Устарело: `back-end/src/migrations/*` и `back-end/src/schema.sql` — **не править**, на них ссылаются только старые тесты.

## Поток запроса

Браузер → `front-end/src/utils/api.js` (`API_URL = "/api"`) → Next-прокси `front-end/src/app/api/[...path]/route.js` (добавляет `X-Internal-Proxy-Secret` + доверенный X-Forwarded-For, `_lib/forwardedFor.js`) → бэкенд `BACKEND_API_URL` `/api/*`.
Отдельные Next route handlers: `app/api/smart-search`, `app/api/speech-to-text` (ElevenLabs), `app/api/health`.

## Бэкенд (`back-end/src`)

- `index.js` — middleware (clientIp → requestContext → helmet → CORS → json 1mb → глобальный rate limit 300/мин), монтирование роутов, глобальный error handler, graceful shutdown.
- Слои: `routes/*Routes.js` → `controllers/*Controller.js` → `services/` / `utils/`. Новый эндпоинт = роут + контроллер (+ схема в `utils/validation.js`) + функция в `front-end/src/utils/api.js`.
- Роуты: `/api/auth`, `/upload`, `/listings`, `/complexes`, `/ai`, `/constants`, `/favorites`, `/developers`, `/payments`, `/admin`, `/lawyers`, `/settings`, `/banners`, `/subscriptions`.
- Auth: `middleware/auth.js` — `authenticateToken` (JWT + `token_version`, кэш 60с `userAuthCache`; после смены роли/токенов вызывать `invalidateUserAuthCache(userId)`), `optionalAuth`, `requireAdmin` (`req.user.role === "admin"`). `req.user = { id, role, accountType, ... }`.
- Типы аккаунтов: personal / realtor / agency / developer (у каждого свой профиль на фронте).
- БД: `config/db.js` — `supabase` (основной доступ, query builder) и `dbPool`/`queryPool` (прямой pg, может быть `null` без `DATABASE_URL` — всегда учитывать fallback).
- Валидация: Zod-схемы в `utils/validation.js` (`createListingSchema`, `updateListingSchema`, тарифы, баннеры, платежи...). Тексты ошибок — по-русски.
- Ответы API: `{ success: true, data }` / `{ success: false, message }` (+ `errors[]`, `retryAfter`). Поля в БД — snake_case, в теле запросов — camelCase.
- Объявления (`listingsController.js`, ~2000 строк): статусы `draft | moderation | active | expired...`; `canOwnerTransition` запрещает владельцу трогать `moderation`; `maskExpiredPromotion` и маскирование истёкших; `sanitizeAuthorPII` для публичных ответов; сортировка vip → top → обычные (`priority_rank`). Типы: apartment, house, land, commercial, room, garage, cottage, parking (`constants/propertyTypes.js`, `UI_TO_DB_PROPERTY_TYPE`: cottage→house, parking→garage).
- Деньги/продвижение: `services/payments/` (O!Dengi, `paymentsService` + `paymentsRepo`, идемпотентная выдача через lease), `promotionsService.js` (VIP/TOP/Срочно), `subscriptionsService.js` (тарифы, слоты объявлений, бусты, лимит черновиков 10), `utils/pricingSettings.js`. Любая правка здесь — осторожно, есть много тестов на гонки/обходы оплаты.
- Прочее: `services/nikitaService.js` (SMS OTP), `emailService.js` (Resend), `cronService.js` (maintenance каждые 15 мин с distributed lease), `ai/smartSearch.*` + `aiController.js` (умный поиск через Claude, `ANTHROPIC_MODEL`), `utils/watermark.js`, `utils/storage.js`, `utils/sharedState.js` (rate-limit store/локи), `utils/counterBatcher.js` (батч просмотров/кликов), `utils/logger.js` (маскирует PII — используй его, не `console.log`).
- Константы для фронта отдаёт `GET /api/constants` (`constants/*.js`: amenities, features, locations, pricing, tariffs).

## Фронтенд (`front-end/src`)

- **Next 16 отличается от того, что ты знаешь** — перед использованием незнакомых API Next читать `front-end/node_modules/next/dist/docs/` (см. `front-end/AGENTS.md`).
- Алиас `@/*` → `src/*`. Страницы в `app/<route>/page.jsx`, компоненты страницы рядом в `components/`, стили — `*.module.css` рядом с компонентом.
- Ключевые страницы: `all-products` (каталог + фильтры по типам + SmartSearch), `all-products/[id]` (карточка), `add-product` (мастер шагов `Step*`), `profile/*` (ads, projects, tariff), `admin/*` (users, payments, tarrifs, defaultTarrifs, banners, lawyers, developers, instagram), `search-map`, `complexes`, `payment`, `register` (⚠ папка `сomponents` начинается с **кириллической «с»**).
- Общие компоненты: `components/ui/*` (ListingCard, CustomSelect, RealEstateMap...), `components/pageComponents/*` (Header, Footer, Hero, AdBanner).
- API-клиент: все вызовы бэкенда — функции в `utils/api.js` (~80 функций, включая админские). `app/admin/utils/api.js` пустой.
- Auth на клиенте: `utils/auth.js` — localStorage `uytap_token` / `uytap_user`, события `uytap:auth-changed`, `uytap:user-updated`; хук `hooks/useAuth.js`.
- i18n: `context/LanguageContext.jsx` → `const { t, language } = useLanguage()`, `t("section.key", "fallback")`. Языки ru (дефолт) и ky: **новый текст UI добавлять в оба** `translations/ru.js` и `translations/ky.js`.
- Маппинг данных бэкенда в UI: `utils/mapListingData.js`, `utils/mapComplexData.js` (регионы, форматирование).

## Команды

```bash
# Бэкенд
cd back-end
npm run dev            # nodemon
npm run lint           # только node --check src/index.js
npm test               # node --test, ~330 тестов на моках (без внешней БД)
node --test security-tests/<file>.test.mjs   # один файл

# Фронтенд
cd front-end
npm run dev
npm run lint
npm run build          # проверка production-сборки
```

- Тесты лежат в `back-end/security-tests/*.test.mjs`. **Новый файл теста надо вручную дописать в оба скрипта `test` и `test:coverage` в `back-end/package.json`** — иначе CI его не запустит.
- Интеграционные тесты (idor, jwt-forgery, promotion-bypass, watermark-bypass) пропускаются без `TEST_SUPABASE_URL/KEY`; запуск против `*.supabase.co` запрещён (`helpers.mjs`). Никогда не запускать тесты против боевой БД.
- Платформа Windows: в Bash-инструменте используй POSIX-синтаксис; пути содержат кириллицу (`Проект`) — всегда в кавычках.

## Правила при изменениях

1. **БД** — только новым файлом в `supabase/migrations/` с таймстемпом позже последнего (`20261027120000_...`). Миграции должны быть идемпотентны (`IF NOT EXISTS`, `CREATE OR REPLACE`) — CI прогоняет `npm run migrate` дважды на чистом Postgres 17. Не редактировать уже применённые миграции. Новые RPC — с `SET search_path` и без public grants (см. `20261018193000_revoke_public_rpc_grants.sql`, `20261025000000_*`).
2. **Безопасность**: проект прошёл несколько аудитов. Не ослаблять: проверку владельца (IDOR), запрет самовыдачи платного продвижения/модерации, маскирование PII, лимиты rate-limit, валидацию загрузок (magic bytes), JWT `token_version`. Исключение — временно открытая самовыдача `promotionStatus/isUrgent/moderation` (см. память), не «чинить» без запроса.
3. Новое поле объявления: схема Zod (create/update) → контроллер (camelCase→snake_case, select-список `PUBLIC_LISTING_COLUMNS` и др. в `listingsController.js`) → миграция → `api.js`/маппер → UI → переводы.
4. Перед изменением логики с тестами — найти связанный тест: `grep -rl "<функция>" back-end/security-tests`. После правки бэкенда — `npm test`; после фронта — `npm run lint` (и `npm run build` при изменении роутинга/конфигов).
5. Не коммитить `.env*`. Коммит/пуш только по просьбе пользователя (push в `main` = прод-деплой).
6. Стиль: комментарии и сообщения пользователю в коде — по-русски, как в существующем коде; не делать массовых рефакторингов попутно с фиксом.
