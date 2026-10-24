-- ============================================================================
-- Migration: 20261025020000_load_indexes_and_batch_counters.sql
-- Stage 3: Production Load Hardening — Missing Indexes & Batch Counter RPCs
--
-- 1. Trigram GIN indexes on listings.description and features->>'residentialComplexName'
--    so multi-column OR ILIKE search in applyListingFilters uses BitmapOr Index Scan
--    instead of a full Sequential Scan.
-- 2. Composite B-Tree partial indexes for catalog pagination, map bbox, user profile
--    ads, and active/pending payment lookups.
-- 3. Batch counter increment RPCs (increment_views_batch, increment_banner_stats_batch)
--    to eliminate hot-row lock contention on listings and banners under traffic spikes.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Недостающие триграммные индексы для полнотекстового OR ILIKE поиска в каталоге
CREATE INDEX IF NOT EXISTS idx_listings_description_trgm
    ON public.listings USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_listings_complex_name_trgm
    ON public.listings USING gin ((features->>'residentialComplexName') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_phone_trgm
    ON public.users USING gin (phone gin_trgm_ops);

-- 2. Составные и частичные B-Tree индексы для горячих публичных и платёжных запросов
CREATE INDEX IF NOT EXISTS idx_listings_active_priority_created
    ON public.listings (priority_rank ASC, created_at DESC, id ASC)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_listings_user_status_created
    ON public.listings (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listings_map_bbox
    ON public.listings (latitude, longitude)
    WHERE status = 'active' AND latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_user_status_created
    ON public.payments (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active
    ON public.subscriptions (user_id, is_active, expires_at);

CREATE INDEX IF NOT EXISTS idx_favorites_user_created
    ON public.favorites (user_id, created_at DESC);

-- 3. Пакетное обновление счётчиков просмотров объявлений (снижение нагрузки на горячие строки)
-- Принимает p_deltas вида: {"<listing_uuid>": 5, "<listing_uuid_2>": 12}
CREATE OR REPLACE FUNCTION public.increment_views_batch(
    p_deltas JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER := 0;
BEGIN
    IF p_deltas IS NULL OR jsonb_typeof(p_deltas) <> 'object' THEN
        RETURN 0;
    END IF;

    WITH deltas AS (
        SELECT
            (key)::UUID AS listing_id,
            GREATEST(0, (value #>> '{}')::INTEGER) AS delta
        FROM jsonb_each(p_deltas)
        WHERE key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    UPDATE public.listings AS l
    SET views_count = COALESCE(l.views_count, 0) + d.delta
    FROM deltas AS d
    WHERE l.id = d.listing_id
      AND d.delta > 0;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_views_batch(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_views_batch(JSONB) TO service_role;

-- 4. Пакетное обновление счётчиков просмотров и кликов баннеров
-- Принимает p_deltas вида: {"<banner_uuid>": {"views": 15, "clicks": 2}}
CREATE OR REPLACE FUNCTION public.increment_banner_stats_batch(
    p_deltas JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER := 0;
BEGIN
    IF p_deltas IS NULL OR jsonb_typeof(p_deltas) <> 'object' THEN
        RETURN 0;
    END IF;

    WITH deltas AS (
        SELECT
            (key)::UUID AS banner_id,
            GREATEST(0, COALESCE((value->>'views')::INTEGER, 0)) AS views_delta,
            GREATEST(0, COALESCE((value->>'clicks')::INTEGER, 0)) AS clicks_delta
        FROM jsonb_each(p_deltas)
        WHERE key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    UPDATE public.banners AS b
    SET views_count = COALESCE(b.views_count, 0) + d.views_delta,
        clicks_count = COALESCE(b.clicks_count, 0) + d.clicks_delta,
        updated_at = NOW()
    FROM deltas AS d
    WHERE b.id = d.banner_id
      AND (d.views_delta > 0 OR d.clicks_delta > 0);

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_banner_stats_batch(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_banner_stats_batch(JSONB) TO service_role;
