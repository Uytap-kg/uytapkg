-- =======================================================
-- Миграция 004: Атомарная активация подписок и защита от арбитража/гонок
-- =======================================================

-- 1. Таблица для фиксации обработанных платежей подписок (гарантия идемпотентности)
CREATE TABLE IF NOT EXISTS processed_subscription_payments (
    payment_id VARCHAR(64) PRIMARY KEY,
    user_id UUID,
    tariff_id VARCHAR(30),
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processed_sub_payments_user_id ON processed_subscription_payments(user_id);

-- 2. Хранимая функция атомарной активации / продления тарифа
-- с блокировкой FOR UPDATE строки подписки и pg_advisory_xact_lock
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
