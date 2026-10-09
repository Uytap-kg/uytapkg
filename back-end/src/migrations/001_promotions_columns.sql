-- Migration: 001_promotions_columns.sql
-- Перенос сроков продвижения (promotion_expires_at, urgent_expires_at) из features в отдельные колонки listings

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
