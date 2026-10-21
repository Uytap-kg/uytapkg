-- =======================================================
-- UyTap Database Schema (PostgreSQL / Supabase)
-- Полная схема данных для поддержки всех разделов UyTap
-- =======================================================

-- 1. Таблица пользователей (универсальная аутентификация)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('personal', 'realtor', 'agency', 'developer')),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    show_phone BOOLEAN DEFAULT FALSE,
    token_version INT NOT NULL DEFAULT 0,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Таблица детальных профилей пользователей
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company_name VARCHAR(255),
    inn VARCHAR(50),
    office_address TEXT,
    about TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Таблица заявок на верификацию продавцов
CREATE TABLE IF NOT EXISTS verification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    passport_front TEXT NOT NULL,
    passport_back TEXT,
    reject_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Единая таблица объявлений (Listings)
CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    property_type VARCHAR(50) NOT NULL CHECK (property_type IN ('apartment', 'house', 'land', 'commercial', 'room', 'garage')),
    deal_type VARCHAR(20) NOT NULL CHECK (deal_type IN ('sale', 'rent')),
    rent_period VARCHAR(20) CHECK (rent_period IN ('hourly', 'daily', 'weekly', 'monthly', 'long_term')),
    
    -- Иерархическая локация
    region VARCHAR(100) NOT NULL,
    city VARCHAR(100),
    district VARCHAR(100),
    microdistrict VARCHAR(100),
    address TEXT,
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    
    -- Характеристики
    price NUMERIC(14, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'KGS' CHECK (currency IN ('KGS', 'USD')),
    area NUMERIC(10, 2),
    rooms INT,
    floor INT,
    total_floors INT,
    
    -- Флаг Иссык-Куля и курортные фильтры
    is_resort BOOLEAN DEFAULT FALSE,
    resort_filters JSONB DEFAULT '{}'::jsonb,
    features JSONB DEFAULT '{}'::jsonb,
    
    -- Статусы
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'draft', 'moderation')),
    promotion_status VARCHAR(20) DEFAULT 'regular' CHECK (promotion_status IN ('regular', 'vip', 'top')),
    promotion_expires_at TIMESTAMP WITH TIME ZONE,
    is_urgent BOOLEAN DEFAULT FALSE,
    urgent_expires_at TIMESTAMP WITH TIME ZONE,
    priority_rank INT DEFAULT 3 NOT NULL,
    photos_count INT DEFAULT 0 NOT NULL,
    views_count INT DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '40 days'),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Фотографии объявлений
CREATE TABLE IF NOT EXISTS listing_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    is_main BOOLEAN DEFAULT FALSE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Застройщики
CREATE TABLE IF NOT EXISTS developers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    company_name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    description TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    website TEXT,
    registry_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Жилые Комплексы (ЖК)
CREATE TABLE IF NOT EXISTS residential_complexes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    country VARCHAR(50) DEFAULT 'kyrgyzstan',
    region VARCHAR(100) NOT NULL,
    city VARCHAR(100),
    district VARCHAR(100),
    address TEXT,
    completion_status VARCHAR(50) CHECK (completion_status IN ('building', 'completed')),
    completion_date VARCHAR(50),
    housing_class VARCHAR(50),
    registry_link TEXT,
    cover_photo TEXT,
    features JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Планировки и квартиры в ЖК
CREATE TABLE IF NOT EXISTS complex_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complex_id UUID NOT NULL REFERENCES residential_complexes(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    rooms INT NOT NULL,
    area NUMERIC(10, 2) NOT NULL,
    price NUMERIC(14, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'sold', 'reserved')),
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Избранное
CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, listing_id)
);

-- 10. Рекламные баннеры
CREATE TABLE IF NOT EXISTS banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    image_url TEXT NOT NULL,
    link_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    views_count INT DEFAULT 0,
    clicks_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. Тарифные подписки пользователей (активный PRO-тариф)
-- Хранит и дефолтные тарифы (start/optimal/business, купленные через
-- оплату), и индивидуальные тарифы (выданные админом вручную) —
-- см. controllers/tariffsController.js. У пользователя одновременно
-- может быть только один тариф (UNIQUE(user_id)).
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tariff_id VARCHAR(30) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Индивидуальный тариф: выдан вручную одному пользователю (оплата по
    -- реквизитам, вне платёжной системы), со своим названием и лимитами.
    is_individual BOOLEAN NOT NULL DEFAULT FALSE,
    custom_name VARCHAR(100),
    active_listings_limit INT,
    vip_boosts_limit INT,
    top_boosts_limit INT,
    -- Сколько обычных объявлений уже списано по тарифу в текущем периоде (одноразовый расход слота).
    -- Не возвращается при удалении объявления.
    listings_used INT NOT NULL DEFAULT 0,
    -- Сколько VIP/TOP-поднятий уже списано в текущем периоде — см.
    -- services/subscriptionsService.js consumeTariffBoost(). Обнуляется
    -- при каждой новой оплате/выдаче тарифа.
    vip_boosts_used INT NOT NULL DEFAULT 0,
    top_boosts_used INT NOT NULL DEFAULT 0,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_is_individual ON subscriptions(is_individual);

-- 13. Платежи через O!Dengi (QR Pay)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id VARCHAR(64) UNIQUE NOT NULL,
    invoice_id VARCHAR(20),
    trans_id VARCHAR(20),
    tariff_id VARCHAR(30) NOT NULL,
    months INT NOT NULL,
    amount INT NOT NULL, -- сумма в копейках (100 = 1.00 сом)
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'approved', 'canceled', 'failed')),
    qr_url TEXT,
    paylink_url TEXT,
    link_app TEXT,
    provider_response JSONB,
    paid_at TIMESTAMP WITH TIME ZONE,
    fulfilled_at TIMESTAMP WITH TIME ZONE,
    fulfill_attempts INT DEFAULT 0,
    fulfill_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfill_attempts INT DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfill_error TEXT;
CREATE INDEX IF NOT EXISTS idx_payments_approved_unfulfilled ON payments(status, fulfilled_at) WHERE status = 'approved' AND fulfilled_at IS NULL;

-- 14. Юристы (раздел «Юристы», управляется из админ-панели)
CREATE TABLE IF NOT EXISTS lawyers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    last_name VARCHAR(100) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    specialization VARCHAR(255) NOT NULL,
    experience VARCHAR(50) NOT NULL,
    phone VARCHAR(50),
    whatsapp VARCHAR(50),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lawyers_is_active ON lawyers(is_active);

-- 11. Индексы для сверхбыстрого поиска
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_token_version ON users(id, token_version);
CREATE INDEX IF NOT EXISTS idx_listings_region ON listings(region);
CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings(property_type);
CREATE INDEX IF NOT EXISTS idx_listings_promotion ON listings(promotion_status);
CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_residential_complexes_location ON residential_complexes(country, city, district);
CREATE INDEX IF NOT EXISTS idx_residential_complexes_created_at ON residential_complexes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_residential_complexes_dev_created ON residential_complexes(developer_id, created_at DESC);

-- Отзыв токенов (Token Revocation)
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

-- Добавление колонки срока жизни объявления (40 дней)
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE 
DEFAULT (CURRENT_TIMESTAMP + INTERVAL '40 days');

-- Заполнение для всех существующих объявлений
UPDATE listings 
SET expires_at = created_at + INTERVAL '40 days' 
WHERE expires_at IS NULL;

-- Составной индекс для быстрой фильтрации активных неистёкших объявлений
CREATE INDEX IF NOT EXISTS idx_listings_active_expires 
ON listings(status, expires_at);

-- Колонки и индексы сроков продвижения (VIP/ТОП/Срочно)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS promotion_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS urgent_expires_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_listings_promotion_expires ON listings(promotion_status, promotion_expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_urgent_expires ON listings(is_urgent, urgent_expires_at);

-- Миграция данных из features
UPDATE listings 
SET promotion_expires_at = (features->>'promotionExpiresAt')::timestamptz
WHERE features ? 'promotionExpiresAt' AND promotion_expires_at IS NULL;

UPDATE listings 
SET urgent_expires_at = (features->>'urgentExpiresAt')::timestamptz
WHERE features ? 'urgentExpiresAt' AND urgent_expires_at IS NULL;

-- Колонки и индексы приоритета и фотографий (Дефект 1.1)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS priority_rank INT DEFAULT 3 NOT NULL;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS photos_count INT DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_active_prio ON listings(status, priority_rank ASC, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_listings_photos_count ON listings(photos_count);

-- Триггер для расчета priority_rank
CREATE OR REPLACE FUNCTION update_listing_priority_rank()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.promotion_status = 'vip' AND (NEW.promotion_expires_at IS NULL OR NEW.promotion_expires_at > CURRENT_TIMESTAMP) THEN
    NEW.priority_rank := 0;
  ELSIF NEW.is_urgent = TRUE AND (NEW.urgent_expires_at IS NULL OR NEW.urgent_expires_at > CURRENT_TIMESTAMP) THEN
    NEW.priority_rank := 1;
  ELSIF NEW.promotion_status = 'top' AND (NEW.promotion_expires_at IS NULL OR NEW.promotion_expires_at > CURRENT_TIMESTAMP) THEN
    NEW.priority_rank := 2;
  ELSE
    NEW.priority_rank := 3;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_priority_rank ON listings;
CREATE TRIGGER trg_listing_priority_rank
BEFORE INSERT OR UPDATE OF promotion_status, promotion_expires_at, is_urgent, urgent_expires_at
ON listings
FOR EACH ROW EXECUTE FUNCTION update_listing_priority_rank();

-- Триггеры для поддержания photos_count
CREATE OR REPLACE FUNCTION update_listing_photos_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE listings SET photos_count = photos_count + 1 WHERE id = NEW.listing_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE listings SET photos_count = GREATEST(0, photos_count - 1) WHERE id = OLD.listing_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
      UPDATE listings SET photos_count = GREATEST(0, photos_count - 1) WHERE id = OLD.listing_id;
      UPDATE listings SET photos_count = photos_count + 1 WHERE id = NEW.listing_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_photos_count ON listing_photos;
CREATE TRIGGER trg_listing_photos_count
AFTER INSERT OR DELETE OR UPDATE OF listing_id
ON listing_photos
FOR EACH ROW EXECUTE FUNCTION update_listing_photos_count();

-- Оптимизация поиска через триграммные GIN-индексы (Дефект 2.3)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_listings_city_trgm ON listings USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_district_trgm ON listings USING gin (district gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_region_trgm ON listings USING gin (region gin_trgm_ops);

-- ============================================================
-- Storage (аватарки): создать вручную в Supabase Dashboard
-- Storage → New bucket → имя: avatars → Public bucket: ON
-- Путь файлов: avatars/{userId}/{timestamp}.{ext}
-- URL пишется в user_profiles.avatar_url
-- ============================================================


-- =======================================================
-- Подтверждение email через OTP
-- =======================================================
CREATE TABLE IF NOT EXISTS email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6),
    code_hash VARCHAR(64),
    type VARCHAR(30) NOT NULL CHECK (type IN ('registration', 'password_reset')),
    attempts INT DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    reset_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_lookup
ON email_verifications(email, type, is_used, expires_at);

ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS code_hash VARCHAR(64);
ALTER TABLE email_verifications ALTER COLUMN code DROP NOT NULL;
ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS reset_completed BOOLEAN DEFAULT FALSE;

-- Функция атомарного инкремента попыток ввода OTP ДО проверки кода (защита от race condition и брутфорса)
CREATE OR REPLACE FUNCTION consume_otp_attempt(p_id UUID)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
    v_attempts INT;
BEGIN
    UPDATE email_verifications
    SET attempts = attempts + 1
    WHERE id = p_id AND is_used = false AND attempts < 5
    RETURNING attempts INTO v_attempts;
    RETURN COALESCE(v_attempts, -1);
END;
$$;

-- Колонка подтверждения email. Если колонки ещё не было, все УЖЕ существующие
-- пользователи считаются подтверждёнными (иначе они потеряют возможность входа).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'is_email_verified'
    ) THEN
        ALTER TABLE users ADD COLUMN is_email_verified BOOLEAN DEFAULT FALSE;
        UPDATE users SET is_email_verified = TRUE;
    END IF;
END $$;

-- =======================================================
-- 15. Заказы продвижения (Promotion Orders)
-- =======================================================
CREATE TABLE IF NOT EXISTS promotion_orders (
    order_id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    service_type VARCHAR(50) NOT NULL,
    days INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_promotion_orders_user_id ON promotion_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_promotion_orders_listing_id ON promotion_orders(listing_id);

-- =======================================================
-- 16. Реестр владельцев загрузок (Upload Ownership)
-- =======================================================
CREATE TABLE IF NOT EXISTS upload_ownership (
    object_path TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_ownership_user_id ON upload_ownership(user_id);

-- =======================================================
-- 17. Обработанные платежи подписок (Идемпотентность)
-- =======================================================
CREATE TABLE IF NOT EXISTS processed_subscription_payments (
    payment_id VARCHAR(64) PRIMARY KEY,
    user_id UUID,
    tariff_id VARCHAR(30),
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processed_sub_payments_user_id ON processed_subscription_payments(user_id);

-- =======================================================
-- 18. Атомарная активация/продление подписки с защитой от гонок и арбитража
-- =======================================================
CREATE OR REPLACE FUNCTION activate_subscription_atomic(
    p_user_id UUID,
    p_tariff_id VARCHAR,
    p_days INT,
    p_payment_id VARCHAR DEFAULT NULL
)
RETURNS subscriptions
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing subscriptions%ROWTYPE;
    v_result subscriptions%ROWTYPE;
    v_new_expires_at TIMESTAMPTZ;
BEGIN
    -- 1. Гарантия идемпотентности по p_payment_id
    IF p_payment_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM processed_subscription_payments WHERE payment_id = p_payment_id) THEN
            SELECT * INTO v_result FROM subscriptions WHERE user_id = p_user_id;
            RETURN v_result;
        END IF;
    END IF;

    -- 2. Транзакционная блокировка на уровне пользователя для защиты от гонок
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    -- 3. FOR UPDATE блокировка существующей строки подписки
    SELECT * INTO v_existing
    FROM subscriptions
    WHERE user_id = p_user_id
    FOR UPDATE;

    -- 4. Защита активной индивидуальной подписки:
    -- Нельзя затереть выданный администратором корпоративный/индивидуальный тариф
    IF v_existing.id IS NOT NULL 
       AND v_existing.is_individual = TRUE 
       AND v_existing.is_active = TRUE 
       AND v_existing.expires_at > CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'У вас активен персональный корпоративный тариф. Для смены тарифа обратитесь к администратору'
            USING ERRCODE = 'P0001';
    END IF;

    -- 5. Накопительное продление сроков:
    -- Если тариф тот же — прибавляем дни к текущему сроку окончания.
    -- Если тариф другой (или подписка истекла) — дни отсчитываются от CURRENT_TIMESTAMP.
    IF v_existing.id IS NOT NULL AND v_existing.expires_at > CURRENT_TIMESTAMP THEN
        IF v_existing.tariff_id = p_tariff_id THEN
            v_new_expires_at := v_existing.expires_at + (p_days || ' days')::INTERVAL;
        ELSE
            v_new_expires_at := CURRENT_TIMESTAMP + (p_days || ' days')::INTERVAL;
        END IF;
    ELSE
        v_new_expires_at := CURRENT_TIMESTAMP + (p_days || ' days')::INTERVAL;
    END IF;

    -- 6. Атомарный upsert подписки
    INSERT INTO subscriptions (
        user_id,
        tariff_id,
        started_at,
        expires_at,
        is_active,
        is_individual,
        custom_name,
        active_listings_limit,
        vip_boosts_limit,
        top_boosts_limit,
        listings_used,
        vip_boosts_used,
        top_boosts_used,
        updated_at
    ) VALUES (
        p_user_id,
        p_tariff_id,
        COALESCE(v_existing.started_at, CURRENT_TIMESTAMP),
        v_new_expires_at,
        TRUE,
        FALSE,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        0,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id) DO UPDATE SET
        tariff_id = p_tariff_id,
        expires_at = v_new_expires_at,
        is_active = TRUE,
        is_individual = FALSE,
        custom_name = NULL,
        active_listings_limit = NULL,
        vip_boosts_limit = NULL,
        top_boosts_limit = NULL,
        listings_used = 0,
        vip_boosts_used = 0,
        top_boosts_used = 0,
        updated_at = CURRENT_TIMESTAMP
    RETURNING * INTO v_result;

    -- 7. Фиксация обработанного платежа для предотвращения повторной обработки
    IF p_payment_id IS NOT NULL THEN
        INSERT INTO processed_subscription_payments (
            payment_id,
            user_id,
            tariff_id,
            processed_at
        ) VALUES (
            p_payment_id,
            p_user_id,
            p_tariff_id,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (payment_id) DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;

-- 19. Атомарное инкрементирование просмотров объявления
CREATE OR REPLACE FUNCTION increment_views(listing_id UUID)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_views INT;
BEGIN
    UPDATE listings
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = listing_id
    RETURNING views_count INTO v_views;

    RETURN COALESCE(v_views, 0);
END;
$$;

-- =======================================================
-- 20. Реестр обработанных операций возвратов (Идемпотентность, Пункт 12)
-- =======================================================
CREATE TABLE IF NOT EXISTS processed_refund_operations (
    operation_id VARCHAR(128) PRIMARY KEY,
    user_id UUID,
    subscription_id UUID,
    operation_type VARCHAR(50),
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processed_refund_ops_user_id ON processed_refund_operations(user_id);

-- =======================================================
-- 21. Атомарный возврат слота объявления (Пункт 12)
-- =======================================================
CREATE OR REPLACE FUNCTION refund_tariff_listing_atomic(
    p_user_id UUID,
    p_operation_id VARCHAR DEFAULT NULL,
    p_subscription_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_sub_id UUID := p_subscription_id;
BEGIN
    -- 1. Проверка идемпотентности по operation_id
    IF p_operation_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM processed_refund_operations WHERE operation_id = p_operation_id) THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 2. Если ID подписки не передан, находим её по user_id
    IF v_sub_id IS NULL THEN
        SELECT id INTO v_sub_id
        FROM subscriptions
        WHERE user_id = p_user_id
          AND is_active = TRUE
          AND expires_at > CURRENT_TIMESTAMP;

        IF v_sub_id IS NULL THEN
            SELECT id INTO v_sub_id
            FROM subscriptions
            WHERE user_id = p_user_id
            ORDER BY updated_at DESC
            LIMIT 1;
        END IF;
    END IF;

    IF v_sub_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 3. Атомарный SQL-запрос для исключения гонки read-modify-write
    UPDATE subscriptions
    SET listings_used = GREATEST(listings_used - 1, 0),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_sub_id;

    -- 4. Фиксация обработанной операции возврата
    IF p_operation_id IS NOT NULL THEN
        INSERT INTO processed_refund_operations (
            operation_id,
            user_id,
            subscription_id,
            operation_type,
            processed_at
        ) VALUES (
            p_operation_id,
            p_user_id,
            v_sub_id,
            'listing_refund',
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (operation_id) DO NOTHING;
    END IF;

    RETURN TRUE;
END;
$$;

-- =======================================================
-- 22. Атомарный возврат VIP/TOP поднятия (Пункт 12)
-- =======================================================
CREATE OR REPLACE FUNCTION refund_tariff_boost_atomic(
    p_user_id UUID,
    p_boost_type VARCHAR,
    p_operation_id VARCHAR DEFAULT NULL,
    p_subscription_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_sub_id UUID := p_subscription_id;
BEGIN
    -- 1. Проверка идемпотентности по operation_id
    IF p_operation_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM processed_refund_operations WHERE operation_id = p_operation_id) THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 2. Если ID подписки не передан, находим её по user_id
    IF v_sub_id IS NULL THEN
        SELECT id INTO v_sub_id
        FROM subscriptions
        WHERE user_id = p_user_id
          AND is_active = TRUE
          AND expires_at > CURRENT_TIMESTAMP;

        IF v_sub_id IS NULL THEN
            SELECT id INTO v_sub_id
            FROM subscriptions
            WHERE user_id = p_user_id
            ORDER BY updated_at DESC
            LIMIT 1;
        END IF;
    END IF;

    IF v_sub_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 3. Атомарный SQL-запрос обновления счётчика
    IF p_boost_type = 'vip' THEN
        UPDATE subscriptions
        SET vip_boosts_used = GREATEST(vip_boosts_used - 1, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_sub_id;
    ELSIF p_boost_type = 'top' THEN
        UPDATE subscriptions
        SET top_boosts_used = GREATEST(top_boosts_used - 1, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_sub_id;
    ELSE
        RETURN FALSE;
    END IF;

    -- 4. Фиксация в таблице идемпотентности
    IF p_operation_id IS NOT NULL THEN
        INSERT INTO processed_refund_operations (
            operation_id,
            user_id,
            subscription_id,
            operation_type,
            processed_at
        ) VALUES (
            p_operation_id,
            p_user_id,
            v_sub_id,
            p_boost_type || '_boost_refund',
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (operation_id) DO NOTHING;
    END IF;

    RETURN TRUE;
END;
$$;

-- =======================================================
-- 23. Атомарное создание объявления с проверкой лимита (Пункт 11)
-- =======================================================
CREATE OR REPLACE FUNCTION create_listing_with_limit(
    p_user_id UUID,
    p_listing_data JSONB,
    p_limit INT DEFAULT NULL
)
RETURNS listings
LANGUAGE plpgsql
AS $$
DECLARE
    v_active_count INT;
    v_limit INT;
    v_account_type VARCHAR(20);
    v_subscription subscriptions%ROWTYPE;
    v_new_listing listings%ROWTYPE;
    v_initial_status VARCHAR(20);
BEGIN
    -- 1. Транзакционная блокировка advisory lock для предотвращения гонок создания
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    v_initial_status := COALESCE(p_listing_data->>'status', 'active');

    -- Проверяем лимит только если создаваемое объявление публикуется в статусе "active"
    IF v_initial_status = 'active' THEN
        -- 2. Подсчёт реально активных неистёкших объявлений пользователя
        SELECT COUNT(*)
        INTO v_active_count
        FROM listings
        WHERE user_id = p_user_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP);

        -- Ищем действующую подписку
        SELECT * INTO v_subscription
        FROM subscriptions
        WHERE user_id = p_user_id
          AND is_active = TRUE
          AND expires_at > CURRENT_TIMESTAMP;

        -- 3. Определение лимита пользователя
        IF p_limit IS NOT NULL THEN
            v_limit := p_limit;
        ELSIF v_subscription.id IS NOT NULL THEN
            IF v_subscription.is_individual = TRUE THEN
                v_limit := COALESCE(v_subscription.active_listings_limit, 0);
            ELSE
                CASE v_subscription.tariff_id
                    WHEN 'start' THEN v_limit := 5;
                    WHEN 'optimal' THEN v_limit := 15;
                    WHEN 'business' THEN v_limit := 50;
                    WHEN 'developer' THEN v_limit := 100;
                    ELSE v_limit := COALESCE(v_subscription.active_listings_limit, 0);
                END CASE;
            END IF;
        ELSE
            SELECT account_type INTO v_account_type
            FROM users
            WHERE id = p_user_id;

            IF v_account_type = 'personal' THEN
                v_limit := 2; -- Личный продавец без тарифа: максимум 2 бесплатных объявления
            ELSE
                v_limit := 0; -- Бизнес (agency/developer/realtor) без тарифа: 0 бесплатных объявлений
            END IF;
        END IF;

        -- 4. Если лимит превышен — откат транзакции с исключением 'LIMIT_EXCEEDED'
        IF v_active_count >= v_limit THEN
            RAISE EXCEPTION 'LIMIT_EXCEEDED'
                USING ERRCODE = 'P0002',
                      DETAIL = format('User %s exceeded active listings limit: %s of %s', p_user_id, v_active_count, v_limit);
        END IF;

        -- Если у пользователя есть тариф — атомарно проверяем listings_used и списываем слот
        IF v_subscription.id IS NOT NULL THEN
            IF v_subscription.listings_used >= v_limit THEN
                RAISE EXCEPTION 'LIMIT_EXCEEDED'
                    USING ERRCODE = 'P0002',
                          DETAIL = format('User %s exhausted subscription listings_used: %s of %s', p_user_id, v_subscription.listings_used, v_limit);
            END IF;

            UPDATE subscriptions
            SET listings_used = listings_used + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_subscription.id;
        END IF;
    END IF;

    -- 5. Если лимит не превышен — вставка строки в listings и возврат созданного объявления
    INSERT INTO listings (
        user_id,
        title,
        description,
        property_type,
        deal_type,
        rent_period,
        region,
        city,
        district,
        microdistrict,
        address,
        latitude,
        longitude,
        price,
        currency,
        area,
        rooms,
        floor,
        total_floors,
        is_resort,
        resort_filters,
        features,
        status,
        promotion_status,
        promotion_expires_at,
        is_urgent,
        urgent_expires_at,
        expires_at
    ) VALUES (
        p_user_id,
        p_listing_data->>'title',
        p_listing_data->>'description',
        COALESCE(p_listing_data->>'property_type', p_listing_data->>'propertyType'),
        COALESCE(p_listing_data->>'deal_type', p_listing_data->>'dealType'),
        COALESCE(p_listing_data->>'rent_period', p_listing_data->>'rentPeriod'),
        p_listing_data->>'region',
        p_listing_data->>'city',
        p_listing_data->>'district',
        p_listing_data->>'microdistrict',
        p_listing_data->>'address',
        NULLIF(p_listing_data->>'latitude', '')::NUMERIC,
        NULLIF(p_listing_data->>'longitude', '')::NUMERIC,
        NULLIF(p_listing_data->>'price', '')::NUMERIC,
        COALESCE(p_listing_data->>'currency', 'KGS'),
        NULLIF(p_listing_data->>'area', '')::NUMERIC,
        NULLIF(p_listing_data->>'rooms', '')::INT,
        NULLIF(p_listing_data->>'floor', '')::INT,
        NULLIF(COALESCE(p_listing_data->>'total_floors', p_listing_data->>'totalFloors'), '')::INT,
        COALESCE(NULLIF(COALESCE(p_listing_data->>'is_resort', p_listing_data->>'isResort'), '')::BOOLEAN, FALSE),
        COALESCE(p_listing_data->'resort_filters', p_listing_data->'resortFilters', '{}'::JSONB),
        COALESCE(p_listing_data->'features', '{}'::JSONB),
        v_initial_status,
        COALESCE(p_listing_data->>'promotion_status', p_listing_data->>'promotionStatus', 'regular'),
        NULLIF(COALESCE(p_listing_data->>'promotion_expires_at', p_listing_data->>'promotionExpiresAt'), '')::TIMESTAMPTZ,
        COALESCE(NULLIF(COALESCE(p_listing_data->>'is_urgent', p_listing_data->>'isUrgent'), '')::BOOLEAN, FALSE),
        NULLIF(COALESCE(p_listing_data->>'urgent_expires_at', p_listing_data->>'urgentExpiresAt'), '')::TIMESTAMPTZ,
        COALESCE(NULLIF(COALESCE(p_listing_data->>'expires_at', p_listing_data->>'expiresAt'), '')::TIMESTAMPTZ, CURRENT_TIMESTAMP + INTERVAL '40 days')
    )
    RETURNING * INTO v_new_listing;

    RETURN v_new_listing;
END;
$$;