# Предрелизный аудит безопасности и релизной готовности (Pre-Release Security & Readiness Audit) — UyTap

**Дата аудита:** 25.10.2026  
**Ветка:** `main` (монорепозиторий `back-end/` + `front-end/` + `supabase/`)  
**Режим:** Только чтение (Read-Only)  

---

## 1. Итоговая сводка и вердикт

| Приоритет | Описание категории | Количество находок |
| :--- | :--- | :---: |
| **P0 (Критично)** | Захват аккаунта (ATO), беспарольный вход без ограничений, обход всех IP rate-limiters через прокси, скомпрометированные секреты в истории Git | **4** |
| **P1 (Обязательно до релиза)** | Верификация чужого email, отказ защиты от phone-squatting, гонки и in-memory сброс лимитов SMS, потеря вебхуков O!Dengi и отсутствие сверки суммы, обход оплаты Instagram-промо, IDOR через избранное, утечки PII/документов, открытый прокси ElevenLabs (риск OOM и слива баланса), отсутствие FK-индексов в БД, проблемы CI/CD и Storage | **12** |
| **P2 (Важно, не блокирует)** | Оракулы перечисления аккаунтов, хранение JWT в `localStorage`/незащищённых cookie, отсутствие CSP/HSTS на фронтенде, отсутствие потолка пагинации на ряде маршрутов, утечки `error.message` в 500-ответах, неатомарный fallback подписок | **9** |
| **P3 (Улучшение)** | Артефакты в корне репозитория, кириллическая `с` в пути `register/сomponents`, модификация `SECURITY_LOG.md` тестами, слабый скрипт `npm run lint` на бэкенде | **4** |
| **ВСЕГО** | | **29** |

### Вердикт: ❌ НЕ ГОТОВ К РЕЛИЗУ (NO-GO)

**Обоснование:**
1. **Критический захват любого аккаунта (P0-01, P0-02):** В текущей ветке `main` в контроллерах `verifyOtp` (`back-end/src/controllers/authController.js:1355-1410`) и `verifyResetCode` (`authController.js:1705-1751`), а также в `phoneOtpStore.findRecord` (`back-end/src/utils/phoneOtpStore.js:221-245`) обнаружена критическая уязвимость: токен SMS-сессии (`token`) проверяется без сверки с переданным в теле запроса номером `phone`, а поиск пользователя для выдачи полноценного JWT-токена или токена сброса пароля идёт по `rawPhone || result.phone`. Злоумышленник может запросить SMS на собственный номер, получить валидные `token` и `code`, а затем отправить их вместе с `phone` жертвы — и получить полный доступ к аккаунту любого пользователя (включая застройщиков, агентства и администраторов).
2. **Полный обход IP-лимитов через Next.js прокси (P0-03):** Фронтенд-прокси (`front-end/src/app/api/_lib/forwardedFor.js:47-50`) безусловно доверяет клиентскому заголовку `X-Real-IP` и подписывает его секретом `x-internal-proxy-secret` (`forwardedFor.js:89-96`). В результате любой внешний клиент может подменять свой IP в каждом запросе и обходить все лимиты на подбор паролей, OTP и AI-поиск.
3. **Скомпрометированные секреты в истории Git и ошибки прод-конфигурации (P0-04, P1-05):** В истории Git (`commit 29d8ddf3`) остаются боевые ключи, в `back-end/.env:4` прописан REST URL вместо PostgreSQL URI в `DATABASE_URL`, а в `.env` и `.env.example` указан несуществующий URL вебхука O!Dengi (`ODENGI_RESULT_URL`), из-за чего callback-уведомления от платёжного шлюза будут получать `404 Not Found`.
4. **Риски потери платежей и финансовых потерь (P1-04, P1-06, P1-09):** Вебхук O!Dengi использует общий 10-секундный троттлинг с клиентским поллингом статуса и может быть проигнорирован с ответом `200 OK`, сверка фактической суммы платежа от провайдера отсутствует, создание объявления с `listingType: "instagram"` создаёт платную заявку бесплатно, а эндпоинт `/api/speech-to-text` открыт без авторизации и лимитов.

---

## 2. Проверка закрытия пунктов предыдущего аудита (`SECURITY_AUDIT.md`)

Перед поиском новых уязвимостей каждый из 15 пунктов `SECURITY_AUDIT.md` был проверен непосредственно по коду ветки `main`. Полностью закрытые пункты ниже подтверждены и **не дублируются** в списке открытых находок.

| Пункт `SECURITY_AUDIT.md` | Статус в коде `main` | Подтверждение в коде (`файл:строка`) и комментарий |
| :--- | :---: | :--- |
| **1.1** Защита от IP-спуфинга (`x-internal-proxy-secret`, `trust proxy = false`) | ⚠️ **Частично (обход на фронтенде)** | Бэкенд проверяет `INTERNAL_PROXY_SECRET` (`back-end/src/index.js:28-36`, `back-end/src/middleware/clientIp.js:19-87`). Однако сам Next.js-прокси в `front-end/src/app/api/_lib/forwardedFor.js:47-50` доверяет неподписанному `x-real-ip` и подписывает его секретом (см. **P0-03**). |
| **1.2** Строгая валидация номеров КР (`+996`, 12 цифр) перед отправкой в Nikita SMS | ✅ **Закрыто** | Подтверждено в `back-end/src/services/nikitaService.js:146-175` (`normalizeNikitaPhone` + проверка `cleanPhone.startsWith("996") && cleanPhone.length === 12` до сетевого вызова). |
| **1.3** Многоуровневые лимиты отправки SMS (60с кулдаун, 10/сутки на номер, 30/мин и 120/ч на IP, потолок 500/сутки + алерт 70%) | ⚠️ **Частично (in-memory + гонка)** | Логика реализована в `back-end/src/config/nikita.js:26-55` и `back-end/src/utils/phoneOtpStore.js:68-169`, но хранится только в RAM (сбрасывается при рестарте) и имеет окно гонки TOCTOU между `checkSendLimits` (`nikitaService.js:184`) и `recordSend` (`nikitaService.js:239`) (см. **P1-03**). |
| **1.4** Защита от брутфорса и гонок при проверке OTP (5 попыток, атомарное гашение) | ✅ **Закрыто (Email)** / ⚠️ **Частично (SMS)** | Для Email OTP подтверждено: RPC `consume_otp_attempt` (`supabase/migrations/20261012000000_baseline.sql:187-236`), `crypto.timingSafeEqual` (`authController.js:1492, 1808`) и атомарный `.eq("is_used", false)` (`authController.js:1504-1517, 1820-1833`). Для SMS OTP счётчик в RAM, удаление токена происходит после `await postNikita` (`nikitaService.js:333-367`). |
| **1.5** Составной ключ `IP + идентификатор` в rate-limiter для `/verify-otp` | ✅ **Закрыто** | Подтверждено в `back-end/src/routes/authRoutes.js:88-108` (`verifyKeyGenerator` формирует `${ipKeyGenerator(req)}\|${target}`). |
| **1.6** Разделение `is_email_verified` и `is_verified`, сброс при смене телефона | ❌ **Регрессия (P0/P1)** | Поля разделены и при смене телефона `updateMe` сбрасывает `is_verified = false` (`authController.js:874-876`). Однако в `verifyOtp` есть критическая подмена `rawPhone` (см. **P0-01**) и отсутствие сверки `req.user.email === email` (см. **P1-01**). |
| **1.7** Освобождение неподтверждённых номеров через 10 минут с 6 проверками безопасности | ❌ **Не работает (P1)** | Реализовано в `back-end/src/controllers/authController.js:360-428`, но проверка №6 (`lines 414-424`) блокирует очистку, если у пользователя есть запись в `user_profiles`, а `register` создаёт `user_profiles` всегда (`lines 495-555`) (см. **P1-02**). |
| **1.8** Защита от обхода водяного знака через публичную загрузку (`avatars/pending/`) | ✅ **Закрыто** | Подтверждено: `uploadPendingAvatar` грузит в `pending/` (`back-end/src/controllers/uploadController.js:65`, `back-end/src/utils/storage.js:54-56`), а `isUploadOwnedBy` (`back-end/src/utils/uploadOwnership.js:55-58`) отклоняет любые пути с `pending/` для объявлений и ЖК. |
| **1.9** Автоматическая очистка осиротевших файлов `avatars/pending/` старше 24ч | ✅ **Закрыто (есть N+1)** | Подтверждено в `back-end/src/utils/storage.js:66-134` и `back-end/src/services/cronService.js:120-125` (замечание по N+1 запросам вынесено в **P2-06**). |
| **1.10** Запрет логирования открытых OTP-кодов в продакшне | ✅ **Закрыто** | Подтверждено в `back-end/src/services/emailService.js:156-163` (в `production` при отсутствии провайдера выбрасывается исключение без вывода кода в лог) и в `nikitaService.js` (код не генерируется и не логируется бэкендом). |
| **1.11** Ограничение пагинации (`limit <= 100`) на публичных эндпоинтах | ⚠️ **Частично** | Внедрено в `getListings` (`listingsController.js:526`), `getComplexes` (`complexesController.js:53`), `getDevelopers` (`developersController.js:56`), `getLawyers` (`lawyersController.js:27`). Остались без лимита `getComplexListings`, `getMyComplexes`, `getFavorites`, `getUserPublicProfile` и админ-списки (см. **P2-06**). |
| **1.12** Включение RLS и отзыв прав на `SECURITY DEFINER` RPC у `PUBLIC`/`anon`/`authenticated` | ✅ **Закрыто (для таблиц приложения)** | Подтверждено в `supabase/migrations/20261012113812_enable_rls_email_verifications.sql:8` и `20261018193000_revoke_public_rpc_grants.sql:18-62`. Осталась без RLS служебная таблица `_schema_migrations` и не зафиксирован `search_path` в старых RPC (см. **P1-11**). |
| **1.13** Расчёт суммы и валюты платежа исключительно на сервере | ✅ **Закрыто** | Подтверждено в `back-end/src/services/payments/paymentsService.js:93-101, 177-187` (цены берутся только из `getPricingSettings()` в KGS/тыйынах, клиентские поля игнорируются). |
| **1.14** Pull-reconciliation вебхуков O!Dengi со сверкой статуса и суммы | ❌ **Частично / Баг (P1)** | Сверка статуса через `odengiCheckInvoiceStatus` есть (`paymentsService.js:408-415`), но **сверка суммы отсутствует**, а общий 10-секундный троттлинг отбрасывает вебхуки (см. **P1-04**). |
| **1.15** Строгая машина состояний платежа и идемпотентность зачисления | ✅ **Закрыто** | Подтверждено в `back-end/src/services/payments/paymentsRepo.js:116-123` (`ALLOWED_STATUS_TRANSITIONS`) и `paymentsRepo.js:187-237` (`claimPaymentFulfillment` через уникальный ключ в `processed_subscription_payments`). |

---

## 3. Детальные находки аудита

### Приоритет P0 — Критические блокеры релиза

---

#### [P0-01] Захват любого аккаунта (Account Takeover) и верификация чужого номера через подмену `phone` в `verifyOtp` и `verifyResetCode`
- **Приоритет:** P0 (Критично — авторизация / захват аккаунта)
- **Узел:** OTP / Аутентификация (`back-end`)
- **Что не так и где:**
  1. `back-end/src/utils/phoneOtpStore.js:221-245` — метод `findRecord({ token, phone })` при наличии `token` ищет сессию в `this.byToken.get(String(token).trim())` и **полностью игнорирует переданный параметр `phone`**, не проверяя `record.phone === phone`.
  2. `back-end/src/services/nikitaService.js:321-376` — функция `verifyOtp({ token, phone, code })` передаёт `{ token, phone }` в `findRecord`, проверяет код в Nikita по `session.transactionId` и `session.phone` (`lines 345-348`), и возвращает `{ success: true, phone: session.phone }`, ни разу не проверив совпадение `session.phone` с `phone` из запроса клиента.
  3. `back-end/src/controllers/authController.js:1355-1410` (`verifyOtp`):
     - Для авторизованного пользователя (`if (req.user?.id)`, `lines 1356-1385`) код вычисляет `const targetPhone = rawPhone ? normalizePhone(rawPhone) : null;` (`line 1356`) из `req.body.phone` (а не из `result.phone`) и записывает `phone: targetPhone, is_verified: true` в профиль текущего пользователя (`lines 1372-1378`). Если же `phone` в теле запроса опущен (`lines 1380-1385`), код просто ставит `is_verified: true` текущему аккаунту, даже если его реальный телефон в БД другой и никогда не проверялся.
     - Для неавторизованного запроса (`lines 1387-1409`) выполняется:
       ```js
       const phoneToFind = rawPhone || result.phone;
       ```
       После чего по `phoneToFind` ищется пользователь в таблице `users` (`line 1390`), ему выставляется `is_verified: true`, и **выдаётся полноценный JWT-токен входа** (`const authToken = generateToken(user)`, `line 1403`)!
  4. `back-end/src/controllers/authController.js:1705-1751` (`verifyResetCode`):
     - На строке `1720` аналогично выполняется `const phoneToFind = rawPhone || result.phone;`, по `phoneToFind` находится пользователь в `users` (`lines 1722-1729`) и выпускается JWT `resetToken` (`purpose: "password_reset"`, `lines 1735-1745`) для смены пароля этого пользователя.
     - Дополнительно на строках `1721-1728`: если `formattedPhone` окажется пустой строкой, условие `if (formattedPhone)` пропустит фильтр `.eq("phone", ...)` и запрос `userQuery.maybeSingle()` выполнится вообще без `WHERE`!
- **Чем грозит (эксплуатация):**
  Атакующий запрашивает SMS-код на свой собственный номер (`+996555XXXXXX`), получает валидный `token` и `code` из SMS, а затем отправляет запрос `POST /api/auth/verify-otp` (или `POST /api/auth/verify-reset-code`) с телом:
  `{ "token": "<токен_атакующего>", "code": "<код_атакующего>", "phone": "996700112233" }` (где `996700112233` — публичный телефон любого застройщика, риэлтора или администратора).
  Сервер проверяет `token` и `code` против номера атакующего, считает проверку успешной, но ищет пользователя по `rawPhone` (`996700112233`) и возвращает атакующему JWT-токен жертвы! Полный захват любого аккаунта за 1 запрос.
- **Как исправить:**
  1. В `phoneOtpStore.findRecord` (`phoneOtpStore.js:221-245`) и `nikitaService.verifyOtp` (`nikitaService.js:321-376`), если переданы одновременно `token` и `phone`, жёстко проверять `session.phone === normalizeNikitaPhone(phone)` и отклонять запрос при несовпадении.
  2. В `authController.js` (`verifyOtp` на строках `1356, 1387` и `verifyResetCode` на строке `1720`) **никогда** не использовать `rawPhone` после `nikitaService.verifyOtp` — брать исключительно доверенный `result.phone` из проверенной серверной сессии.
  3. Для авторизованного пользователя (`authController.js:1355-1385`) проверять, что `result.phone` совпадает с текущим телефоном пользователя в БД (либо что телефон не занят и обновляется именно на `result.phone`), и убрать ветку `else` (`lines 1380-1385`), ставящую `is_verified: true` без привязки `result.phone`.
  4. В `verifyResetCode` (`authController.js:1721`) возвращать `400 Bad Request`, если `!formattedPhone`.
- **Риск поломки соседних функций:** Низкий. Фронтенд в `front-end/src/app/auth-code/page.jsx` всегда передаёт тот же `phone`, на который запрашивал `token`, либо только `token` + `code`.

---

#### [P0-02] Беспарольный вход в любой подтверждённый аккаунт через `/api/auth/verify-otp` и переиспользование SMS-токенов между сценариями
- **Приоритет:** P0 (Критично — архитектура аутентификации)
- **Узел:** Аутентификация / OTP (`back-end`)
- **Что не так и где:**
  1. `back-end/src/controllers/authController.js:1387-1409` — неавторизованный вызов `POST /api/auth/verify-otp` при успешной проверке SMS ищет пользователя по номеру телефона (`supabase.from("users").select(...).eq("phone", formattedPhone)`), обновляет `is_verified: true` и **всегда возвращает JWT-токен доступа (`token: authToken`)**, даже если аккаунт уже давно был подтверждён (`user.is_verified === true`), имеет пароль и не находится в процессе первичной регистрации.
  2. `back-end/src/utils/phoneOtpStore.js:174-201` — в отличие от таблицы `email_verifications` (где есть колонка `type`: `"registration"` vs `"password_reset"`, проверяемая в `authController.js:1461` и `1778`), записи в `phoneOtpStore` не содержат поля `purpose` / `type`. Токен, выданный через `POST /api/auth/send-otp`, принимается в `POST /api/auth/verify-reset-code` (`authController.js:1706`) для сброса пароля, и наоборот.
- **Чем грозит:**
  1. Эндпоинт `/verify-otp` фактически превращает SMS OTP в беспарольный вход для всех существующих аккаунтов в обход пароля и без инвалидации старых сессий.
  2. При перехвате или социальной инженерии кода подтверждения регистрации атакующий может использовать тот же `token` на эндпоинте `/verify-reset-code` и перезаписать пароль жертвы.
- **Как исправить:**
  1. Добавить обязательное поле `purpose` (`"registration"` | `"phone_change"` | `"password_reset"`) в `phoneOtpStore.createSession` (`phoneOtpStore.js:174`) и проверять его при вызове `nikitaService.verifyOtp`.
  2. В неавторизованной ветке `verifyOtp` (`authController.js:1387-1409`) выдавать первичный JWT-токен только если `user.is_verified === false` (первичное подтверждение после регистрации / входа неподтверждённого пользователя), а для уже верифицированных аккаунтов требовать стандартный вход по паролю (`POST /api/auth/login`).
- **Риск поломки соседних функций:** Средний. Необходимо убедиться, что сценарий до-верификации старого неподтверждённого аккаунта при редиректе со страницы `/login` на `/auth-code?method=phone&reason=login` (`front-end/src/app/login/page.jsx:108-115`) продолжает работать (у таких аккаунтов `user.is_verified === false`, поэтому проверка `!user.is_verified` их не сломает).

---

#### [P0-03] Подмена IP-адреса через `X-Real-IP` в Next.js API-прокси — полный обход всех IP Rate Limiters бэкенда
- **Приоритет:** P0 (Критично — веб-безопасность / защита от перебора и спама)
- **Узел:** Веб-безопасность / Прокси / Rate Limiting (`front-end` + `back-end`)
- **Что не так и где:**
  - `front-end/src/app/api/_lib/forwardedFor.js:47-50`:
    В функции `getTrustedClientIp(request)` перед чтением `X-Forwarded-For` выполняется безусловная проверка заголовка `x-real-ip`:
    ```js
    const realIp = request.headers.get("x-real-ip");
    if (realIp && isPlausibleIp(realIp)) {
      return realIp.trim();
    }
    ```
  - `front-end/src/app/api/_lib/forwardedFor.js:89-96`, `front-end/src/app/api/[...path]/route.js:23`, `front-end/src/app/api/smart-search/route.js:17`:
    Функция `applyTrustedForwardedFor` записывает полученный из `getTrustedClientIp` адрес в `x-forwarded-for` и подписывает запрос заголовком `x-internal-proxy-secret: process.env.INTERNAL_PROXY_SECRET`.
  - `back-end/src/middleware/clientIp.js:56-68`:
    Бэкенд при совпадении `x-internal-proxy-secret` полностью доверяет первому IP в `x-forwarded-for`.
- **Чем грозит (эксплуатация):**
  При деплое на Render (`render.yaml:95-120`, где `ENABLE_CLOUDFLARE: "false"`) или на VPS без принудительной перезаписи `X-Real-IP` на уровне внешнего Nginx, балансировщик пропускает клиентский заголовок `X-Real-IP` без изменений. Злоумышленник отправляет запросы на `/api/auth/login`, `/api/auth/send-otp`, `/api/auth/verify-otp` или `/api/smart-search` со случайным заголовком `X-Real-IP: 203.0.113.<rand>`. Next.js-прокси подписывает этот фальшивый IP внутренним секретом, и бэкенд считает каждый запрос пришедшим с нового IP, что полностью отключает `loginLimiter`, `registerLimiter`, `sendOtpLimiter`, `verifyOtpLimiter`, `aiSearchLimiter` и IP-лимиты Nikita SMS.
  *(Дополнительно в `back-end/src/middleware/clientIp.js:34-39` сравнение `incomingSecret === configuredSecret` выполняется обычным `===` вместо `crypto.timingSafeEqual`).*
- **Как исправить:**
  1. В `front-end/src/app/api/_lib/forwardedFor.js:47-50` удалить безусловное чтение `x-real-ip` (либо разрешать его только при явно включённом флаге `process.env.TRUST_NGINX_REAL_IP === "true"`, когда перед Next.js гарантированно стоит собственный Nginx с `proxy_set_header X-Real-IP $remote_addr;`).
  2. В `back-end/src/middleware/clientIp.js:34-39` сравнивать `x-internal-proxy-secret` через `crypto.timingSafeEqual`.
- **Риск поломки соседних функций:** Низкий. На Render и стандартных прокси реальный IP клиента всегда добавляется в конец `X-Forwarded-For`, который уже корректно обрабатывается в `forwardedFor.js:58-72` (берётся последний элемент `hops[hops.length - 1]`).

---

#### [P0-04] Скомпрометированные секреты в истории Git, активные секреты в `back-end/.env` и невалидный `DATABASE_URL`
- **Приоритет:** P0 (Критично — секреты и конфигурация)
- **Узел:** Секреты и конфигурация (`.git`, `back-end/.env`)
- **Что не так и где:**
  1. **История Git (`.git`, коммит `29d8ddf31b201b1ac5d05e635478ebf05a501619` от 03.08.2026):** Файлы `back-end/.env` и `back-end/back-end.env` были удалены из индекса в коммитах `6dfdabf` и `14e2391`, но **остались в истории Git-объектов** (`git log --all --full-history -- "**/.env*"`). В истории лежат `SUPABASE_KEY` (`eyJh...`) и `JWT_SECRET` (`tVfR...`).
  2. **Текущий локальный файл `back-end/.env:1-24` на диске:**
     - Содержит активные секреты: `SUPABASE_KEY="sb_s..."` (`line 3`), `JWT_SECRET="z4y4..."` (`line 5`), `GEMINI_API_KEY=AQ.A...` (`line 12`), `ODENGI_SID=5320...` (`line 18`), `ODENGI_PASSWORD=%Q42...` (`line 19`).
     - На строке `back-end/.env:4` указано **некорректное значение `DATABASE_URL`**:
       `DATABASE_URL=https://kakiuqgjhcunyaxydopx.supabase.co/rest/v1/`
       Это HTTP-адрес PostgREST, а не строка подключения PostgreSQL (`postgresql://...`). Из-за этого `dbPool` (`back-end/src/config/db.js:36-46`) и скрипт миграций (`back-end/scripts/migrate.js:49-55`) при обращении к `DATABASE_URL` падают с ошибкой подключения.
     - В `back-end/.env` отсутствует `INTERNAL_PROXY_SECRET` и `OTP_SECRET`.
- **Чем грозит:**
  Любой разработчик, подрядчик или CI-раннер с доступом к репозиторию может извлечь старые ключи из `git show 29d8ddf3:back-end/.env`. А некорректный `DATABASE_URL` ломает миграции и прямой пул соединений `pg.Pool`.
- **Как исправить:**
  1. Убедиться в панели Supabase, что старый JWT-ключ `eyJh...` из коммита `29d8ddf3` отозван, а перед выходом в продакшн сгенерировать новые боевые `SUPABASE_KEY`, `JWT_SECRET`, `OTP_SECRET`, `INTERNAL_PROXY_SECRET`, `GEMINI_API_KEY`, `ODENGI_PASSWORD` и `NIKITA_API_KEY`.
  2. Очистить историю репозитория через `git filter-repo --path back-end/.env --path back-end/back-end.env --invert-paths` с принудительным пушем.
  3. В `back-end/.env:4` заменить `DATABASE_URL` на валидный PostgreSQL URI (`postgresql://...`) либо закомментировать его для локальной разработки через `supabase-js`.
- **Риск поломки соседних функций:** При ротации `JWT_SECRET` все текущие залогиненные сессии пользователей будут разлогинены (ожидаемое поведение перед релизом).

---

### Приоритет P1 — Обязательно исправить до релиза

---

#### [P1-01] Подтверждение чужого/непривязанного Email в `verifyOtp` и пропуск проверки отзыва токена (`token_version`) в `optionalAuth`
- **Приоритет:** P1 (Обязательно до релиза — авторизация)
- **Узел:** Аутентификация / Email OTP (`back-end`)
- **Что не так и где:**
  1. `back-end/src/controllers/authController.js:1456-1535` (`verifyOtp`, ветка Email):
     На строке `1458` код ищет запись в `email_verifications` по `email` из `req.body.email`. Затем на строках `1519-1527`, если запрос пришёл с заголовком `Authorization` (`const targetUserId = req.user?.id`), выполняется:
     ```js
     if (targetUserId) {
       await supabase.from("users").update({ is_email_verified: true, ... }).eq("id", targetUserId);
     }
     ```
     **без проверки того, что `req.user.email === email`!**
  2. `back-end/src/middleware/auth.js:188-202` (`optionalAuth`):
     В отличие от основного middleware `authenticate` (`auth.js:88-167`), который проверяет существование пользователя в БД и сверяет `(user.token_version ?? 0) === (decodedUser.tv ?? 0)`, middleware `optionalAuth` выполняет только `jwt.verify` и сразу записывает `req.user = decodedUser` (`line 196`).
- **Чем грозит:**
  1. Авторизованный пользователь с неподтверждённым чужим email в профиле может запросить код на любой контролируемый им сторонний ящик `attacker@mail.com`, отправить `POST /api/auth/verify-otp` со своим JWT и `{ email: "attacker@mail.com", code }`, и его аккаунт получит `is_email_verified = true`.
  2. Отозванный после `POST /api/auth/logout-all` или смены пароля JWT-токен продолжает приниматься как валидный на всех маршрутах, использующих `optionalAuth` (`/api/auth/send-otp`, `/api/auth/verify-otp`, а также `resolveCurrentUser` в `listingsController.js:76-82`).
- **Как исправить:**
  1. В `authController.js:1521` перед обновлением по `targetUserId` проверять `req.user.email?.toLowerCase() === email`, либо обновлять пользователя строго по `.eq("id", targetUserId).eq("email", email)`.
  2. В `back-end/src/middleware/auth.js:188-202` (`optionalAuth`) вызывать ту же проверку пользователя и `token_version` (через `userAuthCache` / БД), что и в `authenticate`, и при несовпадении `token_version` оставлять `req.user = null`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P1-02] Защита от захвата чужого номера при регистрации (Phone Squatting) никогда не срабатывает из-за Guard #6 (`user_profiles`)
- **Приоритет:** P1 (Обязательно до релиза — регистрация / доступность сервиса)
- **Узел:** Аутентификация / Регистрация (`back-end`)
- **Что не так и где:**
  - `back-end/src/controllers/authController.js:360-428` (`releaseExpiredUnverifiedPhoneIfNeeded`):
    Функция призвана освобождать номер телефона через 10 минут (`UNVERIFIED_PHONE_RESERVATION_MS`), если аккаунт не был подтверждён (`is_verified === false` и `is_email_verified === false`).
    Однако проверка №6 (`lines 414-424`) делает запрос:
    ```js
    const { count: profilesCount, error: profilesErr } = await supabase
      .from("user_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", existingByPhone.id);
    if (profilesErr || (profilesCount ?? 0) > 0) {
      return { released: false, conflictResponse: { status: 409, message: "Пользователь с таким телефоном уже существует" } };
    }
    ```
  - В то же время `POST /api/auth/register` (`authController.js:495-511` через RPC `register_user` в `supabase/migrations/20261013120100_register_user_rpc.sql:65-80`, а также в fallback-ветке `authController.js:552-555`) **всегда создаёт строку в `user_profiles` в момент регистрации** (ещё до ввода OTP-кода).
- **Чем грозит:**
  У **каждого** зарегистрированного неподтверждённого пользователя `profilesCount === 1`. Следовательно, проверка №6 **всегда** возвращает `409 Conflict`, и ни один неподтверждённый аккаунт никогда не освобождается! Злоумышленник может зарегистрировать чужой номер телефона (не зная SMS-кода) и навсегда заблокировать настоящему владельцу номера возможность зарегистрироваться на UyTap.
  *(В тесте `back-end/security-tests/phone-reservation.test.mjs:120-133` это не было замечено только потому, что тест вставлял строку напрямую в `public.users` в обход `POST /api/auth/register` и без `user_profiles`).*
- **Как исправить:**
  Убрать блокировку по наличию базовой строки в `user_profiles` (или проверять только отсутствие верифицированного застройщика в `developers` / активных заявок в `verification_requests`), а при удалении просроченного неподтверждённого аккаунта (`authController.js:426`) удалять его вместе с дочерней записью `user_profiles` (каскадно или в транзакции).
- **Риск поломки соседних функций:** Низкий (остальные 5 проверок — отсутствие `listings`, `payments`, `subscriptions`, `favorites` и флагов верификации — надёжно защищают реальные аккаунты).

---

#### [P1-03] In-memory хранение SMS-сессий и лимитов (`PhoneOtpStore`) + состояние гонки (TOCTOU) при отправке и проверке SMS
- **Приоритет:** P1 (Обязательно до релиза — защита баланса SMS / OTP)
- **Узел:** OTP / SMS (`back-end`)
- **Что не так и где:**
  1. `back-end/src/utils/phoneOtpStore.js:27-55` — хранилище `PhoneOtpStore` целиком размещено в оперативной памяти процесса Node.js (`Map` и массивы). При каждом перезапуске контейнера, деплое или горизонтальном масштабировании все активные SMS-сессии, кулдауны (60с), суточные лимиты на номер (10/сут) и глобальный суточный потолок (500 SMS/сут) **обнуляются**.
  2. `back-end/src/services/nikitaService.js:184-239` — проверка лимитов `phoneOtpStore.checkSendLimits(phone, ip)` вызывается на строке `184` **до** сетевого запроса `await postNikita("/api/otp/send", ...)` (`line 206`), а запись факта отправки `phoneOtpStore.recordSend(phone, ip)` — только на строке `239` **после** ответа внешнего API Nikita (окно 200–2000 мс).
  3. `back-end/src/services/nikitaService.js:333-367` — в `verifyOtp` токен удаляется из памяти (`phoneOtpStore.deleteSession`) только на строке `367` после завершения сетевого вызова `await postNikita("/api/otp/verify")`.
- **Чем грозит:**
  Отправка пачки из 10–30 параллельных запросов `POST /api/auth/send-otp` для одного номера одновременно проходит `checkSendLimits` до того, как первый запрос завершит `await postNikita` и вызовет `recordSend`, что позволяет обойти 60-секундный кулдаун и лимит на номер.
- **Как исправить:**
  1. Резервировать слот отправки (`recordSend` или in-flight lock по `phone` и `ip`) **синхронно внутри `checkSendLimits`** до `await postNikita` (с откатом слота только при сетевой ошибке до отправки).
  2. Поставить in-flight блокировку (`record.verifying = true`) на сессию в `phoneOtpStore.registerAttempt` на время выполнения `postNikita("/api/otp/verify")`.
  3. Для продакшна перенести хранение счётчиков и сессий `PhoneOtpStore` в PostgreSQL (по аналогии с `email_verifications` и RPC `consume_otp_attempt`) или Redis.
- **Риск поломки соседних функций:** Низкий.

---

#### [P1-04] Потеря вебхуков O!Dengi из-за общего 10-секундного троттлинга с клиентским поллингом и отсутствие сверки оплаченной суммы
- **Приоритет:** P1 (Обязательно до релиза — платежи / деньги)
- **Узел:** Платёжная система O!Dengi (`back-end`)
- **Что не так и где:**
  1. **Потеря вебхука из-за троттлинга:**
     В `back-end/src/services/payments/paymentsService.js:387-394` функция `reconcilePaymentStatus(payment)` использует in-memory карту `providerCheckThrottleMap` с интервалом `ODENGI_THROTTLE_MS = 10000` (10 секунд на один `order_id`).
     Эта функция вызывается **и** при поллинге статуса клиентом (`GET /api/payments/:orderId/status` -> `getPaymentStatusService`, `line 472`), **и** при получении серверного вебхука от O!Dengi (`POST /api/payments/webhook` -> `handleWebhookService`, `line 553`).
     Если фронтенд опросил `/status` в момент `t = 0с` (когда счёт ещё `processing`), а в `t = 2с` пользователь оплатил счёт и O!Dengi прислал вебхук на `/api/payments/webhook`, то `reconcilePaymentStatus` на строке `390` видит `now - lastCheck < 10000`, **немедленно возвращает управление без запроса в O!Dengi**, а контроллер (`paymentsController.js:228`) отвечает шлюзу O!Dengi `200 OK`!
     При этом фоновый крон `reconcileStuckPayments` (`back-end/src/services/cronService.js:31-53`) ищет только платежи со статусом `status = 'approved'` и `fulfilled_at IS NULL`, и **никогда не проверяет платежи, застрявшие в `status = 'processing'`**! Если пользователь закрыл вкладку браузера сразу после оплаты в приложении O!Деньги, его платёж навсегда останется в `processing`, а услуга не будет активирована.
  2. **Отсутствие сверки суммы платежа:**
     Вопреки утверждению в `SECURITY_AUDIT.md` (п. 1.14), в `back-end/src/services/payments/paymentsService.js:408-423` после вызова `odengiCheckInvoiceStatus` проверяется только `if (providerStatus === "approved")` (`line 415`), но **не проверяется**, что оплаченная сумма (`paymentAttempt?.amount` или `statusData?.amount`) равна `payment.amount` из БД.
- **Чем грозит:**
  1. Реальные оплаченные заказы пользователей могут зависать в статусе `processing` без выдачи тарифа/продвижения.
  2. При расхождении суммы в шлюзе (или частичной оплате) система зачислит полный тариф без проверки `paidAmount >= Number(payment.amount)`.
- **Как исправить:**
  1. Передавать в `reconcilePaymentStatus(payment, { force: true })` флаг `force: true` при вызове из `handleWebhookService` (`paymentsService.js:553`), чтобы вебхук от O!Dengi никогда не блокировался клиентским троттлингом.
  2. В `reconcilePaymentStatus` (`paymentsService.js:415`) перед переводом в `approved` сверять сумму из ответа O!Dengi с `Number(payment.amount)` (если O!Dengi возвращает `amount` в ответе `status`).
  3. В `cronService.js:31-53` добавить периодическую сверку (`reconcilePaymentStatus`) для платежей в статусе `processing`, созданных за последние 24 часа.
- **Риск поломки соседних функций:** Низкий.

---

#### [P1-05] Неверный `ODENGI_RESULT_URL` в конфигурациях, отсутствие HTTP-таймаута в `odengiService.js` и тест-режим по умолчанию
- **Приоритет:** P1 (Обязательно до релиза — платежи / конфигурация)
- **Узел:** Платёжная система O!Dengi (`back-end`)
- **Что не так и где:**
  1. `back-end/.env:24` содержит `ODENGI_RESULT_URL=https://uytap-backend.onrender.com/api`, а `back-end/.env.example:70` — `ODENGI_RESULT_URL=https://your-backend.onrender.com/api/payments/odengi/callback`. Оба URL неверны: реальный роут вебхука смонтирован по адресу **`POST /api/payments/webhook`** (`back-end/src/routes/paymentsRoutes.js:48`, `back-end/src/index.js:157`).
  2. `back-end/src/services/odengiService.js:52-56` — вызов `fetch(odengiConfig.apiUrl, ...)` выполняется **без `signal: AbortSignal.timeout(...)`**. При зависании шлюза O!Dengi запросы создания счёта и вебхуки зависнут бесконечно.
  3. `back-end/src/config/odengi.js:15-21` — по умолчанию `apiUrl` указывает на тестовый шлюз `https://mw-api-test.dengi.kg/api/json/json.php`, а `test: process.env.ODENGI_TEST === "0" ? 0 : 1`. При запуске с `NODE_ENV=production` нет проверки, предупреждающей или блокирующей запуск с песочницей (`test: 1`), если переменную `ODENGI_TEST=0` забыли задать.
- **Чем грозит:**
  Вебхуки от O!Dengi в продакшне будут получать `404 Not Found`; зависание внешнего API O!Dengi заблокирует соединения бэкенда; при забытом `ODENGI_TEST=0` пользователи смогут активировать платные тарифы через тестовый контур.
- **Как исправить:**
  1. Исправить `ODENGI_RESULT_URL` в `.env.example:70` (и в боевом окружении) на `https://<backend-domain>/api/payments/webhook`.
  2. Добавить `signal: AbortSignal.timeout(10000)` в `fetch` внутри `back-end/src/services/odengiService.js:52`.
  3. В `assertOdengiConfigured()` (`back-end/src/config/odengi.js:26-35`) при `NODE_ENV === "production"` проверять, что `ODENGI_RESULT_URL` задан и заканчивается на `/api/payments/webhook`, а также логировать критическое предупреждение (или ошибку), если `ODENGI_TEST !== "0"`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P1-06] Обход оплаты Instagram-рекламы при создании объявления с `listingType: "instagram"`
- **Приоритет:** P1 (Обязательно до релиза — бизнес-логика / монетизация)
- **Узел:** Объявления / Платежи (`back-end`)
- **Что не так и где:**
  - `back-end/src/controllers/listingsController.js:1276-1286`:
    В `createListing` (маршрут `POST /api/listings`) любой авторизованный пользователь может передать в теле запроса `listingType: "instagram"` (разрешено схемой `createListingSchema` в `back-end/src/utils/validation.js:230`).
    На строках `1276-1286` контроллер проверяет:
    ```js
    if (normalizedListingType === "instagram" && newListing?.id) {
      await createInstagramRequest({ listingId: newListing.id, userId });
    }
    ```
    При этом объявление сразу публикуется со статусом `active` (`listingsController.js:1165`: `normalizedListingType === "free" ? "moderation" : "active"` — то есть **даже в обход модерации!**), а заявка в таблице `instagram_requests` создаётся со статусом `pending` (`back-end/src/controllers/adminController.js:724-738`) и попадает в админ-панель (`GET /api/admin/instagram-requests`) как готовая к публикации в Instagram **без какого-либо платежа**!
- **Чем грозит:**
  Любой пользователь может:
  1. Публиковать объявления со статусом `active` без прохождения модерации и без платного тарифа, просто передав `listingType: "instagram"` (или `"vip"` / `"urgent"`, хотя сам флаг `is_vip`/`is_urgent` не ставится, но проверка `normalizedListingType === "free" ? "moderation" : "active"` на строке `1165` пропускает модерацию!).
  2. Бесплатно создавать заявки на рекламу в Instagram в обход платного эндпоинта `POST /api/payments/promotion/create`.
- **Как исправить:**
  1. На строке `listingsController.js:1165` определять статус `active` vs `moderation` исключительно по наличию активной платной подписки пользователя (`hasActiveSub`), а не по клиентскому полю `normalizedListingType`.
  2. Запретить прямое создание заявки `createInstagramRequest` из `createListing` без подтверждённого платежа (заявка должна создаваться или активироваться только после оплаты `promotion_orders` с `service_type = 'instagram'`).
- **Риск поломки соседних функций:** Средний. Если фронтенд при создании объявления сразу предлагает выбрать «Реклама в Instagram», он должен после создания объявления инициировать оплату через `POST /api/payments/promotion/create`, и только после оплаты заявка должна появляться в админке.

---

#### [P1-07] IDOR: Чтение чужих черновиков, скрытых и находящихся на модерации объявлений через «Избранное»
- **Приоритет:** P1 (Обязательно до релиза — авторизация / утечка данных)
- **Узел:** Избранное / Объявления (`back-end`)
- **Что не так и где:**
  - `back-end/src/controllers/favoritesController.js:19-30` (`addFavorite`): проверяет только существование объявления `.from("listings").select("id").eq("id", listingId).maybeSingle()` без проверки `.eq("status", "active")`.
  - `back-end/src/controllers/favoritesController.js:128-157` (`getFavorites`): используя клиент `supabase` с ключом `service_role` (обходящим RLS), выгружает полные данные связанных объявлений `listings (*, listing_photos (*), users (...))` без фильтра по `listings.status === "active"`.
- **Чем грозит:**
  В то время как `GET /api/listings/:id` (`listingsController.js:909-914`) запрещает просмотр чужих неактивных объявлений (`draft`, `moderation`, `hidden`, `expired`, `rejected`), любой авторизованный пользователь может вызвать `POST /api/favorites/<listingId>` и затем `GET /api/favorites`, получив полное описание, телефон, цену и все фотографии чужого черновика или скрытого объявления.
- **Как исправить:**
  1. В `addFavorite` (`favoritesController.js:22-25`) разрешать добавление в избранное только объявлений со `status === "active"`.
  2. В `getFavorites` (`favoritesController.js:145-156`) отфильтровывать записи, у которых `item.listings?.status !== "active"`, а также пропускать автора через `sanitizeAuthorPII` и `maskExpiredPromotion`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P1-08] Утечка приватных путей документов верификации (`verificationDocs`), ИНН, email и скрытых телефонов в публичных API
- **Приоритет:** P1 (Обязательно до релиза — утечка персональных данных / PII)
- **Узел:** Профили / Объявления (`back-end`)
- **Что не так и где:**
  1. `back-end/src/controllers/listingsController.js:884` (`getListingById`):
     Запрос выбирает `user_profiles (first_name, last_name, company_name, avatar_url, about)` и отдаёт `listing.users.user_profiles.about` клиенту как есть. Однако для застройщиков (`developer`) в колонке `user_profiles.about` хранится JSON со служебными полями `verificationDocs` (пути к паспортам/свидетельствам в приватном бакете `verification-docs`), `verificationStatus` и `rejectionReason` (`back-end/src/controllers/authController.js:2302-2306`, `adminController.js:625-626`)!
  2. `back-end/src/controllers/authController.js:2111-2201` (`getUserPublicProfile`, роут `GET /api/auth/users/:id`):
     - Строка `2117` не выбирает поле `show_phone` из таблицы `users`, а строка `2193` возвращает `phone: user.phone` для личных аккаунтов (`personal`) даже тогда, когда пользователь отключил показ телефона (`show_phone = false`)!
     - Строка `2192` возвращает `email: isBusinessAccount ? user.email : null` (раскрывая логин-почту и технические адреса вида `996XXXXXXXXX@phone.uytap.kg`), хотя в `listingsController.js:765` (`sanitizeAuthorPII`) email был специально скрыт для всех типов аккаунтов.
     - Строка `2149` и `2196` возвращают `inn` (ИНН компании/риэлтора) и `verificationStatus` в публичном профиле.
     - Строка `2197` возвращает список объявлений `ads` без вызова `maskExpiredPromotion`, показывая истёкшие VIP/TOP-статусы.
- **Чем грозит:**
  Раскрытие персональных данных пользователей (скрытых номеров телефонов, логин-email, ИНН, причин отказа модерации и внутренних путей документов верификации) любому анонимному посетителю.
- **Как исправить:**
  1. В `listingsController.js:884` парсить `user_profiles.about` и удалять из него `verificationDocs`, `verificationStatus`, `rejectionReason` (оставляя только текстовое описание `text`).
  2. В `getUserPublicProfile` (`authController.js:2117, 2185-2199`) добавить `show_phone` в `select`, скрывать `phone` при `show_phone === false`, всегда возвращать `email: null`, исключить `inn` из публичного ответа и применить `maskExpiredPromotion` к `ads`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P1-09] Неаутентифицированный и не лимитированный прокси к платному API ElevenLabs (`POST /api/speech-to-text`) + риск OOM
- **Приоритет:** P1 (Обязательно до релиза — защита платных API и доступности сервера)
- **Узел:** Голосовой поиск / Next.js Route Handler (`front-end`)
- **Что не так и где:**
  - `front-end/src/app/api/speech-to-text/route.js:5-85`:
    Маршрут `POST /api/speech-to-text` принимает `multipart/form-data` с аудиофайлом размером до **20 МБ** (`if (audio.size > 20 * 1024 * 1024)` на строке `27`) и пересылает его в `https://api.elevenlabs.io/v1/speech-to-text` с серверным ключом `process.env.ELEVENLABS_API_KEY` (`lines 7, 43-52`).
    При этом:
    1. На маршруте **нет ни авторизации, ни rate-limiting** (запрос обрабатывается напрямую сервером Next.js и не проходит через `express-rate-limit` бэкенда).
    2. Вызов `await request.formData()` (`line 16`) целиком загружает тело запроса в оперативную память Node.js до проверки `audio.size`.
- **Чем грозит:**
  1. Любой сторонний скрипт в интернете может бесплатно использовать ваш платный ключ ElevenLabs (`scribe_v2`) для транскрибации собственных аудиофайлов и обнулить баланс за минуты.
  2. На тарифе Render `starter` (512 МБ RAM, `render.yaml:98`) отправка 15–20 параллельных запросов по 20 МБ вызовет **Out-Of-Memory (OOM) crash** контейнера фронтенда.
- **Как исправить:**
  1. Перенести эндпоинт `/api/speech-to-text` на бэкенд под жесткий `express-rate-limit` (например, 5 запросов в минуту с одного IP) и `multer` со строгим лимитом размера **2–3 МБ** (для 15–30 секунд голосовой команды поиска 2 МБ WebM/Opus более чем достаточно), либо добавить IP rate-limiter и проверку `content-length` до `request.formData()` в самом `route.js`.
- **Риск поломки соседних функций:** Низкий (голосовой ввод поискового запроса длится несколько секунд и весит десятки килобайт).

---

#### [P1-10] Отсутствие индексов на внешних ключах (Foreign Keys) в PostgreSQL (`listings`, `listing_photos`, `favorites`, `complex_layouts`)
- **Приоритет:** P1 (Обязательно до релиза — производительность БД и защита от DoS)
- **Узел:** База данных и миграции (`supabase/migrations`)
- **Что не так и где:**
  В `supabase/migrations/20261012000000_baseline.sql` (и последующих миграциях) созданы внешние ключи (`FOREIGN KEY`), но **отсутствуют индексы** на следующих высоконагруженных колонках:
  1. `public.listings(user_id)` (`baseline.sql:1241-1242`) — используется в `getMyListings`, `getUserPublicProfile`, RPC `create_listing_with_limit` (`baseline.sql:330`) и в RLS-политике `listings` (`baseline.sql:1365`).
  2. `public.listing_photos(listing_id)` (`baseline.sql:1233-1234`, `ON DELETE CASCADE`) — используется при каждой выборке каталога объявлений и в триггере `update_listing_photos_count` (`20261013000000_listing_priority_rank.sql:56, 61`), который делает `SELECT COUNT(*) FROM listing_photos WHERE listing_id = ...` на каждую вставку/удаление фото!
  3. `public.favorites(listing_id)` (`baseline.sql:1217-1218`, `ON DELETE CASCADE`) — уникальный индекс `favorites_user_id_listing_id_key` (`baseline.sql:903`) имеет `user_id` первой колонкой и не ускоряет каскадное удаление при `DELETE FROM listings`.
  4. `public.complex_layouts(complex_id)` (`baseline.sql:1201-1202`), `public.listings(complex_id)` (`baseline.sql:1225-1226`), `public.residential_complexes(developer_id)` (`baseline.sql:1273-1274`), `public.verification_requests(user_id)` (`baseline.sql:1313-1314`).
- **Чем грозит:**
  При росте числа объявлений и фотографий до нескольких тысяч каждый запрос каталога, добавление фотографии и удаление объявления будут вызывать **Sequential Scan** всей таблицы и блокировки при каскадных удалениях.
- **Как исправить:**
  Создать новую миграцию в `supabase/migrations/` с командами `CREATE INDEX IF NOT EXISTS` для всех перечисленных внешних ключей.
- **Риск поломки соседних функций:** Нулевой (добавление индексов не меняет логику запросов).

---

#### [P1-11] Таблица `public._schema_migrations` без RLS, пустой `search_path` в RPC/триггерах и отсутствие бакета `verification-docs` в `DEPLOY.md`
- **Приоритет:** P1 (Обязательно до релиза — БД и инфраструктура Supabase)
- **Узел:** База данных / Storage / Миграции (`back-end/scripts/migrate.js`, `supabase/migrations`, `DEPLOY.md`)
- **Что не так и где:**
  1. `back-end/scripts/migrate.js:77-81` создаёт таблицу `public._schema_migrations` в схеме `public` **без `ALTER TABLE public._schema_migrations ENABLE ROW LEVEL SECURITY`** и без отзыва грантов у `anon`/`authenticated`. В Supabase Cloud (при `auto_expose_new_tables = true`, `supabase/config.toml:23`) эта таблица автоматически становится открытой на чтение/запись через PostgREST по публичному `anon`-ключу.
  2. `supabase/migrations/20261012000000_baseline.sql:14` выполняет `SELECT pg_catalog.set_config('search_path', '', false);`. При этом 6 функций `SECURITY DEFINER` в `baseline.sql` (`activate_subscription_atomic` `:67`, `consume_otp_attempt` `:187`, `create_listing_with_limit` `:252`, `increment_views` `:405`, `refund_tariff_boost_atomic` `:425`, `refund_tariff_listing_atomic` `:501`) и 2 триггерные функции в `20261013000000_listing_priority_rank.sql` (`update_listing_priority_rank` `:29`, `update_listing_photos_count` `:52`) обращаются к таблицам без префикса `public.` и **не имеют директивы `SET search_path = public`** в заголовке функции.
  3. Рассинхрон бакетов Storage: код (`back-end/src/utils/storage.js:6, 156, 205`) использует 3 бакета: публичный `avatars`, публичный `banners` и **приватный `verification-docs`**. Однако в `DEPLOY.md:39, 346-350` указано создать `avatars`, `listings` (не существует в коде) и `banners`, а **`verification-docs` вообще не упомянут**. В SQL-миграциях создание бакетов также отсутствует.
- **Чем грозит:**
  1. Через `anon`-ключ Supabase можно модифицировать `_schema_migrations`.
  2. На чистом продакшн-инстансе, развёрнутом по инструкции `DEPLOY.md`, загрузка документов верификации застройщика (`POST /api/upload/verification-docs`) упадёт с ошибкой `Bucket not found`.
- **Как исправить:**
  1. В `back-end/scripts/migrate.js:77-81` добавить `ALTER TABLE public._schema_migrations ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public._schema_migrations FROM PUBLIC, anon, authenticated;`.
  2. Новой миграцией проставить `ALTER FUNCTION ... SET search_path = public;` для всех 8 функций.
  3. Обновить `DEPLOY.md:39, 346-350` (и/или добавить идемпотентный `INSERT INTO storage.buckets` в миграцию): зафиксировать публичные бакеты `avatars`, `banners` и приватный бакет `verification-docs`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P1-12] Сломанное условие деплоя в `.github/workflows/ci.yml`, отсутствие SSL в `dbPool` и пропуск 13 security-тестов в CI
- **Приоритет:** P1 (Обязательно до релиза — CI/CD и тестирование)
- **Узел:** CI/CD / Деплой / Тесты (`.github/workflows/ci.yml`, `back-end/package.json`, `back-end/src/config/db.js`)
- **Что не так и где:**
  1. **Автодеплой в `ci.yml` никогда не выполнится (`.github/workflows/ci.yml:265-282`):**
     ```yaml
     - name: Trigger Render Backend Deploy Hook
       if: env.RENDER_BACKEND_DEPLOY_HOOK != ''
       env:
         RENDER_BACKEND_DEPLOY_HOOK: ${{ secrets.RENDER_BACKEND_DEPLOY_HOOK }}
     ```
     В GitHub Actions условие `if:` на уровне шага вычисляется **до** инициализации блока `env:` этого же шага! Так как переменная не объявлена на уровне `jobs.deploy-to-render.env`, `env.RENDER_BACKEND_DEPLOY_HOOK` в `if:` всегда пустой, и шаги деплоя бэкенда и фронтенда всегда получают статус `Skipped`.
  2. **13 файлов security-тестов исключены из `npm test` и CI (`back-end/package.json:17-18`, `.github/workflows/ci.yml:105-115`):**
     В `back-end/package.json:17-18` в скриптах `test` и `test:coverage` вручную перечислены 37 файлов, но **забыты 13 файлов** из `back-end/security-tests/` (`auth-verify-otp.test.mjs`, `ip-spoofing.test.mjs`, `otp-logging.test.mjs`, `otp-verification.test.mjs`, `pagination-bounds.test.mjs`, `payments-security.test.mjs`, `phone-reservation.test.mjs`, `send-limits.test.mjs`, `supabase-rls-postgrest.test.mjs`, `e2e-baseline-scenarios.test.mjs`, `item-11-12-13-slots-resilience.test.mjs`, `item-4-tariff-arbitrage-prorata.test.mjs`, `item-4-tariff-upgrade-arbitrage.test.mjs`). Более того, в `ci.yml:105-115` не передаются `TEST_SUPABASE_URL` / `TEST_SUPABASE_KEY`, поэтому все DB-тесты безопасности в CI тихо пропускаются (`skip`).
  3. **Trivy не блокирует уязвимые Docker-образы (`.github/workflows/ci.yml:196, 259`):**
     В `trivy-action` указано `exit-code: "0"`, а джоб `build-and-scan-docker` не добавлен в `needs:` джоба `deploy-to-render`.
  4. **Отсутствие `ssl` в `dbPool` (`back-end/src/config/db.js:38-43`):**
     В отличие от `back-end/scripts/migrate.js:49-52` (где задано `ssl: useSsl ? { rejectUnauthorized: false } : undefined`), в `src/config/db.js:38-43` `new Pool` создаётся без настройки `ssl`, что при подключении к внешнему управляемому PostgreSQL (Supabase / Render) по TLS может вызывать ошибку `SELF_SIGNED_CERT_IN_CHAIN`.
- **Чем грозит:**
  Регрессии безопасности не ловятся в CI, уязвимые образы проходят сборку, а деплой-хуки в GitHub Actions не срабатывают.
- **Как исправить:**
  1. Перенести `env: RENDER_BACKEND_DEPLOY_HOOK: ...` на уровень `jobs.deploy-to-render.env` в `.github/workflows/ci.yml:260`.
  2. Включить все актуальные тесты из `security-tests/` в `back-end/package.json:17-18`.
  3. В `ci.yml:196` поставить `exit-code: "1"` для `CRITICAL` уязвимостей и добавить `build-and-scan-docker` в `needs` деплоя.
  4. Добавить конфигурацию `ssl` в `back-end/src/config/db.js:38-43` аналогично `migrate.js`.
- **Риск поломки соседних функций:** Низкий (при добавлении `ip-spoofing.test.mjs` и `send-limits.test.mjs` в `npm test` нужно сначала исправить их привязку к внешнему порту `localhost:5000`, см. **P3-03**).

---

### Приоритет P2 — Важные замечания (рекомендуется закрыть до или сразу после релиза)

---

#### [P2-01] Оракулы перечисления аккаунтов (Account Enumeration) в `/forgot-password` и `/send-otp` и обход `sendOtpLimiter` ротацией целей
- **Приоритет:** P2 (Важно — приватность / защита от спама)
- **Узел:** OTP / Email / SMS (`back-end`)
- **Что не так и где:**
  1. `back-end/src/controllers/authController.js:1614-1637` (`forgotPassword`, ветка телефона):
     Если пользователь с таким телефоном **не найден**, возвращается `{ success: true, message: "Если аккаунт существует, код отправлен по SMS" }` **без поля `token`** (`lines 1615-1618`). Если пользователь **найден**, возвращается тот же текст, но **с полем `token: result.token`** (`lines 1633-1637`) либо статус `429` при повторном запросе. Это 100%-й оракул проверки существования телефона в базе + возможность расходовать баланс Nikita SMS на любые зарегистрированные номера через `/forgot-password`.
  2. `back-end/src/controllers/authController.js:1658-1670` (`forgotPassword`, ветка email):
     Повторный запрос в течение 60 секунд для несуществующего email возвращает `200 OK` (`line 1659`), а для существующего — `429 Too Many Requests` (`line 1668`).
  3. `back-end/src/controllers/authController.js:1301-1334` (`sendOtp`, ветка email):
     Для несуществующего/подтверждённого email возвращает `"Если аккаунт существует, код отправлен"`, а для существующего неподтверждённого — `"Код подтверждения отправлен"` + поле `email`.
  4. `back-end/src/routes/authRoutes.js:128-146` (`sendOtpLimiter`):
     Ключ лимитера формируется как `if (email) return "send-otp:email:" + email` без участия IP-адреса! В результате с одного IP-адреса можно отправлять письма на сотни разных email-адресов в минуту (до глобального лимита 300 req/min), выжигая дневную квоту Resend/SMTP.
- **Как исправить:**
  1. В `forgotPassword` (телефон) всегда возвращать одинаковую структуру `{ success: true, message: "...", token: result.token || crypto.randomUUID() }` и применять одинаковый rate-limit по IP/номеру независимо от существования пользователя.
  2. В `sendOtpLimiter` (`authRoutes.js:128-146`) добавить отдельный лимит по IP (например, не более 10 отправок в 10 минут с одного IP на любые адреса) в дополнение к лимиту на конкретный `email`/`phone`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P2-02] Отсутствие проверки энтропии `JWT_SECRET`, разделения с `OTP_SECRET` в продакшне и гонка при сбросе пароля по телефону
- **Приоритет:** P2 (Важно — криптография и сессии)
- **Узел:** Аутентификация (`back-end`)
- **Что не так и где:**
  1. `back-end/src/middleware/auth.js:7-12`: проверяет только наличие `process.env.JWT_SECRET`, но не проверяет его минимальную длину (например, `>= 32` символов) и не отклоняет шаблонное значение из `.env.example`.
  2. `back-end/src/controllers/authController.js:88-96`: функция `getOtpSecret()` при отсутствии `OTP_SECRET` в `production` только пишет `console.warn` и использует `JWT_SECRET` для HMAC-хэширования OTP-кодов.
  3. `back-end/src/controllers/authController.js:1991-2009` (`resetPassword`, ветка телефона): обновляет пароль и `token_version: currentVersion + 1` по `.eq("id", targetUser.id)` без оптимистичной блокировки `.eq("token_version", currentVersion)`.
- **Как исправить:**
  1. В `src/index.js:28-36` (при `NODE_ENV === "production"`) требовать `JWT_SECRET.length >= 32` и наличие отдельного `OTP_SECRET` (`>= 32` символов, `OTP_SECRET !== JWT_SECRET`).
  2. В `authController.js:2005` добавить `.eq("token_version", currentVersion)` при обновлении пароля.
- **Риск поломки соседних функций:** Низкий (потребуется задать `OTP_SECRET` в переменных окружения продакшна).

---

#### [P2-03] Хранение JWT в `localStorage`, дублирование в незащищённый `document.cookie` (без `Secure`/`HttpOnly`) и неработающий «Запомнить меня»
- **Приоритет:** P2 (Важно — клиентская безопасность)
- **Узел:** Аутентификация на клиенте (`front-end`)
- **Что не так и где:**
  1. `front-end/src/app/login/page.jsx:91-96` и `front-end/src/app/admin/login/page.jsx:44-45`:
     При входе токен сохраняется одновременно в `localStorage` и в `document.cookie`:
     - В `login/page.jsx:91-93`: `document.cookie = "uytap_token=...; path=/; max-age=2592000; SameSite=Lax"` (на 30 дней при TTL самого JWT 24 часа в `back-end/src/middleware/auth.js:23`, **без флага `Secure`**).
     - В `admin/login/page.jsx:44`: `document.cookie = "uytap_token=...; path=/; max-age=2592000"` (**без `Secure` и без `SameSite`**).
     При этом ни бэкенд (`auth.js:44`), ни фронтенд этот cookie нигде не читают — токен передаётся только через заголовок `Authorization: Bearer` из `localStorage`. Запись токена в не-`HttpOnly` и не-`Secure` cookie лишь создаёт лишний вектор утечки по сети.
  2. `front-end/src/app/login/page.jsx:30, 263-272`: чекбокс `remember` («Запомнить меня») привязан к `useState(true)`, но при сохранении токена (`lines 91-99`) переменная `remember` вообще нигде не используется.
- **Как исправить:**
  1. Удалить бесполезную запись `document.cookie = "uytap_token=..."` из `login/page.jsx:91-93`, `admin/login/page.jsx:44` и очистку из `DeveloperProfile.jsx:127` (либо при переходе на cookie-авторизацию выставлять `HttpOnly; Secure; SameSite=Lax` cookie с сервера).
  2. При `remember === false` сохранять токен в `sessionStorage` вместо `localStorage` (и учитывать это в `front-end/src/utils/auth.js:11`).
- **Риск поломки соседних функций:** Низкий (middleware Next.js в проекте отсутствует, cookie `uytap_token` нигде не читается).

---

#### [P2-04] Отсутствие HTTP Security Headers (`CSP`, `HSTS`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) на фронтенде
- **Приоритет:** P2 (Важно — веб-безопасность)
- **Узел:** Веб-безопасность (`front-end/next.config.mjs`)
- **Что не так и где:**
  - `front-end/next.config.mjs:53-94`: в конфигурации Next.js отсутствует секция `async headers()`. Заголовки `helmet()` из `back-end/src/index.js:51` применяются только к JSON-ответам API бэкенда, но не к HTML-страницам фронтенда.
- **Чем грозит:**
  Страницы `/login`, `/admin/login`, `/profile` и страницы оплаты не защищены от Clickjacking (`X-Frame-Options` / `frame-ancestors`), MIME-sniffing и даунгрейда протокола (`Strict-Transport-Security`), а отсутствие `Content-Security-Policy` повышает риск кражи JWT из `localStorage` при возникновении XSS.
- **Как исправить:**
  Добавить `async headers()` в `front-end/next.config.mjs` с заголовками `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(self), microphone=(self)` и `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- **Риск поломки соседних функций:** Низкий (при настройке `Permissions-Policy` важно оставить `microphone=(self)` для голосового поиска и `geolocation=(self)` для карты).

---

#### [P2-05] Отсутствие валидации `socials` в профиле (`z.any()`), рендер `profile.website` без проверки схемы и внешние URL баннеров
- **Приоритет:** P2 (Важно — защита от XSS / SSRF)
- **Узел:** Валидация входных данных (`back-end` / `front-end`)
- **Что не так и где:**
  1. `back-end/src/utils/validation.js:160` — в `updateMeSchema` поле `socials` объявлено как `socials: z.any().optional()`, что позволяет сохранить в `user_profiles.about` произвольный JSON-объект любой вложенности или вредоносные `javascript:` ссылки.
  2. `front-end/src/app/profile/components/realtorProfile/RealtorProfile.jsx:140-145` — рендерит `<a href={profile.website}>` без нормализации протокола `https?://` (в отличие от `AgencyProfile.jsx:203` и `DeveloperProfile.jsx:345-348`).
  3. `back-end/src/utils/validation.js:476-481` — `bannerImageUrl` проверяет только `isHttpUrl` (разрешая любой внешний хост), тогда как для всех остальных изображений (`validation.js:38-64`) используется `trustedImageUrl` (только хост `SUPABASE_URL`).
- **Как исправить:**
  1. Заменить `socials: z.any().optional()` в `validation.js:160` на строгий `z.record(z.string().max(32), httpUrlField)` или удалить, если не используется.
  2. В `RealtorProfile.jsx:140` проверять `/^https?:\/\//i.test(profile.website)`.
  3. В `validation.js:476` использовать `trustedImageUrl` для `bannerImageUrl`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P2-06] Маршруты без потолка пагинации (`.limit()`) и проблема N+1 запросов в `cleanupOrphanedPendingAvatars`
- **Приоритет:** P2 (Важно — производительность и защита от выгрузки базы)
- **Узел:** База данных и API (`back-end`)
- **Что не так и где:**
  1. Следующие эндпоинты выгружают все записи из БД без `.limit()` / `.range()`:
     - `GET /api/complexes/:id/listings` (`back-end/src/controllers/complexesController.js:180-190`) — публичный эндпоинт, выгружает все активные объявления ЖК и все их фотографии без лимита.
     - `GET /api/auth/users/:id` (`back-end/src/controllers/authController.js:2155-2182`) — публичный профиль, выгружает все активные объявления пользователя и все их фото без лимита.
     - `GET /api/complexes/my` (`back-end/src/controllers/complexesController.js:230-239`) — все ЖК застройщика без лимита.
     - `GET /api/favorites` (`back-end/src/controllers/favoritesController.js:128-140`) — все избранные объявления со связанными фото и авторами без лимита.
     - Админ-списки в `back-end/src/controllers/adminController.js:88, 179, 535, 670` (`getModerationListings`, `getAllListings`, `getUsers`, `getAdminPayments`).
  2. `back-end/src/utils/storage.js:94-118` (`cleanupOrphanedPendingAvatars`): в цикле `for (const file of staleFiles)` (до 100 файлов) выполняет по 2 отдельных SQL-запроса `.ilike("avatar_url", ...)` и `.ilike("logo_url", ...)` — до **200 последовательных запросов к БД** за один запуск крона.
- **Как исправить:**
  1. Добавить пагинацию (`limit <= 100`, `.range(from, to)`) на перечисленные эндпоинты.
  2. В `cleanupOrphanedPendingAvatars` заменить цикл из 200 запросов на 2 пакетных запроса или проверку через таблицу `upload_ownership`.
- **Риск поломки соседних функций:** Низкий (при сохранении дефолтного `limit = 100` фронтенд продолжит работать без изменений).

---

#### [P2-07] Неатомарный fallback активации подписки (`activateSubscriptionFallback`)
- **Приоритет:** P2 (Важно — целостность данных подписок)
- **Узел:** Платежи и подписки (`back-end/src/services/subscriptionsService.js`)
- **Что не так и где:**
  - `back-end/src/services/subscriptionsService.js:355-434`: если вызов атомарной RPC `activate_subscription_atomic` вернул ошибку (`lines 334-345`), вызывается `activateSubscriptionFallback`, который выполняет 3 отдельных нетранзакционных запроса:
    1) отменяет текущие активные подписки пользователя (`status = 'canceled'`, `line 366`);
    2) вставляет новую подписку (`line 380`);
    3) обновляет `users` (`line 410`).
    Если шаг 2 или 3 упадёт (например, из-за сетевого сбоя или ограничения БД), старая оплаченная подписка пользователя уже будет переведена в `canceled`, а новая не создастся.
- **Как исправить:**
  Выполнять fallback через транзакцию `dbPool` (`BEGIN ... COMMIT`) либо полагаться исключительно на RPC `activate_subscription_atomic` с ретраем при временной сетевой ошибке, не отменяя старую подписку вне транзакции.
- **Риск поломки соседних функций:** Низкий.

---

#### [P2-08] Утечка внутренних сообщений об ошибках (`error.message`) в HTTP 500 ответах клиенту
- **Приоритет:** P2 (Важно — чистота кода и безопасность)
- **Узел:** Обработка ошибок (`back-end`)
- **Что не так и где:**
  В ряде контроллеров при статусе `500` клиенту возвращается сырое внутреннее сообщение `error.message` (включая ошибки Postgres/Supabase и Sharp):
  - `back-end/src/controllers/complexesController.js:424` (`"Ошибка при создании жилого комплекса: " + complexError.message`)
  - `back-end/src/controllers/authController.js:1171, 2246`
  - `back-end/src/controllers/uploadController.js:102, 156, 209`
  - `back-end/src/controllers/bannersController.js:94`
  - `back-end/src/controllers/adminController.js:755`
- **Как исправить:**
  Логировать детальную ошибку на сервере (`console.error` / `logger`), а клиенту в 500-ответах отдавать только статическое пользовательское сообщение без конкатенации `error.message`.
- **Риск поломки соседних функций:** Нулевой.

---

#### [P2-09] Невалидные плейсхолдеры в `.github/CODEOWNERS`, незакрытый `dbPool` в `gracefulShutdown`, отсутствие `front-end/Dockerfile` и устаревший `docs/deploy.md`
- **Приоритет:** P2 (Важно — деплой и эксплуатация на VPS)
- **Узел:** CI/CD и деплой (`.github/CODEOWNERS`, `back-end/src/index.js`, `docs/deploy.md`)
- **Что не так и где:**
  1. `.github/CODEOWNERS:5-13` содержит шаблонные строки `@<GITHUB_TEAM_OR_TECHLEAD>`, `@<GITHUB_DBA_OR_TECHLEAD>`, `@<GITHUB_DEVOPS_OR_TECHLEAD>`. При включении правила `Require review from Code Owners` в GitHub ветка `main` будет заблокирована для любых PR из-за синтаксически невалидных владельцев.
  2. `back-end/src/index.js:206-226` (`gracefulShutdown`): останавливает крон (`stopCronJobs()`) и HTTP-сервер (`server.close()`), но не закрывает пул соединений PostgreSQL `dbPool?.end()` (`back-end/src/config/db.js:34`).
  3. Для переезда на VPS есть готовый `back-end/Dockerfile:1-76`, но отсутствует `front-end/Dockerfile` и `docker-compose.yml` / конфигурация Nginx + PM2.
  4. Файл `docs/deploy.md:1-214` устарел и противоречит актуальному `DEPLOY.md:1-554` (указывает неверные переменные `ODENGI_MERCHANT_ID`/`ODENGI_SECRET_KEY` на строках `48-51` вместо `ODENGI_SID`/`ODENGI_PASSWORD`, и `trust proxy: 1` вместо `INTERNAL_PROXY_SECRET`).
- **Как исправить:**
  1. Заменить плейсхолдеры в `.github/CODEOWNERS` на реальные GitHub-аккаунты команды.
  2. Вызывать `if (dbPool) await dbPool.end();` внутри `gracefulShutdown` в `back-end/src/index.js:211`.
  3. Удалить устаревший `docs/deploy.md` (оставив единый `DEPLOY.md`) и при деплое на VPS использовать связку Nginx (TLS + `proxy_set_header`) + Docker/PM2.
- **Риск поломки соседних функций:** Нулевой.

---

### Приоритет P3 — Улучшения чистоты кода и тестов

---

#### [P3-01] Посторонние файлы в корне репозитория и кириллическая буква `с` в пути `front-end/src/app/register/сomponents/`
- **Приоритет:** P3 (Улучшение — чистота репозитория)
- **Узел:** Чистота кода и структура проекта
- **Что не так и где:**
  1. `{9944FEF3-BBDA-463C-A3C1-7B1E32D2940F}.png` — в корень репозитория закоммичен скриншот (69 КБ).
  2. `package.json:1-5` и `package-lock.json` в корне репозитория содержат только одну зависимость `"lucide-react": "^1.61.0"` (ошибочно установленную в корень вместо `promo-video/`). Из-за корневого `package-lock.json` сборка `next build` (`front-end`) выдаёт предупреждение о множественных lock-файлах.
  3. Директория `front-end/src/app/register/сomponents/` содержит в первой букве слова `сomponents` **кириллическую букву `с` (U+0441)** вместо латинской `c` (U+0063), что создаёт путаницу при импортах и кроссплатформенной разработке.
- **Как исправить:**
  Удалить `{9944FEF3-BBDA-463C-A3C1-7B1E32D2940F}.png`, корневые `package.json` и `package-lock.json`, и переименовать `сomponents` в латинское `components` с обновлением импортов в `front-end/src/app/register/page.jsx`.
- **Риск поломки соседних функций:** Низкий.

---

#### [P3-02] Мёртвый код и неэкранированный `resetUrl` в неиспользуемой функции `sendResetLinkEmail`
- **Приоритет:** P3 (Улучшение — чистота кода)
- **Узел:** Чистота кода (`back-end` / `front-end`)
- **Что не так и где:**
  1. `back-end/src/services/emailService.js:81-116` — экспортируемая функция `sendResetLinkEmail(email, resetUrl)` нигде в проекте не вызывается (сброс пароля работает по 6-значному коду через `sendPasswordResetEmail`), при этом на строке `97` вставляет `${resetUrl}` в HTML-шаблон без экранирования кавычек.
  2. `front-end/src/app/login/page.jsx:61` — внутри `handleLogin` оставлена бесполезная строка `const handlePhoneLogin = handleLogin;`.
- **Как исправить:**
  Удалить неиспользуемую функцию `sendResetLinkEmail` (или экранировать URL) и убрать мёртвую переменную `handlePhoneLogin`.
- **Риск поломки соседних функций:** Нулевой.

---

#### [P3-03] Модификация отслеживаемого файла `SECURITY_LOG.md` при прогоне тестов и зависимость 2 тестов от `localhost:5000`
- **Приоритет:** P3 (Улучшение — тестовая инфраструктура)
- **Узел:** Тесты (`back-end/security-tests`)
- **Что не так и где:**
  1. `back-end/security-tests/helpers.mjs:59-83` — функция `recordFinding` при каждом запуске некоторых security-тестов дописывает строки в отслеживаемый Git-ом файл `back-end/security-tests/SECURITY_LOG.md`, загрязняя рабочее дерево (`git status`).
  2. `back-end/security-tests/ip-spoofing.test.mjs:54` и `back-end/security-tests/send-limits.test.mjs:164` отправляют HTTP-запросы на `BASE_URL` (`http://localhost:5000`), не поднимая собственный тестовый сервер Express и не проверяя, что на порту 5000 запущен именно `uytap-backend`.
- **Как исправить:**
  В `helpers.mjs` писать временные логи в игнорируемый файл (или только при `WRITE_SECURITY_LOG=true`), а в `ip-spoofing.test.mjs` и `send-limits.test.mjs` поднимать `app.listen(0)` на эфемерном порту (как это уже сделано в других тестах проекта).
- **Риск поломки соседних функций:** Нулевой.

---

#### [P3-04] Поверхностный скрипт `npm run lint` на бэкенде и отсутствие защиты от накрутки на кликах/просмотрах баннеров
- **Приоритет:** P3 (Улучшение — качество кода и аналитики)
- **Узел:** Линтер / Баннеры (`back-end`)
- **Что не так и где:**
  1. `back-end/package.json:16` — скрипт `"lint": "node --check src/index.js"` проверяет синтаксис только одного входного файла `src/index.js`, не проверяя остальные ~55 файлов в `back-end/src/`.
  2. `back-end/src/routes/bannersRoutes.js:16-17` — публичные эндпоинты `POST /api/banners/:id/view` и `POST /api/banners/:id/click` не имеют дедупликации по IP (в отличие от просмотров объявлений, где в `listingsController.js:31-48` используется 10-минутный кэш `shouldIncrementView`).
- **Как исправить:**
  Настроить ESLint для `back-end/` (или `node --check src/**/*.js`), и добавить дедупликацию/лимит на `banners/:id/view` и `click`.
- **Риск поломки соседних функций:** Нулевой.

---

## 4. Требования к настройке Email (SPF / DKIM / DMARC и защита заголовка Host)

1. **Защита ссылок в письмах от подмены `Host`-заголовка:**
   - Проверено в `back-end/src/services/emailService.js:30-149` и `back-end/src/controllers/authController.js`: заголовок `req.headers.host` нигде не используется для генерации ссылок в письмах. Все письма верификации и сброса пароля отправляют только 6-значный OTP-код.
2. **Что необходимо настроить в DNS для домена отправителя (`uytap.kg`) перед выходом в продакшн:**
   - **SPF:** Добавить TXT-запись на корневой домен (или поддомен отправкиResend/SMTP):  
     `v=spf1 include:_spf.resend.com ~all` (при использовании Resend) либо IP/include вашего SMTP-провайдера.
   - **DKIM:** В панели Resend (Domains -> Add Domain `uytap.kg`) сгенерировать DKIM-ключи и добавить 3 CNAME/TXT записи (`resend._domainkey.uytap.kg`).
   - **DMARC:** Добавить TXT-запись `_dmarc.uytap.kg`:  
     `v=DMARC1; p=quarantine; rua=mailto:dmarc@uytap.kg; pct=100; adkim=s; aspf=s`
   - **Переменная `EMAIL_FROM`:** После верификации домена в Resend заменить тестовый адрес `onboarding@resend.dev` (`back-end/src/services/emailService.js:9`) на `UyTap <noreply@uytap.kg>` в переменных окружения продакшна (с `onboarding@resend.dev` письма доставляются только на собственный адрес владельца аккаунта Resend!).

---

## 5. Что НЕ удалось проверить автоматически (требует ручной проверки человеком)

Следующие внешние контуры недоступны из исходного кода репозитория и **обязательно должны быть проверены инженером вручную** перед переключением трафика:

1. **Панель управления Supabase (Production Dashboard):**
   - Проверить в разделе **Storage -> Buckets**, что созданы ровно 3 бакета:
     - `avatars` — **Public**
     - `banners` — **Public**
     - `verification-docs` — **Private** (публичный доступ выключен!)
   - Проверить в разделе **Database -> Policies**, что все миграции вплоть до `20261022000000_smart_search_complexes_indexes.sql` реально применены к продакшн-базе.
   - Проверить в разделе **Database -> Backups**, что включены ежедневные автоматические бэкапы (Daily Backups / PITR на плане Pro).
   - Проверить в **Project Settings -> API**, что старый `service_role` ключ из Git-коммита `29d8ddf3` (`eyJh...`) отозван/ротирован.
2. **Личный кабинет платёжной системы O!Деньги (mwallet):**
   - Проверить, что в настройках боевой торговой точки прописан корректный Result URL: `https://<ваш-домен-бэкенда>/api/payments/webhook`.
   - Проверить, что в продакшн-окружении выставлены боевые `ODENGI_SID`, `ODENGI_PASSWORD`, `ODENGI_API_URL=https://mw-api.dengi.kg/api/json/json.php` и `ODENGI_TEST=0`.
   - Провести контрольный платёж на минимальную сумму и убедиться, что вебхук доходит и активирует услугу.
3. **Личный кабинет SMS-провайдера Nikita (`smspro.nikita.kg`):**
   - Проверить баланс, наличие IP-whitelist (разрешить запросы только с выходного статического IP вашего VPS) и установленный суточный лимит расходов на стороне кабинета Nikita.
4. **DNS и почтовый провайдер (Resend / SMTP):**
   - Проверить статус верификации домена `uytap.kg` (SPF, DKIM, DMARC = Verified) и убедиться, что `EMAIL_FROM` не использует песочницу `onboarding@resend.dev`.
5. **Конфигурация VPS и GitHub Repository Settings:**
   - Настроить защиту ветки `main` в GitHub (Branch Protection Rules: Require PR, Require status checks to pass).
   - На VPS настроить файрвол (UFW: открыты только 22, 80, 443; порт бэкенда 5000 слушает только `127.0.0.1` или внутреннюю Docker-сеть), автоматическое продление сертификатов Let's Encrypt и закрытие заголовков `X-Forwarded-For` / `X-Real-IP` от подмены на уровне Nginx.

---

## 6. Рекомендуемый порядок исправлений (группами за один заход)

Чтобы минимизировать риск регрессий и закрыть связанные уязвимости комплексно, рекомендуется выполнять исправления в **5 последовательных этапов**:

### Группа 1: Секреты, IP-прокси и конфигурация окружения (закрывает P0-03, P0-04, P1-05, P2-02)
1. Исправить `front-end/src/app/api/_lib/forwardedFor.js:47-50` (убрать безусловное доверие к `x-real-ip`) и добавить `crypto.timingSafeEqual` в `back-end/src/middleware/clientIp.js:34-39`.
2. Ротировать все секреты, очистить историю Git от старых `.env` (`git filter-repo`), исправить `DATABASE_URL` и `ODENGI_RESULT_URL` (`/api/payments/webhook`) в `.env` / `.env.example`.
3. Добавить в `back-end/src/index.js` и `odengi.js` fail-fast проверки продакшн-конфигурации (`JWT_SECRET.length >= 32`, отдельный `OTP_SECRET`, проверка `ODENGI_TEST=0` и `ssl` в `dbPool`).

### Группа 2: Аутентификация, OTP и защита аккаунтов (закрывает P0-01, P0-02, P1-01, P1-02, P1-03, P2-01)
1. В `phoneOtpStore.js`, `nikitaService.js` и `authController.js` (`verifyOtp`, `verifyResetCode`) жёстко связать `token` с `session.phone` и `purpose` (`registration` | `phone_change` | `password_reset`), полностью отказавшись от доверия к `req.body.phone` при выдаче JWT или сбросе пароля.
2. Запретить выдачу JWT в неавторизованном `verifyOtp` для уже верифицированных аккаунтов (`user.is_verified === true`) и добавить проверку `req.user.email === email` в email-ветке `verifyOtp`.
3. Добавить проверку `token_version` в `optionalAuth` (`back-end/src/middleware/auth.js:188-202`).
4. Исправить Guard #6 в `releaseExpiredUnverifiedPhoneIfNeeded` (`authController.js:414-424`), чтобы неподтверждённые номера реально освобождались через 10 минут вместе с удалением пустой записи `user_profiles`.
5. Устранить окно гонки TOCTOU в `nikitaService.js:184-239` (резервировать лимит до `await postNikita`), выровнять ответы `/forgot-password` и добавить IP-ключ в `sendOtpLimiter`.

### Группа 3: Платежи O!Dengi и монетизация (закрывает P1-04, P1-06, P2-07)
1. В `paymentsService.js:388-439, 553` отключить 10-секундный троттлинг для вызовов из вебхука (`handleWebhookService`), добавить сверку оплаченной суммы с `payment.amount` и добавить в `cronService.js:31-53` фоновую сверку платежей в статусе `processing`.
2. Добавить `AbortSignal.timeout(10000)` в `odengiService.js:52`.
3. В `listingsController.js:1165, 1276-1286` закрыть бесплатное создание Instagram-заявок и обход модерации через клиентское поле `listingType`.

### Группа 4: Доступ к данным (IDOR / PII), защита ElevenLabs и индексы БД (закрывает P1-07, P1-08, P1-09, P1-10, P1-11, P2-06)
1. Закрыть IDOR в `favoritesController.js:19-30, 128-157` (фильтровать по `status === "active"`) и очистить публичную выдачу в `listingsController.js:884` и `authController.js:2111-2201` от `verificationDocs`, `inn`, `email` и скрытых телефонов (`show_phone = false`).
2. Защитить `/api/speech-to-text` (`front-end/src/app/api/speech-to-text/route.js`) жёстким лимитом по IP и уменьшить максимальный размер файла с 20 МБ до 2–3 МБ.
3. Создать новую миграцию в `supabase/migrations/`, добавляющую индексы на все внешние ключи (`listings.user_id`, `listing_photos.listing_id`, `favorites.listing_id` и др.) и `SET search_path = public` для всех RPC/триггеров, а также включить RLS на `public._schema_migrations` в `migrate.js`.
4. Добавить потолок пагинации (`limit <= 100`) на оставшиеся маршруты (`getComplexListings`, `getMyComplexes`, `getFavorites`, `getUserPublicProfile`, админ-списки).

### Группа 5: Веб-заголовки, CI/CD, тесты и уборка репозитория (закрывает P1-12, P2-03, P2-04, P2-05, P2-08, P2-09, P3-01..04)
1. Настроить Security Headers в `front-end/next.config.mjs`, убрать запись токена в незащищённый `document.cookie`, валидировать `socials` и `bannerImageUrl`.
2. Убрать вывод `error.message` в 500-ответах контроллеров и добавить `dbPool.end()` в `gracefulShutdown`.
3. Исправить `if:` в `.github/workflows/ci.yml:265-282`, включить все security-тесты в `back-end/package.json`, починить `.github/CODEOWNERS` и удалить мусорные файлы из корня репозитория.
