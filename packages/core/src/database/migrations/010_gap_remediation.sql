-- ============================================================
-- Migration 010 — Gap Remediation (Gaps 1–5 + Queue Routing)
-- Applied: 2026-06-10
-- ============================================================

-- ── Gap 1: First-Response SLA columns ───────────────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS first_response_breached    BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_response_warned      BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_response_breached_at TIMESTAMPTZ;

-- ── Gap 2: Queue agent membership ───────────────────────────
CREATE TABLE IF NOT EXISTS queue_members (
  queue_id  UUID NOT NULL REFERENCES ticket_queues(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (queue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_members_user ON queue_members(user_id);

-- Per-agent ticket limit: stored in tenants.settings JSONB as
--   { "routing": { "per_agent_ticket_limit": 6, "routing_method": "capacity" } }
-- No schema change needed — uses existing tenants.settings JSONB column.

-- ── Gap 2: Manager override tracking on tickets ──────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS manager_overridden_by   UUID,
  ADD COLUMN IF NOT EXISTS manager_overridden_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_override_note   TEXT,
  ADD COLUMN IF NOT EXISTS prev_assignee_id        UUID;   -- who had it before manager moved it

-- ── Gap 3: Reassignment audit log (reuses ticket_escalations) ─
-- No new table needed — we write to ticket_activities / notifications.

-- ── Gap 4: CSAT expiry days in tenant settings ───────────────
-- Uses tenants.settings JSONB: { "csat_expiry_days": 7 }
-- No schema change needed.

-- ── Gap 5: Ticket tag master table ──────────────────────────
CREATE TABLE IF NOT EXISTS ticket_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6b7280',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ticket_tags_tenant ON ticket_tags(tenant_id);

-- Enable RLS on ticket_tags
ALTER TABLE ticket_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ticket_tags;
CREATE POLICY tenant_isolation ON ticket_tags
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Enable RLS on queue_members (no tenant_id — protected via queue ownership)
ALTER TABLE queue_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS queue_member_isolation ON queue_members;
CREATE POLICY queue_member_isolation ON queue_members
  USING (
    queue_id IN (
      SELECT id FROM ticket_queues
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );
