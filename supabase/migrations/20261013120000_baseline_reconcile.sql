-- 20261013120000_baseline_reconcile.sql
-- Идемпотентная миграция согласования (baseline reconcile).
-- Гарантирует наличие всех таблиц, колонок и индексов, необходимых коду UyTap Backend.

-- 1. Таблица payments: колонки выдачи услуг и аренды (lease)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS fulfilling_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS fulfill_attempts INTEGER DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS fulfill_error TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status_fulfilled ON public.payments(status, fulfilled_at);

-- 2. Таблица email_verifications: HMAC хэш кодов и флаг сброса
ALTER TABLE public.email_verifications ADD COLUMN IF NOT EXISTS code_hash CHARACTER VARYING(64);
ALTER TABLE public.email_verifications ADD COLUMN IF NOT EXISTS reset_completed BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_email_verifications_email_type ON public.email_verifications(email, type);

-- 3. Таблица users: версионирование токенов, видимость телефона, подтверждение email
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS show_phone BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone);

-- 4. Таблица promotion_orders (разовые заказы продвижения)
CREATE TABLE IF NOT EXISTS public.promotion_orders (
    order_id CHARACTER VARYING(64) PRIMARY KEY,
    user_id UUID NOT NULL,
    listing_id UUID NOT NULL,
    service_type CHARACTER VARYING(50) NOT NULL,
    days INTEGER NOT NULL,
    status CHARACTER VARYING(20) DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_promotion_orders_user_id ON public.promotion_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_promotion_orders_listing_id ON public.promotion_orders(listing_id);

-- 5. Таблица upload_ownership (учёт владения файлами в хранилище)
CREATE TABLE IF NOT EXISTS public.upload_ownership (
    object_path TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_ownership_user_id ON public.upload_ownership(user_id);

-- 6. Таблицы идемпотентности подписок и возвратов
CREATE TABLE IF NOT EXISTS public.processed_subscription_payments (
    payment_id CHARACTER VARYING(64) PRIMARY KEY,
    user_id UUID,
    tariff_id CHARACTER VARYING(30),
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.processed_refund_operations (
    operation_id CHARACTER VARYING(128) PRIMARY KEY,
    user_id UUID,
    subscription_id UUID,
    operation_type CHARACTER VARYING(50),
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
