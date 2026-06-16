-- ============================================================
-- MIGRATION 004: Email sending & history
-- ============================================================

-- ── Email records ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Envelope
  from_email   TEXT NOT NULL,
  from_name    TEXT,
  to_email     TEXT NOT NULL,
  to_name      TEXT,
  cc           TEXT[] NOT NULL DEFAULT '{}',
  bcc          TEXT[] NOT NULL DEFAULT '{}',
  reply_to     TEXT,

  -- Content
  subject      TEXT NOT NULL,
  body_html    TEXT,
  body_text    TEXT,

  -- Delivery state
  status       TEXT NOT NULL DEFAULT 'queued',
  -- queued | sending | delivered | failed | bounced

  provider     TEXT,  -- smtp | sendgrid
  provider_id  TEXT,  -- message-id returned by provider
  error        TEXT,  -- last error message if failed

  -- CRM associations
  contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id      UUID REFERENCES deals(id)    ON DELETE SET NULL,
  ticket_id    UUID REFERENCES tickets(id)  ON DELETE SET NULL,
  sent_by      UUID REFERENCES users(id)    ON DELETE SET NULL,

  -- Tracking (set by webhook / pixel)
  sent_at      TIMESTAMPTZ,
  opened_at    TIMESTAMPTZ,
  clicked_at   TIMESTAMPTZ,

  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON emails
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_emails_tenant   ON emails(tenant_id, created_at DESC);
CREATE INDEX idx_emails_contact  ON emails(tenant_id, contact_id);
CREATE INDEX idx_emails_deal     ON emails(tenant_id, deal_id);
CREATE INDEX idx_emails_ticket   ON emails(tenant_id, ticket_id);
CREATE INDEX idx_emails_status   ON emails(tenant_id, status);
CREATE INDEX idx_emails_sent_by  ON emails(tenant_id, sent_by);

-- ── Email templates ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  body_text   TEXT,
  category    TEXT NOT NULL DEFAULT 'general',
  -- general | ticket_opened | ticket_resolved | deal_won | contact_welcome
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_templates
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_email_templates_tenant ON email_templates(tenant_id);
