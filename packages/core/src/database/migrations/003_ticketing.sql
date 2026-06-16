-- ============================================================
-- CRM Platform - Ticketing Module Schema
-- Ticket queues, SLA policies, tickets, comments,
-- escalations, and in-app notifications
-- ============================================================

-- ── In-app notifications (shared by all modules) ──────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  type        TEXT NOT NULL,                        -- sla_reminder / sla_breach / sla_escalated / ticket_assigned / ticket_accepted / etc.
  title       TEXT NOT NULL,
  body        TEXT,
  entity_type TEXT,                                 -- 'ticket', 'deal', etc.
  entity_id   UUID,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON notifications
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_notifications_user   ON notifications(tenant_id, user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_entity ON notifications(entity_type, entity_id);

-- ── Ticket queues ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_queues (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT DEFAULT '#6366f1',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticket_queues ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ticket_queues
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_ticket_queues_tenant ON ticket_queues(tenant_id);

-- ── SLA policies ──────────────────────────────────────────────────────────
-- first_response_hours: time from ticket creation to first agent reply
-- resolution_hours:     time from AGENT ACCEPTANCE to resolution
-- reminder_pct:         % of resolution time at which to fire reminder (default 80)
-- l1_escalation_pct:    % of resolution time at which L1 escalation fires (default 100 = breach)
-- l2_escalation_pct:    % of resolution time at which L2 escalation fires (default 150)
CREATE TABLE IF NOT EXISTS sla_policies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  priority              TEXT NOT NULL DEFAULT 'medium',  -- urgent/high/medium/low
  first_response_hours  INT  NOT NULL DEFAULT 4,
  resolution_hours      INT  NOT NULL DEFAULT 24,
  reminder_pct          INT  NOT NULL DEFAULT 80,
  l1_escalation_pct     INT  NOT NULL DEFAULT 100,
  l2_escalation_pct     INT  NOT NULL DEFAULT 150,
  business_hours_only   BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sla_policies
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_sla_policies_tenant ON sla_policies(tenant_id);

-- ── Ticket number counter (one row per tenant) ────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_counters (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_val  BIGINT NOT NULL DEFAULT 1
);

-- ── Tickets ───────────────────────────────────────────────────────────────
-- Status flow:
--   open → assigned → accepted → in_progress → pending → resolved → closed
--
-- SLA timer: starts at accepted_at (when agent clicks "Accept")
-- escalation_level: 0=none  1=supervisor notified  2=admin notified
CREATE TABLE IF NOT EXISTS tickets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  ticket_number       TEXT NOT NULL,                               -- TKT-00001
  subject             TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'open',
  priority            TEXT NOT NULL DEFAULT 'medium',
  channel             TEXT NOT NULL DEFAULT 'manual',              -- manual / voice_bot / email / api
  source              TEXT,                                        -- extra metadata on source
  queue_id            UUID REFERENCES ticket_queues(id)           ON DELETE SET NULL,
  sla_policy_id       UUID REFERENCES sla_policies(id)            ON DELETE SET NULL,
  contact_id          UUID REFERENCES contacts(id)                ON DELETE SET NULL,
  company_id          UUID REFERENCES companies(id)               ON DELETE SET NULL,
  assignee_id         UUID REFERENCES users(id)                   ON DELETE SET NULL,
  reporter_email      TEXT,
  reporter_name       TEXT,
  reporter_phone      TEXT,
  voice_call_id       UUID REFERENCES voice_calls(id)             ON DELETE SET NULL,
  tags                TEXT[]  NOT NULL DEFAULT '{}',
  custom_fields       JSONB   NOT NULL DEFAULT '{}',

  -- SLA timestamps (all driven from accepted_at)
  accepted_at         TIMESTAMPTZ,                                 -- agent accepted → timer starts
  sla_due_at          TIMESTAMPTZ,                                 -- computed: accepted_at + sla.resolution_hours
  reminder_sent_at    TIMESTAMPTZ,                                 -- when 80% reminder was sent
  first_response_at   TIMESTAMPTZ,                                 -- first agent reply timestamp
  escalation_level    INT     NOT NULL DEFAULT 0,                  -- 0 / 1 / 2
  escalated_l1_at     TIMESTAMPTZ,
  escalated_l2_at     TIMESTAMPTZ,

  resolved_at         TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  resolution_note     TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, ticket_number)
);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tickets
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_tickets_tenant       ON tickets(tenant_id);
CREATE INDEX idx_tickets_status       ON tickets(tenant_id, status);
CREATE INDEX idx_tickets_assignee     ON tickets(tenant_id, assignee_id);
CREATE INDEX idx_tickets_queue        ON tickets(tenant_id, queue_id);
CREATE INDEX idx_tickets_contact      ON tickets(tenant_id, contact_id);
CREATE INDEX idx_tickets_priority     ON tickets(tenant_id, priority);
CREATE INDEX idx_tickets_created      ON tickets(tenant_id, created_at DESC);
CREATE INDEX idx_tickets_sla_due      ON tickets(tenant_id, sla_due_at)  WHERE sla_due_at IS NOT NULL;
CREATE INDEX idx_tickets_voice        ON tickets(voice_call_id)           WHERE voice_call_id IS NOT NULL;

-- ── Ticket comments ───────────────────────────────────────────────────────
-- is_internal = true  → visible to agents only (internal notes / discussion)
-- is_internal = false → customer-visible reply
CREATE TABLE IF NOT EXISTS ticket_comments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  ticket_id    UUID NOT NULL REFERENCES tickets(id)   ON DELETE CASCADE,
  author_id    UUID          REFERENCES users(id)      ON DELETE SET NULL,
  author_name  TEXT,                                   -- fallback for external senders
  author_email TEXT,
  body         TEXT NOT NULL,
  is_internal  BOOLEAN NOT NULL DEFAULT false,
  attachments  JSONB   NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ticket_comments
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_ticket_comments_ticket ON ticket_comments(ticket_id, created_at ASC);
CREATE INDEX idx_ticket_comments_tenant ON ticket_comments(tenant_id);

-- ── Escalation audit log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_escalations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  ticket_id       UUID NOT NULL REFERENCES tickets(id)  ON DELETE CASCADE,
  escalation_level INT  NOT NULL,                        -- 1 or 2
  reason          TEXT NOT NULL,                         -- 'sla_breach' / 'manual' / 'timeout_l2'
  notified_users  UUID[],                                -- who was notified
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticket_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ticket_escalations
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_ticket_escalations_ticket ON ticket_escalations(ticket_id);

-- ── Seed default data for existing tenants ────────────────────────────────
INSERT INTO ticket_queues (tenant_id, name, description, color, is_default)
SELECT id, 'General Support', 'Default support queue', '#6366f1', true
FROM tenants
ON CONFLICT DO NOTHING;

-- Default SLA policies (4 priority tiers)
INSERT INTO sla_policies (tenant_id, name, priority, first_response_hours, resolution_hours, reminder_pct, l1_escalation_pct, l2_escalation_pct)
SELECT id, 'Urgent',  'urgent', 1,  4,  80, 100, 150 FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO sla_policies (tenant_id, name, priority, first_response_hours, resolution_hours, reminder_pct, l1_escalation_pct, l2_escalation_pct)
SELECT id, 'High',    'high',   2,  8,  80, 100, 150 FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO sla_policies (tenant_id, name, priority, first_response_hours, resolution_hours, reminder_pct, l1_escalation_pct, l2_escalation_pct)
SELECT id, 'Medium',  'medium', 4,  24, 80, 100, 150 FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO sla_policies (tenant_id, name, priority, first_response_hours, resolution_hours, reminder_pct, l1_escalation_pct, l2_escalation_pct)
SELECT id, 'Low',     'low',    8,  72, 80, 100, 150 FROM tenants ON CONFLICT DO NOTHING;
