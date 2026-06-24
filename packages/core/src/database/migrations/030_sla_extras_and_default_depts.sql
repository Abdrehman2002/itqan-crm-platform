-- ============================================================
-- Migration 030: SLA module extras (Munir Steps 2+3) + default departments
-- ============================================================
-- Pulled from munir/main (his 025_default_departments + SLA columns
-- needed by his tickets.ts SLA policy CRUD).
-- Renumbered to 030 to slot after our 029_audit_log_super_admin_bypass.sql.
-- Already applied to Supabase via SQA pull.
-- ============================================================

-- SLA module — business hours per-day schedule (jsonb)
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS business_hours_schedule jsonb;
-- SLA module — pause clock on Pending status
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS pause_on_pending boolean NOT NULL DEFAULT false;
-- SLA module — multi-step reminder schedule (jsonb array)
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS reminder_schedule jsonb;

-- Departments — is_system flag for the 3 standard depts
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Seed the three standard departments for every existing tenant
INSERT INTO departments (tenant_id, name, department_type, description, color, is_system)
SELECT t.id, d.name, d.department_type, d.description, d.color, true
FROM tenants t
CROSS JOIN (VALUES
  ('Sales',      'sales',            'Handles leads, deals and revenue generation',           '#29ABE2'),
  ('Support',    'support',          'Customer service, tickets and issue resolution',         '#57A93C'),
  ('Complaints', 'compliance_audit', 'Complaint handling, escalations and regulatory matters', '#f59e0b')
) AS d(name, department_type, description, color)
ON CONFLICT (tenant_id, name) DO UPDATE SET is_system = true;
