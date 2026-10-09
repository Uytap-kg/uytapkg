-- Миграция: перенос заказов продвижения и реестра владельцев загрузок из JSON-файлов Storage в БД Postgres
-- Защита от потери и перезаписи данных при параллельных запросах (race condition / in-memory cache desync).

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

CREATE TABLE IF NOT EXISTS upload_ownership (
    object_path TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_ownership_user_id ON upload_ownership(user_id);
