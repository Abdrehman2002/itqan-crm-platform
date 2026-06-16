-- ============================================================
-- Migration 012: users.department
-- The application (auth login/register JWT claims, analytics
-- ops-dashboard department breakdown) references users.department,
-- but it was missing from the migration set. Added here so the
-- schema matches the code.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
-- department_type: explicit dept category (sales/support/complaints/...) used by
-- team invite + permission defaults, instead of fragile keyword matching on name.
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_type TEXT;

CREATE INDEX IF NOT EXISTS idx_users_department ON users(tenant_id, department);
