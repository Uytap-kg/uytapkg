-- Включение Row Level Security (RLS) для таблицы email_verifications.
--
-- Политики RLS намеренно не создаются:
-- 1. Бэкенд взаимодействует с базой данных через service role (service_role key), который обходит RLS (RLS bypass).
-- 2. Прямой доступ клиентов (через anon key или authenticated role по PostgREST API) к кодам верификации и хэшам OTP строго запрещён.
-- 3. Включение RLS без политик реализует принцип default deny — любой прямой публичный/клиентский запрос к таблице public.email_verifications будет заблокирован.

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
