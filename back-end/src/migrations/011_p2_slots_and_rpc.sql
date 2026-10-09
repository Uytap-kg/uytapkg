-- =======================================================
-- Миграция 011: Группа P2 — Устойчивость слотов и тарифов (Пункты 11, 12, 13)
-- 1. Атомарное создание объявления с проверкой лимита (RPC create_listing_with_limit)
-- 2. Атомарные и идемпотентные возвраты слотов и поднятий (refund_tariff_listing_atomic, refund_tariff_boost_atomic)
-- 3. Реестр обработанных операций возвратов (processed_refund_operations)
-- =======================================================

-- 0. Гарантия наличия колонки listings_used в таблице subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS listings_used INT NOT NULL DEFAULT 0;

-- =======================================================
-- 1. Таблица фиксации возвратов слотов и поднятий (Идемпотентность, Пункт 12)
-- =======================================================
CREATE TABLE IF NOT EXISTS processed_refund_operations (
    operation_id VARCHAR(128) PRIMARY KEY,
    user_id UUID,
    subscription_id UUID,
    operation_type VARCHAR(50), -- 'listing_refund', 'vip_boost_refund', 'top_boost_refund'
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processed_refund_ops_user_id ON processed_refund_operations(user_id);

-- =======================================================
-- 2. Атомарный возврат слота объявления (Пункт 12)
--    UPDATE subscriptions SET listings_used = GREATEST(listings_used - 1, 0)
--    с защитой от двойного списания через operation_id
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
-- 3. Атомарный возврат VIP/TOP поднятия (Пункт 12)
--    UPDATE subscriptions SET vip_boosts_used = GREATEST(vip_boosts_used - 1, 0)
--    с защитой от двойного списания через operation_id
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
-- 4. Атомарное создание объявления с проверкой лимита (Пункт 11)
--    В одной транзакции:
--    * Advisory lock: PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
--    * Подсчёт реально активных объявлений (status='active' AND (expires_at IS NULL OR expires_at > NOW()));
--    * Проверка лимита (personal: 2, бизнес без тарифа: 0, тариф: лимит тарифа);
--    * Если превышен — откат с RAISE EXCEPTION 'LIMIT_EXCEEDED';
--    * Если не превышен — вставка строки в listings и возврат созданного объявления.
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
