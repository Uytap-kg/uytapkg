-- 20261018193000_revoke_public_rpc_grants.sql
-- Отзыв прав на прямой вызов хранимых процедур (RPC) через PostgREST (anon / authenticated).
-- Все транзакционные, биллинговые и аутентификационные функции должны вызываться
-- исключительно бэкендом через роль service_role.

DO $$
BEGIN
    -- 1. activate_subscription_atomic
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'activate_subscription_atomic') THEN
        REVOKE ALL ON FUNCTION public.activate_subscription_atomic FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.activate_subscription_atomic TO service_role;
    END IF;

    -- 2. refund_tariff_boost_atomic
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refund_tariff_boost_atomic') THEN
        REVOKE ALL ON FUNCTION public.refund_tariff_boost_atomic FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.refund_tariff_boost_atomic TO service_role;
    END IF;

    -- 3. refund_tariff_listing_atomic
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refund_tariff_listing_atomic') THEN
        REVOKE ALL ON FUNCTION public.refund_tariff_listing_atomic FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.refund_tariff_listing_atomic TO service_role;
    END IF;

    -- 4. create_promotion_payment
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_promotion_payment') THEN
        REVOKE ALL ON FUNCTION public.create_promotion_payment FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.create_promotion_payment TO service_role;
    END IF;

    -- 5. register_user
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'register_user') THEN
        REVOKE ALL ON FUNCTION public.register_user FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.register_user TO service_role;
    END IF;

    -- 6. reclaim_unverified_user
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reclaim_unverified_user') THEN
        REVOKE ALL ON FUNCTION public.reclaim_unverified_user FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.reclaim_unverified_user TO service_role;
    END IF;

    -- 7. consume_otp_attempt
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'consume_otp_attempt') THEN
        REVOKE ALL ON FUNCTION public.consume_otp_attempt FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.consume_otp_attempt TO service_role;
    END IF;

    -- 8. create_listing_with_limit
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_listing_with_limit') THEN
        REVOKE ALL ON FUNCTION public.create_listing_with_limit FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.create_listing_with_limit TO service_role;
    END IF;

    -- 9. increment_views
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_views') THEN
        REVOKE ALL ON FUNCTION public.increment_views FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.increment_views TO service_role;
    END IF;

    -- 10. increment_banner_stat
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_banner_stat') THEN
        REVOKE ALL ON FUNCTION public.increment_banner_stat FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.increment_banner_stat TO service_role;
    END IF;
END $$;
