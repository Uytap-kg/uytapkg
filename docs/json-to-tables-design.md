# Проектирование реляционных таблиц PostgreSQL вместо JSON-хранилищ в Supabase Storage

**Документ:** Архитектурный проект схемы данных  
**Статус:** Согласованный проект (Design Only — без выполнения SQL и изменения кода)  
**Редакция:** 2.0 (по результатам согласования требований и аудита авторизации)  
**Дата разработки:** Октябрь 2026 г.  
**Стек:** PostgreSQL 15+ (Supabase) / Node.js (ES Modules) / Next.js  

---

## 1. Введение и контекст

### 1.1. Текущее состояние
В ходе аудита бэкенда UyTap было выявлено, что три важные бизнес-сущности платформы сохраняются как JSON-файлы в приватном бакете Supabase Storage (`APP_SETTINGS_BUCKET = "app-settings"`):
1. **Рекламные баннеры:** `banners.json` (управляется через `back-end/src/utils/bannersStore.js`).
2. **Заявки на публикацию в Instagram:** `instagram-requests.json` (управляется через `back-end/src/utils/instagramRequests.js`).
3. **Тарифные планы и расценки разовых услуг:** `pricing.json` (управляется через `back-end/src/utils/pricingSettings.js`).

### 1.2. Проблема текущей архитектуры
- **Состояние гонки (Race Conditions) и потеря обновлений (Lost Updates):**  
  Чтение и запись JSON построены по паттерну *read-modify-write* (скачать весь массив, распарсить, изменить в памяти, сериализовать и перезаписать файл в Storage целиком).
- **Неэффективность внутрипроцессной блокировки `withWriteLock`:**  
  В `bannersStore.js` и `instagramRequests.js` используется очередь промисов (`writeQueue.then(...)`). Она работает **строго в рамках одного процесса Node.js**. При запуске нескольких процессов (кластер PM2, несколько контейнеров, горизонтальный автоскейлинг) параллельные процессы перезаписывают файл поверх друг друга.
- **В `pricingSettings.js` блокировка отсутствует вовсе:**  
  Любое одновременное сохранение цен затирает данные.
- **Кэширование:** In-memory кэш (10–15 секунд) создает окно рассинхронизации между инстансами.

### 1.3. Согласованные решения
По итогам обсуждения концепции утверждены следующие решения:
1. **Заявки Instagram:** При удалении объявления связанная заявка удаляется каскадно (`ON DELETE CASCADE` по `listing_id`).
2. **Скрипт переноса данных:** Обязателен отдельный идемпотентный скрипт миграции с поддержкой режима `--dry-run`. Исходные JSON-файлы и Storage-бакет не удаляются.
3. **Колонка `page` в баннерах:** Колонку `page` в таблицу `banners` **не добавлять**.

---

## 2. Анализ существующей схемы БД и предотвращение дублирования

Был проведён аудит файлов `back-end/src/schema.sql` и всех миграций (`001_promotions_columns.sql` — `011_p2_slots_and_rpc.sql`):

| Сущность | Наличие в `schema.sql` / миграциях | Фактическое состояние | Решение проекта |
|---|---|---|---|
| **Баннеры** | В `schema.sql` (строки 159–168) есть таблица `banners` | Таблица создавалась как заготовка и ни разу не вызывалась из кода (`supabase.from("banners")` отсутствует). В ней **отсутствуют** поля фокуса картинки (`imagePositionX/Y`), диапазон дат (`startDate`, `endDate`) и `updated_at`. В миграциях таблицы нет. | **Не создавать дублирующую таблицу `banners_new`.** Модернизировать схему существующей таблицы `banners` безопасными командами `ALTER TABLE ADD COLUMN IF NOT EXISTS`, обеспечив совместимость как для чистой базы, так и для базы с исходным `schema.sql`. |
| **Заявки Instagram** | **Отсутствует** в `schema.sql` и во всех файлах миграций | Никаких таблиц нет. Данные хранятся только в `instagram-requests.json`. | Создать новую таблицу `instagram_requests` с внешними ключами на `listings` и `users`. |
| **Тарифы и цены** | В `schema.sql` есть `subscriptions` и `payments` | Таблицы `subscriptions` и `payments` хранят *подписки конкретных пользователей* и *транзакции*, но таблицы **справочника тарифов и расценок услуг** нет. Цены и лимиты читаются только из `pricing.json`. | Создать нормализованные таблицы `tariff_plans` (планы подписок) и `service_prices` (разовые услуги). Существующие таблицы подписок и платежей **не модифицировать**. |

---

## 3. Аудит авторизации и схема Row Level Security (RLS)

### 3.1. Результаты проверки: как бэкенд обращается к базе данных
В ходе аудита конфигурации (`back-end/src/config/db.js`, `back-end/.env`, `back-end/src/middleware/auth.js`) установлено:
1. **Ключ подключения к Supabase:**  
   В `back-end/.env` переменная `SUPABASE_KEY` содержит ключ формата `sb_secret_...` — это **Service Role Key (секретный сервисный ключ с максимальными привилегиями)**.
2. **Тип авторизации пользователей:**  
   В проекте используется **кастомный JWT** (библиотека `jsonwebtoken`, подписывается секретом `process.env.JWT_SECRET`, алгоритм HS256). Встроенный сервис Supabase Auth (`supabase.auth`) в проекте **не используется вообще**. Таблица пользователей — это собственная таблица `public.users`.
3. **Почему стандартные RLS с `auth.uid()` и `role = 'admin'` не работают:**
   - Когда Node.js выполняет запрос к Supabase через ключ `service_role`, в PostgreSQL переменная роли равна `service_role`. По умолчанию в Supabase запросы от `service_role` **полностью обходят RLS (BYPASSRLS)**.
   - Встроенная функция `auth.uid()` в PostgreSQL всегда возвращает `NULL`, так как запрос не содержит сессионного токена Supabase GoTrue.
   - Следовательно, политики вида `USING (auth.uid() = user_id)` или `USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))` при прямом запросе всегда заблокируют доступ (так как `auth.uid()` равен `NULL`), а для запросов Node.js бэкенда они просто игнорируются движком Postgres из-за привилегии `BYPASSRLS`.

### 3.2. Архитектура безопасности: эшелонированная защита (Defense-in-Depth)
В архитектуре UyTap бэкенд выступает в роли единственного доверенного шлюза (Backend-As-Gatekeeper / BFF):
```
[React / Next.js Фронтенд]
       │
       ▼ (Custom JWT: Authorization: Bearer <token>)
[Express API Сервер]
   ├── authenticateToken (jwt.verify(token, JWT_SECRET), проверка token_version)
   ├── requireAdmin (проверка req.user.role === 'admin')
   ├── Zod Validation (валидация входных данных)
   └── Бизнес-проверки владения (listing.user_id === req.user.id)
       │
       ▼ (Supabase Service Role Key: BYPASSRLS)
[PostgreSQL Database]
   ▲
   │ (PostgREST API через открытый интернет с анонимным ключом: anon key)
[Потенциальный злоумышленник] ──► ЗАБЛОКИРОВАН ПОЛИТИКАМИ RLS
```

### 3.3. Реальная схема политик RLS в PostgreSQL
Политики RLS в данной архитектуре выполняют критическую функцию **защитного экрана от прямого доступа из интернета** (через публичный PostgREST endpoint Supabase `https://<ref>.supabase.co/rest/v1/`):
1. **Таблица `banners`:**
   - `SELECT`: открыт для `anon` и `authenticated`, но **только** для строк, где `is_active = TRUE AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE)`.
   - `INSERT, UPDATE, DELETE`: **запрещены** для `anon` и `authenticated`. Любая модификация баннеров возможна только через эндпоинты Express-сервера под `service_role`.
2. **Таблица `instagram_requests`:**
   - `SELECT, INSERT, UPDATE, DELETE`: **полностью запрещены** для `anon` и `authenticated`. Никакой внешний клиент не сможет прочитать или подделать заявки напрямую через Supabase REST API. Доступ осуществляется строго через защищенные контроллеры Express.
3. **Таблицы `tariff_plans` и `service_prices`:**
   - `SELECT`: открыт для `anon` и `authenticated` для строк с `is_active = TRUE`. Публичный просмотр цен через PostgREST безопасен.
   - `INSERT, UPDATE, DELETE`: **полностью запрещены** для `anon` и `authenticated`. Изменение расценок возможно только через проверенный эндпоинт `PUT /api/admin/pricing` Express-сервера.

---

## 4. Сущность 1: Рекламные баннеры (Banners)

### 4.1. Реальная структура JSON (`banners.json`)
```json
[
  {
    "id": "e42e47e8-4663-4b62-bb4e-7b7501a3cf88",
    "title": "Новый жилой комплекс в Бишкеке",
    "imageUrl": "https://supabase.../storage/v1/object/public/banners/abc-123.jpg",
    "imagePositionX": 50,
    "imagePositionY": 50,
    "link": "https://example.com/promo",
    "startDate": "2026-08-01",
    "endDate": "2026-08-31",
    "active": true,
    "createdAt": "2026-08-01T12:00:00.000Z",
    "updatedAt": "2026-08-01T12:00:00.000Z"
  }
]
```

### 4.2. Результаты проверки фронтенд-фильтра `banner.page === page`
В компоненте `front-end/src/components/pageComponents/addBanner/AdBanner.jsx` (строки 22–24) обнаружен код:
```javascript
const filteredBanners = page
  ? data.filter((banner) => banner.page === page)
  : data;
```
**Результаты проверки поведения фронтенда:**
1. **Как вызывается компонент сейчас:** На всех страницах платформы (`/`, `/complexes`, `/developers`, `/issyk-kul`, `/lawyers`) компонент вызывается без пропсов: `<AdBanner />`.
2. **Значение по умолчанию:** Параметр `page` по умолчанию равен `null` (`export default function AdBanner({ page = null })`).
3. **Поведение тернарного оператора:** Поскольку `page` равен `null` (falsy), условие не выполняется, и компонент возвращает `data` целиком. **Все активные баннеры успешно отображаются.**
4. **Что произошло бы при передаче `page`:** Если бы разработчик передал `<AdBanner page="main" />`, то из-за отсутствия свойства `page` в объектах баннеров `banner.page` было бы `undefined`, фильтр вернул бы пустой массив `[]`, и баннер скрылся бы (`if (banners.length === 0) return null;`).
5. **Согласованное решение:** Колонку `page` в таблицу `banners` **не добавлять**. В дальнейшем на фронтенде рекомендуется убрать неиспользуемый пропс `page` из `AdBanner.jsx` в рамках планового рефакторинга UI.

### 4.3. Соответствие полей JSON и колонок таблицы `banners`

| Поле в JSON | Колонка в таблице | Тип PostgreSQL | Модификаторы | Примечание |
|---|---|---|---|---|
| `id` | `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | 1:1 совпадение |
| `title` | `title` | `VARCHAR(255)` | `NOT NULL` | В Zod ограничение 200, в БД 255 |
| `imageUrl` | `image_url` | `TEXT` | `NOT NULL` | Ссылка на файл в бакете `banners` |
| `imagePositionX` | `image_position_x` | `SMALLINT` | `NOT NULL DEFAULT 50 CHECK (image_position_x BETWEEN 0 AND 100)` | Горизонтальный фокус кадрирования (0–100%) |
| `imagePositionY` | `image_position_y` | `SMALLINT` | `NOT NULL DEFAULT 50 CHECK (image_position_y BETWEEN 0 AND 100)` | Вертикальный фокус кадрирования (0–100%) |
| `link` | `link_url` | `TEXT` | `NULL` | Ссылка клика. В DTO мапится как `link: row.link_url` |
| `startDate` | `start_date` | `DATE` | `NOT NULL DEFAULT CURRENT_DATE` | Дата начала показа |
| `endDate` | `end_date` | `DATE` | `NULL` | Дата окончания показа (NULL = бессрочно) |
| `active` | `is_active` | `BOOLEAN` | `NOT NULL DEFAULT TRUE` | Стандарт проекта. В DTO мапится как `active: row.is_active` |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | Метка создания |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | Метка обновления |
| *(из schema.sql)* | `views_count` | `INT` | `NOT NULL DEFAULT 0` | Сохранено для будущей аналитики |
| *(из schema.sql)* | `clicks_count` | `INT` | `NOT NULL DEFAULT 0` | Сохранено для будущей аналитики |
| *(не используется)*| `page` | — | — | **Отклонено по согласованию.** В БД не создается |

### 4.4. Предложенный SQL DDL для `banners`

```sql
-- =======================================================
-- 1. Таблица баннеров (Banners)
-- =======================================================

CREATE TABLE IF NOT EXISTS banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    image_url TEXT NOT NULL,
    link_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    views_count INT NOT NULL DEFAULT 0,
    clicks_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Добавление недостающих колонок (идемпотентно для существующей базы)
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_position_x SMALLINT NOT NULL DEFAULT 50 
    CHECK (image_position_x >= 0 AND image_position_x <= 100);

ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_position_y SMALLINT NOT NULL DEFAULT 50 
    CHECK (image_position_y >= 0 AND image_position_y <= 100);

ALTER TABLE banners ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE banners ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE banners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_banners_dates_range') THEN
        ALTER TABLE banners ADD CONSTRAINT chk_banners_dates_range 
            CHECK (end_date IS NULL OR end_date >= start_date);
    END IF;
END $$;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_banners_active_dates ON banners (is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_banners_created_at_desc ON banners (created_at DESC);

-- RLS
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- Публичный просмотр через PostgREST (только активные и актуальные)
CREATE POLICY "Public read active banners"
ON banners FOR SELECT TO anon, authenticated
USING (
    is_active = TRUE 
    AND start_date <= CURRENT_DATE 
    AND (end_date IS NULL OR end_date >= CURRENT_DATE)
);

-- Все операции изменения закрыты от прямых внешних запросов
-- (Node.js бэкенд под service_role выполняет INSERT/UPDATE/DELETE в обход RLS)
```

---

## 5. Сущность 2: Заявки на размещение в Instagram (Instagram Requests)

### 5.1. Реальная структура JSON (`instagram-requests.json`)
```json
[
  {
    "id": "c7a4e69b-891a-4c2e-9d22-1d5427976829",
    "listingId": "0e5b9f7a-8b1a-4d2c-9a1b-123456789abc",
    "userId": "1f2e3d4c-5b6a-7890-abcd-ef0123456789",
    "status": "pending",
    "createdAt": "2026-08-05T14:30:00.000Z",
    "publishedAt": null
  }
]
```

### 5.2. Согласованное правило удаления
По согласованию утверждено правило: **`ON DELETE CASCADE` по `listing_id`**.  
Если пользователь удаляет свое объявление из базы, заявка на публикацию в Instagram удаляется автоматически, исключая ситуацию, когда администратор публикует в соцсетях несуществующий или удаленный объект.

### 5.3. Соответствие полей JSON и колонок таблицы `instagram_requests`

| Поле в JSON | Колонка в таблице | Тип PostgreSQL | Модификаторы | Примечание |
|---|---|---|---|---|
| `id` | `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | 1:1 совпадение |
| `listingId` | `listing_id` | `UUID` | `NOT NULL REFERENCES listings(id) ON DELETE CASCADE` | Внешний ключ с каскадным удалением |
| `userId` | `user_id` | `UUID` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Внешний ключ на автора |
| `status` | `status` | `VARCHAR(20)` | `NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected', 'canceled'))` | Статус заявки |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | Дата подачи заявки |
| `publishedAt` | `published_at` | `TIMESTAMPTZ` | `NULL` | Время фактической публикации |
| *(новое)* | `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | Системный аудит изменений |
| *(новое)* | `published_by` | `UUID` | `NULL REFERENCES users(id) ON DELETE SET NULL` | ID администратора, закрывшего заявку |
| *(новое)* | `notes` | `TEXT` | `NULL` | Служебная заметка / ссылка на пост |

### 5.4. Предложенный SQL DDL для `instagram_requests`

```sql
-- =======================================================
-- 2. Таблица заявок на публикацию в Instagram
-- =======================================================

CREATE TABLE IF NOT EXISTS instagram_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'published', 'rejected', 'canceled')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_instagram_requests_status_created 
ON instagram_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_instagram_requests_listing_id 
ON instagram_requests (listing_id);

CREATE INDEX IF NOT EXISTS idx_instagram_requests_user_id 
ON instagram_requests (user_id);

-- RLS: Полная защита от прямого внешнего доступа
ALTER TABLE instagram_requests ENABLE ROW LEVEL SECURITY;

-- Для anon и authenticated политик SELECT/INSERT/UPDATE/DELETE не создается,
-- что полностью блокирует любые прямые обращения через PostgREST.
-- Все операции проводятся строго через Express контроллеры под service_role.
```

---

## 6. Сущность 3: Тарифные планы и расценки разовых услуг (Pricing / Tariffs)

### 6.1. Реальная структура JSON (`pricing.json`)
```json
{
  "tariffs": {
    "start": { "price": 390, "activeListings": 5, "vipLifts": 1, "topLifts": 1 },
    "optimal": { "price": 790, "activeListings": 15, "vipLifts": 2, "topLifts": 3 },
    "business": { "price": 1890, "activeListings": 50, "vipLifts": 5, "topLifts": 10 },
    "developer": {
      "mode": "individual",
      "value": null,
      "activeListings": 100,
      "vipLifts": 10,
      "topLifts": 20
    }
  },
  "services": {
    "vip": 290,
    "urgent": 70,
    "top": 190,
    "instagram": 390
  }
}
```

### 6.2. Архитектурное решение: Нормализованные таблицы
Вместо непрозрачного JSON создаются две строго типизированные таблицы:
1. `tariff_plans` — пакетные тарифы подписки (`start`, `optimal`, `business`, `developer`).
2. `service_prices` — разовые услуги продвижения (`vip`, `urgent`, `top`, `instagram`).

Колонки лимитов (`active_listings_limit`, `vip_boosts_limit`, `top_boosts_limit`) названы в точности так же, как в существующей таблице `subscriptions`, что сохраняет архитектурное единообразие платформы.

### 6.3. Соответствие полей JSON и колонок таблиц

#### Тарифные планы (`tariff_plans`)

| Поле в JSON | Колонка в таблице | Тип PostgreSQL | Модификаторы | Примечание |
|---|---|---|---|---|
| Ключ (`start`, `optimal`, `business`, `developer`) | `id` | `VARCHAR(30)` | `PRIMARY KEY` | Естественный ключ, совпадает с `subscriptions.tariff_id` |
| UI Заголовок | `title` | `VARCHAR(100)` | `NOT NULL` | "СТАРТ", "ОПТИМАЛЬНЫЙ", "БИЗНЕС", "ЗАСТРОЙЩИК" |
| `price` / `value` | `price` | `NUMERIC(10, 2)` | `NULL CHECK (price IS NULL OR price >= 0)` | Число или `NULL` при `mode='individual'` |
| `developer.mode` | `price_mode` | `VARCHAR(20)` | `NOT NULL DEFAULT 'numeric' CHECK (price_mode IN ('numeric', 'individual'))` | Режим ценообразования |
| `activeListings` | `active_listings_limit` | `INT` | `NOT NULL DEFAULT 0 CHECK (active_listings_limit >= 0)` | Лимит активных объявлений |
| `vipLifts` | `vip_boosts_limit` | `INT` | `NOT NULL DEFAULT 0 CHECK (vip_boosts_limit >= 0)` | Лимит VIP-поднятий |
| `topLifts` | `top_boosts_limit` | `INT` | `NOT NULL DEFAULT 0 CHECK (top_boosts_limit >= 0)` | Лимит ТОП-поднятий |
| Порядок вывода | `display_order` | `INT` | `NOT NULL DEFAULT 0` | 1, 2, 3, 4 |
| Системные | `created_at`, `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | Метки аудита |

#### Разовые услуги (`service_prices`)

| Поле в JSON | Колонка в таблице | Тип PostgreSQL | Модификаторы | Примечание |
|---|---|---|---|---|
| Ключ (`vip`, `urgent`, `top`, `instagram`) | `id` | `VARCHAR(30)` | `PRIMARY KEY` | Естественный ключ услуги |
| UI Заголовок | `title` | `VARCHAR(100)` | `NOT NULL` | "VIP", "Срочно", "ТОП", "Instagram" |
| Значение цены | `price` | `NUMERIC(10, 2)` | `NOT NULL CHECK (price >= 0)` | Стоимость услуги в сомах |
| Периодичность | `price_period` | `VARCHAR(20)` | `NOT NULL DEFAULT 'day' CHECK (price_period IN ('day', 'once'))` | `'day'` (в день) или `'once'` (разово) |
| Порядок вывода | `display_order` | `INT` | `NOT NULL DEFAULT 0` | 1, 2, 3, 4 |
| Системные | `created_at`, `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | Метки аудита |

### 6.4. Предложенный SQL DDL для `tariff_plans` и `service_prices`

```sql
-- =======================================================
-- 3. Таблица тарифных планов (Tariff Plans)
-- =======================================================

CREATE TABLE IF NOT EXISTS tariff_plans (
    id VARCHAR(30) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
    price_mode VARCHAR(20) NOT NULL DEFAULT 'numeric' 
        CHECK (price_mode IN ('numeric', 'individual')),
    active_listings_limit INT NOT NULL DEFAULT 0 CHECK (active_listings_limit >= 0),
    vip_boosts_limit INT NOT NULL DEFAULT 0 CHECK (vip_boosts_limit >= 0),
    top_boosts_limit INT NOT NULL DEFAULT 0 CHECK (top_boosts_limit >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tariff_price_mode CHECK (
        (price_mode = 'numeric' AND price IS NOT NULL) OR
        (price_mode = 'individual')
    )
);

-- =======================================================
-- 4. Таблица цен разовых услуг (Service Prices)
-- =======================================================

CREATE TABLE IF NOT EXISTS service_prices (
    id VARCHAR(30) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    price_period VARCHAR(20) NOT NULL DEFAULT 'day' 
        CHECK (price_period IN ('day', 'once')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Сид дефолтных тарифов (идемпотентно через ON CONFLICT DO NOTHING)
INSERT INTO tariff_plans (id, title, price, price_mode, active_listings_limit, vip_boosts_limit, top_boosts_limit, display_order)
VALUES
    ('start', 'СТАРТ', 390.00, 'numeric', 5, 1, 1, 1),
    ('optimal', 'ОПТИМАЛЬНЫЙ', 790.00, 'numeric', 15, 2, 3, 2),
    ('business', 'БИЗНЕС', 1890.00, 'numeric', 50, 5, 10, 3),
    ('developer', 'ЗАСТРОЙЩИК', NULL, 'individual', 100, 10, 20, 4)
ON CONFLICT (id) DO NOTHING;

-- Сид цен разовых услуг (идемпотентно через ON CONFLICT DO NOTHING)
INSERT INTO service_prices (id, title, price, price_period, display_order)
VALUES
    ('vip', 'VIP', 290.00, 'day', 1),
    ('urgent', 'Срочно', 70.00, 'day', 2),
    ('top', 'ТОП', 190.00, 'day', 3),
    ('instagram', 'Instagram', 390.00, 'once', 4)
ON CONFLICT (id) DO NOTHING;

-- RLS
ALTER TABLE tariff_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_prices ENABLE ROW LEVEL SECURITY;

-- Публичный просмотр через PostgREST
CREATE POLICY "Public read active tariff plans"
ON tariff_plans FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

CREATE POLICY "Public read active service prices"
ON service_prices FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

-- Изменения разрешены только через Express сервер под service_role
```

---

## 7. Как данные из JSON ложатся в таблицы (Аудит полей)

Все поля без исключения сопоставлены:

```
[BANNERS.JSON]
  id               ───► banners.id (UUID)
  title            ───► banners.title (VARCHAR 255)
  imageUrl         ───► banners.image_url (TEXT)
  imagePositionX   ───► banners.image_position_x (SMALLINT, default 50)
  imagePositionY   ───► banners.image_position_y (SMALLINT, default 50)
  link             ───► banners.link_url (TEXT, nullable)
  startDate        ───► banners.start_date (DATE)
  endDate          ───► banners.end_date (DATE, nullable)
  active           ───► banners.is_active (BOOLEAN, default true)
  createdAt        ───► banners.created_at (TIMESTAMPTZ)
  updatedAt        ───► banners.updated_at (TIMESTAMPTZ)

[INSTAGRAM-REQUESTS.JSON]
  id               ───► instagram_requests.id (UUID)
  listingId        ───► instagram_requests.listing_id (UUID FK -> listings.id ON DELETE CASCADE)
  userId           ───► instagram_requests.user_id (UUID FK -> users.id ON DELETE CASCADE)
  status           ───► instagram_requests.status (VARCHAR 20, default 'pending')
  createdAt        ───► instagram_requests.created_at (TIMESTAMPTZ)
  publishedAt      ───► instagram_requests.published_at (TIMESTAMPTZ, nullable)

[PRICING.JSON]
  tariffs.start.*         ───► tariff_plans [id='start'] (price, active_listings_limit, vip_boosts_limit, top_boosts_limit)
  tariffs.optimal.*       ───► tariff_plans [id='optimal'] (price, active_listings_limit, vip_boosts_limit, top_boosts_limit)
  tariffs.business.*      ───► tariff_plans [id='business'] (price, active_listings_limit, vip_boosts_limit, top_boosts_limit)
  tariffs.developer.mode  ───► tariff_plans [id='developer'].price_mode ('individual' | 'numeric')
  tariffs.developer.value ───► tariff_plans [id='developer'].price (NUMERIC or NULL)
  tariffs.developer.*     ───► tariff_plans [id='developer'] (active_listings_limit, vip_boosts_limit, top_boosts_limit)
  services.vip            ───► service_prices [id='vip'].price
  services.urgent         ───► service_prices [id='urgent'].price
  services.top            ───► service_prices [id='top'].price
  services.instagram      ───► service_prices [id='instagram'].price
```

---

## 8. Проект скрипта переноса данных (Data Migration Script)

По результатам согласования спроектирован сценарий безопасного переноса данных:

### 8.1. Требования к скрипту
1. **Идемпотентность (повторяемость):**  
   Скрипт должен безопасно запускаться любое число раз без дублирования записей и без падений:
   - Для `banners` и `instagram_requests`: вставка через `ON CONFLICT (id) DO UPDATE SET ...`.
   - Для `tariff_plans` и `service_prices`: вставка через `ON CONFLICT (id) DO UPDATE SET ...`.
2. **Режим тестового прогона (`--dry-run`):**  
   Флаг запуска `node scripts/migrate-json-to-tables.mjs --dry-run` скачивает файлы, валидирует их, выводит в консоль подробную статистику (сколько баннеров, заявок и тарифов найдено, какие поля будут вставлены), но **не выполняет никаких изменений в базе данных**.
3. **Сохранность исходных данных:**  
   Скрипт выполняет **только чтение** (`download`) из бакета `app-settings`. Файлы `banners.json`, `instagram-requests.json`, `pricing.json` и сам бакет **не удаляются** и остаются в качестве архивного бэкапа.
4. **Валидация внешних ключей для Instagram заявок:**  
   Если в `instagram-requests.json` встретится запись со старым `listingId` или `userId`, которого уже нет в таблицах `listings` или `users` (например, тестовое объявление было удалено до введения внешнего ключа), скрипт в режиме dry-run предупредит о битой ссылке, а в рабочем режиме пропустит «осиротевшую» запись с записью в лог, чтобы не вызвать ошибку ограничения внешнего ключа.

### 8.2. Шаблон архитектуры скрипта миграции (Design Only)
```javascript
// scripts/migrate-json-to-tables.mjs (Концептуальный проект)
import { supabase } from "../back-end/src/config/db.js";

const isDryRun = process.argv.includes("--dry-run");

async function migrate() {
  console.log(`Starting JSON to Postgres migration [Mode: ${isDryRun ? "DRY-RUN (No DB Writes)" : "LIVE"}]...`);

  // 1. Миграция баннеров
  const banners = await downloadJson("banners.json");
  console.log(`Found ${banners.length} banners in storage.`);
  for (const b of banners) {
    const row = {
      id: b.id,
      title: b.title,
      image_url: b.imageUrl,
      image_position_x: b.imagePositionX ?? 50,
      image_position_y: b.imagePositionY ?? 50,
      link_url: b.link || null,
      start_date: b.startDate,
      end_date: b.endDate || null,
      is_active: b.active ?? true,
      created_at: b.createdAt,
      updated_at: b.updatedAt || b.createdAt,
    };
    if (!isDryRun) {
      await supabase.from("banners").upsert(row, { onConflict: "id" });
    }
  }

  // 2. Миграция заявок Instagram с валидацией внешних ключей
  const requests = await downloadJson("instagram-requests.json");
  console.log(`Found ${requests.length} instagram requests in storage.`);
  for (const r of requests) {
    const row = {
      id: r.id,
      listing_id: r.listingId,
      user_id: r.userId,
      status: r.status || "pending",
      created_at: r.createdAt,
      published_at: r.publishedAt || null,
    };
    if (!isDryRun) {
      await supabase.from("instagram_requests").upsert(row, { onConflict: "id" });
    }
  }

  // 3. Миграция тарифов и расценок
  const pricing = await downloadJson("pricing.json");
  if (pricing) {
    console.log("Migrating pricing settings into tariff_plans and service_prices...");
    // Обработка start, optimal, business, developer и services vip, urgent, top, instagram
    // с выполнением upsert по первичному ключу id.
  }

  console.log("Migration finished successfully. Storage JSON files left intact.");
}
```

---

## 9. Список файлов кода для последующей переработки

При последующей реализации (после утверждения проекта и создания миграции):

### 9.1. Бэкенд (`back-end/src/`)
1. `back-end/src/utils/bannersStore.js`
   - Перевести чтение/запись на `supabase.from("banners")`.
   - Удалить `withWriteLock`, скачивание из `app-settings`.
   - Обеспечить DTO-маппинг (`is_active -> active`, `image_url -> imageUrl`, `link_url -> link`) для 100% совместимости API.
2. `back-end/src/utils/instagramRequests.js`
   - Перевести чтение/запись на `supabase.from("instagram_requests")`.
   - Удалить `withWriteLock`.
3. `back-end/src/controllers/adminController.js`
   - В `listInstagramRequestsAdmin` заменить ресурсоемкую склейку массивов в памяти на быстрый **PostgreSQL JOIN**:
     ```javascript
     const { data } = await supabase
       .from("instagram_requests")
       .select(`
         id, status, created_at, published_at,
         listings (id, title, price, currency, property_type, deal_type, region, city, district, address, rooms, area, promotion_status, is_urgent, listing_photos(url, is_main, display_order)),
         users (id, phone, email, user_profiles(first_name, last_name, company_name))
       `)
       .order("created_at", { ascending: false });
     ```
   - В `getPricing` / `updatePricing` перевести чтение/запись на таблицы `tariff_plans` и `service_prices`.
4. `back-end/src/utils/pricingSettings.js`
   - Заменить чтение/запись файла `pricing.json` на выборку и апдейт строк в `tariff_plans` и `service_prices`.
   - Функция `getPricingSettings()` сохраняет свой возвращаемый формат `{ tariffs: {...}, services: {...} }`, что гарантирует бесперебойную работу `subscriptionsService.js`, `paymentsController.js` и `tariffs.js`.

### 9.2. Фронтенд (`front-end/`)
- **Изменения не требуются (0 файлов).**  
  Благодаря сохранению DTO-интерфейсов контроллеров бэкенда клиентские компоненты (`AdBanner.jsx`, `BannerCard.jsx`, `BannerForm.jsx`, `admin/instagram/page.jsx`, `PricingModal.jsx`, `api.js`) продолжают работать без модификаций.

---

## 10. Риски и открытые вопросы

1. **Предварительное очищение «осиротевших» заявок Instagram:**  
   Если в `instagram-requests.json` есть заявки, ссылающиеся на объявления или пользователей, удаленные из базы в период разработки, скрипт миграции в режиме dry-run выявит их. Их следует отфильтровать перед переносом, так как ограничение внешнего ключа `FOREIGN KEY REFERENCES listings(id)` отклонит вставку с несуществующим ID.
2. **Кэширование на бэкенде:**  
   Поскольку запросы к индексированным таблицам `banners` и `tariff_plans` выполняются за единицы миллисекунд, внутрипроцессное кэширование можно отключить, исключив даже 10-секундное запаздывание при изменении баннеров или тарифов в панели администратора.

---

## 11. Итоговый сводный SQL-скрипт (Проект миграции)

```sql
-- ============================================================================
-- Проект миграции: Перенос banners, instagram_requests, pricing в PostgreSQL
-- ============================================================================

BEGIN;

-- 1. ТАБЛИЦА БАННЕРОВ (BANNERS)
CREATE TABLE IF NOT EXISTS banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    image_url TEXT NOT NULL,
    link_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    views_count INT NOT NULL DEFAULT 0,
    clicks_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_position_x SMALLINT NOT NULL DEFAULT 50 
    CHECK (image_position_x >= 0 AND image_position_x <= 100);
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_position_y SMALLINT NOT NULL DEFAULT 50 
    CHECK (image_position_y >= 0 AND image_position_y <= 100);
ALTER TABLE banners ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_banners_dates_range') THEN
        ALTER TABLE banners ADD CONSTRAINT chk_banners_dates_range 
            CHECK (end_date IS NULL OR end_date >= start_date);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_banners_active_dates ON banners (is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_banners_created_at_desc ON banners (created_at DESC);


-- 2. ТАБЛИЦА ЗАЯВОК НА INSTAGRAM (INSTAGRAM_REQUESTS)
CREATE TABLE IF NOT EXISTS instagram_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'published', 'rejected', 'canceled')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_instagram_requests_status_created ON instagram_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_requests_listing_id ON instagram_requests (listing_id);
CREATE INDEX IF NOT EXISTS idx_instagram_requests_user_id ON instagram_requests (user_id);


-- 3. ТАБЛИЦА ТАРИФНЫХ ПЛАНОВ (TARIFF_PLANS)
CREATE TABLE IF NOT EXISTS tariff_plans (
    id VARCHAR(30) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
    price_mode VARCHAR(20) NOT NULL DEFAULT 'numeric' 
        CHECK (price_mode IN ('numeric', 'individual')),
    active_listings_limit INT NOT NULL DEFAULT 0 CHECK (active_listings_limit >= 0),
    vip_boosts_limit INT NOT NULL DEFAULT 0 CHECK (vip_boosts_limit >= 0),
    top_boosts_limit INT NOT NULL DEFAULT 0 CHECK (top_boosts_limit >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tariff_price_mode CHECK (
        (price_mode = 'numeric' AND price IS NOT NULL) OR
        (price_mode = 'individual')
    )
);

-- 4. ТАБЛИЦА ЦЕН РАЗОВЫХ УСЛУГ (SERVICE_PRICES)
CREATE TABLE IF NOT EXISTS service_prices (
    id VARCHAR(30) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    price_period VARCHAR(20) NOT NULL DEFAULT 'day' 
        CHECK (price_period IN ('day', 'once')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Базовый сид тарифов
INSERT INTO tariff_plans (id, title, price, price_mode, active_listings_limit, vip_boosts_limit, top_boosts_limit, display_order)
VALUES
    ('start', 'СТАРТ', 390.00, 'numeric', 5, 1, 1, 1),
    ('optimal', 'ОПТИМАЛЬНЫЙ', 790.00, 'numeric', 15, 2, 3, 2),
    ('business', 'БИЗНЕС', 1890.00, 'numeric', 50, 5, 10, 3),
    ('developer', 'ЗАСТРОЙЩИК', NULL, 'individual', 100, 10, 20, 4)
ON CONFLICT (id) DO NOTHING;

-- Базовый сид разовых услуг
INSERT INTO service_prices (id, title, price, price_period, display_order)
VALUES
    ('vip', 'VIP', 290.00, 'day', 1),
    ('urgent', 'Срочно', 70.00, 'day', 2),
    ('top', 'ТОП', 190.00, 'day', 3),
    ('instagram', 'Instagram', 390.00, 'once', 4)
ON CONFLICT (id) DO NOTHING;

-- RLS: Эшелонированная защита от прямого внешнего доступа через PostgREST
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_prices ENABLE ROW LEVEL SECURITY;

-- Banners: открыт только публичный просмотр активных
CREATE POLICY "Public read active banners"
ON banners FOR SELECT TO anon, authenticated
USING (is_active = TRUE AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE));

-- Instagram Requests: полностью закрыты от внешнего PostgREST API
-- (запросов без service_role)

-- Tariff Plans & Service Prices: открыт публичный просмотр активных
CREATE POLICY "Public read active tariff plans"
ON tariff_plans FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

CREATE POLICY "Public read active service prices"
ON service_prices FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

COMMIT;
```
