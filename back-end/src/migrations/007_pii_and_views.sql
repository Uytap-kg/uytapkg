-- =======================================================
-- Миграция 007: Защита PII и безопасный учёт просмотров объявлений
-- Устраняет уязвимости пункта 7 ТЗ:
--   1. Утечка черновиков и чужих объявлений (IDOR в getListingById)
--   2. Утечка e-mail и телефонов частных продавцов (personal)
--   3. Накрутка просмотров авторами и ботами (атомарный increment_views и антиспам)
-- =======================================================

-- 1. Флаг показа номера телефона в публичных карточках для частных продавцов
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_phone BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN users.show_phone IS 'Флаг явного согласия частного продавца (personal) на показ номера телефона в публичной карточке';

-- 2. Атомарная функция инкрементирования просмотров объявления в Postgres
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
