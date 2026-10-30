-- =======================================================
-- Migration: 20261013000001_search_indexes_and_cleanup.sql
-- Дефекты 2.3 и 3.1: Триграммные индексы поиска и процедура очистки
-- =======================================================

-- 1. Подключение расширения pg_trgm
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Триграммные GIN-индексы для ускорения поиска по гео-локациям
CREATE INDEX IF NOT EXISTS idx_listings_city_trgm ON listings USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_district_trgm ON listings USING gin (district gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_region_trgm ON listings USING gin (region gin_trgm_ops);
