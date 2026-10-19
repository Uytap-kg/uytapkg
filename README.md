# UyTap — Платформа недвижимости Кыргызстана

Цифровая платформа для поиска, размещения и управления объявлениями о недвижимости в Кыргызстане.

---

## Архитектура проекта

- **`back-end/`** — REST API сервер на Node.js (Express, PostgreSQL `pg`, Supabase JS, Sharp, Zod).
- **`front-end/`** — веб-приложение на Next.js 16 (React 19, Turbopack, Tailwind CSS).
- **`supabase/`** — миграции базы данных PostgreSQL, RPC-функции и RLS-политики.
- **`docs/`** — техническая документация ([`deploy.md`](docs/deploy.md), [`testing.md`](docs/testing.md) и схемы БД).
- **`_cleanup_review/`** — директория для изолированного хранения неиспользуемых файлов, бэкапов и отладочных скриптов (игнорируется в Git).
- **`render.yaml`** — файл Blueprint для автоматического развёртывания стека на Render.

---

## Деплой на Render (Рекомендуемый способ)

В корне репозитория подготовлен файл спецификации **`render.yaml` (Render Blueprint)**. Он автоматически создаёт и настраивает два связанных веб-сервиса:

1. **`uytap-backend` (Web Service, Node.js 22):**
   - **Root Directory:** `back-end`
   - **Build Command:** `npm ci --omit=dev`
   - **Start Command:** `node src/index.js`
   - **Health Check Path:** `/api/health`
   - **Слушает:** порт `$PORT` на адресе `0.0.0.0`.

2. **`uytap-frontend` (Web Service, Next.js 16 / React 19):**
   - **Root Directory:** `front-end`
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm run start -- -p $PORT -H 0.0.0.0`
   - **Health Check Path:** `/api/health`

### Инструкция по развёртыванию через Blueprint:
1. Зарегистрируйтесь на [Render](https://render.com) и подключите ваш GitHub-аккаунт.
2. В панели Render нажмите **New +** -> **Blueprint**.
3. Выберите ваш новый репозиторий с проектом UyTap.
4. Render автоматически распознает `render.yaml` и выведет список сервисов и переменных со статусом `sync: false`.
5. Заполните секретные переменные окружения (см. раздел [Переменные окружения](#переменные-окружения-и-секреты)) в интерфейсе Render.
6. Нажмите **Apply** — Render выполнит автоматическую сборку и запуск обоих сервисов с проверкой health-check.

---

## CI / CD Пайплайн

В проекте настроен автоматический CI-пайплайн на базе **GitHub Actions** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### Что делает CI:
1. **`lint-and-audit` (Параллельная проверка синтаксиса и безопасности зависимостей):**
   - Проверяет синтаксис бэкенда (`npm run lint` в `back-end`).
   - Запускает линтер фронтенда (`npm run lint` в `front-end`).
   - Выполняет аудит зависимостей на уязвимости высокой и критической степени (`npm audit --omit=dev --audit-level=high`) для обоих сервисов.
2. **`backend-tests` (Набор юнит- и security-тестов бэкенда):**
   - Запускается в полностью изолированном окружении с mock-переменными без обращения к внешним сервисам.
   - Прогоняет полный набор из 330 тестов Node.js Test Runner (`npm run test:coverage`).
   - Формирует отчёт о покрытии кода и сохраняет его как артефакт сборки (`backend-test-results`).
3. **`build-frontend` (Верификация production-сборки Next.js):**
   - Проверяет успешность компиляции фронтенда (`npm run build`) с кэшированием `.next/cache`.
4. **`build-and-scan-docker` (Сборка Docker-образа и сканирование уязвимостей):**
   - Собирает multi-stage образ бэкенда на базе `node:22-alpine`.
   - Сканирует образ сканером безопасности **Trivy** на уязвимости категорий `CRITICAL` и `HIGH`.

### Запуск проверок локально

#### 1. Бэкенд (`cd back-end`):
```bash
# Синтаксическая проверка
npm run lint

# Запуск юнит- и функциональных тестов (330 тестов)
npm test

# Запуск с отчётом о покрытии кода
npm run test:coverage

# Аудит безопасности зависимостей
npm audit --omit=dev --audit-level=high
```

#### 2. Фронтенд (`cd front-end`):
```bash
# Линтер ESLint (Next.js 16 / React 19)
npm run lint

# Production-сборка Next.js
npm run build

# Аудит безопасности зависимостей
npm audit --omit=dev --audit-level=high
```

#### 3. Сборка Docker-образа бэкенда:
```bash
docker build -t uytap-backend:latest back-end
```

---

## Переменные окружения и секреты

### 1. Локальная разработка:
Скопируйте примеры конфигурации и заполните локальными значениями:
```bash
cp .env.example .env
cp back-end/.env.example back-end/.env
cp front-end/.env.example front-end/.env.local
```
> [!WARNING]
> Файлы `.env`, `.env.*` и `back-end.env` содержат конфиденциальные данные и защищены правилами `.gitignore`. Никогда не добавляйте их в Git!

### 2. Окружение CI (GitHub Actions):
Для юнит-тестов в CI реальные боевые секреты **не требуются**. Все тесты запускаются с безопасными mock-переменными (`http://127.0.0.1:54321`), гарантируя изоляцию от боевой базы данных.

### 3. Окружение Production (Render):
В настройках сервисов на Render задаются следующие переменные:

#### Бэкенд (`uytap-backend`):
- `NODE_ENV` = `production`
- `PORT` = `10000`
- `INTERNAL_PROXY_SECRET` — общий секрет для валидации прокси-запросов от Next.js (>= 32 символов).
- `ALLOWED_ORIGINS` — URL фронтенда (`https://uytap-frontend.onrender.com,https://uytap.kg`).
- `SUPABASE_URL` — REST API адрес Supabase / Kong (`https://<project-ref>.supabase.co`).
- `SUPABASE_KEY` — секретный сервисный ключ (`service_role`).
- `DATABASE_URL` — прямое подключение к PostgreSQL (пул `pg`).
- `JWT_SECRET` — криптографический секрет для подписи JWT (минимум 32–64 символа).
- `OTP_SECRET` — секрет для HMAC-хэширования кодов подтверждения.
- `AI_PROVIDER` = `claude`
- `ANTHROPIC_API_KEY` — API-ключ Anthropic Claude для умного поиска.
- `ANTHROPIC_MODEL` = `claude-haiku-5-5`
- `GEMINI_API_KEY` — (резерв) API-ключ Google Gemini.
- `NIKITA_API_KEY` — API-ключ SMS-шлюза Nikita OTP.
- `ODENGI_SID`, `ODENGI_PASSWORD`, `ODENGI_RESULT_URL` — реквизиты платёжного шлюза O!Dengi.
- `RESEND_API_KEY` — ключ отправки email.
- `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` — (опционально) Telegram-алерты.

#### Фронтенд (`uytap-frontend`):
- `NODE_ENV` = `production`
- `NEXT_PUBLIC_API_URL` — публичный URL API бэкенда (`https://uytap-backend.onrender.com/api`).
- `BACKEND_API_URL` — внутренний URL API бэкенда (`https://uytap-backend.onrender.com/api` или private network `http://uytap-backend:10000/api`).
- `INTERNAL_PROXY_SECRET` — тот же секрет, что и на бэкенде.
- `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` — адрес Supabase для remotePatterns изображений.
- `ELEVENLABS_API_KEY` — API-ключ ElevenLabs для голосового поиска.

---

## Проверка работоспособности (Healthcheck)

После деплоя обоих сервисов проверьте эндпоинты доступности:

```bash
# Healthcheck бэкенда
curl -i https://uytap-backend.onrender.com/api/health
# Ожидаемый ответ: HTTP/1.1 200 OK {"status":"ok","service":"UyTap Backend API", ...}

# Проверка готовности БД на бэкенде
curl -i https://uytap-backend.onrender.com/api/health/ready
# Ожидаемый ответ: HTTP/1.1 200 OK {"status":"ready", ...}

# Healthcheck фронтенда
curl -i https://uytap-frontend.onrender.com/api/health
# Ожидаемый ответ: HTTP/1.1 200 OK {"status":"ok","service":"UyTap Frontend", ...}
```
