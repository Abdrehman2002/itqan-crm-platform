-- Platform-level invoicing: super admin bills tenant admins for subscriptions

CREATE TABLE IF NOT EXISTS platform_invoices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number TEXT UNIQUE NOT NULL,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  amount         NUMERIC(12,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'GBP',
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  due_date       DATE NOT NULL,
  items          JSONB NOT NULL DEFAULT '[]',
  notes          TEXT,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id   UUID NOT NULL REFERENCES platform_invoices(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  amount       NUMERIC(12,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  payment_date DATE NOT NULL,
  method       TEXT CHECK (method IN ('bank_transfer','card','cheque','cash','other')),
  reference    TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant  ON platform_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status  ON platform_invoices(status);
CREATE INDEX IF NOT EXISTS idx_platform_payments_invoice ON platform_payments(invoice_id);

GRANT ALL ON platform_invoices  TO crm;
GRANT ALL ON platform_payments  TO crm;
