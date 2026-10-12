-- ============================================================================
-- Миграция: 20261012120000_banners_extend.sql
-- Назначение: Расширение существующей таблицы banners полями позиционирования,
--             диапазона дат показа и аудита, установка констрейнтов NOT NULL,
--             индексов, RLS и функции инкремента статистики.
-- База: Таблица banners уже существует в схеме (id, title, image_url, link_url,
--       is_active, views_count, clicks_count, created_at). В живой базе 0 строк.
-- ============================================================================

-- 1. Добавление недостающих колонок с проверкой на существование
ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS image_position_x SMALLINT NOT NULL DEFAULT 50;
ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS image_position_y SMALLINT NOT NULL DEFAULT 50;
ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Установка значений по умолчанию для ранее nullable колонок
ALTER TABLE public.banners ALTER COLUMN is_active SET DEFAULT TRUE;
ALTER TABLE public.banners ALTER COLUMN views_count SET DEFAULT 0;
ALTER TABLE public.banners ALTER COLUMN clicks_count SET DEFAULT 0;
ALTER TABLE public.banners ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

-- 3. Заполнение NULL-значений (гарантия безопасности перед установкой NOT NULL)
UPDATE public.banners SET is_active = TRUE WHERE is_active IS NULL;
UPDATE public.banners SET views_count = 0 WHERE views_count IS NULL;
UPDATE public.banners SET clicks_count = 0 WHERE clicks_count IS NULL;
UPDATE public.banners SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;

-- 4. Установка ограничения NOT NULL для существующих колонок
ALTER TABLE public.banners ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.banners ALTER COLUMN views_count SET NOT NULL;
ALTER TABLE public.banners ALTER COLUMN clicks_count SET NOT NULL;
ALTER TABLE public.banners ALTER COLUMN created_at SET NOT NULL;

-- 5. Добавление CHECK-констрейнтов для координат кадрирования и дат показа
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_banners_position_x') THEN
        ALTER TABLE public.banners ADD CONSTRAINT chk_banners_position_x
            CHECK (image_position_x >= 0 AND image_position_x <= 100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_banners_position_y') THEN
        ALTER TABLE public.banners ADD CONSTRAINT chk_banners_position_y
            CHECK (image_position_y >= 0 AND image_position_y <= 100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_banners_dates_range') THEN
        ALTER TABLE public.banners ADD CONSTRAINT chk_banners_dates_range
            CHECK (end_date IS NULL OR end_date >= start_date);
    END IF;
END $$;

-- 6. Индексы для быстрой фильтрации активных баннеров и сортировки в админке
CREATE INDEX IF NOT EXISTS idx_banners_active_dates 
ON public.banners (is_active, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_banners_created_at_desc 
ON public.banners (created_at DESC);

-- 7. Настройка Row Level Security (RLS)
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

-- Публичный просмотр через PostgREST только активных и не истекших баннеров
DROP POLICY IF EXISTS "Public can view active published banners" ON public.banners;
CREATE POLICY "Public can view active published banners"
ON public.banners
FOR SELECT
TO anon, authenticated
USING (
    is_active = TRUE 
    AND start_date <= CURRENT_DATE 
    AND (end_date IS NULL OR end_date >= CURRENT_DATE)
);

-- 8. Функция атомарного увеличения счётчиков просмотров и кликов баннера
-- Вызывается бэкендом (service_role) без риска гонок read-modify-write
CREATE OR REPLACE FUNCTION public.increment_banner_stat(banner_id UUID, stat TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF stat = 'view' OR stat = 'views' THEN
        UPDATE public.banners
        SET views_count = views_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = banner_id;
    ELSIF stat = 'click' OR stat = 'clicks' THEN
        UPDATE public.banners
        SET clicks_count = clicks_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = banner_id;
    ELSE
        RAISE EXCEPTION 'Invalid stat type: %. Allowed values: view, views, click, clicks', stat
            USING ERRCODE = '22023'; -- invalid_parameter_value
    END IF;
END;
$$;

-- Ограничение доступа к функции: только service_role
REVOKE ALL ON FUNCTION public.increment_banner_stat(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_banner_stat(UUID, TEXT) TO service_role;
