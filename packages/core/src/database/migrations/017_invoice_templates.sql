-- Invoice templates: builder layouts (JSON) and uploaded DOCX templates

CREATE TABLE IF NOT EXISTS invoice_templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'builder' CHECK (type IN ('builder','docx')),
  layout       JSONB,                  -- builder type: array of {id,type,label,properties}
  file_path    TEXT,                   -- docx type: server-side path to uploaded file
  file_name    TEXT,                   -- original filename shown to user
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one default per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_templates_default
  ON invoice_templates (tenant_id) WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_invoice_templates_tenant ON invoice_templates(tenant_id);

GRANT ALL ON invoice_templates TO crm;
