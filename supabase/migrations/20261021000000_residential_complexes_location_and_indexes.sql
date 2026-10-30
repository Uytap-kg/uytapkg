-- Migration: 20261021000000_residential_complexes_location_and_indexes.sql
-- Description: Add country and district columns to residential_complexes, backfill from features,
-- and add high-load performance indexes for location filtering and pagination.

-- 1. Add columns to residential_complexes if they don't already exist
ALTER TABLE public.residential_complexes
    ADD COLUMN IF NOT EXISTS country VARCHAR(50) DEFAULT 'kyrgyzstan',
    ADD COLUMN IF NOT EXISTS district VARCHAR(100);

-- 2. Backfill existing rows with country and district from features JSONB if available
UPDATE public.residential_complexes
SET
    country = COALESCE(NULLIF(TRIM(features->>'country'), ''), country, 'kyrgyzstan'),
    district = COALESCE(district, NULLIF(TRIM(features->>'district'), ''))
WHERE
    country IS NULL
    OR (district IS NULL AND features->>'district' IS NOT NULL);

-- 3. High-load B-tree indexes for fast seeks and sorted paginations
-- Optimize: Location-filtered searches (country, city, district)
CREATE INDEX IF NOT EXISTS idx_residential_complexes_location
    ON public.residential_complexes(country, city, district);

-- Optimize: Global complex feed ordered by creation date (eliminates full table sort)
CREATE INDEX IF NOT EXISTS idx_residential_complexes_created_at
    ON public.residential_complexes(created_at DESC);

-- Optimize: Developer profile complex listing (WHERE developer_id = ... ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_residential_complexes_dev_created
    ON public.residential_complexes(developer_id, created_at DESC);
