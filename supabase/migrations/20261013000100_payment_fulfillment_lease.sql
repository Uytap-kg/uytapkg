-- Аренда (lease) на выдачу оплаченной услуги.
-- Webhook O!Dengi и поллинг статуса могут одновременно вызвать fulfillPayment
-- для одного платежа. Бэкенд атомарно захватывает платёж условным UPDATE
-- (fulfilling_at IS NULL или просрочен) и выдаёт услугу только при успешном захвате.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfilling_at TIMESTAMP WITH TIME ZONE;
