-- =======================================================
-- Migration: 20261017000000_search_title_trgm_index.sql
-- Фаза 1: Триграммный GIN-индекс для серверного поиска по заголовку
-- =======================================================

-- 1. Убеждаемся, что расширение pg_trgm подключено
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Триграммный GIN-индекс для быстрого поиска по заголовку объявления (ILIKE %term%)
-- Поля city, district и region уже проиндексированы в 20261013000001_search_indexes_and_cleanup.sql
CREATE INDEX IF NOT EXISTS idx_listings_title_trgm ON listings USING gin (title gin_trgm_ops);
