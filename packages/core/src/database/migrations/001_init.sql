-- ============================================================
-- CRM Platform - Initial Schema with Row-Level Security
-- Every table has tenant_id. RLS enforces isolation at DB level.
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- for fast text search

-- ============================================================
-- TENANTS (super-admin only, no RLS)
-- ============================================================
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,         -- subdomain
  custom_domain TEXT UNIQUE,
  plan          TEXT NOT NULL DEFAULT 'free',
  status        TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ,
  settings      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_custom_domain ON tenants(custom_domain);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL,
  password_hash TEXT,
  role         TEXT NOT NULL DEFAULT 'agent',
  avatar       TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  preferences  JSONB NOT NULL DEFAULT '{}',
  last_login_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(tenant_id, email);

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE companies (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  domain         TEXT,
  industry       TEXT,
  size           TEXT,
  annual_revenue NUMERIC,
  country        TEXT,
  city           TEXT,
  website        TEXT,
  phone          TEXT,
  owner_id       UUID REFERENCES users(id),
  tags           TEXT[] NOT NULL DEFAULT '{}',
  custom_fields  JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_companies_tenant ON companies(tenant_id);
CREATE INDEX idx_companies_name ON companies USING gin(name gin_trgm_ops);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE contacts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name       TEXT NOT NULL,
  last_name        TEXT,
  email            TEXT,
  phone            TEXT,
  mobile           TEXT,
  company_id       UUID REFERENCES companies(id),
  job_title        TEXT,
  department       TEXT,
  owner_id         UUID REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'lead',
  source           TEXT NOT NULL DEFAULT 'manual',
  tags             TEXT[] NOT NULL DEFAULT '{}',
  custom_fields    JSONB NOT NULL DEFAULT '{}',
  score            INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  do_not_call      BOOLEAN NOT NULL DEFAULT false,
  do_not_email     BOOLEAN NOT NULL DEFAULT false,
  last_contacted_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contacts
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_contacts_email ON contacts(tenant_id, email);
CREATE INDEX idx_contacts_phone ON contacts(tenant_id, phone);
CREATE INDEX idx_contacts_owner ON contacts(tenant_id, owner_id);
CREATE INDEX idx_contacts_search ON contacts USING gin(
  (first_name || ' ' || COALESCE(last_name, '') || ' ' || COALESCE(email, '')) gin_trgm_ops
);

-- ============================================================
-- PIPELINES & STAGES
-- ============================================================
CREATE TABLE pipelines (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  stages     JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pipelines
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_pipelines_tenant ON pipelines(tenant_id);

-- ============================================================
-- DEALS
-- ============================================================
CREATE TABLE deals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  contact_id    UUID REFERENCES contacts(id),
  company_id    UUID REFERENCES companies(id),
  pipeline_id   UUID NOT NULL REFERENCES pipelines(id),
  stage_id      TEXT NOT NULL,
  owner_id      UUID NOT NULL REFERENCES users(id),
  amount        NUMERIC,
  currency      TEXT NOT NULL DEFAULT 'USD',
  close_date    DATE,
  status        TEXT NOT NULL DEFAULT 'open',
  priority      TEXT NOT NULL DEFAULT 'medium',
  source        TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  custom_fields JSONB NOT NULL DEFAULT '{}',
  lost_reason   TEXT,
  won_at        TIMESTAMPTZ,
  lost_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deals
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_deals_tenant ON deals(tenant_id);
CREATE INDEX idx_deals_pipeline ON deals(tenant_id, pipeline_id, stage_id);
CREATE INDEX idx_deals_owner ON deals(tenant_id, owner_id);
CREATE INDEX idx_deals_status ON deals(tenant_id, status);

-- Deal change history for audit trail
CREATE TABLE deal_history (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL,
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  old_value  JSONB,
  new_value  JSONB,
  changed_by UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE deal_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deal_history
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- ============================================================
-- ACTIVITIES
-- ============================================================
CREATE TABLE activities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  priority     TEXT NOT NULL DEFAULT 'normal',
  contact_id   UUID REFERENCES contacts(id),
  company_id   UUID REFERENCES companies(id),
  deal_id      UUID REFERENCES deals(id),
  owner_id     UUID NOT NULL REFERENCES users(id),
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_at       TIMESTAMPTZ,
  duration     INTEGER,
  outcome      TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activities
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_activities_tenant ON activities(tenant_id);
CREATE INDEX idx_activities_contact ON activities(tenant_id, contact_id);
CREATE INDEX idx_activities_deal ON activities(tenant_id, deal_id);
CREATE INDEX idx_activities_owner ON activities(tenant_id, owner_id);
CREATE INDEX idx_activities_due ON activities(tenant_id, due_at) WHERE status = 'pending';

-- ============================================================
-- VOICE CALLS
-- ============================================================
CREATE TABLE voice_calls (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_call_id TEXT NOT NULL,
  provider         TEXT NOT NULL,
  direction        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'initiated',
  from_number      TEXT NOT NULL,
  to_number        TEXT NOT NULL,
  contact_id       UUID REFERENCES contacts(id),
  deal_id          UUID REFERENCES deals(id),
  agent_id         UUID REFERENCES users(id),
  bot_handled      BOOLEAN NOT NULL DEFAULT false,
  duration         INTEGER,
  recording_url    TEXT,
  transcript       JSONB,
  sentiment        JSONB,
  bot_intent       TEXT,
  bot_entities     JSONB,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  notes            TEXT,
  outcome          TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON voice_calls
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_voice_tenant ON voice_calls(tenant_id);
CREATE INDEX idx_voice_contact ON voice_calls(tenant_id, contact_id);
CREATE INDEX idx_voice_external_id ON voice_calls(tenant_id, external_call_id);
CREATE INDEX idx_voice_started_at ON voice_calls(tenant_id, started_at DESC);

-- ============================================================
-- API KEYS
-- ============================================================
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_prefix  TEXT NOT NULL,
  key_hash    TEXT NOT NULL,
  scopes      TEXT[] NOT NULL DEFAULT '{}',
  rate_limit  INTEGER,
  expires_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- ============================================================
-- WEBHOOKS
-- ============================================================
CREATE TABLE webhooks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  secret        TEXT NOT NULL,
  events        TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  headers       JSONB,
  retry_policy  JSONB NOT NULL DEFAULT '{"maxRetries":3,"backoffMs":1000}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhooks
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE TABLE webhook_deliveries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id  UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  event       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  status_code INTEGER,
  response    TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  succeeded   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- ============================================================
-- CUSTOM FIELDS DEFINITIONS
-- ============================================================
CREATE TABLE custom_field_definitions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity      TEXT NOT NULL,    -- 'contact' | 'company' | 'deal'
  name        TEXT NOT NULL,
  label       TEXT NOT NULL,
  field_type  TEXT NOT NULL,    -- 'text' | 'number' | 'date' | 'select' | 'boolean' | 'url'
  options     JSONB,            -- for 'select' type
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity, name)
);

ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_field_definitions
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- ============================================================
-- USAGE METERING (for billing)
-- ============================================================
CREATE TABLE usage_metrics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,    -- 'api_calls' | 'voice_minutes' | 'contacts'
  value       BIGINT NOT NULL DEFAULT 0,
  period      TEXT NOT NULL,    -- 'YYYY-MM'
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, metric, period)
);

-- Updated_at trigger for all main tables
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','companies','contacts','deals','activities']
  LOOP
    EXECUTE format('
      CREATE TRIGGER trg_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t);
  END LOOP;
END $$;
