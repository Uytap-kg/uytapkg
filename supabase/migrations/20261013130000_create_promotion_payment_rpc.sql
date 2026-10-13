-- ============================================================================
-- Миграция: 20261013130000_create_promotion_payment_rpc.sql
-- Назначение: Атомарное создание платежа и связанного заказа продвижения
-- Гарантия идемпотентности: CREATE OR REPLACE FUNCTION безопасен при повторном запуске
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_promotion_payment(
    p_user_id UUID,
    p_order_id VARCHAR,
    p_tariff_id VARCHAR,
    p_days INT,
    p_amount INT,
    p_listing_id UUID,
    p_service_type VARCHAR
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment public.payments;
BEGIN
    -- 1. Атомарное создание записи в payments
    INSERT INTO public.payments (
        user_id,
        order_id,
        tariff_id,
        months,
        amount,
        status
    ) VALUES (
        p_user_id,
        p_order_id,
        p_tariff_id,
        p_days,
        p_amount,
        'pending'
    )
    RETURNING * INTO v_payment;

    -- 2. Атомарное создание связанного заказа продвижения в promotion_orders
    INSERT INTO public.promotion_orders (
        order_id,
        user_id,
        listing_id,
        service_type,
        days,
        status
    ) VALUES (
        p_order_id,
        p_user_id,
        p_listing_id,
        p_service_type,
        p_days,
        'pending'
    );

    RETURN to_jsonb(v_payment);
END;
$$;

-- Отзыв публичных прав и выдача только роли service_role
REVOKE ALL ON FUNCTION public.create_promotion_payment(UUID, VARCHAR, VARCHAR, INT, INT, UUID, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_promotion_payment(UUID, VARCHAR, VARCHAR, INT, INT, UUID, VARCHAR) TO service_role;
