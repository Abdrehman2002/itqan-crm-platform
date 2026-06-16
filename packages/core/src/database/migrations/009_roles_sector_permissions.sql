-- ============================================================
-- Migration 009: roles, custom_role_id, tenant sector, user permissions
-- These objects are referenced by the application code (auth/register/login,
-- roles & settings routes) but were missing from the migration set in this
-- snapshot. Added here so the schema matches the code.
-- ============================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sector TEXT NOT NULL DEFAULT 'other';
ALTER TABLE users   ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT DEFAULT '#6366f1',
  is_system   BOOLEAN NOT NULL DEFAULT false,
  base_role   TEXT NOT NULL DEFAULT 'agent',
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roles;
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id::text = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
