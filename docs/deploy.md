# Руководство по развёртыванию бэкенда UyTap в продакшене (VPS / Docker)

Данный документ описывает требования и пошаговые инструкции по безопасному развёртыванию бэкенда платформы UyTap на виртуальном выделенном сервере (VPS) под управлением Linux (Ubuntu/Debian) или в контейнере Docker.

---

## 1. Архитектурные требования и ограничения

1. **Однопроцессный режим (Fork Mode / Single Instance):**
   > [!IMPORTANT]
   > Бэкенд UyTap использует внутрипроцессные механизмы защиты: in-memory rate-limiting (`express-rate-limit`), троттлинг запросов к платёжному шлюзу O!Dengi (`providerCheckThrottleMap`), троттлинг просмотров объявлений (`viewsThrottleMap`), кэш отозванных токенов (`authCache`), кэш дедупликации алертов (`alertsCache`) и встроенный cron-планировщик (`cronService.js`).  
   > **Запуск в режиме cluster (несколько воркеров) строго запрещён** без предварительного выноса этих структур в единое хранилище Redis. В `pm2` используйте режим `fork` (`instances: 1`), в `systemd` — одиночный сервис.

2. **Сетевая изоляция:**
   - Приложение слушает только локальный интерфейс: `127.0.0.1:5000`.
   - Прямой доступ к порту `5000` извне сервера должен быть закрыт фаерволом (`ufw deny 5000`).
   - Внешний трафик принимается только через реверс-прокси (Nginx или Caddy) с TLS-сертификатом (Let's Encrypt).

3. **Настройка `trust proxy`:**
   В Express включена настройка `app.set("trust proxy", 1)`, что означает доверие ровно одному внешнему реверс-прокси для корректного определения клиентского IP (`req.ip`) в заголовке `X-Forwarded-For`. При использовании цепочки прокси (например, Cloudflare -> Nginx) число прокси в `trust proxy` должно быть скорректировано.

4. **Права доступа к секретам (`.env`):**
   Файл `.env` должен иметь права доступа `600` (`chmod 600 .env`) и принадлежать пользователю, под которым работает процесс приложения (`chown uytap:uytap .env`).

---

## 2. Перечень обязательных переменных окружения

В файле конфигурации `.env` на сервере должны быть определены следующие переменные:

| Переменная | Описание | Пример значения |
|---|---|---|
| `NODE_ENV` | Режим работы окружения Node.js | `production` |
| `PORT` | Порт локального HTTP-сервера | `5000` |
| `ALLOWED_ORIGINS` | Разрешённые CORS-домены фронтенда через запятую | `https://uytap.kg,https://www.uytap.kg` |
| `JWT_SECRET` | Криптографически стойкий секрет для подписи JWT токенов | 64+ случайных символов (`openssl rand -hex 32`) |
| `OTP_SECRET` | Секрет HMAC для безопасного хэширования кодов верификации | 64+ случайных символов |
| `SUPABASE_URL` | URL проекта Supabase | `https://xxxxxxxxxxxx.supabase.co` |
| `SUPABASE_KEY` | Service Role API Key (секретный сервисный ключ) | `eyJhbGciOi...` |
| `DATABASE_URL` | Строка прямого подключения к базе PostgreSQL (пул соединений) | `postgresql://postgres:[PASSWORD]@[HOST]:6543/postgres?pgbouncer=true` |
| `ODENGI_MERCHANT_ID` | Идентификатор мерчанта в платёжной системе O!Dengi | Строка от провайдера O!Dengi |
| `ODENGI_SERVICE_ID` | Идентификатор сервиса в O!Dengi | Строка от провайдера O!Dengi |
| `ODENGI_SECRET_KEY` | Секретный ключ подписи запросов O!Dengi | Строка от провайдера O!Dengi |
| `ODENGI_API_URL` | Адрес API платёжного шлюза O!Dengi | `https://api.odengi.kg` |
| `ALERT_TELEGRAM_BOT_TOKEN` | *(Опционально)* Токен Telegram-бота для критических алертов | `123456789:AA...` |
| `ALERT_TELEGRAM_CHAT_ID` | *(Опционально)* Chat ID или ID группы администраторов для алертов | `-1001234567890` |
| `RESEND_API_KEY` | *(Опционально)* API-ключ Resend для отправки email | `re_...` |

---

## 3. Вариант 1: Развёртывание через Systemd (рекомендуется для VPS)

### 3.1. Создание системного пользователя и подготовка каталога
```bash
sudo adduser --system --no-create-home --group uytap
sudo mkdir -p /var/www/uytap/back-end
sudo chown -R uytap:uytap /var/www/uytap
```

### 3.2. Размещение кода и зависимостей
```bash
cd /var/www/uytap/back-end
# Клонирование / копирование файлов бэкенда
sudo -u uytap npm ci --omit=dev

# Создание .env и настройка прав
sudo -u uytap touch .env
# Заполните .env необходимыми переменными
sudo chmod 600 .env
sudo chown uytap:uytap .env
```

### 3.3. Создание Systemd юнита
Создайте файл `/etc/systemd/system/uytap-backend.service`:
```ini
[Unit]
Description=UyTap Backend API Service
After=network.target

[Service]
Type=simple
User=uytap
Group=uytap
WorkingDirectory=/var/www/uytap/back-end
Environment=NODE_ENV=production
EnvironmentFile=/var/www/uytap/back-end/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=uytap-backend
LimitNOFILE=65536

# Песочница безопасности
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

### 3.4. Запуск и автозагрузка
```bash
sudo systemctl daemon-reload
sudo systemctl enable uytap-backend
sudo systemctl start uytap-backend
sudo systemctl status uytap-backend
```

Просмотр структурных JSON-логов в реальном времени:
```bash
sudo journalctl -u uytap-backend -f
```

---

## 4. Вариант 2: Развёртывание через PM2 (Fork Mode)

Если на сервере используется `pm2`:
```bash
cd /var/www/uytap/back-end
npm ci --omit=dev
chmod 600 .env

# ВНИМАНИЕ: флаг -i 1 или fork обязателен!
pm2 start src/index.js --name "uytap-backend" --instances 1 --env production
pm2 save
pm2 startup
```

---

## 5. Вариант 3: Запуск через Docker-контейнер

### 5.1. Сборка Docker-образа
```bash
cd back-end
docker build -t uytap-backend:latest .
```

### 5.2. Запуск контейнера
```bash
docker run -d \
  --name uytap-backend \
  --restart always \
  -p 127.0.0.1:5000:5000 \
  --env-file .env \
  uytap-backend:latest
```

---

## 6. Конфигурация реверс-прокси

### 6.1. Конфигурация Caddy (рекомендуется за простоту и авто-TLS)
Файл `/etc/caddy/Caddyfile`:
```caddy
api.uytap.kg {
    encode gzip zstd

    reverse_proxy 127.0.0.1:5000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Лимит размера тела запроса (50 MB для фотографий)
    request_body {
        max_size 50MB
    }
}
```

### 6.2. Конфигурация Nginx
Файл `/etc/nginx/sites-available/uytap-api`:
```nginx
server {
    listen 80;
    server_name api.uytap.kg;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.uytap.kg;

    ssl_certificate /etc/letsencrypt/live/api.uytap.kg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.uytap.kg/privkey.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Таймауты
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

---

## 7. Проверка работоспособности после деплоя

1. **Проверка Healthcheck:**
   ```bash
   curl -i http://127.0.0.1:5000/api/health
   # Ожидаемый ответ: HTTP/1.1 200 OK
   # {"status":"ok","service":"UyTap Backend API", ...}
   ```

2. **Проверка готовности и подключения к базе данных:**
   ```bash
   curl -i http://127.0.0.1:5000/api/health/ready
   # Ожидаемый ответ: HTTP/1.1 200 OK
   # {"status":"ready", ...}
   ```

3. **Проверка наличия заголовка Request ID:**
   ```bash
   curl -i https://api.uytap.kg/api/health
   # В заголовках ответа должен присутствовать:
   # X-Request-Id: <uuid>
   ```
