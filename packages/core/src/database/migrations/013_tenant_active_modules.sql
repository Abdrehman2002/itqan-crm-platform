-- ============================================================
-- Migration 013: tenants.active_modules
-- The application (modules route, settings module licensing,
-- super-admin module management, team invite) references
-- tenants.active_modules (text[]) — the set of product modules
-- licensed to a tenant. It was missing from the migration set.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS active_modules TEXT[] NOT NULL DEFAULT ARRAY['crm']::text[];
