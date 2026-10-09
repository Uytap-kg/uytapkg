-- Migration: 009_token_revocation.sql
-- Отзыв токенов: версионирование токенов пользователей для мгновенной инвалидации сессий
-- (при смене/сбросе пароля, компрометации сессии или вызове logout-all)

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_token_version ON users(id, token_version);
