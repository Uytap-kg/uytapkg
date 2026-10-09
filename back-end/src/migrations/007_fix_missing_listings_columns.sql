-- =======================================================
-- Миграция: исправление недостающих колонок и таблиц в БД Supabase
-- Устраняет ошибки:
--   - "column listings.expires_at does not exist"
--   - "column listings.promotion_expires_at does not exist"
--   - "column listings.urgent_expires_at does not exist"
--   - "Could not find the table 'public.upload_ownership'"
--   - "Could not find the table 'public.promotion_orders'"
-- =======================================================

-- 1. Срок жизни объявлений (40 дней)
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE 
DEFAULT (CURRENT_TIMESTAMP + INTERVAL '40 days');

UPDATE listings 
SET expires_at = created_at + INTERVAL '40 days' 
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_listings_active_expires 
ON listings(status, expires_at);

-- 2. Сроки платного продвижения (VIP / ТОП / Срочно)
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS promotion_expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS urgent_expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_listings_promotion_expires 
ON listings(promotion_status, promotion_expires_at);

CREATE INDEX IF NOT EXISTS idx_listings_urgent_expires 
ON listings(is_urgent, urgent_expires_at);

-- Перенос дат из features для уже существующих записей
UPDATE listings 
SET promotion_expires_at = (features->>'promotionExpiresAt')::timestamptz
WHERE features ? 'promotionExpiresAt' AND promotion_expires_at IS NULL;

UPDATE listings 
SET urgent_expires_at = (features->>'urgentExpiresAt')::timestamptz
WHERE features ? 'urgentExpiresAt' AND urgent_expires_at IS NULL;

-- 3. Заказы платного продвижения (Promotion Orders)
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

-- 4. Реестр владельцев загруженных файлов (Upload Ownership)
CREATE TABLE IF NOT EXISTS upload_ownership (
    object_path TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_ownership_user_id ON upload_ownership(user_id);
