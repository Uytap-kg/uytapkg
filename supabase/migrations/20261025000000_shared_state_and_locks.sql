-- ============================================================================
-- Migration: 20261025000000_shared_state_and_locks.sql
-- Этап 1: Вынос критичного состояния (сессии SMS OTP, счётчики лимитов и квот,
-- межпроцессные блокировки фоновых задач cron) в PostgreSQL для безопасной
-- работы в многопроцессном режиме (PM2 cluster / несколько контейнеров) и
-- сохранения квот при перезапусках.
-- ============================================================================

-- 1. Таблица сессий телефонных OTP-кодов (phone_otp_sessions)
CREATE TABLE IF NOT EXISTS public.phone_otp_sessions (
    token CHARACTER VARYING(128) PRIMARY KEY,
    phone CHARACTER VARYING(50) NOT NULL,
    code_hash CHARACTER VARYING(64),
    transaction_id CHARACTER VARYING(64),
    purpose CHARACTER VARYING(30) DEFAULT 'verification' NOT NULL,
    attempts INTEGER DEFAULT 0 NOT NULL,
    max_attempts INTEGER DEFAULT 5 NOT NULL,
    verified BOOLEAN DEFAULT FALSE NOT NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    reset_verified BOOLEAN DEFAULT FALSE NOT NULL,
    reset_verified_at TIMESTAMP WITH TIME ZONE,
    used BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_otp_sessions_phone
    ON public.phone_otp_sessions (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_otp_sessions_expires_at
    ON public.phone_otp_sessions (expires_at);

ALTER TABLE public.phone_otp_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_otp_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.phone_otp_sessions TO service_role;

-- Атомарное списание попытки проверки телефонного OTP (аналог consume_otp_attempt)
CREATE OR REPLACE FUNCTION public.consume_phone_otp_attempt(
    p_token CHARACTER VARYING,
    p_max_attempts INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_attempts INTEGER;
BEGIN
    UPDATE public.phone_otp_sessions
    SET attempts = attempts + 1
    WHERE token = p_token
      AND used = FALSE
      AND expires_at > CURRENT_TIMESTAMP
      AND attempts < COALESCE(p_max_attempts, max_attempts, 5)
    RETURNING attempts INTO v_attempts;

    RETURN COALESCE(v_attempts, -1);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_phone_otp_attempt(CHARACTER VARYING, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_phone_otp_attempt(CHARACTER VARYING, INTEGER) TO service_role;

-- 2. Таблица общих счётчиков rate-limit и суточных квот (rate_limit_counters)
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
    key CHARACTER VARYING(255) PRIMARY KEY,
    count INTEGER DEFAULT 1 NOT NULL,
    reset_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_reset_at
    ON public.rate_limit_counters (reset_at);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_counters TO service_role;

-- Атомарная проверка и инкремент счётчика лимита/квоты
-- Если p_increment = 0, выполняет только чтение текущего состояния без инкремента.
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
    p_key CHARACTER VARYING,
    p_window_ms BIGINT,
    p_max_count INTEGER,
    p_increment INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := CURRENT_TIMESTAMP;
    v_new_reset TIMESTAMPTZ := v_now + (p_window_ms || ' milliseconds')::INTERVAL;
    v_row public.rate_limit_counters%ROWTYPE;
    v_retry_sec INTEGER := 0;
BEGIN
    -- Режим только проверки (без инкремента)
    IF p_increment <= 0 THEN
        SELECT * INTO v_row
        FROM public.rate_limit_counters
        WHERE key = p_key;

        IF NOT FOUND OR v_row.reset_at <= v_now THEN
            RETURN jsonb_build_object(
                'allowed', TRUE,
                'count', 0,
                'retry_after_sec', 0,
                'reset_at', v_new_reset
            );
        END IF;

        IF v_row.count >= p_max_count THEN
            v_retry_sec := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_row.reset_at - v_now)))::INTEGER);
            RETURN jsonb_build_object(
                'allowed', FALSE,
                'count', v_row.count,
                'retry_after_sec', v_retry_sec,
                'reset_at', v_row.reset_at
            );
        END IF;

        RETURN jsonb_build_object(
            'allowed', TRUE,
            'count', v_row.count,
            'retry_after_sec', 0,
            'reset_at', v_row.reset_at
        );
    END IF;

    -- Атомарный инкремент с проверкой потолка
    INSERT INTO public.rate_limit_counters (key, count, reset_at, updated_at)
    VALUES (p_key, p_increment, v_new_reset, v_now)
    ON CONFLICT (key) DO UPDATE
    SET count = CASE
            WHEN public.rate_limit_counters.reset_at <= v_now THEN p_increment
            ELSE public.rate_limit_counters.count + p_increment
        END,
        reset_at = CASE
            WHEN public.rate_limit_counters.reset_at <= v_now THEN v_new_reset
            ELSE public.rate_limit_counters.reset_at
        END,
        updated_at = v_now
    WHERE public.rate_limit_counters.reset_at <= v_now
       OR public.rate_limit_counters.count + p_increment <= p_max_count
    RETURNING * INTO v_row;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'allowed', TRUE,
            'count', v_row.count,
            'retry_after_sec', 0,
            'reset_at', v_row.reset_at
        );
    END IF;

    -- Если строка не обновилась — значит лимит уже достигнут
    SELECT * INTO v_row
    FROM public.rate_limit_counters
    WHERE key = p_key;

    v_retry_sec := GREATEST(1, COALESCE(CEIL(EXTRACT(EPOCH FROM (v_row.reset_at - v_now)))::INTEGER, 1));
    RETURN jsonb_build_object(
        'allowed', FALSE,
        'count', COALESCE(v_row.count, p_max_count),
        'retry_after_sec', v_retry_sec,
        'reset_at', COALESCE(v_row.reset_at, v_new_reset)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(CHARACTER VARYING, BIGINT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(CHARACTER VARYING, BIGINT, INTEGER, INTEGER) TO service_role;

-- 3. Таблица межпроцессных блокировок фоновых задач (cron_leases)
-- Работает корректно как через прямое соединение pg.Pool, так и через PgBouncer (Transaction mode) и PostgREST RPC.
CREATE TABLE IF NOT EXISTS public.cron_leases (
    job_name CHARACTER VARYING(100) PRIMARY KEY,
    holder_id CHARACTER VARYING(128) NOT NULL,
    locked_until TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.cron_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_leases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cron_leases TO service_role;

CREATE OR REPLACE FUNCTION public.try_acquire_cron_lease(
    p_job_name CHARACTER VARYING,
    p_holder_id CHARACTER VARYING,
    p_lease_ms BIGINT DEFAULT 600000
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := CURRENT_TIMESTAMP;
    v_until TIMESTAMPTZ := v_now + (p_lease_ms || ' milliseconds')::INTERVAL;
    v_acquired BOOLEAN := FALSE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('cron_lease:' || p_job_name));

    INSERT INTO public.cron_leases (job_name, holder_id, locked_until, updated_at)
    VALUES (p_job_name, p_holder_id, v_until, v_now)
    ON CONFLICT (job_name) DO UPDATE
    SET holder_id = EXCLUDED.holder_id,
        locked_until = EXCLUDED.locked_until,
        updated_at = v_now
    WHERE public.cron_leases.locked_until <= v_now
       OR public.cron_leases.holder_id = p_holder_id;

    GET DIAGNOSTICS v_acquired = ROW_COUNT;
    RETURN v_acquired;
END;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_cron_lease(CHARACTER VARYING, CHARACTER VARYING, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_cron_lease(CHARACTER VARYING, CHARACTER VARYING, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.release_cron_lease(
    p_job_name CHARACTER VARYING,
    p_holder_id CHARACTER VARYING
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_released BOOLEAN := FALSE;
BEGIN
    DELETE FROM public.cron_leases
    WHERE job_name = p_job_name
      AND holder_id = p_holder_id;

    GET DIAGNOSTICS v_released = ROW_COUNT;
    RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_cron_lease(CHARACTER VARYING, CHARACTER VARYING) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_cron_lease(CHARACTER VARYING, CHARACTER VARYING) TO service_role;
