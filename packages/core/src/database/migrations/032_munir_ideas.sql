-- ============================================================
-- Migration 032: Munir's product ideas distilled
-- ============================================================
-- Source-of-truth schema for: holiday calendar, first-reply time,
-- NIC search, CSAT survey, smart SLA policy matching.
-- Already applied live to Supabase 2026-06-24.
-- ============================================================

-- ── M1: Holiday calendar ──
CREATE TABLE IF NOT EXISTS sla_holidays (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, date)
);
ALTER TABLE sla_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sla_holidays
  USING (tenant_id::text = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE sla_holidays FORCE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sla_holidays_tenant_date ON sla_holidays(tenant_id, date);

-- ── M2: First-reply time ──
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_replied_at TIMESTAMPTZ;

-- ── M4: NIC search ──
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS nic_number TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_nic ON contacts(tenant_id, nic_number) WHERE nic_number IS NOT NULL;

-- ── M6: CSAT survey ──
CREATE TABLE IF NOT EXISTS csat_surveys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rating        SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  responded_at  TIMESTAMPTZ,
  UNIQUE(tenant_id, ticket_id)
);
ALTER TABLE csat_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON csat_surveys
  USING (tenant_id::text = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE csat_surveys FORCE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_csat_token ON csat_surveys(token);
CREATE INDEX IF NOT EXISTS idx_csat_ticket ON csat_surveys(ticket_id);

-- ── M7: Smart SLA policy matching ──
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS match_conditions JSONB;
