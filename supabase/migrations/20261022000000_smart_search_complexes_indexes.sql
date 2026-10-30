-- =======================================================
-- Migration: 20261022000000_smart_search_complexes_indexes.sql
-- Description: High-load indexes for smart search by residential complexes
-- =======================================================

-- 1. Enable pg_trgm extension for trigram search if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Partial functional B-Tree index on listings((features->>'residentialComplexId'))
-- Ensures O(log N) indexed seeks when filtering listings by residential complex ID,
-- eliminating sequential scans on the listings table under high load.
CREATE INDEX IF NOT EXISTS idx_listings_features_complex_id
    ON public.listings ((features->>'residentialComplexId'))
    WHERE (features->>'residentialComplexId') IS NOT NULL;

-- 3. GIN Trigram index on residential_complexes(name)
-- Enables ultra-fast substring and fuzzy matching for complex names,
-- allowing instant resolution of complex names even with typos.
CREATE INDEX IF NOT EXISTS idx_residential_complexes_name_trgm
    ON public.residential_complexes USING gin (name gin_trgm_ops);
