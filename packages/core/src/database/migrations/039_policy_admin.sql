-- Migration 039 — policy governance role.
-- Sourced from Munir's 034_policy_admin (his 034 conflicted with our
-- 034_soft_delete_users, so we re-numbered).
--
-- New system role policy_admin (ROLE_LEVEL 25, between manager 30 and agent 20)
-- is the ONLY role that can write SLA policies. tenant_admin can create the user
-- but cannot write SLA themselves. manager and lower roles are read-only on SLA.
--
-- governed_departments scopes a policy_admin to one or more departments.
-- An empty array means "all" — but the invite UI requires at least one selection
-- so this is mostly a fallback default for legacy rows.
--
-- sla_policies.ticket_type — 'sales' | 'complaint' | 'support' | NULL = all
-- so a policy_admin governing 'sales' can write/edit only sales policies.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS governed_departments TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE sla_policies
  ADD COLUMN IF NOT EXISTS ticket_type TEXT;

CREATE INDEX IF NOT EXISTS idx_sla_policies_ticket_type
  ON sla_policies(tenant_id, ticket_type);

CREATE INDEX IF NOT EXISTS idx_users_governed_depts
  ON users USING GIN (governed_departments);
