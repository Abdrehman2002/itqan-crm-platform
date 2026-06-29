-- Migration 037 — tax_rates: per-tenant custom tax rate catalogue.
-- Previously tax rates were stored as a JSONB column on sales_settings,
-- which made them invisible to relational queries, audit logs, and any
-- future per-rate metadata (effective dates, jurisdiction codes, etc.).
-- This table promotes them to first-class rows so the Sales settings UI
-- can do real CRUD and the invoice line-item form can FK to a saved rate.
--
-- The legacy sales_settings.tax_rates JSONB column is left untouched for
-- backward compatibility; the API reads/writes the new table and the JSONB
-- is treated as a deprecated mirror to be removed in a follow-up migration.

CREATE TABLE IF NOT EXISTS tax_rates (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  rate_percent NUMERIC(6,3) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant ON tax_rates(tenant_id);

-- Only one default per tenant. Partial unique index so non-default rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rates_one_default_per_tenant
  ON tax_rates(tenant_id) WHERE is_default = TRUE;

ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tax_rates;
CREATE POLICY tenant_isolation ON tax_rates
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );
