# Руководство по тестированию и изоляции тестового окружения UyTap

Данный документ описывает структуру тестов бэкенда UyTap, классификацию тестов по зависимости от базы данных и сетевого окружения, а также инструкции по локальному запуску интеграционных тестов с полной изоляцией от боевой базы данных.

---

## 1. Политика изоляции и безопасность боевой БД

> [!CAUTION]
> **Категорический запрет на запуск тестов против боевой БД!**  
> Ни при каких обстоятельствах тесты не должны подключаться к облачному проекту Supabase (`*.supabase.co`) или использовать боевые ключи из `.env`.

Для предотвращения случайного повреждения или загрязнения боевой базы данных внедрена многоуровневая защита:
1. **Автоматический пропуск (Skip по умолчанию):** Все интеграционные тесты, требующие живую базу данных или запущенный сервер, автоматически пропускаются (`test.skip`), если не заданы специальные переменные `TEST_SUPABASE_URL` и `TEST_SUPABASE_KEY`.
2. **Аварийный предохранитель доменов (`helpers.mjs`):** Если в `TEST_SUPABASE_URL` передан адрес, совпадающий с боевым `SUPABASE_URL` или содержащий домен `*.supabase.co`, выполнение тестов немедленно аварийно прерывается с ошибкой безопасности. Разрешены только локальные адреса (`http://127.0.0.1` или `localhost`).
3. **Моки по умолчанию:** Все базовые функциональные тесты, тесты безопасности и бизнес-логики (200+ тестов) выполняются на моках в оперативной памяти без внешних сетевых вызовов.

---

## 2. Таблица: Тест → Нужна ли реальная БД

| Файл теста | Описание проверки | Требует БД? | Режим работы |
|---|---|---|---|
| `security-tests/concurrent-fulfillment.test.mjs` | Конкурентная выдача услуг (Lease lock) | Нет (Mock) | Моки Supabase и RPC |
| `security-tests/register-transaction.test.mjs` | Транзакционная регистрация и reclaim | Нет (Mock) | Моки Supabase и RPC |
| `security-tests/logger-alerts.test.mjs` | Маскирование PII, request-id, алерты | Нет | Моки streams и fetch |
| `security-tests/pricing-settings.test.mjs` | Чтение и валидация тарифов из БД | Нет (Mock) | Моки Supabase |
| `security-tests/item-1-features-promotion-tampering.test.mjs` | Подмена флагов продвижения в features | Нет | Юнит-тесты валидации |
| `security-tests/item-2-renew-moderation-bypass.test.mjs` | Продление и статусы объявлений | Нет | Юнит-тесты |
| `security-tests/item-3-tariff-listings-limit.test.mjs` | Лимиты объявлений по тарифам | Нет (Mock) | Моки Supabase |
| `security-tests/item-4-tariff-arbitrage-prorata.test.mjs` | Pro-rata перерасчёт тарифов | Нет | Чистая математика |
| `security-tests/item-4-tariff-upgrade-arbitrage.test.mjs` | Защита от арбитража тарифов | Нет | Чистая математика |
| `security-tests/item-5-payment-fulfillment.test.mjs` | Идемпотентность и retry выдачи услуг | Нет (Mock) | Моки Supabase |
| `security-tests/item-6-promotion-orders-db.test.mjs` | Хранение заказов продвижения | Нет (Mock) | Моки Supabase |
| `security-tests/item-6-storage-db-migration.test.mjs` | Проверка прав на объекты Storage | Нет (Mock) | Моки Supabase |
| `security-tests/item-7-pii-and-views.test.mjs` | Троттлинг просмотров и маскирование PII | Нет | In-memory кэш |
| `security-tests/item-7-pii-draft-leak.test.mjs` | Фильтрация черновиков в публичной выдаче | Нет | Юнит-тесты контроллера |
| `security-tests/item-8-otp-race-security.test.mjs` | Защита от гонки в верификации OTP | Нет (Mock) | Моки Supabase |
| `security-tests/item-8-otp-security.test.mjs` | Хэширование кодов и timing attack | Нет | Криптографические тесты |
| `security-tests/item-9-token-revocation.test.mjs` | Отзыв JWT через token_version | Нет | Моки JWT и контроллера |
| `security-tests/item-10-anonymous-upload.test.mjs` | Валидация типов и magic bytes загрузок | Нет | Юнит-тесты буферов |
| `security-tests/item-10-upload-security.test.mjs` | Безопасность обработки изображений sharp | Нет | Локальная обработка изображений |
| `security-tests/item-11-12-13-p2-slots.test.mjs` | Слоты тарифов и бустов | Нет (Mock) | Моки Supabase |
| `security-tests/item-11-12-13-slots-resilience.test.mjs` | Устойчивость списания слотов | Нет (Mock) | Моки Supabase |
| `security-tests/item-14-priority-pagination.test.mjs` | Пагинация и ранжирование выдачи | Нет | Алгоритмические тесты |
| `security-tests/item-15-odengi-polling-throttle.test.mjs` | Троттлинг опроса шлюза O!Dengi | Нет | Мок-клиент O!Dengi |
| `security-tests/item-16-auth-cache.test.mjs` | Кэширование проверки токенов | Нет | In-memory кэш |
| `security-tests/item-17-cron-and-search.test.mjs` | Фоновые задачи крона и поиск | Нет (Mock) | Моки Supabase |
| `security-tests/item-18-db-pool.test.mjs` | Менеджер пула PostgreSQL соединений | Нет | Моки pg.Pool |
| `security-tests/banners-store.test.mjs` | Управление баннерами | Нет | In-memory стор |
| `security-tests/instagram-requests.test.mjs` | Заявки на Instagram-продвижение | Нет | Юнит-тесты |
| `security-tests/fixes-verification.test.mjs` | Валидация DoS bcrypt и сортировки | Нет | Схемы Zod и сортировка |
| **`security-tests/idor-listings-payments.test.mjs`** | **IDOR доступ к чужим объявлениям и платежам** | **Да** | **Skip по умолчанию (требует локальный сервер и БД)** |
| **`security-tests/jwt-forgery.test.mjs`** | **Подделка JWT (alg=none, неверная подпись)** | **Да** | **Skip по умолчанию (требует локальный сервер и БД)** |
| **`security-tests/promotion-bypass.test.mjs`** | **Обход оплаты продвижения и модерации** | **Да** | **Skip по умолчанию (требует локальный сервер и БД)** |
| **`security-tests/watermark-bypass.test.mjs`** | **Обход наложения водяного знака** | **Да** | **Skip по умолчанию (требует локальный сервер и БД)** |

---

## 3. Запуск тестов

### 3.1. Стандартный запуск (без внешней БД)
Запускает весь набор юнит- и функциональных тестов:
```bash
cd back-end
npm test
```
Все 200+ тестов на моках проходят успешно, а 4 интеграционных PoC-теста выводят статус `# SKIP` с сообщением о причине.

### 3.2. Локальный запуск интеграционных тестов через Supabase CLI

Если вам необходимо запустить интеграционные тесты (`idor-*`, `jwt-forgery`, `promotion-bypass`, `watermark-bypass`), поднимите локальный изолированный стек Supabase:

1. **Предварительные требования:**
   - Установлен Docker Desktop (запущен).
   - Установлен Supabase CLI:
     ```bash
     npm install -g supabase
     # или на Windows:
     scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
     scoop install supabase
     ```

2. **Запуск локального Supabase:**
   В корне проекта (`uytapkg`):
   ```bash
   supabase start
   ```
   Команда поднимет локальные Docker-контейнеры Postgres, PostgREST, GoTrue и Storage на `http://127.0.0.1:54321`.

3. **Применение миграций:**
   ```bash
   supabase db reset
   ```
   Команда накатит все миграции из папки `supabase/migrations/` на локальную базу данных.

4. **Запуск тестового сервера бэкенда:**
   В отдельном терминале запустите сервер с тестовыми переменными:
   ```bash
   cd back-end
   $env:PORT="5000"
   $env:SUPABASE_URL="http://127.0.0.1:54321"
   $env:SUPABASE_KEY="<ваш_локальный_anon_или_service_key>"
   npm start
   ```

5. **Запуск тестов:**
   В другом терминале:
   ```bash
   cd back-end
   $env:TEST_SUPABASE_URL="http://127.0.0.1:54321"
   $env:TEST_SUPABASE_KEY="<ваш_локальный_service_role_key>"
   $env:SECURITY_TEST_BASE_URL="http://localhost:5000"
   node --test security-tests/idor-listings-payments.test.mjs security-tests/jwt-forgery.test.mjs security-tests/promotion-bypass.test.mjs security-tests/watermark-bypass.test.mjs
   ```

6. **Остановка локального стека после тестов:**
   ```bash
   supabase stop
   ```
