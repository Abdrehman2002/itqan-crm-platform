-- Platform roles for sub-admins of the super admin
CREATE TABLE IF NOT EXISTS platform_roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link platform_admin users to a platform role
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role_id UUID REFERENCES platform_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_platform_role ON users(platform_role_id) WHERE platform_role_id IS NOT NULL;

GRANT ALL ON platform_roles TO crm;
