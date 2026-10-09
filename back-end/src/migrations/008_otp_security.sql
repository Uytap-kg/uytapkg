-- =======================================================
-- Миграция 008: Безопасность OTP (HMAC-SHA256 и атомарный инкремент попыток)
-- =======================================================

-- 1. Добавление колонки code_hash для хранения HMAC-SHA256 хэша OTP кода
ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS code_hash VARCHAR(64);

-- 2. Делаем исходную колонку code nullable, так как открытый код больше не хранится в БД
ALTER TABLE email_verifications ALTER COLUMN code DROP NOT NULL;

-- 3. Добавление колонки reset_completed для защиты от повторного использования токена сброса пароля
ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS reset_completed BOOLEAN DEFAULT FALSE;

-- 4. Создание Postgres-функции для атомарного инкремента попыток ДО проверки:
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
