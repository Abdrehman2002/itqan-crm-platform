-- Allow ON CONFLICT upsert when seeding system role permissions per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_base_system
  ON roles (tenant_id, base_role)
  WHERE is_system = true;
