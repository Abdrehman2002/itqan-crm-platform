-- ============================================================
-- Billing schema — invoices, payments, subscriptions
-- ============================================================

CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan                     TEXT NOT NULL,
  billing_cycle            TEXT NOT NULL DEFAULT 'monthly',
  status                   TEXT NOT NULL DEFAULT 'trialing',
  currency                 TEXT NOT NULL DEFAULT 'USD',
  amount                   INTEGER NOT NULL,          -- smallest unit (cents / paisa)
  provider                 TEXT NOT NULL,
  provider_subscription_id TEXT,
  current_period_start     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 month',
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
  trial_end                TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- NOTE: The `invoices` table is intentionally NOT created here. The Sales &
-- Invoicing module (008_sales_invoicing.sql) owns the `invoices` table with a
-- different (and authoritative) schema. Creating it here too caused a column
-- collision (`due_at` vs `due_date`) that broke migrations on a fresh DB.

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id          UUID,   -- no FK: invoices table is created later in 008
  provider            TEXT NOT NULL,                -- stripe|wise|jazzcash|easypaisa|raast
  provider_payment_id TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  currency            TEXT NOT NULL,
  amount              INTEGER NOT NULL,
  fee                 INTEGER,
  net                 INTEGER,
  failure_reason      TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_provider_id ON payments(provider, provider_payment_id);

-- Billing details stored per tenant (shown on invoices)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_details JSONB DEFAULT '{}';

-- GST/NTN fields for Pakistan compliance
COMMENT ON COLUMN tenants.billing_details IS
  'Stores: name, email, phone, address, taxId (NTN for Pakistan), ntn, country';
