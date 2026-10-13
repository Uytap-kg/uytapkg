-- 20261013120100_register_user_rpc.sql
-- Транзакционные функции регистрации и перезаписи неподтвержденных пользователей.
-- Гарантируют атомарное создание записей users + user_profiles (+ developers) в одной транзакции.

-- 1. Функция register_user: атомарное создание нового пользователя
CREATE OR REPLACE FUNCTION public.register_user(
    p_account_type CHARACTER VARYING,
    p_email CHARACTER VARYING,
    p_phone CHARACTER VARYING,
    p_password_hash TEXT,
    p_profile_data JSONB DEFAULT '{}'::JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_about TEXT;
    v_avatar_url TEXT;
    v_first_name TEXT;
    v_last_name TEXT;
    v_company_name TEXT;
    v_inn TEXT;
    v_office_address TEXT;
    v_website TEXT;
BEGIN
    -- 1. Создание записи в users
    INSERT INTO public.users (
        account_type,
        email,
        phone,
        password_hash,
        is_verified,
        is_email_verified,
        token_version,
        created_at,
        updated_at
    ) VALUES (
        p_account_type,
        p_email,
        p_phone,
        p_password_hash,
        false,
        false,
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_user_id;

    -- 2. Извлечение полей профиля из JSONB
    v_about := p_profile_data->>'about';
    v_avatar_url := p_profile_data->>'avatar_url';
    v_first_name := p_profile_data->>'first_name';
    v_last_name := p_profile_data->>'last_name';
    v_company_name := p_profile_data->>'company_name';
    v_inn := p_profile_data->>'inn';
    v_office_address := p_profile_data->>'office_address';
    v_website := p_profile_data->>'website';

    -- 3. Создание записи в user_profiles
    INSERT INTO public.user_profiles (
        user_id,
        about,
        avatar_url,
        first_name,
        last_name,
        company_name,
        inn,
        office_address,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        v_about,
        v_avatar_url,
        v_first_name,
        v_last_name,
        v_company_name,
        v_inn,
        v_office_address,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

    -- 4. Если тип аккаунта developer — создаём запись в developers
    IF p_account_type = 'developer' THEN
        INSERT INTO public.developers (
            user_id,
            company_name,
            logo_url,
            description,
            phone,
            email,
            website,
            created_at
        ) VALUES (
            v_user_id,
            COALESCE(v_company_name, 'Застройщик'),
            v_avatar_url,
            v_about,
            p_phone,
            p_email,
            v_website,
            CURRENT_TIMESTAMP
        );
    END IF;

    RETURN v_user_id;
END;
$$;

-- 2. Функция reclaim_unverified_user: атомарная перезапись неподтвержденной учетной записи
CREATE OR REPLACE FUNCTION public.reclaim_unverified_user(
    p_user_id UUID,
    p_account_type CHARACTER VARYING,
    p_phone CHARACTER VARYING,
    p_password_hash TEXT,
    p_profile_data JSONB DEFAULT '{}'::JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
    v_about TEXT;
    v_avatar_url TEXT;
    v_first_name TEXT;
    v_last_name TEXT;
    v_company_name TEXT;
    v_inn TEXT;
    v_office_address TEXT;
    v_website TEXT;
    v_email TEXT;
BEGIN
    -- 1. Проверяем и обновляем запись в users только если is_email_verified = false
    UPDATE public.users
    SET account_type = p_account_type,
        phone = p_phone,
        password_hash = p_password_hash,
        is_email_verified = false,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_user_id AND is_email_verified = false
    RETURNING email INTO v_email;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Пользователь не найден или уже подтверждён' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Извлечение полей профиля из JSONB
    v_about := p_profile_data->>'about';
    v_avatar_url := p_profile_data->>'avatar_url';
    v_first_name := p_profile_data->>'first_name';
    v_last_name := p_profile_data->>'last_name';
    v_company_name := p_profile_data->>'company_name';
    v_inn := p_profile_data->>'inn';
    v_office_address := p_profile_data->>'office_address';
    v_website := p_profile_data->>'website';

    -- 3. Обновляем или вставляем профиль (с очисткой прежних полей для защиты от утечки чужих данных)
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = p_user_id) THEN
        UPDATE public.user_profiles
        SET about = v_about,
            avatar_url = v_avatar_url,
            first_name = v_first_name,
            last_name = v_last_name,
            company_name = v_company_name,
            inn = v_inn,
            office_address = v_office_address,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = p_user_id;
    ELSE
        INSERT INTO public.user_profiles (
            user_id,
            about,
            avatar_url,
            first_name,
            last_name,
            company_name,
            inn,
            office_address,
            created_at,
            updated_at
        ) VALUES (
            p_user_id,
            v_about,
            v_avatar_url,
            v_first_name,
            v_last_name,
            v_company_name,
            v_inn,
            v_office_address,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );
    END IF;

    -- 4. Синхронизация записи застройщика
    IF p_account_type = 'developer' THEN
        IF EXISTS (SELECT 1 FROM public.developers WHERE user_id = p_user_id) THEN
            UPDATE public.developers
            SET company_name = COALESCE(v_company_name, 'Застройщик'),
                logo_url = v_avatar_url,
                description = v_about,
                phone = p_phone,
                email = v_email,
                website = v_website
            WHERE user_id = p_user_id;
        ELSE
            INSERT INTO public.developers (
                user_id,
                company_name,
                logo_url,
                description,
                phone,
                email,
                website,
                created_at
            ) VALUES (
                p_user_id,
                COALESCE(v_company_name, 'Застройщик'),
                v_avatar_url,
                v_about,
                p_phone,
                v_email,
                v_website,
                CURRENT_TIMESTAMP
            );
        END IF;
    ELSE
        DELETE FROM public.developers WHERE user_id = p_user_id;
    END IF;

    RETURN p_user_id;
END;
$$;

-- 3. Ограничение прав доступа: вызов разрешен только сервисной роли (service_role)
REVOKE ALL ON FUNCTION public.register_user(CHARACTER VARYING, CHARACTER VARYING, CHARACTER VARYING, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_user(CHARACTER VARYING, CHARACTER VARYING, CHARACTER VARYING, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.reclaim_unverified_user(UUID, CHARACTER VARYING, CHARACTER VARYING, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_unverified_user(UUID, CHARACTER VARYING, CHARACTER VARYING, TEXT, JSONB) TO service_role;
