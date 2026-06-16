-- ============================================================
-- Migration 010: Milestone templates + Queue routing columns
-- These objects are referenced by the application code
-- (settings routes, voice-bot ticket creation) but were
-- missing from the migration set.
-- ============================================================

-- ── 1. ticket_milestone_templates ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_milestone_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_type TEXT NOT NULL,   -- complaint | inquiry | sales
  name        TEXT NOT NULL DEFAULT 'Default',
  steps       JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, ticket_type)
);

ALTER TABLE ticket_milestone_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ticket_milestone_templates;
CREATE POLICY tenant_isolation ON ticket_milestone_templates
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX IF NOT EXISTS idx_milestone_templates_tenant
  ON ticket_milestone_templates(tenant_id);

-- ── 2. Queue routing columns ──────────────────────────────────────────────────
ALTER TABLE ticket_queues
  ADD COLUMN IF NOT EXISTS routing_method   TEXT NOT NULL DEFAULT 'pull',
  ADD COLUMN IF NOT EXISTS routing_criteria JSONB NOT NULL DEFAULT '{}';

-- ── 3. Seed default milestone templates for all existing tenants ──────────────
INSERT INTO ticket_milestone_templates (tenant_id, ticket_type, name, steps)
SELECT
  t.id,
  'complaint',
  'Complaint Resolution',
  '[
    {"id":"step-1","label":"Complaint Received","description":"Ticket logged and acknowledged","order":0},
    {"id":"step-2","label":"Under Investigation","description":"Agent is reviewing the complaint","order":1},
    {"id":"step-3","label":"Root Cause Identified","description":"Root cause of the issue found","order":2},
    {"id":"step-4","label":"Corrective Action Taken","description":"Fix or remediation applied","order":3},
    {"id":"step-5","label":"Resolution Confirmed","description":"Customer notified and issue closed","order":4}
  ]'::jsonb
FROM tenants t
ON CONFLICT (tenant_id, ticket_type) DO NOTHING;

INSERT INTO ticket_milestone_templates (tenant_id, ticket_type, name, steps)
SELECT
  t.id,
  'inquiry',
  'Support Resolution',
  '[
    {"id":"step-1","label":"Query Received","description":"Support request logged","order":0},
    {"id":"step-2","label":"Assigned to Specialist","description":"Routed to the right team member","order":1},
    {"id":"step-3","label":"Response Prepared","description":"Answer or solution drafted","order":2},
    {"id":"step-4","label":"Solution Sent to Customer","description":"Customer notified of resolution","order":3}
  ]'::jsonb
FROM tenants t
ON CONFLICT (tenant_id, ticket_type) DO NOTHING;

INSERT INTO ticket_milestone_templates (tenant_id, ticket_type, name, steps)
SELECT
  t.id,
  'sales',
  'Sales Pipeline',
  '[
    {"id":"step-1","label":"Lead Received","description":"Sales enquiry captured","order":0},
    {"id":"step-2","label":"Initial Contact Made","description":"Sales agent has called or emailed the lead","order":1},
    {"id":"step-3","label":"Proposal Sent","description":"Quote or proposal delivered to customer","order":2},
    {"id":"step-4","label":"Follow-up Call Done","description":"Post-proposal follow-up completed","order":3},
    {"id":"step-5","label":"Deal Closed","description":"Won or Lost — outcome recorded","order":4}
  ]'::jsonb
FROM tenants t
ON CONFLICT (tenant_id, ticket_type) DO NOTHING;

-- ── 4. Seed complaint / support / sales queues for existing tenants ────────────
-- (Complaint queue)
INSERT INTO ticket_queues (tenant_id, name, description, color, is_default, routing_method)
SELECT id, 'Complaints Queue', 'Handles all complaint tickets', '#dc2626', false, 'pull'
FROM tenants
ON CONFLICT DO NOTHING;

-- (Support queue)
INSERT INTO ticket_queues (tenant_id, name, description, color, is_default, routing_method)
SELECT id, 'Support Queue', 'Handles support and inquiry tickets', '#2563eb', false, 'pull'
FROM tenants
ON CONFLICT DO NOTHING;

-- (Sales queue)
INSERT INTO ticket_queues (tenant_id, name, description, color, is_default, routing_method)
SELECT id, 'Sales Queue', 'Handles sales tickets and leads', '#16a34a', false, 'pull'
FROM tenants
ON CONFLICT DO NOTHING;
