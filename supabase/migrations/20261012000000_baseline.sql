--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tariff_id character varying(30) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_individual boolean DEFAULT false NOT NULL,
    custom_name character varying(100),
    active_listings_limit integer,
    vip_boosts_limit integer,
    top_boosts_limit integer,
    granted_by uuid,
    vip_boosts_used integer DEFAULT 0 NOT NULL,
    top_boosts_used integer DEFAULT 0 NOT NULL,
    listings_used integer DEFAULT 0 NOT NULL
);


--
-- Name: activate_subscription_atomic(uuid, character varying, integer, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_subscription_atomic(p_user_id uuid, p_tariff_id character varying, p_days integer, p_payment_id character varying DEFAULT NULL::character varying) RETURNS public.subscriptions
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_existing subscriptions%ROWTYPE;
    v_result subscriptions%ROWTYPE;
    v_new_expires_at TIMESTAMPTZ;
BEGIN
    -- 1. Гарантия идемпотентности по p_payment_id
    IF p_payment_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM processed_subscription_payments WHERE payment_id = p_payment_id) THEN
            SELECT * INTO v_result FROM subscriptions WHERE user_id = p_user_id;
            RETURN v_result;
        END IF;
    END IF;

    -- 2. Транзакционная блокировка на уровне пользователя для защиты от гонок
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    -- 3. FOR UPDATE блокировка существующей строки подписки
    SELECT * INTO v_existing
    FROM subscriptions
    WHERE user_id = p_user_id
    FOR UPDATE;

    -- 4. Защита активной индивидуальной подписки:
    -- Нельзя затереть выданный администратором корпоративный/индивидуальный тариф
    IF v_existing.id IS NOT NULL 
       AND v_existing.is_individual = TRUE 
       AND v_existing.is_active = TRUE 
       AND v_existing.expires_at > CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'У вас активен персональный корпоративный тариф. Для смены тарифа обратитесь к администратору'
            USING ERRCODE = 'P0001';
    END IF;

    -- 5. Накопительное продление сроков:
    -- Если тариф тот же — прибавляем дни к текущему сроку окончания.
    -- Если тариф другой (или подписка истекла) — дни отсчитываются от CURRENT_TIMESTAMP.
    IF v_existing.id IS NOT NULL AND v_existing.expires_at > CURRENT_TIMESTAMP THEN
        IF v_existing.tariff_id = p_tariff_id THEN
            v_new_expires_at := v_existing.expires_at + (p_days || ' days')::INTERVAL;
        ELSE
            v_new_expires_at := CURRENT_TIMESTAMP + (p_days || ' days')::INTERVAL;
        END IF;
    ELSE
        v_new_expires_at := CURRENT_TIMESTAMP + (p_days || ' days')::INTERVAL;
    END IF;

    -- 6. Атомарный upsert подписки
    INSERT INTO subscriptions (
        user_id,
        tariff_id,
        started_at,
        expires_at,
        is_active,
        is_individual,
        custom_name,
        active_listings_limit,
        vip_boosts_limit,
        top_boosts_limit,
        listings_used,
        vip_boosts_used,
        top_boosts_used,
        updated_at
    ) VALUES (
        p_user_id,
        p_tariff_id,
        COALESCE(v_existing.started_at, CURRENT_TIMESTAMP),
        v_new_expires_at,
        TRUE,
        FALSE,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        0,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id) DO UPDATE SET
        tariff_id = p_tariff_id,
        expires_at = v_new_expires_at,
        is_active = TRUE,
        is_individual = FALSE,
        custom_name = NULL,
        active_listings_limit = NULL,
        vip_boosts_limit = NULL,
        top_boosts_limit = NULL,
        listings_used = 0,
        vip_boosts_used = 0,
        top_boosts_used = 0,
        updated_at = CURRENT_TIMESTAMP
    RETURNING * INTO v_result;

    -- 7. Фиксация обработанного платежа для предотвращения повторной обработки
    IF p_payment_id IS NOT NULL THEN
        INSERT INTO processed_subscription_payments (
            payment_id,
            user_id,
            tariff_id,
            processed_at
        ) VALUES (
            p_payment_id,
            p_user_id,
            p_tariff_id,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (payment_id) DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;


--
-- Name: consume_otp_attempt(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_otp_attempt(p_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_attempts INT;
BEGIN
    UPDATE email_verifications
    SET attempts = attempts + 1
    WHERE id = p_id AND is_used = false AND attempts < 5
    RETURNING attempts INTO v_attempts;
    RETURN COALESCE(v_attempts, -1);
END;
$$;


--
-- Name: listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    property_type character varying(50) NOT NULL,
    deal_type character varying(20) NOT NULL,
    rent_period character varying(20),
    region character varying(100) NOT NULL,
    city character varying(100),
    district character varying(100),
    microdistrict character varying(100),
    address text,
    latitude numeric(10,8),
    longitude numeric(11,8),
    price numeric(14,2) NOT NULL,
    currency character varying(10) DEFAULT 'KGS'::character varying,
    area numeric(10,2),
    rooms integer,
    floor integer,
    total_floors integer,
    is_resort boolean DEFAULT false,
    resort_filters jsonb DEFAULT '{}'::jsonb,
    features jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'active'::character varying,
    promotion_status character varying(20) DEFAULT 'regular'::character varying,
    is_urgent boolean DEFAULT false,
    views_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone DEFAULT (CURRENT_TIMESTAMP + '40 days'::interval),
    promotion_expires_at timestamp with time zone,
    urgent_expires_at timestamp with time zone,
    CONSTRAINT listings_currency_check CHECK (((currency)::text = ANY ((ARRAY['KGS'::character varying, 'USD'::character varying])::text[]))),
    CONSTRAINT listings_deal_type_check CHECK (((deal_type)::text = ANY ((ARRAY['sale'::character varying, 'rent'::character varying])::text[]))),
    CONSTRAINT listings_promotion_status_check CHECK (((promotion_status)::text = ANY ((ARRAY['regular'::character varying, 'vip'::character varying, 'top'::character varying])::text[]))),
    CONSTRAINT listings_property_type_check CHECK (((property_type)::text = ANY ((ARRAY['apartment'::character varying, 'house'::character varying, 'land'::character varying, 'commercial'::character varying, 'room'::character varying, 'garage'::character varying])::text[]))),
    CONSTRAINT listings_rent_period_check CHECK (((rent_period)::text = ANY ((ARRAY['hourly'::character varying, 'daily'::character varying, 'weekly'::character varying, 'monthly'::character varying, 'long_term'::character varying])::text[]))),
    CONSTRAINT listings_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'hidden'::character varying, 'draft'::character varying, 'moderation'::character varying])::text[])))
);


--
-- Name: create_listing_with_limit(uuid, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_listing_with_limit(p_user_id uuid, p_listing_data jsonb, p_limit integer DEFAULT NULL::integer) RETURNS public.listings
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_active_count INT;
    v_limit INT;
    v_account_type VARCHAR(20);
    v_subscription subscriptions%ROWTYPE;
    v_new_listing listings%ROWTYPE;
    v_initial_status VARCHAR(20);
BEGIN
    -- 1. Транзакционная блокировка advisory lock для предотвращения гонок создания
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    v_initial_status := COALESCE(p_listing_data->>'status', 'active');

    -- Проверяем лимит только если создаваемое объявление публикуется в статусе "active"
    IF v_initial_status = 'active' THEN
        -- 2. Подсчёт реально активных неистёкших объявлений пользователя
        SELECT COUNT(*)
        INTO v_active_count
        FROM listings
        WHERE user_id = p_user_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP);

        -- Ищем действующую подписку
        SELECT * INTO v_subscription
        FROM subscriptions
        WHERE user_id = p_user_id
          AND is_active = TRUE
          AND expires_at > CURRENT_TIMESTAMP;

        -- 3. Определение лимита пользователя
        IF p_limit IS NOT NULL THEN
            v_limit := p_limit;
        ELSIF v_subscription.id IS NOT NULL THEN
            IF v_subscription.is_individual = TRUE THEN
                v_limit := COALESCE(v_subscription.active_listings_limit, 0);
            ELSE
                CASE v_subscription.tariff_id
                    WHEN 'start' THEN v_limit := 5;
                    WHEN 'optimal' THEN v_limit := 15;
                    WHEN 'business' THEN v_limit := 50;
                    WHEN 'developer' THEN v_limit := 100;
                    ELSE v_limit := COALESCE(v_subscription.active_listings_limit, 0);
                END CASE;
            END IF;
        ELSE
            SELECT account_type INTO v_account_type
            FROM users
            WHERE id = p_user_id;

            IF v_account_type = 'personal' THEN
                v_limit := 2; -- Личный продавец без тарифа: максимум 2 бесплатных объявления
            ELSE
                v_limit := 0; -- Бизнес (agency/developer/realtor) без тарифа: 0 бесплатных объявлений
            END IF;
        END IF;

        -- 4. Если лимит превышен — откат транзакции с исключением 'LIMIT_EXCEEDED'
        IF v_active_count >= v_limit THEN
            RAISE EXCEPTION 'LIMIT_EXCEEDED'
                USING ERRCODE = 'P0002',
                      DETAIL = format('User %s exceeded active listings limit: %s of %s', p_user_id, v_active_count, v_limit);
        END IF;

        -- Если у пользователя есть тариф — атомарно проверяем listings_used и списываем слот
        IF v_subscription.id IS NOT NULL THEN
            IF v_subscription.listings_used >= v_limit THEN
                RAISE EXCEPTION 'LIMIT_EXCEEDED'
                    USING ERRCODE = 'P0002',
                          DETAIL = format('User %s exhausted subscription listings_used: %s of %s', p_user_id, v_subscription.listings_used, v_limit);
            END IF;

            UPDATE subscriptions
            SET listings_used = listings_used + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_subscription.id;
        END IF;
    END IF;

    -- 5. Если лимит не превышен — вставка строки в listings и возврат созданного объявления
    INSERT INTO listings (
        user_id,
        title,
        description,
        property_type,
        deal_type,
        rent_period,
        region,
        city,
        district,
        microdistrict,
        address,
        latitude,
        longitude,
        price,
        currency,
        area,
        rooms,
        floor,
        total_floors,
        is_resort,
        resort_filters,
        features,
        status,
        promotion_status,
        promotion_expires_at,
        is_urgent,
        urgent_expires_at,
        expires_at
    ) VALUES (
        p_user_id,
        p_listing_data->>'title',
        p_listing_data->>'description',
        COALESCE(p_listing_data->>'property_type', p_listing_data->>'propertyType'),
        COALESCE(p_listing_data->>'deal_type', p_listing_data->>'dealType'),
        COALESCE(p_listing_data->>'rent_period', p_listing_data->>'rentPeriod'),
        p_listing_data->>'region',
        p_listing_data->>'city',
        p_listing_data->>'district',
        p_listing_data->>'microdistrict',
        p_listing_data->>'address',
        NULLIF(p_listing_data->>'latitude', '')::NUMERIC,
        NULLIF(p_listing_data->>'longitude', '')::NUMERIC,
        NULLIF(p_listing_data->>'price', '')::NUMERIC,
        COALESCE(p_listing_data->>'currency', 'KGS'),
        NULLIF(p_listing_data->>'area', '')::NUMERIC,
        NULLIF(p_listing_data->>'rooms', '')::INT,
        NULLIF(p_listing_data->>'floor', '')::INT,
        NULLIF(COALESCE(p_listing_data->>'total_floors', p_listing_data->>'totalFloors'), '')::INT,
        COALESCE(NULLIF(COALESCE(p_listing_data->>'is_resort', p_listing_data->>'isResort'), '')::BOOLEAN, FALSE),
        COALESCE(p_listing_data->'resort_filters', p_listing_data->'resortFilters', '{}'::JSONB),
        COALESCE(p_listing_data->'features', '{}'::JSONB),
        v_initial_status,
        COALESCE(p_listing_data->>'promotion_status', p_listing_data->>'promotionStatus', 'regular'),
        NULLIF(COALESCE(p_listing_data->>'promotion_expires_at', p_listing_data->>'promotionExpiresAt'), '')::TIMESTAMPTZ,
        COALESCE(NULLIF(COALESCE(p_listing_data->>'is_urgent', p_listing_data->>'isUrgent'), '')::BOOLEAN, FALSE),
        NULLIF(COALESCE(p_listing_data->>'urgent_expires_at', p_listing_data->>'urgentExpiresAt'), '')::TIMESTAMPTZ,
        COALESCE(NULLIF(COALESCE(p_listing_data->>'expires_at', p_listing_data->>'expiresAt'), '')::TIMESTAMPTZ, CURRENT_TIMESTAMP + INTERVAL '40 days')
    )
    RETURNING * INTO v_new_listing;

    RETURN v_new_listing;
END;
$$;


--
-- Name: increment_views(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_views(listing_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_views INT;
BEGIN
    UPDATE listings
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = listing_id
    RETURNING views_count INTO v_views;

    RETURN COALESCE(v_views, 0);
END;
$$;


--
-- Name: refund_tariff_boost_atomic(uuid, character varying, character varying, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_tariff_boost_atomic(p_user_id uuid, p_boost_type character varying, p_operation_id character varying DEFAULT NULL::character varying, p_subscription_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_sub_id UUID := p_subscription_id;
BEGIN
    -- 1. Проверка идемпотентности по operation_id
    IF p_operation_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM processed_refund_operations WHERE operation_id = p_operation_id) THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 2. Если ID подписки не передан, находим её по user_id
    IF v_sub_id IS NULL THEN
        SELECT id INTO v_sub_id
        FROM subscriptions
        WHERE user_id = p_user_id
          AND is_active = TRUE
          AND expires_at > CURRENT_TIMESTAMP;

        IF v_sub_id IS NULL THEN
            SELECT id INTO v_sub_id
            FROM subscriptions
            WHERE user_id = p_user_id
            ORDER BY updated_at DESC
            LIMIT 1;
        END IF;
    END IF;

    IF v_sub_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 3. Атомарный SQL-запрос обновления счётчика
    IF p_boost_type = 'vip' THEN
        UPDATE subscriptions
        SET vip_boosts_used = GREATEST(vip_boosts_used - 1, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_sub_id;
    ELSIF p_boost_type = 'top' THEN
        UPDATE subscriptions
        SET top_boosts_used = GREATEST(top_boosts_used - 1, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_sub_id;
    ELSE
        RETURN FALSE;
    END IF;

    -- 4. Фиксация в таблице идемпотентности
    IF p_operation_id IS NOT NULL THEN
        INSERT INTO processed_refund_operations (
            operation_id,
            user_id,
            subscription_id,
            operation_type,
            processed_at
        ) VALUES (
            p_operation_id,
            p_user_id,
            v_sub_id,
            p_boost_type || '_boost_refund',
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (operation_id) DO NOTHING;
    END IF;

    RETURN TRUE;
END;
$$;


--
-- Name: refund_tariff_listing_atomic(uuid, character varying, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_tariff_listing_atomic(p_user_id uuid, p_operation_id character varying DEFAULT NULL::character varying, p_subscription_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_sub_id UUID := p_subscription_id;
BEGIN
    -- 1. Проверка идемпотентности по operation_id
    IF p_operation_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM processed_refund_operations WHERE operation_id = p_operation_id) THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 2. Если ID подписки не передан, находим её по user_id
    IF v_sub_id IS NULL THEN
        SELECT id INTO v_sub_id
        FROM subscriptions
        WHERE user_id = p_user_id
          AND is_active = TRUE
          AND expires_at > CURRENT_TIMESTAMP;

        IF v_sub_id IS NULL THEN
            SELECT id INTO v_sub_id
            FROM subscriptions
            WHERE user_id = p_user_id
            ORDER BY updated_at DESC
            LIMIT 1;
        END IF;
    END IF;

    IF v_sub_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 3. Атомарный SQL-запрос для исключения гонки read-modify-write
    UPDATE subscriptions
    SET listings_used = GREATEST(listings_used - 1, 0),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_sub_id;

    -- 4. Фиксация обработанной операции возврата
    IF p_operation_id IS NOT NULL THEN
        INSERT INTO processed_refund_operations (
            operation_id,
            user_id,
            subscription_id,
            operation_type,
            processed_at
        ) VALUES (
            p_operation_id,
            p_user_id,
            v_sub_id,
            'listing_refund',
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (operation_id) DO NOTHING;
    END IF;

    RETURN TRUE;
END;
$$;


--
-- Name: banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    image_url text NOT NULL,
    link_url text,
    is_active boolean DEFAULT true,
    views_count integer DEFAULT 0,
    clicks_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: complex_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complex_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    complex_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    rooms integer NOT NULL,
    area numeric(10,2) NOT NULL,
    price numeric(14,2) NOT NULL,
    status character varying(20) DEFAULT 'available'::character varying,
    image_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT complex_layouts_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'sold'::character varying, 'reserved'::character varying])::text[])))
);


--
-- Name: developers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.developers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    company_name character varying(255) NOT NULL,
    logo_url text,
    description text,
    phone character varying(50),
    email character varying(255),
    website text,
    registry_url text,
    is_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    code character varying(6),
    type character varying(30) NOT NULL,
    attempts integer DEFAULT 0,
    expires_at timestamp with time zone NOT NULL,
    is_used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    code_hash character varying(64),
    reset_completed boolean DEFAULT false,
    CONSTRAINT email_verifications_type_check CHECK (((type)::text = ANY ((ARRAY['registration'::character varying, 'password_reset'::character varying])::text[])))
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lawyers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lawyers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    last_name character varying(100) NOT NULL,
    first_name character varying(100) NOT NULL,
    middle_name character varying(100),
    specialization character varying(255) NOT NULL,
    experience character varying(50) NOT NULL,
    phone character varying(50),
    whatsapp character varying(50),
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: listing_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    url text NOT NULL,
    is_main boolean DEFAULT false,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    order_id character varying(64) NOT NULL,
    invoice_id character varying(20),
    trans_id character varying(20),
    tariff_id character varying(30) NOT NULL,
    months integer NOT NULL,
    amount integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    qr_url text,
    paylink_url text,
    link_app text,
    provider_response jsonb,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    fulfilled_at timestamp with time zone,
    fulfill_attempts integer DEFAULT 0,
    fulfill_error text,
    CONSTRAINT payments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'approved'::character varying, 'canceled'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: processed_refund_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_refund_operations (
    operation_id character varying(128) NOT NULL,
    user_id uuid,
    subscription_id uuid,
    operation_type character varying(50),
    processed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: processed_subscription_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_subscription_payments (
    payment_id character varying(64) NOT NULL,
    user_id uuid,
    tariff_id character varying(30),
    processed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: promotion_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_orders (
    order_id character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    service_type character varying(50) NOT NULL,
    days integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    applied_at timestamp with time zone
);


--
-- Name: residential_complexes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.residential_complexes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    developer_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    region character varying(100) NOT NULL,
    city character varying(100),
    address text,
    completion_status character varying(50),
    completion_date character varying(50),
    housing_class character varying(50),
    registry_link text,
    cover_photo text,
    features jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT residential_complexes_completion_status_check CHECK (((completion_status)::text = ANY ((ARRAY['building'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: upload_ownership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_ownership (
    object_path text NOT NULL,
    user_id uuid NOT NULL,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    first_name character varying(100),
    last_name character varying(100),
    company_name character varying(255),
    inn character varying(50),
    office_address text,
    about text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    avatar_url text
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_type character varying(20) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50) NOT NULL,
    password_hash text NOT NULL,
    is_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    role character varying(20) DEFAULT 'user'::character varying,
    is_email_verified boolean DEFAULT false,
    show_phone boolean DEFAULT false,
    token_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT users_account_type_check CHECK (((account_type)::text = ANY ((ARRAY['personal'::character varying, 'realtor'::character varying, 'agency'::character varying, 'developer'::character varying])::text[]))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: COLUMN users.show_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.show_phone IS 'Флаг явного согласия частного продавца (personal) на показ номера телефона в публичной карточке';


--
-- Name: verification_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    passport_front text NOT NULL,
    passport_back text,
    reject_reason text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT verification_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: banners banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_pkey PRIMARY KEY (id);


--
-- Name: complex_layouts complex_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complex_layouts
    ADD CONSTRAINT complex_layouts_pkey PRIMARY KEY (id);


--
-- Name: developers developers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developers
    ADD CONSTRAINT developers_pkey PRIMARY KEY (id);


--
-- Name: developers developers_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developers
    ADD CONSTRAINT developers_user_id_key UNIQUE (user_id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_user_id_listing_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_listing_id_key UNIQUE (user_id, listing_id);


--
-- Name: lawyers lawyers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lawyers
    ADD CONSTRAINT lawyers_pkey PRIMARY KEY (id);


--
-- Name: listing_photos listing_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_photos
    ADD CONSTRAINT listing_photos_pkey PRIMARY KEY (id);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: payments payments_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_key UNIQUE (order_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: processed_refund_operations processed_refund_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_refund_operations
    ADD CONSTRAINT processed_refund_operations_pkey PRIMARY KEY (operation_id);


--
-- Name: processed_subscription_payments processed_subscription_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_subscription_payments
    ADD CONSTRAINT processed_subscription_payments_pkey PRIMARY KEY (payment_id);


--
-- Name: promotion_orders promotion_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_orders
    ADD CONSTRAINT promotion_orders_pkey PRIMARY KEY (order_id);


--
-- Name: residential_complexes residential_complexes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residential_complexes
    ADD CONSTRAINT residential_complexes_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);


--
-- Name: upload_ownership upload_ownership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_ownership
    ADD CONSTRAINT upload_ownership_pkey PRIMARY KEY (object_path);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_key UNIQUE (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification_requests verification_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_requests
    ADD CONSTRAINT verification_requests_pkey PRIMARY KEY (id);


--
-- Name: idx_email_verifications_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_lookup ON public.email_verifications USING btree (email, type, is_used, expires_at);


--
-- Name: idx_lawyers_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lawyers_is_active ON public.lawyers USING btree (is_active);


--
-- Name: idx_listings_active_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_active_expires ON public.listings USING btree (status, expires_at);


--
-- Name: idx_listings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_created_at ON public.listings USING btree (created_at DESC);


--
-- Name: idx_listings_promotion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_promotion ON public.listings USING btree (promotion_status);


--
-- Name: idx_listings_promotion_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_promotion_expires ON public.listings USING btree (promotion_status, promotion_expires_at);


--
-- Name: idx_listings_property_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_property_type ON public.listings USING btree (property_type);


--
-- Name: idx_listings_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_region ON public.listings USING btree (region);


--
-- Name: idx_listings_urgent_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_urgent_expires ON public.listings USING btree (is_urgent, urgent_expires_at);


--
-- Name: idx_payments_approved_unfulfilled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_approved_unfulfilled ON public.payments USING btree (status, fulfilled_at) WHERE (((status)::text = 'approved'::text) AND (fulfilled_at IS NULL));


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_payments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_user_id ON public.payments USING btree (user_id);


--
-- Name: idx_processed_refund_ops_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_processed_refund_ops_user_id ON public.processed_refund_operations USING btree (user_id);


--
-- Name: idx_processed_sub_payments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_processed_sub_payments_user_id ON public.processed_subscription_payments USING btree (user_id);


--
-- Name: idx_promotion_orders_listing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotion_orders_listing_id ON public.promotion_orders USING btree (listing_id);


--
-- Name: idx_promotion_orders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotion_orders_user_id ON public.promotion_orders USING btree (user_id);


--
-- Name: idx_subscriptions_is_individual; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_is_individual ON public.subscriptions USING btree (is_individual);


--
-- Name: idx_upload_ownership_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upload_ownership_user_id ON public.upload_ownership USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone);


--
-- Name: idx_users_token_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_token_version ON public.users USING btree (id, token_version);


--
-- Name: complex_layouts complex_layouts_complex_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complex_layouts
    ADD CONSTRAINT complex_layouts_complex_id_fkey FOREIGN KEY (complex_id) REFERENCES public.residential_complexes(id) ON DELETE CASCADE;


--
-- Name: developers developers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developers
    ADD CONSTRAINT developers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: favorites favorites_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: listing_photos listing_photos_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_photos
    ADD CONSTRAINT listing_photos_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: listings listings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: promotion_orders promotion_orders_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_orders
    ADD CONSTRAINT promotion_orders_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: promotion_orders promotion_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_orders
    ADD CONSTRAINT promotion_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: residential_complexes residential_complexes_developer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residential_complexes
    ADD CONSTRAINT residential_complexes_developer_id_fkey FOREIGN KEY (developer_id) REFERENCES public.developers(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: upload_ownership upload_ownership_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_ownership
    ADD CONSTRAINT upload_ownership_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: verification_requests verification_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_requests
    ADD CONSTRAINT verification_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: banners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

--
-- Name: complex_layouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complex_layouts ENABLE ROW LEVEL SECURITY;

--
-- Name: developers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.developers ENABLE ROW LEVEL SECURITY;

--
-- Name: favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: lawyers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lawyers ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: listings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_refund_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processed_refund_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_subscription_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processed_subscription_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: promotion_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promotion_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: residential_complexes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.residential_complexes ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: upload_ownership; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.upload_ownership ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: verification_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

