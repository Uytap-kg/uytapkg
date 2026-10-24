# Полное руководство по развертыванию UyTap на Render (Production Deploy Guide)

Данный документ представляет собой пошаговую инструкцию по развертыванию платформы **UyTap** (бэкенд Express API, фронтенд Next.js 16 и база данных PostgreSQL) на хостинге **Render** из нового чистого GitHub-репозитория с нуля.

---

## Содержание
0. [Предусловия и необходимые аккаунты](#0-предусловия-и-необходимые-аккаунты)
1. [Подготовка кода и нового репозитория](#1-подготовка-кода-и-нового-репозитория)
2. [База данных: создание и инициализация с нуля](#2-база-данных-создание-и-инициализация-с-нуля)
3. [Настройка GitHub: репозиторий, ветки, секреты, права](#3-настройка-github-репозиторий-ветки-секреты-права)
4. [Настройка Render: сервисы, база, переменные, preDeploy](#4-настройка-render-сервисы-база-переменные-predeploy)
5. [Первый запуск (First Deployment)](#5-первый-запуск-first-deployment)
6. [Проверка работоспособности (Healthcheck и Smoke-тесты)](#6-проверка-работоспособности-healthcheck-и-smoke-тесты)
7. [Регулярный процесс: как катить изменения через PR](#7-регулярный-процесс-как-катить-изменения-через-pr)
8. [Откат (Rollback): приложения и миграций](#8-откат-rollback-приложения-и-миграций)
9. [Справочник переменных окружения](#9-справочник-переменных-окружения)
10. [Типичные проблемы и их решения (Troubleshooting)](#10-типичные-проблемы-и-их-решения-troubleshooting)

---

## 0. Предусловия и необходимые аккаунты

Перед началом деплоя убедитесь, что у вас созданы и доступны следующие аккаунты:

1. **GitHub ([github.com](https://github.com))**:
   - Аккаунт разработчика / организации с правами создания публичных или приватных репозиториев, настройки Actions, Branch Protection и Secrets.
2. **Render ([render.com](https://render.com))**:
   - Аккаунт с привязанным платежным методом.
   - **ВАЖНО О ТАРИФАХ:** Для продакшена **нельзя** использовать Free-тир Render!
     - *Free Web Service* засыпает через 15 минут неактивности (холодный старт 50+ секунд), имеет лимит 750 часов в месяц и глушит фоновые задачи (`cronService.js`).
     - *Free PostgreSQL* удаляется целиком через 30 дней и не поддерживает автоматические бэкапы.
     - **Минимальный рекомендуемый тариф для продакшена:**
       - Бэкенд: тариф **Starter** ($7/месяц, 512 MB RAM, 0.5 CPU, постоянный аптайм).
       - Фронтенд: тариф **Starter** ($7/месяц, 512 MB RAM, 0.5 CPU, SSR Next.js).
       - PostgreSQL (Render PG): тариф **Starter** ($7/месяц, 1 GB RAM, 1 CPU, 10 GB SSD, автобэкапы).
       - *Итого:* ~$21/месяц.
3. **Хранилище медиафайлов (Supabase Storage или S3)**:
   - Бэкенд загружает фото объявлений, аватаров и баннеров в бакеты хранилища (`avatars`, `listings`, `banners`). Проект рассчитан на работу с Supabase Storage API (`@supabase/supabase-js`).
   - Требуется отдельный чистый продакшен-проект на **Supabase ([supabase.com](https://supabase.com))** для бакетов Storage (либо для базы данных и Storage одновременно).
4. **Внешние провайдеры и шлюзы (Кыргызстан)**:
   - **Nikita OTP ([smspro.nikita.kg](https://smspro.nikita.kg))**: логин, пароль, API-ключ и зарегистрированное буквенное имя отправителя для SMS-кодов (+996).
   - **O!Dengi ([api.odengi.kg](https://api.odengi.kg))**: SID мерчанта, пароль кассы для приема оплат по QR-коду и проверенный Result Callback URL.
   - **Anthropic Claude ([console.anthropic.com](https://console.anthropic.com))**: API-ключ для умного поиска на базе `claude-haiku-5-5` (или Google Gemini `gemini-2.5-flash`).
   - **Resend ([resend.com](https://resend.com))**: API-ключ и подтвержденный домен для транзакционных email (восстановление пароля).
   - **ElevenLabs ([elevenlabs.io](https://elevenlabs.io))**: API-ключ для распознавания голосового поиска (Speech-to-Text).
5. **Локальные утилиты на машине инженера**:
   - `git` >= 2.40
   - `node` >= 22.0.0, `npm` >= 10.0.0
   - `psql` (PostgreSQL client)

---

## 1. Подготовка кода и нового репозитория

### 1.1. Структура проекта
Репозиторий представляет собой монорепозиторий со следующей компоновкой:
- `back-end/` — REST API на Express 4.21, подключение к БД (`pg.Pool` и Supabase), фоновые задачи (`cronService.js`), валидация Zod, обработка изображений Sharp.
- `front-end/` — Next.js 16 (React 19, Tailwind CSS 4, Turbopack, App Router).
- `supabase/migrations/` — 13 версионированных SQL-миграций, покрывающих полную схему базы данных.
- `back-end/scripts/migrate.js` — автономный скрипт миграций для выполнения в `preDeployCommand` на Render.
- `back-end/scripts/manage_admin.js` — CLI-инструмент создания администраторов (`npm run admin`).
- `.github/workflows/ci.yml` — пайплайн автоматического тестирования, линтинга, проверки миграций на пустой БД и триггера деплоя.
- `render.yaml` — Blueprint-манифест всей инфраструктуры Render.

### 1.2. Очистка от мусора
Перед отправкой в новый репозиторий убедитесь, что:
1. Каталог `_cleanup_review/` добавлен в `.gitignore` (все временные файлы, дампы и логи изолированы в нем).
2. Файлы `.env`, `.env.local`, `.env.production` исключены из репозитория и присутствуют только в виде безопасных шаблонов:
   - `.env.example`
   - `back-end/.env.example`
   - `front-end/.env.example`
3. Директории `.vscode/`, `.idea/`, `node_modules/`, `.next/`, `dist/`, `.turbo/` прописаны в корневом `.gitignore`.

### 1.3. Локальная проверка сборки и тестов
Перед переносом в чистый Git-репозиторий выполните локальную верификацию:
```bash
# 1. Проверка синтаксиса и тестов бэкенда
cd back-end
npm ci
npm run lint
npm test
cd ..

# 2. Проверка сборки фронтенда
cd front-end
npm ci
npm run lint
npm run build
cd ..
```

---

## 2. База данных: создание и инициализация с нуля

### 2.1. Версия и параметры базы данных
- **Тип СУБД:** PostgreSQL 16 или 17.
- **Кодировка:** `UTF8`, Collate/Ctype: `en_US.UTF-8` или `C.UTF-8`.
- **Таймзона:** `UTC`. Вся бизнес-логика оперирует `TIMESTAMPTZ`, временная зона Кыргызстана (UTC+6) отображается на стороне клиента.
- **Обязательные расширения:**
  - `pg_trgm` — необходимо для нечеткого полнотекстового поиска по заголовкам объявлений (GIN/GIST триграммные индексы).
  - `gen_random_uuid()` — нативно поддерживается в PostgreSQL 13+.

> [!IMPORTANT]
> **Особенности ролей Supabase vs Standalone Render PostgreSQL:**
> Миграции проекта содержат разграничения прав для ролей `anon`, `authenticated` и `service_role`.
> Если вы создаете чистую базу данных на Render (а не внутри Supabase), эти роли по умолчанию отсутствуют. Скрипт `back-end/scripts/migrate.js` автоматически проверяет и безопасно создает эти роли (`CREATE ROLE ... NOLOGIN`) перед запуском миграций, поэтому ручных действий по созданию ролей не требуется!

### 2.2. Проверка миграций с нуля
Все 13 миграций в `supabase/migrations/` были протестированы на пустой базе данных PostgreSQL.
Результат выполнения:
- **Все 13 миграций применяются последовательно и без ошибок.**
- Создается **21 базовая таблица**, **43 функции и триггера** (RPC).
- Все миграции написаны **идемпотентно** (`IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).

Список миграций:
1. `20261012000000_baseline.sql` — базовые таблицы (`users`, `listings`, `subscriptions`, `payments`, `banners` и т. д.).
2. `20261012113812_enable_rls_email_verifications.sql` — политики безопасности RLS для верификации email.
3. `20261012120000_banners_extend.sql` — расширенная модель рекламных баннеров.
4. `20261012120100_instagram_requests.sql` — заявки на продвижение в Instagram.
5. `20261012120200_tariff_plans_service_prices.sql` — справочники тарифов и разовых платных услуг (с автозаполнением).
6. `20261013000000_listing_priority_rank.sql` — расчет ранга приоритета объявлений и счетчик фото.
7. `20261013000001_search_indexes_and_cleanup.sql` — составные индексы поиска.
8. `20261013000100_payment_fulfillment_lease.sql` — защита от состояния гонки при обработке платежей.
9. `20261013120000_baseline_reconcile.sql` — сверка и согласование схемы.
10. `20261013120100_register_user_rpc.sql` — атомарная RPC-процедура регистрации пользователей.
11. `20261013130000_create_promotion_payment_rpc.sql` — атомарное создание платежей за продвижение.
12. `20261017000000_search_title_trgm_index.sql` — триграммный индекс для быстрого поиска.
13. `20261018193000_revoke_public_rpc_grants.sql` — отзыв публичных прав с критических RPC.

### 2.3. Команды управления миграциями

#### Применение миграций:
```bash
# Через встроенный раннер (рекомендуется для Render preDeploy и локального использования):
cd back-end
DATABASE_URL="<DATABASE_URL>" npm run migrate
```

#### Проверка текущей версии схемы:
```sql
-- Проверить примененные миграции
SELECT version, applied_at FROM public._schema_migrations ORDER BY version ASC;

-- Проверить количество таблиц (должно быть 21)
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
```

#### Откат миграций (Rollback Strategy):
В соответствии с лучшими практиками CI/CD (Forward-Only Migrations) откат изменений на проде выполняется созданием **новой компенсирующей миграции** с более свежим таймстемпом (например, `20261021000000_revert_feature.sql`), которая накатывается штатным пайплайном. Это исключает рассинхрон состояния между репликами и средами.

### 2.4. Начальные данные (Seed)
1. **Справочники:** Тарифные планы (`start`, `optimal`, `business`, `developer`) и стоимость услуг (`vip`, `urgent`, `top`, `instagram`) зашиты в миграцию `20261012120200_tariff_plans_service_prices.sql` и создаются автоматически при накате схемы.
2. **Создание супер-администратора:**
   На чистой базе данных нет ни одного пользователя. Создайте первого администратора через CLI:
   ```bash
   cd back-end
   DATABASE_URL="<DATABASE_URL>" SUPABASE_URL="<SUPABASE_URL>" SUPABASE_KEY="<SUPABASE_SERVICE_ROLE_KEY>" \
     npm run admin create admin@uytap.kg "<STRONG_PASSWORD>" "+996555000001"
   ```
   > [!CAUTION]
   > Тестовые данные (пользователи, тестовые объявления, логи платежей стенда) переносить на прод **категорически запрещено**!

### 2.5. Перенос реального контента со стенда (при необходимости)
Если со стенда необходимо перенести справочники, ЖК или проверенные объявления (без персональных данных пользователей):
```bash
# 1. Снять дамп только публичных данных, исключив персональные данные и платежи:
pg_dump "<STAGING_DATABASE_URL>" \
  --format=custom \
  --no-owner \
  --no-acl \
  --exclude-table=users \
  --exclude-table=user_profiles \
  --exclude-table=payments \
  --exclude-table=processed_subscription_payments \
  --exclude-table=processed_refund_operations \
  --exclude-table=promotion_orders \
  --exclude-table=email_verifications \
  --exclude-table=instagram_requests \
  -f uytap_sanitized_content.dump

# 2. Восстановить в продакшен базу данных:
pg_restore --no-owner --no-acl --data-only -d "<PROD_DATABASE_URL>" uytap_sanitized_content.dump
```

### 2.6. Подключение к базе данных на Render
- **Internal Database URL** (формат: `postgres://uytap:<PASSWORD>@dpg-xxxxxx-a:5432/uytap`):
  Используется для взаимодействия между бэкендом и базой данных внутри Render. Не тарифицируется по трафику, работает с минимальной задержкой (< 1 мс).
- **External Database URL** (формат: `postgres://uytap:<PASSWORD>@dpg-xxxxxx-a.frankfurt-postgres.render.com:5432/uytap?sslmode=require`):
  Используется для подключения из GitHub Actions CI, локального `psql` или админских скриптов. Обязателен флаг `sslmode=require`.
- **Пул соединений (Connection Pooling):**
  Бэкенд использует собственный пул `pg.Pool` (файл [db.js](file:///C:/Users/User/Desktop/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82/uytapkg/back-end/src/config/db.js)). Если вы включаете PgBouncer на Render (порт 6543, Transaction mode), убедитесь, что в приложении не используются долгие `SESSION` advisory locks.

### 2.7. Резервное копирование (Backups)
- **Автоматические бэкапы Render:** На тарифе Starter и выше Render делает автоматические ежедневные snapshot-бэкапы с глубиной хранения 7 дней. Восстановление доступно в 1 клик через Render Dashboard -> Database -> Backups.
- **Ручной дамп перед крупными релизами:**
  ```bash
  pg_dump -Fc --no-acl --no-owner "<EXTERNAL_DATABASE_URL>" > uytap_backup_$(date +%Y%m%d_%H%M%S).dump
  ```
- **Восстановление из дампа:**
  ```bash
  pg_restore --clean --if-exists --no-acl --no-owner -d "<EXTERNAL_DATABASE_URL>" uytap_backup_XXXXXXXX.dump
  ```

---

## 3. Настройка GitHub: репозиторий, ветки, секреты, права

### 3.1. Архитектура репозиториев: Сравнение вариантов

| Критерий | Вариант A: Единый репозиторий (`develop` -> PR -> `main`) | Вариант B: Два репозитория (`uytap-dev` и `uytap-prod`) |
| :--- | :--- | :--- |
| **Сложность** | Низкая: один репозиторий, единый контекст PR и тикетов | Высокая: синхронизация репозиториев через Action или ботов |
| **Риск рассинхрона** | Минимальный (все ветки видны в одном месте) | Высокий (конфликты веток и истории между репозиториями) |
| **Изоляция доступов** | Регулируется Branch Protection и правами ролей | Полная изоляция доступа к продакшен коду |
| **Стоимость/CI** | Единый лимит GitHub Actions минут | Удвоенный расход минут и двойные пайплайны |
| **Удобство деплоя** | Прод собирается прямо из `main` после одобренного PR | Требуется дополнительный шаг переноса изменений в `prod-repo` |

> [!TIP]
> **Рекомендация: Вариант A.**
> Для команды и платформы уровня UyTap оптимален **Вариант A**:
> - Ветка `develop` — тестовый стенд (staging).
> - Ветка `main` — продакшен стенд (production).
> - Переход изменений из `develop` в `main` происходит исключительно через Pull Request со строгими автоматическими проверками и обязательным ревью.

### 3.2. Полный цикл прохождения изменений (Feature Flow)
```mermaid
flowchart LR
    Dev[Разработчик] -->|git checkout -b feature/name| FeatureBranch[Ветка feature/*]
    FeatureBranch -->|Локальные тесты| LocalTest[npm test & lint]
    LocalTest -->|git push| GitHubPR[Pull Request -> main]
    GitHubPR -->|GitHub Actions| CI[CI: Lint, Tests, DB Migrations, Build]
    CI -->|Pass| CodeReview[Code Review / CODEOWNERS]
    CodeReview -->|Squash and Merge| MainBranch[Ветка main]
    MainBranch -->|Deploy Hook| Render[Render: preDeploy & Zero-Downtime Deploy]
```

1. **Разработка:** Инженер создает ветку от актуального `main` (или `develop`): `git checkout -b feature/smart-search-v2`.
2. **Локальная проверка:** Обязательный запуск тестов бэкенда (`npm test`) и сборки фронтенда (`npm run build`).
3. **Открытие PR:** Открывается Pull Request в ветку `main`.
4. **Автоматический CI:** GitHub Actions прогоняет:
   - Проверку синтаксиса (ESLint / `node --check`) и аудит уязвимостей зависимостей.
   - 330 модульных тестов и проверок безопасности API.
   - **Тест миграций на изолированном контейнере PostgreSQL 17** (проверяется чистое применение и идемпотентность).
   - Сборку Next.js 16 (проверка TypeScript/JSX и Turbopack).
5. **Ревью кода:** Согласно правилам `.github/CODEOWNERS`, ревью запрашивается у ответственных лиц (миграции требуют аппрува DBA/Techlead).
6. **Слияние:** Используется **Squash and Merge** — все коммиты фичи объединяются в один чистый коммит в истории `main`.
7. **Деплой:** При пуше в `main` GitHub Action вызывает защищенные Deploy Hooks на Render.

### 3.3. Настройка защиты веток (Branch Protection Rules) в GitHub
В GitHub перейдите в **Settings** -> **Branches** -> **Add branch ruleset** (или **Add rule**) для ветки `main`:

- [x] **Require a pull request before merging**:
  - [x] Require approvals: **минимум 1** (рекомендуется 2).
  - [x] Dismiss stale pull request approvals when new commits are pushed.
  - [x] Require review from Code Owners (активирует учет файла [CODEOWNERS](file:///C:/Users/User/Desktop/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82/uytapkg/.github/CODEOWNERS)).
- [x] **Require status checks to pass before merging**:
  - [x] Require branches to be up to date before merging.
  - В поле поиска статус-чеков добавьте следующие обязательные задачи:
    - `Lint & Dependency Security Audit`
    - `Backend Unit & Security Tests`
    - `Clean DB Migrations Verification`
    - `Frontend Production Build Verification`
- [x] **Require conversation resolution before merging** (все комментарии к коду должны быть разрешены).
- [x] **Do not allow bypassing the above settings** (правила действуют для всех, включая администраторов репозитория).
- [x] **Restrict pushes that create matching branches** (запретить прямой пуш в `main` в обход PR).

### 3.4. Настройка секретов в GitHub (Repository Secrets)
Перейдите в **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**:
1. `RENDER_BACKEND_DEPLOY_HOOK` — URL Deploy Hook веб-сервиса бэкенда из Render Dashboard.
2. `RENDER_FRONTEND_DEPLOY_HOOK` — URL Deploy Hook веб-сервиса фронтенда из Render Dashboard.

---

## 4. Настройка Render: сервисы, база, переменные, preDeploy

### 4.1. Развертывание через Blueprint (`render.yaml`)
В корне репозитория подготовлен файл [render.yaml](file:///C:/Users/User/Desktop/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82/uytapkg/render.yaml), который описывает сервисы как код (Infrastructure as Code).

Для автоматического создания сервисов:
1. Зайдите в **Render Dashboard** ([dashboard.render.com](https://dashboard.render.com)).
2. Нажмите **New +** -> **Blueprint**.
3. Подключите ваш новый GitHub-репозиторий `uytap`.
4. Render автоматически обнаружит `render.yaml` и отобразит сервисы:
   - `uytap-backend` (Node.js Web Service)
   - `uytap-frontend` (Node.js Web Service)
5. Нажмите **Apply**.

### 4.2. Конфигурация бэкенда (`uytap-backend`)
- **Runtime:** `Node` (Node.js 22).
- **Region:** `Frankfurt` (минимальный пинг до Кыргызстана и Центральной Азии).
- **Root Directory:** `back-end`
- **Build Command:** `npm ci --omit=dev`
- **Pre-Deploy Command:** `npm run migrate`
  > [!IMPORTANT]
  > **Zero-Downtime механизм:**
  > Render запускает `preDeployCommand` на новом контейнере ДО переключения сетевого трафика.
  > Скрипт `scripts/migrate.js` накатывает свежие миграции на БД. Если миграция падает с ошибкой, деплой немедленно прерывается, а старая версия бэкенда продолжает бесперебойно обслуживать пользователей!
- **Start Command:** `node src/index.js`
- **Health Check Path:** `/api/health` (возвращает HTTP 200 `{ "status": "ok" }`).
- **Auto-Deploy:** `No` (если используете GitHub Actions Deploy Hook) или `Yes` (для автодеплоя при любом пуше).

### 4.3. Конфигурация фронтенда (`uytap-frontend`)
- **Runtime:** `Node` (Node.js 22).
- **Region:** `Frankfurt` (должен совпадать с бэкендом для минимальной задержки приватной сети).
- **Root Directory:** `front-end`
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npm run start -- -p $PORT -H 0.0.0.0`
- **Health Check Path:** `/api/health` (возвращает HTTP 200 `{ "status": "ok", "service": "UyTap Frontend" }`).

### 4.4. Настройка доменов и SSL
1. **Кастомный домен фронтенда (например, `uytap.kg` и `www.uytap.kg`):**
   - В Render Dashboard откройте сервис `uytap-frontend` -> **Settings** -> **Custom Domains**.
   - Добавьте CNAME запись у вашего DNS-провайдера, указывающую на `uytap-frontend.onrender.com` (или ALIAS/ANAME для корня `@`).
   - Render автоматически выпустит бесплатный SSL-сертификат Let's Encrypt и настроит автопродление.
2. **Кастомный домен бэкенда (например, `api.uytap.kg`):**
   - В сервисе `uytap-backend` добавьте CNAME запись на `uytap-backend.onrender.com`.

---

## 5. Первый запуск (First Deployment)

Соблюдайте строгую очередность шагов при первом запуске:

```mermaid
sequenceDiagram
    autonumber
    participant DevOps as Инженер
    participant DB as PostgreSQL
    participant Back as uytap-backend
    participant Front as uytap-frontend

    DevOps->>DB: 1. Создать базу данных (Render PG или Supabase)
    DevOps->>Back: 2. Задать переменные окружения бэкенда в Render
    DevOps->>Back: 3. Запустить Deploy бэкенда (выполняется preDeploy migrate)
    Back->>DB: Автоматически создаются таблицы и справочники (21 таблица)
    DevOps->>Back: 4. Создать первого администратора через npm run admin
    DevOps->>Front: 5. Задать переменные окружения фронтенда (указать URL бэкенда)
    DevOps->>Front: 6. Запустить Deploy фронтенда
```

### Шаг 1: Создание базы данных и бакетов Supabase Storage
1. Создайте базу данных в Render или проект в Supabase.
2. Скопируйте строку подключения `DATABASE_URL` (с флагом `sslmode=require`).
3. В панели Supabase Storage создайте бакеты с правильными правами доступа:
   - `avatars` (**Public Bucket**, `SELECT: true for public`) — аватары пользователей и фотографии объявлений недвижимости;
   - `banners` (**Public Bucket**, `SELECT: true for public`) — баннеры главной страницы;
   - `verification-docs` (**Private Bucket**, `public: false`) — приватные документы верификации застройщиков и риэлторов (доступ строго через временные Signed URL).

### Шаг 2: Заполнение секретов бэкенда в Render Dashboard
Перейдите в `uytap-backend` -> **Environment** и заполните значения для переменных с `sync: false`:
- `DATABASE_URL` — строка подключения к PostgreSQL.
- `SUPABASE_URL` и `SUPABASE_KEY` (service_role key).
- `JWT_SECRET` — сгенерируйте надежную строку из 64 символов (`openssl rand -hex 32`).
- `OTP_SECRET` — сгенерируйте строку из 64 символов (`openssl rand -hex 32`).
- `INTERNAL_PROXY_SECRET` — сгенерируйте секрет прокси (`openssl rand -hex 32`).
- Ключи внешних провайдеров (`NIKITA_API_KEY`, `ODENGI_PASSWORD`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`).
- `ALLOWED_ORIGINS` — пока укажите временный URL фронтенда на Render: `https://uytap-frontend.onrender.com`.

### Шаг 3: Первый деплой бэкенда
Нажмите **Manual Deploy** -> **Deploy latest commit** в `uytap-backend`.
Следите за логами:
1. Выполняется `preDeployCommand: npm run migrate`.
2. Лог подтверждает: `Successfully applied all 13 pending migrations`.
3. Запускается `node src/index.js` на порту 10000.
4. Проверяется `/api/health`. Сервис переходит в статус **Live**.

### Шаг 4: Инициализация администратора
Подключитесь через консоль Render Shell в бэкенде или выполните локально команду создания администратора:
```bash
npm run admin create admin@uytap.kg "<STRONG_PASSWORD>" "+996555000001"
```

### Шаг 5: Заполнение секретов фронтенда и деплой
В `uytap-frontend` -> **Environment**:
- `NEXT_PUBLIC_API_URL`: `https://uytap-backend.onrender.com/api` (или `https://api.uytap.kg/api`)
- `BACKEND_API_URL`: `https://uytap-backend.onrender.com/api`
- `INTERNAL_PROXY_SECRET`: то же значение, что и на бэкенде!
- `NEXT_PUBLIC_SUPABASE_URL`: `https://<PROJECT_ID>.supabase.co`
- `ELEVENLABS_API_KEY`: API ключ ElevenLabs.
Запустите деплой фронтенда. После завершения сборки Next.js фронтенд станет доступен по адресу `https://uytap-frontend.onrender.com`.

### Шаг 6: Финализация CORS
Вернитесь в `uytap-backend` -> **Environment** и укажите в `ALLOWED_ORIGINS` постоянный адрес фронтенда:
`https://uytap.kg,https://www.uytap.kg,https://uytap-frontend.onrender.com`

---

## 6. Проверка работоспособности (Healthcheck и Smoke-тесты)

После успешного деплоя выполните чек-лист проверки (Smoke-тестирование):

### 6.1. Автоматическая проверка эндпоинтов (curl)
```bash
# 1. Проверка работоспособности API бэкенда
curl -I https://uytap-backend.onrender.com/api/health
# Ожидаемый ответ: HTTP/1.1 200 OK, {"status":"ok"}

# 2. Проверка работоспособности фронтенда
curl -I https://uytap-frontend.onrender.com/api/health
# Ожидаемый ответ: HTTP/1.1 200 OK, {"status":"ok","service":"UyTap Frontend"}

# 3. Проверка публичного каталога объявлений
curl -s https://uytap-backend.onrender.com/api/listings | head -n 20
```

### 6.2. Пользовательский Smoke-тест (браузер)
1. **Главная страница:** откройте главную страницу, убедитесь в загрузке баннеров, шапки и футера.
2. **Авторизация по SMS/Email:**
   - Нажмите «Войти» -> введите номер телефона (+996...).
   - Убедитесь, что SMS приходит через шлюз Nikita, а форма принимает 6-значный OTP код.
3. **Создание объявления:**
   - Войдите в профиль, нажмите «Подать объявление».
   - Заполните поля, прикрепите 2–3 фотографии.
   - Проверьте, что фотографии успешно загрузились в бакет Supabase Storage и отображаются в галерее.
4. **Умный поиск:**
   - Введите в строке поиска запрос на естественном языке (например, «2 комнатная квартира в южных микрорайонах с ремонтом»).
   - Убедитесь, что AI-поиск (Claude/Gemini) отрабатывает без ошибок 500.
5. **Вход в панель администратора:**
   - Перейдите на `/admin/login`.
   - Введите логин и пароль созданного администратора.
   - Убедитесь, что дашборд администратора, список объявлений и модерация доступны.

---

## 7. Регулярный процесс: как катить изменения через PR

Для обеспечения максимальной надежности при обновлении боевого сервера соблюдайте регламент:

1. **Правило расширения и сжатия схемы БД (Expand and Contract Pattern):**
   При изменении структуры базы данных никогда не удаляйте и не переименовывайте колонки одновременно с кодом.
   - *Релиз N (Expand):* Добавить новую колонку как `NULLABLE` в миграции. Обновить код так, чтобы он читал старую колонку, но писал в обе.
   - *Релиз N+1:* Переключить чтение на новую колонку.
   - *Релиз N+2 (Contract):* Удалить старую неиспользуемую колонку отдельной миграцией.
2. **Локальный прогон перед открытием PR:**
   ```bash
   # В корне проекта
   cd back-end && npm test
   cd ../front-end && npm run build
   ```
3. **Создание PR:**
   Откройте PR с детальным описанием изменений. Дождитесь успешного завершения всех четырех проверок в GitHub Actions.
4. **Мердж:**
   Только после получения аппрува по CODEOWNERS сделайте **Squash and Merge**.
5. **Мониторинг деплоя:**
   Следите за деплой-логами в Render Dashboard. Если `preDeployCommand` не проходит, старый прод останется нетронутым.

---

## 8. Откат (Rollback): приложения и миграций

### 8.1. Откат кода приложения
Если в новом релизе обнаружен критический баг в бизнес-логике:
1. Зайдите в **Render Dashboard** -> выберите проблемный сервис (`uytap-backend` или `uytap-frontend`).
2. Перейдите во вкладку **Events** или **Deploys**.
3. Найдите предыдущий успешный деплой.
4. Нажмите **Rollback to this deploy**.
5. Render мгновенно переключит трафик на проверенный контейнер.

### 8.2. Откат базы данных
- Если код был откачен, а миграция была неразрушающей (`ADD COLUMN`), откатывать базу **не требуется** — код будет игнорировать лишнюю колонку.
- Если требуется отменить изменения схемы: подготовьте PR с обратной миграцией (например, `DROP INDEX`, `DROP TABLE`).
- В случае повреждения данных восстановите снимок из вкладки **Backups** в Render Dashboard.

---

## 9. Справочник переменных окружения

### 9.1. Бэкенд (`uytap-backend`)

| Переменная | Обязательна? | Где задавать | Описание и назначение | Пример / Плейсхолдер |
| :--- | :---: | :--- | :--- | :--- |
| `NODE_ENV` | Да | Render Env | Режим работы Node.js | `production` |
| `PORT` | Да | Render Env | Порт входящих соединений | `10000` |
| `DATABASE_URL` | Да | Render Secret | Строка прямого подключения к PostgreSQL | `postgres://user:pass@host:5432/db?sslmode=require` |
| `SUPABASE_URL` | Да | Render Secret | URL REST API проекта Supabase | `https://<PROJECT_ID>.supabase.co` |
| `SUPABASE_KEY` | Да | Render Secret | Сервисный ключ Supabase (`service_role`) | `<SUPABASE_SERVICE_ROLE_KEY>` |
| `JWT_SECRET` | Да | Render Secret | Секретный ключ подписи JWT (минимум 32–64 символа) | `<RANDOM_SECRET_64_CHARS>` |
| `OTP_SECRET` | Да | Render Secret | Секретный ключ для HMAC-хэширования OTP кодов | `<RANDOM_SECRET_64_CHARS>` |
| `INTERNAL_PROXY_SECRET` | Да | Render Secret | Ключ авторизации внутренних вызовов с фронтенда | `<RANDOM_SECRET_32_CHARS>` |
| `ALLOWED_ORIGINS` | Да | Render Env | Разрешенные домены CORS через запятую | `https://uytap.kg,https://uytap-frontend.onrender.com` |
| `AI_PROVIDER` | Да | Render Env | Провайдер AI для умного поиска (`claude` или `gemini`) | `claude` |
| `ANTHROPIC_API_KEY` | Да* | Render Secret | API-ключ Anthropic (если `AI_PROVIDER=claude`) | `sk-ant-api03-...` |
| `ANTHROPIC_MODEL` | Нет | Render Env | Модель Anthropic | `claude-haiku-5-5` |
| `GEMINI_API_KEY` | Да* | Render Secret | API-ключ Gemini (если `AI_PROVIDER=gemini`) | `<GEMINI_API_KEY>` |
| `GEMINI_MODEL` | Нет | Render Env | Модель Gemini | `gemini-2.5-flash` |
| `NIKITA_API_KEY` | Да | Render Secret | API-ключ SMS-шлюза Nikita OTP | `<NIKITA_API_KEY>` |
| `NIKITA_BASE_URL` | Нет | Render Env | Базовый URL API Nikita OTP | `https://smspro.nikita.kg` |
| `ODENGI_API_URL` | Да | Render Env | Базовый URL мерчанта O!Dengi | `https://api.odengi.kg` |
| `ODENGI_SID` | Да | Render Secret | Идентификатор сервиса (SID) O!Dengi | `<ODENGI_SID>` |
| `ODENGI_PASSWORD` | Да | Render Secret | Пароль кассы мерчанта O!Dengi | `<ODENGI_PASSWORD>` |
| `ODENGI_TEST` | Да | Render Env | Режим тестирования O!Dengi (`0` — боевой, `1` — тест) | `0` |
| `ODENGI_RESULT_URL` | Да | Render Secret | URL для webhook обратного вызова при оплате | `https://api.uytap.kg/api/payments/webhook` |
| `RESEND_API_KEY` | Да | Render Secret | Ключ сервиса отправки email Resend | `re_...` |
| `RESEND_FROM` | Нет | Render Env | Имя и адрес отправителя email | `UyTap <no-reply@uytap.kg>` |
| `ALERT_TELEGRAM_BOT_TOKEN` | Нет | Render Secret | Токен Telegram-бота для критических системных алертов | `<TELEGRAM_BOT_TOKEN>` |
| `ALERT_TELEGRAM_CHAT_ID` | Нет | Render Secret | ID чата администраторов в Telegram | `<TELEGRAM_CHAT_ID>` |

### 9.2. Фронтенд (`uytap-frontend`)

| Переменная | Обязательна? | Где задавать | Описание и назначение | Пример / Плейсхолдер |
| :--- | :---: | :--- | :--- | :--- |
| `NODE_ENV` | Да | Render Env | Режим работы Node.js | `production` |
| `NEXT_PUBLIC_API_URL` | Да | Render Env | Публичный URL API бэкенда для браузерных запросов | `https://api.uytap.kg/api` |
| `BACKEND_API_URL` | Да | Render Env | Серверный URL бэкенда для SSR проксирования | `https://uytap-backend.onrender.com/api` |
| `INTERNAL_PROXY_SECRET` | Да | Render Secret | Должен строго совпадать со значением бэкенда! | `<RANDOM_SECRET_32_CHARS>` |
| `NEXT_PUBLIC_SUPABASE_URL` | Да | Render Env | URL Supabase для оптимизатора картинок | `https://<PROJECT_ID>.supabase.co` |
| `SUPABASE_URL` | Да | Render Env | URL Supabase для серверной загрузки медиа | `https://<PROJECT_ID>.supabase.co` |
| `ELEVENLABS_API_KEY` | Да | Render Secret | Ключ ElevenLabs для голосового ввода | `<ELEVENLABS_API_KEY>` |
| `ENABLE_CLOUDFLARE` | Нет | Render Env | Включить ли проксирование Cloudflare | `false` |

---

## 10. Типичные проблемы и их решения (Troubleshooting)

### Проблема 1: Ошибка подключения к БД (`ECONNREFUSED` или `SSL connection error`)
- **Симптом:** Бэкенд падает при запуске с ошибкой `connect ECONNREFUSED` или `no pg_hba.conf entry for host ... no encryption`.
- **Решение:**
  1. Убедитесь, что в строке `DATABASE_URL` указан параметр `?sslmode=require`.
  2. Если база находится внутри Render, используйте **Internal Database URL** (без ограничений по IP и без расходов на внешний трафик).
  3. Если база внешняя, проверьте настройки IP Allowlist в настройках СУБД.

### Проблема 2: Ошибка CORS (`Access to fetch at ... has been blocked by CORS policy`)
- **Симптом:** Фронтенд не может выполнить запросы к бэкенду из браузера.
- **Решение:**
  1. Проверьте переменную `ALLOWED_ORIGINS` на бэкенде. Она должна содержать точный адрес фронтенда (включая протокол `https://`, без слеша на конце): например, `https://uytap.kg,https://uytap-frontend.onrender.com`.
  2. Перезапустите бэкенд после изменения переменной.

### Проблема 3: 401 Unauthorized на серверных роутах Next.js (`INTERNAL_PROXY_SECRET mismatch`)
- **Симптом:** Браузерные вызовы работают, но серверные вызовы Next.js через API-роуты возвращают 401 ошибку прокси.
- **Решение:**
  Убедитесь, что значение `INTERNAL_PROXY_SECRET` в сервисе `uytap-frontend` **абсолютно посимвольно совпадает** со значением `INTERNAL_PROXY_SECRET` в сервисе `uytap-backend`.

### Проблема 4: Сборка Next.js падает с ошибкой `Failed to collect page data`
- **Симптом:** На шаге `npm run build` сборка Next.js падает при генерации статических страниц.
- **Решение:**
  Next.js 16 при сборке обращается к переменной `NEXT_PUBLIC_API_URL`. Убедитесь, что переменная `NEXT_PUBLIC_API_URL` задана в Environment сервиса `uytap-frontend` в Render Dashboard **до запуска первой сборки**.

### Проблема 5: SMS-коды не приходят пользователям
- **Симптом:** Пользователь нажимает «Получить код», на фронтенде ошибка или статус тайм-аута.
- **Решение:**
  1. Проверьте баланс и статус аккаунта в личном кабинете Nikita OTP ([smspro.nikita.kg](https://smspro.nikita.kg)).
  2. Убедитесь, что ваш исходящий IP-адрес на Render не заблокирован фаерволом Nikita (уточните в поддержке Nikita требование привязки IP-адресов).
  3. Проверьте логи бэкенда по ключевому слову `Nikita OTP error`.

### Проблема 6: preDeployCommand падает с ошибкой миграции
- **Симптом:** Render сообщает `preDeployCommand failed, aborting deploy`.
- **Решение:**
  1. Откройте логи деплоя в Render Dashboard, найдите имя упавшего SQL-файла.
  2. Исправьте синтаксис в локальном окружении, проверьте через `node back-end/scripts/migrate.js`.
  3. Запушьте исправление в PR. Старая версия бэкенда все это время продолжает обслуживать пользователей без даунтайма.

---

## 11. Запуск на VPS в многопроцессном режиме (PM2 / Docker + Nginx)

Приложение полностью готово к запуску как в **однопроцессном**, так и в **многопроцессном** (PM2 cluster / несколько реплик Docker) режиме без использования Redis:

1. **Состояние безопасности и денег синхронизировано через PostgreSQL** (миграция `20261025000000_shared_state_and_locks.sql`):
   - `public.phone_otp_sessions` + RPC `consume_phone_otp_attempt`: сессии SMS OTP и атомарный счётчик попыток общие между всеми процессами (запрос кода на инстансе #1 и проверка кода на инстансе #2 работают бесшовно).
   - `public.rate_limit_counters` + RPC `check_and_increment_rate_limit`: межпроцессные счётчики лимитов отправки SMS/Email, входа (`/login`), проверки OTP (`/verify-otp`, `/verify-reset-code`) и суточных квот платных API.
   - `public.cron_leases` + RPC `try_acquire_cron_lease` / `release_cron_lease`: фоновая задача `runMaintenanceJob` захватывает межпроцессный lease-замок и выполняется ровно в одном процессе кластера, а внутри процесса защищена флагом `isMaintenanceRunning`.
2. **Ограничение памяти (Bounded In-Memory Maps):**
   - Все локальные кэши (`userAuthCache`, `SEARCH_CACHE`, `providerCheckThrottleMap`, `viewsThrottleMap`, `BoundedSharedRateLimitStore`, `sttRateLimitMap`) имеют жёсткий верхний предел размера и вытеснение по TTL + FIFO/LRU.
3. **Переменные окружения для многопроцессного запуска:**
   - `DATABASE_URL` — строка подключения к PostgreSQL (или порт `6543` Supavisor/PgBouncer).
   - `DB_POOL_MAX` — размер пула `pg.Pool` **на один процесс** (по умолчанию `10`; при запуске `N=2` воркеров суммарно до `20` коннектов, при `N=4` рекомендуется `DB_POOL_MAX=5..8`).
   - `INTERNAL_PROXY_SECRET` — единый секрет между Nginx / Next.js и всеми воркерами Express для доверенной передачи реального IP клиента (`X-Forwarded-For`).
   - Конфигурационные шаблоны находятся в каталоге `deploy/` (`deploy/ecosystem.config.cjs`, `deploy/docker-compose.yml`, `deploy/nginx.conf.example`).
