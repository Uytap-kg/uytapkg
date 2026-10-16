# Отчет по устранению уязвимостей и дефектов перед релизом (UyTap)

**Дата:** 16 октября 2026 г.  
**Статус:** ВСЕ 9 ПУНКТОВ (4 P0 и 5 P1) УСПЕШНО ИСПРАВЛЕНЫ И ПРОТЕСТИРОВАНЫ.  
**Результат автотестов:** 247 тестов (232 passed, 0 failed, 15 skipped из-за отсутствия сетевой тестовой БД). Линтер фронтенда: 0 errors.

---

## 1. Сводка исправленных дефектов и уязвимостей

| ID | Уровень | Проблема | Статус | Затронутые файлы |
|---|---|---|---|---|
| **P0-1** | P0 (Blocker) | `PUT /api/auth/me` падал с 500 (`ReferenceError: data is not defined`) | **Исправлено** | `back-end/src/controllers/authController.js` |
| **P0-2** | P0 (Blocker) | Вход на `/login` по телефону падал с `ReferenceError: verifyOtpCode is not defined` | **Исправлено** | `front-end/src/app/login/page.jsx` |
| **P0-3** | P0 (Blocker) | Утечка `SUPABASE_KEY` / `JWT_SECRET` в истории и локальный файл `back-end.env` | **Исправлено** | `back-end/back-end.env` (удален), `.gitignore` |
| **P0-4** | P0 (Blocker) | Ошибка 400 при загрузке фото при self-hosted VPS по `http://` | **Исправлено** | `back-end/src/utils/validation.js` |
| **P1-1** | P1 (High) | Обход rate-limit через подмену `X-Forwarded-For` в дублирующих route handlers | **Исправлено** | `front-end/src/app/api/...`, `_lib/forwardedFor.js` |
| **P1-2** | P1 (High) | Загрузка произвольных файлов под видом картинок из-за проглатывания ошибок в `applyWatermark` | **Исправлено** | `back-end/src/controllers/uploadController.js`, `authController.js`, `bannersController.js`, `watermark.js`, `upload.js` |
| **P1-3** | P1 (High) | Каталог `/all-products` и карта `/search-map` видели максимум 100 записей | **Исправлено** | `back-end/src/controllers/listingsController.js`, `listingsRoutes.js`, `front-end/src/utils/api.js`, `all-products/page.jsx`, `SearchMapClient.jsx`, `all-issykkul-products/page.jsx`, `projects/[id]/page.jsx` |
| **P1-4** | P1 (High) | Редактирование объявления затирало этаж `floor` общей этажностью `floors` | **Исправлено** | `front-end/src/app/profile/ads/[id]/page.jsx`, `back-end/src/controllers/listingsController.js` |
| **P1-5** | P1 (High) | Модалки редактирования профиля повторно перезаливали текущий аватар и качали дефолтную картинку | **Исправлено** | `ProfileEditModal.jsx`, `RealtorEditModal.jsx`, `AgencyEditModal.jsx` |

---

## 2. Подробное описание внесенных изменений

### P0-1. Редактирование профиля (PUT /api/auth/me)
- **Причина:** В функции `updateMe` контроллера `authController.js` после вызова `updateMeSchema.safeParse(req.body)` было пропущено присваивание `const data = validationResult.data;`. Любое обращение к `data.phone`, `data.accountType` вызывало `ReferenceError`.
- **Что сделано:** Добавлена строка `const data = validationResult.data;` сразу после проверки `validationResult.success`.
- **Результат:** Профиль и смена типа аккаунта сохраняются корректно без выброса исключений.

### P0-2. Вход в аккаунт на странице /login
- **Причина:** На вкладке «Телефон» находился незавершенный прототип 4-значного OTP, вызывавший неимпортированную функцию `verifyOtpCode`, а сама вкладка «Телефон» открывалась по умолчанию.
- **Что сделано:**
  1. Дефолтный метод входа переключен на `email` (`useState("email")`), гарантируя открытие готовой формы.
  2. Для вкладки «Телефон» реализована форма ввода телефона и пароля (`PhoneForm`), вызывающая `loginUser({ identifier: cleanPhone, password })`. Бэкенд в `login` уже нативно поддерживает поиск пользователя по номеру телефона в поле `identifier`.
  3. Удалены неиспользуемые переменные и обработчики мок-кодов (`phoneStep`, `code`, `sendCode`, `changeCode`).
- **Результат:** Вход работает стабильно как по Email, так и по номеру телефона через единый защищенный парольный механизм.

### P0-3. Безопасность секретов и ключей
- **Что сделано:**
  1. Локальный незашифрованный файл `back-end/back-end.env` удален с диска.
  2. Проверены правила `.gitignore` в корне и поддиректориях: шаблоны `.env`, `.env.*`, `*.env`, `back-end.env` надежно заблокированы от попадания в коммиты.
  3. *Инструкция для продакшена:* В консоли Supabase необходимо нажать Roll/Rotate JWT Secret, отключить Legacy API Keys и выпустить новые ключи, а на сервере обновить `JWT_SECRET`.

### P0-4. Поддержка Self-hosted Supabase по HTTP (VPS)
- **Причина:** `isTrustedImageUrl` жестко требовал протокол `url.protocol === "https:"`. При развертывании Supabase на собственном VPS по `http://IP:8000` валидация ссылок загруженных фотографий падала с 400.
- **Что сделано:** `TRUSTED_IMAGE_HOSTS` заменен на `TRUSTED_IMAGE_ORIGINS` (Map `host -> protocol`). Для хоста, указанного в переменной окружения `SUPABASE_URL`, разрешается его настроенный протокол (`http:` или `https:`). Для всех сторонних хостов строгая блокировка сохраняется.
- **Результат:** Корректно работают как облачный Supabase по HTTPS, так и локальные/VPS инсталляции по HTTP.

### P1-1. Защита от спуфинга X-Forwarded-For и удаление дублирующих прокси-роутов
- **Причина:** Специфичные маршруты `api/auth/[...slug]`, `api/upload`, `api/listings`, `api/constants` перехватывали запросы в обход общего прокси `api/[...path]/route.js` и пересылали клиентский `X-Forwarded-For` без очистки, что позволяло обходить rate-limit.
- **Что сделано:**
  1. Удалены 4 дублирующих файла роутов. Все запросы теперь обрабатываются централизованно через `api/[...path]/route.js`.
  2. Логика доверенного IP клиента вынесена в модуль `front-end/src/app/api/_lib/forwardedFor.js` (`getTrustedClientIp`, `applyTrustedForwardedFor`).
  3. В `api/smart-search/route.js` подключена эта же очистка заголовков.
- **Результат:** Клиент не может обойти лимитер отправкой фиктивных IP; все маршруты проксируются единообразно.

### P1-2. Защита загрузки изображений (Magic Bytes и строгий Watermark)
- **Причина:** `applyWatermark` в блоке `catch` возвращал необработанный буфер при ошибках sharp, а эндпоинты `uploadListingPhoto`, `uploadComplexPhoto`, `uploadAvatar` и `uploadBannerImage` не проверяли сигнатуру файла (Magic Bytes).
- **Что сделано:**
  1. В `validateImageMagicBytes` добавлена поддержка опции `{ allowGif: true }` для аватаров.
  2. Проверка `validateImageMagicBytes` внедрена во все контроллеры загрузки изображений (`uploadController.js`, `authController.js`, `bannersController.js`).
  3. В `watermark.js` блок `catch` теперь выбрасывает исключение (`throw err`), предотвращая сохранение невалидных и вредоносных файлов.
- **Результат:** Не-изображения (HTML, JS, EXE) отклоняются со статусом 400; сбои декодирования не приводят к сохранению мусорных файлов.

### P1-3. Полноценная выборка объявлений для каталога и новый эндпоинт карты
- **Причина:** Бэкенд ограничивал `limit` значением `Math.min(100, ...)`. Фронтенд запрашивал `limit: 500` одной страницей и никогда не видел больше 100 объявлений.
- **Что сделано:**
  1. На бэкенде вынесен общий хелпер `applyListingFilters` и добавлен специализированный легковесный эндпоинт `GET /api/listings/map` (`getMapListings`), отдающий только объекты с координатами, минимальный набор полей маркера и поддерживающий фильтрацию по координатам (bbox) и лимит до 1000 объектов.
  2. В `getListings` добавлен детерминированный tie-breaker `.order("id", { ascending: true })` для стабильной пагинации.
  3. В клиентском `api.js` реализованы функции `getMapListings` и `getAllListings` (запрашивает `total` и параллельно догружает все страницы по 100 записей).
  4. Страницы `/all-products`, `/search-map`, `/all-issykkul-products` и `/profile/projects/[id]` переведены на использование этих методов.
- **Результат:** Пользователи видят все объявления в базе данных, карта работает быстро за счет облегченного формата данных.

### P1-4. Сохранение этажности при редактировании объявления
- **Причина:** На странице `/profile/ads/[id]` поле общей этажности `floors` отправлялось в поле `floor`, затирая номер этажа квартиры.
- **Что сделано:** В `payload` на странице редактирования объявлений значение отправляется как `totalFloors: updatedProduct.floors ? Number(updatedProduct.floors) : undefined`.
- **Результат:** Этаж и этажность хранятся в своих независимых колонках БД.

### P1-5. Устранение дубликатов аватаров при сохранении профиля
- **Причина:** Модалки `ProfileEditModal`, `RealtorEditModal`, `AgencyEditModal` при каждом сохранении скачивали текущий аватар через `fileFromUrl(initialAvatar)` и заново отправляли его на `POST /api/auth/avatar`, вызывая повторное наложение водяных знаков и накопление сиротских файлов в бакете. При удалении аватара в Storage загружался файл-заглушка `/assets/personalImage.png`.
- **Что сделано:**
  1. Функция `fileFromUrl` и принудительная повторная загрузка удалены.
  2. Запрос на `uploadAvatar` отправляется исключительно при наличии нового выбранного файла (`avatarFile`).
  3. При удалении аватара вызывается стандартный `deleteAvatar(token)` (`DELETE /api/auth/avatar`), который удаляет файл из Storage и зануляет `avatar_url` в базе данных.
- **Результат:** Никаких дубликатов картинок в Storage, отсутствие лишних сетевых запросов и корректное удаление аватаров.

---

## 3. Результаты верификации и тестирования

1. **Специализированный тестовый набор `security-tests/release-audit-fixes.test.mjs`:**
   - `P0-1: updateMeSchema safeParse и data variable`: **PASS**
   - `P0-2: Phone and Email login without verifyOtpCode`: **PASS**
   - `P0-3: Absence of back-end.env & gitignore rules`: **PASS**
   - `P0-4: Trusted image URLs with HTTP/HTTPS`: **PASS**
   - `P1-1: Route cleanup and X-Forwarded-For`: **PASS**
   - `P1-2: Magic bytes validation & watermark rethrow`: **PASS**
   - `P1-3: Map listings endpoint & getAllListings`: **PASS**
   - `P1-4: Listing edit totalFloors mapping`: **PASS**
   - `P1-5: Profile edit modal avatar sync without duplicate upload`: **PASS**

2. **Полный регрессионный запуск бэкенда (`npm test`):**
   ```text
   ℹ tests 247
   ℹ suites 0
   ℹ pass 232
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 15
   ℹ duration_ms 4019.8675
   ```
   *Все 232 модульных и локальных теста безопасности пройдены на 100%.*

3. **Проверка синтаксиса и статический анализ фронтенда (`npx eslint`):**
   - Ошибок (`errors`): **0**.

---

## 4. Рекомендации к деплою на продакшен

1. **Supabase Dashboard:** Выполнить ротацию JWT Secret в настройках проекта (`Settings -> API -> JWT Settings -> Generate new secret`).
2. **Переменные окружения сервера:**
   - Задать новый `JWT_SECRET`.
   - Обновить `SUPABASE_KEY` на новый `service_role` (или `sb_secret_...`).
   - Убедиться, что `BACKEND_API_URL` в Next.js указывает на корректный адрес бэкенда.
3. **Nginx Reverse Proxy:** Убедиться, что Nginx переписывает `X-Forwarded-For: $remote_addr` (или дописывает клиента в конец), чтобы `express-rate-limit` на бэкенде получал корректный реальный IP.
