-- Откат ранее зарезервированного слота rate-limit (например, SMS не была отправлена).
-- Уменьшает счётчик не ниже 0 и не трогает уже истёкшие окна.
CREATE OR REPLACE FUNCTION public.release_rate_limit(
    p_key CHARACTER VARYING,
    p_decrement INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF p_decrement IS NULL OR p_decrement <= 0 THEN
        RETURN;
    END IF;

    UPDATE public.rate_limit_counters
    SET count = GREATEST(0, count - p_decrement),
        updated_at = CURRENT_TIMESTAMP
    WHERE key = p_key
      AND reset_at > CURRENT_TIMESTAMP;
END;
$$;

REVOKE ALL ON FUNCTION public.release_rate_limit(CHARACTER VARYING, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_rate_limit(CHARACTER VARYING, INTEGER) TO service_role;
