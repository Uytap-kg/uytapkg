-- Индекс для публичного каталога риэлторов (GET /api/realtors, realtorsController.js):
-- WHERE account_type = 'realtor' AND role = 'user'
-- ORDER BY is_verified DESC NULLS LAST, created_at DESC, id
-- Частичный — покрывает только риэлторов, на запись в users почти не влияет.
CREATE INDEX IF NOT EXISTS idx_users_realtor_catalog
    ON public.users USING btree (is_verified DESC NULLS LAST, created_at DESC, id)
    WHERE account_type = 'realtor' AND role = 'user';
