-- Миграция: отслеживание выдачи услуг после подтверждения оплаты (O!Dengi)
-- Защита от потери оплаты, если activateSubscription / applyPromotion упали со сбоем.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfill_attempts INT DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fulfill_error TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_approved_unfulfilled ON payments(status, fulfilled_at) WHERE status = 'approved' AND fulfilled_at IS NULL;
