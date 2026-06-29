-- Migration 036 — system_audit_log for tenant-admin activity tracking.
-- Captures user/role/dept/settings changes (anything outside the ticket domain
-- that already has ticket_audit_log). The tenant_admin dashboard surfaces a
-- UNION of both so admins see "all activities done by tenant admin and sub
-- admins" as the user requested 2026-06-29.

CREATE TABLE IF NOT EXISTS system_audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_name   TEXT,
  actor_email  TEXT,
  actor_role   TEXT,
  action       TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,
  entity_id    UUID,
  entity_label TEXT,
  old_value    JSONB,
  new_value    JSONB,
  meta         JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_audit_tenant ON system_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_actor  ON system_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_entity ON system_audit_log(entity_type, entity_id);

ALTER TABLE system_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_audit_log FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON system_audit_log;
CREATE POLICY tenant_isolation ON system_audit_log
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE OR REPLACE FUNCTION system_audit_log_no_modify() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'system_audit_log entries are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_system_audit ON system_audit_log;
CREATE TRIGGER no_update_system_audit BEFORE UPDATE OR DELETE ON system_audit_log
  FOR EACH ROW EXECUTE FUNCTION system_audit_log_no_modify();
