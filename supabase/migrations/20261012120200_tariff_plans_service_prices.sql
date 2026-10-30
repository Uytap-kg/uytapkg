-- ============================================================================
-- Миграция: 20261012120200_tariff_plans_service_prices.sql
-- Назначение: Создание справочников тарифных планов платформы (tariff_plans)
--             и стоимости разовых услуг (service_prices), настройка RLS
--             и наполнение значениями по умолчанию строго из кода (pricingSettings.js).
-- Примечание: Внешний ключ из таблицы subscriptions на tariff_plans НЕ добавляется.
-- ============================================================================

-- ============================================================================
-- 1. Таблица тарифных планов (Tariff Plans)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tariff_plans (
    id VARCHAR(30) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2),
    price_mode VARCHAR(20) NOT NULL DEFAULT 'numeric',
    active_listings_limit INT NOT NULL DEFAULT 0,
    vip_boosts_limit INT NOT NULL DEFAULT 0,
    top_boosts_limit INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Добавление проверочных ограничений (CHECK constraints)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tariff_plans_price') THEN
        ALTER TABLE public.tariff_plans ADD CONSTRAINT chk_tariff_plans_price
            CHECK (price IS NULL OR price >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tariff_plans_price_mode') THEN
        ALTER TABLE public.tariff_plans ADD CONSTRAINT chk_tariff_plans_price_mode
            CHECK (price_mode IN ('numeric', 'individual'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tariff_plans_price_consistency') THEN
        ALTER TABLE public.tariff_plans ADD CONSTRAINT chk_tariff_plans_price_consistency
            CHECK (
                (price_mode = 'numeric' AND price IS NOT NULL) OR
                (price_mode = 'individual')
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tariff_plans_limits') THEN
        ALTER TABLE public.tariff_plans ADD CONSTRAINT chk_tariff_plans_limits
            CHECK (
                active_listings_limit >= 0 AND
                vip_boosts_limit >= 0 AND
                top_boosts_limit >= 0
            );
    END IF;
END $$;

-- ============================================================================
-- 2. Таблица цен разовых услуг продвижения (Service Prices)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.service_prices (
    id VARCHAR(30) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    price_period VARCHAR(20) NOT NULL DEFAULT 'day',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_prices_price') THEN
        ALTER TABLE public.service_prices ADD CONSTRAINT chk_service_prices_price
            CHECK (price >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_prices_period') THEN
        ALTER TABLE public.service_prices ADD CONSTRAINT chk_service_prices_period
            CHECK (price_period IN ('day', 'once'));
    END IF;
END $$;

-- ============================================================================
-- 3. Наполнение начальными данными (значения из кода и фронтенда)
-- ============================================================================
-- ИСТОЧНИК ЗНАЧЕНИЙ ЦЕН И ЛИМИТОВ:
--   back-end/src/utils/pricingSettings.js (константа DEFAULT_PRICING):
--     tariffs:
--       start:     { price: 390,  activeListings: 5,   vipLifts: 1,  topLifts: 1  }
--       optimal:   { price: 790,  activeListings: 15,  vipLifts: 2,  topLifts: 3  }
--       business:  { price: 1890, activeListings: 50,  vipLifts: 5,  topLifts: 10 }
--       developer: { mode: "individual", value: null,  activeListings: 100, vipLifts: 10, topLifts: 20 }
--     services:
--       vip:       290
--       urgent:    70
--       top:       190
--       instagram: 390
--
-- ИСТОЧНИК НАЗВАНИЙ (title):
--   В pricingSettings.js названия отсутствуют (там только ключи и числа).
--   Названия взяты из согласованных мест в коде и фронтенде:
--     1. front-end/src/app/admin/payments/PricingModal/PricingModal.jsx:
--        tariffConfig  -> 'СТАРТ', 'ОПТИМАЛЬНЫЙ', 'БИЗНЕС', 'ЗАСТРОЙЩИК'
--        serviceConfig -> 'VIP', 'Срочно', 'ТОП', 'Instagram'
--     2. back-end/src/constants/tariffs.js:
--        getTariff -> title: 'СТАРТ', 'ОПТИМАЛЬНЫЙ', 'БИЗНЕС'
--     3. back-end/src/utils/validation.js:
--        pricingSchema -> 'СТАРТ', 'ОПТИМАЛЬНЫЙ', 'БИЗНЕС', 'ЗАСТРОЙЩИК', 'VIP', 'Срочно', 'ТОП', 'Instagram'
INSERT INTO public.tariff_plans (
    id,
    title,
    price,
    price_mode,
    active_listings_limit,
    vip_boosts_limit,
    top_boosts_limit,
    is_active,
    display_order
)
VALUES
    ('start', 'СТАРТ', 390.00, 'numeric', 5, 1, 1, TRUE, 1),
    ('optimal', 'ОПТИМАЛЬНЫЙ', 790.00, 'numeric', 15, 2, 3, TRUE, 2),
    ('business', 'БИЗНЕС', 1890.00, 'numeric', 50, 5, 10, TRUE, 3),
    ('developer', 'ЗАСТРОЙЩИК', NULL, 'individual', 100, 10, 20, TRUE, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.service_prices (
    id,
    title,
    price,
    price_period,
    is_active,
    display_order
)
VALUES
    ('vip', 'VIP', 290.00, 'day', TRUE, 1),
    ('urgent', 'Срочно', 70.00, 'day', TRUE, 2),
    ('top', 'ТОП', 190.00, 'day', TRUE, 3),
    ('instagram', 'Instagram', 390.00, 'once', TRUE, 4)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. Row Level Security (RLS)
-- ============================================================================
ALTER TABLE public.tariff_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_prices ENABLE ROW LEVEL SECURITY;

-- Публичный просмотр активных тарифов через PostgREST
DROP POLICY IF EXISTS "Public can view active tariff plans" ON public.tariff_plans;
CREATE POLICY "Public can view active tariff plans"
ON public.tariff_plans
FOR SELECT
TO anon, authenticated
USING (is_active = TRUE);

-- Публичный просмотр цен активных разовых услуг через PostgREST
DROP POLICY IF EXISTS "Public can view active service prices" ON public.service_prices;
CREATE POLICY "Public can view active service prices"
ON public.service_prices
FOR SELECT
TO anon, authenticated
USING (is_active = TRUE);
