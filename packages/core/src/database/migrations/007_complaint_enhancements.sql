-- ============================================================
-- CRM Platform — Complaint Management Enhancements
-- 1. Immutable audit log
-- 2. CSAT survey tokens & responses
-- 3. RCA fields on tickets
-- 4. ticket_type / preferred_channel / milestones columns
-- ============================================================

-- ── 1. RCA + extra columns on tickets ────────────────────────────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS root_cause         TEXT,
  ADD COLUMN IF NOT EXISTS corrective_action  TEXT,
  ADD COLUMN IF NOT EXISTS rca_completed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rca_completed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ticket_type        TEXT NOT NULL DEFAULT 'complaint',
  ADD COLUMN IF NOT EXISTS reporter_whatsapp  TEXT,
  ADD COLUMN IF NOT EXISTS preferred_channel  TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS milestones         JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(tenant_id, ticket_type);

-- ── 2. Immutable ticket audit log ─────────────────────────────────────────
-- Every state change, assignment, field update, comment, escalation is
-- written here. A trigger prevents any UPDATE or DELETE so the log is
-- tamper-proof at the database level.
CREATE TABLE IF NOT EXISTS ticket_audit_log (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,                           -- snapshot of name at time of action
  action      TEXT        NOT NULL,           -- status_changed | assigned | field_updated | comment_added | escalated | rca_submitted | csat_sent | csat_received
  old_value   JSONB,                          -- previous state (nullable)
  new_value   JSONB,                          -- new state
  meta        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS — agents can read their tenant's log; no one can write directly (use INSERT only via API)
ALTER TABLE ticket_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ticket_audit_log
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX IF NOT EXISTS idx_audit_log_ticket ON ticket_audit_log(ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON ticket_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON ticket_audit_log(actor_id)  WHERE actor_id IS NOT NULL;

-- Trigger: block UPDATE and DELETE so the log is tamper-proof
CREATE OR REPLACE FUNCTION ticket_audit_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ticket_audit_log is immutable — rows cannot be updated or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON ticket_audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON ticket_audit_log
  FOR EACH ROW EXECUTE FUNCTION ticket_audit_log_immutable();

-- ── 3. CSAT surveys ───────────────────────────────────────────────────────
-- One survey token is generated per ticket when it is closed.
-- The customer clicks the link in their closure email and submits a rating.
CREATE TABLE IF NOT EXISTS csat_surveys (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id      UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  token          TEXT        NOT NULL UNIQUE,           -- URL-safe random token (32 chars)
  reporter_email TEXT,
  reporter_name  TEXT,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  -- Response fields (NULL until customer responds)
  rating         INT         CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  responded_at   TIMESTAMPTZ,
  UNIQUE(ticket_id)                                     -- one survey per ticket
);

ALTER TABLE csat_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON csat_surveys
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX IF NOT EXISTS idx_csat_token  ON csat_surveys(token);
CREATE INDEX IF NOT EXISTS idx_csat_ticket ON csat_surveys(ticket_id);
CREATE INDEX IF NOT EXISTS idx_csat_tenant ON csat_surveys(tenant_id, sent_at DESC);
