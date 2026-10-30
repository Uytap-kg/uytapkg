-- ============================================================================
-- Миграция: 20261012120100_instagram_requests.sql
-- Назначение: Создание таблицы заявок на размещение объявлений в Instagram
--             с внешними ключами на public.listings и public.users,
--             частичным уникальным индексом на активные заявки и включением RLS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.instagram_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'published', 'rejected', 'canceled')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    notes TEXT
);

-- Индекс для фильтрации по статусу и сортировки в панели администратора
CREATE INDEX IF NOT EXISTS idx_instagram_requests_status_created 
ON public.instagram_requests (status, created_at DESC);

-- Индексы для ускорения внешних ключей
CREATE INDEX IF NOT EXISTS idx_instagram_requests_listing_id 
ON public.instagram_requests (listing_id);

CREATE INDEX IF NOT EXISTS idx_instagram_requests_user_id 
ON public.instagram_requests (user_id);

-- ============================================================================
-- Частичный уникальный индекс: запрет одновременных активных заявок
-- ============================================================================
-- ПОВЕДЕНИЕ В КОДЕ:
-- В текущем JSON-хранилище (back-end/src/utils/instagramRequests.js) функция
-- createInstagramRequest не проверяла наличие существующих заявок для listingId
-- и просто добавляла новую запись в массив.
-- В РЕЛЯЦИОННОЙ СХЕМЕ:
-- Данный частичный индекс запрещает создание двух одновременных заявок в статусе
-- 'pending' для одного и того же объявления (защита от повторных кликов пользователя
-- и состояния гонки). После того как заявка переведена администратором в статус
-- 'published' (или 'rejected'/'canceled'), для этого же объявления при необходимости
-- может быть создана новая заявка на публикацию.
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_requests_unique_pending_listing 
ON public.instagram_requests (listing_id) 
WHERE status = 'pending';

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================
-- RLS включается без добавления политик (default deny):
-- 1. Бэкенд работает через service role (service_role key), который обходит RLS.
-- 2. Прямой доступ клиентов (через anon key или authenticated role по PostgREST)
--    к заявкам Instagram строго запрещён для предотвращения утечки данных и подделки.
ALTER TABLE public.instagram_requests ENABLE ROW LEVEL SECURITY;
