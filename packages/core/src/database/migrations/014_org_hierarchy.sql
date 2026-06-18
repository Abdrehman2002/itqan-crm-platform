-- ============================================================
-- Migration 014: Org hierarchy + presence
-- Adds:
--   • users.manager_id   — structural reports-to relationship
--   • users.max_direct_reports — capacity cap per manager
--   • users.last_active_at — heartbeat for online/idle/offline
--   • UNIQUE (tenant, dept) for active role='manager' — enforces 1 manager per dept
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(tenant_id, manager_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS max_direct_reports INT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(tenant_id, last_active_at DESC);

-- Enforce: only one active manager per (tenant, department_type)
-- Partial index lets us still create a manager who's not yet active.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_manager_per_dept
  ON users (tenant_id, department_type)
  WHERE role = 'manager' AND is_active = true AND department_type IS NOT NULL;
