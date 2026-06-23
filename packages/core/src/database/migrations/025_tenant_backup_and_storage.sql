-- Add backup tracking and storage usage columns to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS last_backup_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_bytes   BIGINT DEFAULT 0;

-- Password log table for super-admin credential management
CREATE TABLE IF NOT EXISTS super_admin_password_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID,
  action      TEXT        NOT NULL DEFAULT 'reset',
  changed_by  UUID,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sa_pwd_log_tenant ON super_admin_password_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sa_pwd_log_user   ON super_admin_password_log(user_id);
