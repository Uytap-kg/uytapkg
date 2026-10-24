-- ============================================================================
-- Migration: 20261025000000_fk_indexes_and_rpc_search_path.sql
-- Purpose (P1-10):
--   1. Add missing B-Tree indexes on foreign keys (ON DELETE CASCADE / SET NULL
--      and frequent JOIN columns) to prevent sequential table scans and locks.
--   2. Lock search_path = public on all SECURITY DEFINER / RPC and trigger
--      functions in public schema.
--   3. Enable RLS and revoke public/anon/authenticated privileges on
--      public._schema_migrations if it exists.
-- ============================================================================

-- 1. Индексы на внешние ключи (Foreign Keys)
CREATE INDEX IF NOT EXISTS idx_listings_user_id ON public.listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_photos_listing_id ON public.listing_photos(listing_id);
CREATE INDEX IF NOT EXISTS idx_favorites_listing_id ON public.favorites(listing_id);
CREATE INDEX IF NOT EXISTS idx_complex_layouts_complex_id ON public.complex_layouts(complex_id);
CREATE INDEX IF NOT EXISTS idx_residential_complexes_developer_id ON public.residential_complexes(developer_id);
CREATE INDEX IF NOT EXISTS idx_verification_requests_user_id ON public.verification_requests(user_id);

-- Индекс на listings.complex_id (если колонка присутствует в схеме) и функциональный индекс по features->>'residentialComplexId'
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'listings'
          AND column_name = 'complex_id'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_listings_complex_id ON public.listings(complex_id)';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_features_complex_id
ON public.listings ((features->>'residentialComplexId'))
WHERE (features ? 'residentialComplexId');

-- 2. Фиксация search_path = public для всех RPC (SECURITY DEFINER) и триггерных функций
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'activate_subscription_atomic') THEN
        ALTER FUNCTION public.activate_subscription_atomic SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'consume_otp_attempt') THEN
        ALTER FUNCTION public.consume_otp_attempt SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_listing_with_limit') THEN
        ALTER FUNCTION public.create_listing_with_limit SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_views') THEN
        ALTER FUNCTION public.increment_views SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refund_tariff_boost_atomic') THEN
        ALTER FUNCTION public.refund_tariff_boost_atomic SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refund_tariff_listing_atomic') THEN
        ALTER FUNCTION public.refund_tariff_listing_atomic SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'register_user') THEN
        ALTER FUNCTION public.register_user SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reclaim_unverified_user') THEN
        ALTER FUNCTION public.reclaim_unverified_user SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_promotion_payment') THEN
        ALTER FUNCTION public.create_promotion_payment SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_banner_stat') THEN
        ALTER FUNCTION public.increment_banner_stat SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_listing_priority_rank') THEN
        ALTER FUNCTION public.update_listing_priority_rank SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_listing_priority_rank') THEN
        ALTER FUNCTION public.sync_listing_priority_rank SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_listing_photos_count') THEN
        ALTER FUNCTION public.update_listing_photos_count SET search_path = public;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_instagram_requests_updated_at') THEN
        ALTER FUNCTION public.set_instagram_requests_updated_at SET search_path = public;
    END IF;
END $$;

-- 3. Защита служебной таблицы миграций public._schema_migrations (если создана через migrate.js)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '_schema_migrations'
    ) THEN
        ALTER TABLE public._schema_migrations ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON TABLE public._schema_migrations FROM PUBLIC, anon, authenticated;
    END IF;
END $$;
