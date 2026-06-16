-- ============================================================
-- Sales & Invoicing Module
-- All tables use tenant_id + RLS for multi-tenant isolation.
-- ============================================================

-- Billing contacts (clients to invoice)
CREATE TABLE IF NOT EXISTS billing_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  company         TEXT,
  currency        TEXT NOT NULL DEFAULT 'USD',
  tax_id          TEXT,
  billing_address JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_contacts_tenant ON billing_contacts(tenant_id);
ALTER TABLE billing_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_contacts_tenant ON billing_contacts
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','viewed','partial','paid','overdue','cancelled')),
  billing_contact_id  UUID REFERENCES billing_contacts(id),
  issue_date          DATE NOT NULL,
  due_date            DATE NOT NULL,
  po_reference        TEXT,
  currency            TEXT NOT NULL DEFAULT 'USD',
  template_id         TEXT NOT NULL DEFAULT 'tpl-classic',
  subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_tax           NUMERIC(15,2) NOT NULL DEFAULT 0,
  total               NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_paid         NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_due          NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  terms               TEXT,
  logo_url            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant    ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status    ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date  ON invoices(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_contact   ON invoices(billing_contact_id);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Invoice line items
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  quantity     NUMERIC(12,4) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total        NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);

-- Invoice payments
CREATE TABLE IF NOT EXISTS invoice_payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount            NUMERIC(15,2) NOT NULL,
  payment_date      DATE NOT NULL,
  mode_name         TEXT NOT NULL,
  bank_account_name TEXT,
  reference         TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant  ON invoice_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_payments_tenant ON invoice_payments
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Per-tenant sales settings
CREATE TABLE IF NOT EXISTS sales_settings (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_prefix         TEXT NOT NULL DEFAULT 'INV-',
  next_invoice_number    INT NOT NULL DEFAULT 1,
  default_currency       TEXT NOT NULL DEFAULT 'USD',
  default_payment_terms  INT NOT NULL DEFAULT 30,
  tax_rates              JSONB NOT NULL DEFAULT '[]',
  bank_accounts          JSONB NOT NULL DEFAULT '[]',
  payment_modes          JSONB NOT NULL DEFAULT '[]',
  smtp_configured        BOOLEAN NOT NULL DEFAULT false,
  company_name           TEXT,
  company_email          TEXT,
  company_phone          TEXT,
  company_address        JSONB NOT NULL DEFAULT '{}',
  logo_url               TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_settings_tenant ON sales_settings(tenant_id);
