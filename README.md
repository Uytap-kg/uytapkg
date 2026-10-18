# UyTap — Платформа недвижимости Кыргызстана

Цифровая платформа для поиска, размещения и управления объявлениями о недвижимости в Кыргызстане.

---

## Архитектура проекта

- **`back-end/`** — REST API сервер на Node.js (Express, PostgreSQL `pg`, Supabase JS, Sharp, Zod).
- **`front-end/`** — веб-приложение на Next.js 16 (React 19, Turbopack, Tailwind CSS).
- **`supabase/`** — миграции базы данных PostgreSQL, RPC-функции и RLS-политики.
- **`docs/`** — документация по развертыванию ([`deploy.md`](docs/deploy.md)), тестированию ([`testing.md`](docs/testing.md)) и схемам БД.
- **`_cleanup/`** — архив временных и отладочных файлов (не коммитится в Git, см. [`_cleanup/MANIFEST.md`](_cleanup/MANIFEST.md)).

---

## CI / CD Пайплайн

В проекте настроен автоматический CI-пайплайн на базе **GitHub Actions** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### Что делает CI:
1. **`lint-and-audit` (Параллельная проверка синтаксиса и безопасности зависимостей):**
   - Проверяет синтаксис бэкенда (`npm run lint` в `back-end`).
   - Запускает линтер фронтенда (`npm run lint` в `front-end`).
   - Выполняет аудит уязвимостей зависимостей высокой и критической степени (`npm audit --omit=dev --audit-level=high`) для обоих сервисов.
2. **`backend-tests` (Набор юнит- и security-тестов бэкенда):**
   - Запускается в полностью изолированном окружении с mock-переменными без обращения к внешним сервисам.
   - Прогоняет 237 тестов Node.js Test Runner (`npm run test:coverage`).
   - Формирует отчёт о покрытии кода и сохраняет его как артефакт сборки (`backend-test-results`).
3. **`build-frontend` (Верификация production-сборки Next.js):**
   - Проверяет успешность компиляции фронтенда (`npm run build`) с кэшированием `.next/cache`.
4. **`build-and-scan-docker` (Сборка Docker-образа и сканирование уязвимостей):**
   - Собирает multi-stage образ бэкенда на базе `node:20-alpine`.
   - Сканирует образ сканером безопасности **Trivy** на уязвимости категорий `CRITICAL` и `HIGH`.

### Запуск проверок локально

#### 1. Бэкенд (`cd back-end`):
```bash
# Синтаксическая проверка
npm run lint

# Запуск юнит- и функциональных тестов (220+ тестов на моках)
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

#### 3. Сборка Docker-образа:
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

### 3. Окружение Production (VPS):
На боевом сервере создаётся файл конфигурации с правами доступа `600`:
- `SUPABASE_URL` — адрес API Supabase/Kong.
- `SUPABASE_KEY` — секретный сервисный ключ (`service_role`).
- `DATABASE_URL` — прямое подключение к PostgreSQL для миграций.
- `JWT_SECRET` — криптографический секрет для подписи JWT (минимум 32–64 символа).
- `OTP_SECRET` — секрет для HMAC-хэширования кодов подтверждения.
- `NIKITA_*` — API-ключ и параметры SMS-шлюза Nikita OTP (см. [`docs/nikita-otp.md`](docs/nikita-otp.md)).
- `ODENGI_*` — реквизиты платёжного шлюза O!Dengi.
- `ALERT_TELEGRAM_*` — (опционально) токены для Telegram-оповещений об ошибках.

Подробное описание параметров приведено в [`docs/deploy.md`](docs/deploy.md) и [`docs/nikita-otp.md`](docs/nikita-otp.md).

---

## Развёртывание на VPS и регламент отката

### Архитектура развёртывания
- Рекомендуемый режим: **Docker-контейнер** (`uytap-backend`) за реверс-прокси **Caddy** или **Nginx** с автоматическим SSL-сертификатом (Let's Encrypt).
- Контейнер слушает только локальный интерфейс: `127.0.0.1:5000`.
- Внешний порт `5000` закрывается фаерволом: `ufw deny 5000`.

### Проверка работоспособности после релиза (Healthcheck)
```bash
# Базовый healthcheck доступности
curl -i http://127.0.0.1:5000/api/health
# Ожидаемый ответ: HTTP/1.1 200 OK {"status":"ok","service":"UyTap Backend API"}

# Проверка подключения к базе данных
curl -i http://127.0.0.1:5000/api/health/ready
# Ожидаемый ответ: HTTP/1.1 200 OK {"status":"ready"}
```

### Регламент отката (Rollback)
При возникновении проблем на сервере:
1. **Если используется Docker:**
   ```bash
   # Переключение на предыдущий тег образа
   docker stop uytap-backend && docker rm uytap-backend
   docker run -d --name uytap-backend --restart always \
     -p 127.0.0.1:5000:5000 --env-file .env uytap-backend:previous
   ```
2. **Если используется Systemd:**
   ```bash
   # Восстановление предыдущей стабильной версии из резервной копии
   cd /var/www/uytap/back-end
   git checkout <previous_commit_tag>
   npm ci --omit=dev
   sudo systemctl restart uytap-backend
   ```
3. Проверить healthcheck: `curl -f http://127.0.0.1:5000/api/health`.
