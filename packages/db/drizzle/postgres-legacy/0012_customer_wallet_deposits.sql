-- Customer wallet recharge by bank transfer with a payment screenshot, credited
-- once by staff (Admin → Wallet recharges → Customers). Idempotent.
CREATE TABLE IF NOT EXISTS customer_wallet_deposits (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_account_id  text NOT NULL REFERENCES wallet_accounts(id),
  amount             numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency           text NOT NULL,
  credit_amount      numeric(14, 2),
  method             text NOT NULL DEFAULT 'BANK_TRANSFER',
  reference          text,
  paid_on            text,
  bank_account       jsonb,
  attachments        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status             text NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  admin_note         text,
  reviewed_by_id     text,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_wallet_deposits_queue_idx ON customer_wallet_deposits (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS customer_wallet_deposits_user_idx ON customer_wallet_deposits (user_id, created_at DESC);
