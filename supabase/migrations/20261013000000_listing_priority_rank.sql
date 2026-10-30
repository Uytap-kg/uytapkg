-- =======================================================
-- Migration: 20261013000000_listing_priority_rank.sql
-- Дефект 1.1: Сортировка промо-статусов на уровне БД и пагинация
-- =======================================================

-- 1. Добавление колонок priority_rank и photos_count в таблицу listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS priority_rank INT DEFAULT 3 NOT NULL;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS photos_count INT DEFAULT 0 NOT NULL;

-- 2. Инициализация photos_count для существующих объявлений
UPDATE listings l
SET photos_count = COALESCE((
  SELECT COUNT(*)::INT
  FROM listing_photos lp
  WHERE lp.listing_id = l.id
), 0);

-- 3. Инициализация priority_rank для существующих объявлений
-- 0 = VIP, 1 = Urgent, 2 = Top, 3 = Regular
UPDATE listings
SET priority_rank = CASE
  WHEN promotion_status = 'vip' AND (promotion_expires_at IS NULL OR promotion_expires_at > CURRENT_TIMESTAMP) THEN 0
  WHEN is_urgent = TRUE AND (urgent_expires_at IS NULL OR urgent_expires_at > CURRENT_TIMESTAMP) THEN 1
  WHEN promotion_status = 'top' AND (promotion_expires_at IS NULL OR promotion_expires_at > CURRENT_TIMESTAMP) THEN 2
  ELSE 3
END;

-- 4. Функция и триггер для автоматического расчёта priority_rank в listings
CREATE OR REPLACE FUNCTION update_listing_priority_rank()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.promotion_status = 'vip' AND (NEW.promotion_expires_at IS NULL OR NEW.promotion_expires_at > CURRENT_TIMESTAMP) THEN
    NEW.priority_rank := 0;
  ELSIF NEW.is_urgent = TRUE AND (NEW.urgent_expires_at IS NULL OR NEW.urgent_expires_at > CURRENT_TIMESTAMP) THEN
    NEW.priority_rank := 1;
  ELSIF NEW.promotion_status = 'top' AND (NEW.promotion_expires_at IS NULL OR NEW.promotion_expires_at > CURRENT_TIMESTAMP) THEN
    NEW.priority_rank := 2;
  ELSE
    NEW.priority_rank := 3;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_priority_rank ON listings;
CREATE TRIGGER trg_listing_priority_rank
BEFORE INSERT OR UPDATE OF promotion_status, promotion_expires_at, is_urgent, urgent_expires_at
ON listings
FOR EACH ROW EXECUTE FUNCTION update_listing_priority_rank();

-- 5. Функция и триггеры на listing_photos для поддержания актуального photos_count
CREATE OR REPLACE FUNCTION update_listing_photos_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE listings SET photos_count = photos_count + 1 WHERE id = NEW.listing_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE listings SET photos_count = GREATEST(0, photos_count - 1) WHERE id = OLD.listing_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
      UPDATE listings SET photos_count = GREATEST(0, photos_count - 1) WHERE id = OLD.listing_id;
      UPDATE listings SET photos_count = photos_count + 1 WHERE id = NEW.listing_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_photos_count ON listing_photos;
CREATE TRIGGER trg_listing_photos_count
AFTER INSERT OR DELETE OR UPDATE OF listing_id
ON listing_photos
FOR EACH ROW EXECUTE FUNCTION update_listing_photos_count();

-- 6. Индексы для быстрой сортировки по приоритету и фильтрации популярных
CREATE INDEX IF NOT EXISTS idx_listings_active_prio ON listings(status, priority_rank ASC, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_listings_photos_count ON listings(photos_count);
