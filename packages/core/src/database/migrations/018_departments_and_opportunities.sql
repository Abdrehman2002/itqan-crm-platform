-- ============================================================
-- Migration 018 — Departments Table + department_type column
--                 + Sales Opportunities Pipeline
-- Applied: 2026-06-19
--
-- Resolves:
--   (1) department_type referenced in API code but never added to DB
--   (2) departments as a managed entity (name, type, manager)
--   (3) sales_opportunities table for pre-invoice pipeline
-- ============================================================

-- ── 1. Fix: add department_type column that API code already references ──
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_type TEXT
    CHECK (department_type IN (
      'support', 'sales', 'compliance_audit',
      'finance_billing', 'technical_operations', 'operations'
    ));

CREATE INDEX IF NOT EXISTS idx_users_dept_type ON users(tenant_id, department_type)
  WHERE department_type IS NOT NULL;

-- Backfill: for existing rows that have a department text value, attempt
-- a keyword-based backfill for the most common names. This is best-effort;
-- the API's resolveDeptType() logic will handle the rest at runtime.
UPDATE users SET department_type =
  CASE
    WHEN department ILIKE '%support%' OR department ILIKE '%complaint%'
         OR department ILIKE '%service desk%' OR department ILIKE '%helpdesk%'
         THEN 'support'
    WHEN department ILIKE '%sales%' OR department ILIKE '%commercial%'
         OR department ILIKE '%retail%' OR department ILIKE '%revenue%'
         THEN 'sales'
    WHEN department ILIKE '%compliance%' OR department ILIKE '%audit%'
         OR department ILIKE '%legal%' OR department ILIKE '%risk%'
         THEN 'compliance_audit'
    WHEN department ILIKE '%finance%' OR department ILIKE '%billing%'
         OR department ILIKE '%payment%' OR department ILIKE '%accounts%'
         THEN 'finance_billing'
    WHEN department ILIKE '%technical%' OR department ILIKE '%it %'
         OR department ILIKE '%infrastructure%' OR department ILIKE '%broadband%'
         THEN 'technical_operations'
    WHEN department ILIKE '%operation%' OR department ILIKE '%logistics%'
         OR department ILIKE '%warehouse%' OR department ILIKE '%dispatch%'
         THEN 'operations'
    ELSE NULL
  END
WHERE department IS NOT NULL AND department_type IS NULL;

-- ── 2. Departments — managed entity ──────────────────────────────────────
-- A department is an organisational unit within a tenant.
-- Users are linked to departments via department_id (added below).
-- The head_user_id is the primary manager for the department.
CREATE TABLE IF NOT EXISTS departments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  department_type TEXT NOT NULL
    CHECK (department_type IN (
      'support', 'sales', 'compliance_audit',
      'finance_billing', 'technical_operations', 'operations'
    )),
  description   TEXT,
  head_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,  -- department head / manager
  color         TEXT NOT NULL DEFAULT '#6366f1',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON departments
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_departments_type   ON departments(tenant_id, department_type);
CREATE INDEX IF NOT EXISTS idx_departments_head   ON departments(head_user_id) WHERE head_user_id IS NOT NULL;

GRANT ALL ON departments TO crm;

-- ── 3. Link users to department entity ───────────────────────────────────
-- department_id FK — nullable; existing rows keep free-text department column
-- for backwards compatibility; new invites should set both.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(tenant_id, department_id)
  WHERE department_id IS NOT NULL;

-- ── 4. Sales Opportunities Pipeline ──────────────────────────────────────
-- Pre-invoice CRM pipeline stages:
--   assigned → accepted → contacted → quoted → kyc_requested → closed_won → closed_lost
--
-- Each opportunity is assigned to an agent (assignee_id) and linked
-- optionally to a CRM contact and/or company. The manager can see
-- all opportunities for their team via the manager_id hierarchy.

CREATE TABLE IF NOT EXISTS sales_opportunities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  opportunity_number TEXT NOT NULL,                        -- OPP-00001

  -- Stage flow
  stage           TEXT NOT NULL DEFAULT 'assigned'
    CHECK (stage IN (
      'assigned',       -- Opportunity created and assigned to agent
      'accepted',       -- Agent has accepted / acknowledged
      'contacted',      -- Agent has spoken to / emailed the customer
      'quoted',         -- Quotation has been sent to customer
      'kyc_requested',  -- KYC documents requested from customer
      'closed_won',     -- Deal successfully closed
      'closed_lost'     -- Deal lost / cancelled
    )),

  -- Relationships
  assignee_id     UUID REFERENCES users(id)      ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id)   ON DELETE SET NULL,
  company_id      UUID REFERENCES companies(id)  ON DELETE SET NULL,

  -- Opportunity details
  title           TEXT NOT NULL,
  description     TEXT,
  value           NUMERIC(15,2),
  currency        TEXT NOT NULL DEFAULT 'USD',
  probability     INT  NOT NULL DEFAULT 50 CHECK (probability BETWEEN 0 AND 100),
  expected_close  DATE,
  source          TEXT,                                    -- inbound / referral / cold_call / etc.
  tags            TEXT[] NOT NULL DEFAULT '{}',
  custom_fields   JSONB  NOT NULL DEFAULT '{}',

  -- Stage timestamps — set when entering that stage
  accepted_at     TIMESTAMPTZ,
  contacted_at    TIMESTAMPTZ,
  quoted_at       TIMESTAMPTZ,
  kyc_requested_at TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,

  -- Notes per stage
  contact_notes   TEXT,   -- notes from the customer conversation
  quote_reference TEXT,   -- quote number or reference
  kyc_notes       TEXT,   -- which documents were requested
  close_notes     TEXT,   -- win/loss reason

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, opportunity_number)
);

ALTER TABLE sales_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sales_opportunities
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX IF NOT EXISTS idx_opps_tenant    ON sales_opportunities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opps_stage     ON sales_opportunities(tenant_id, stage);
CREATE INDEX IF NOT EXISTS idx_opps_assignee  ON sales_opportunities(tenant_id, assignee_id);
CREATE INDEX IF NOT EXISTS idx_opps_contact   ON sales_opportunities(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_opps_created   ON sales_opportunities(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opps_close     ON sales_opportunities(tenant_id, expected_close)
  WHERE expected_close IS NOT NULL;

GRANT ALL ON sales_opportunities TO crm;

-- ── 5. Opportunity counter (one row per tenant) ───────────────────────────
CREATE TABLE IF NOT EXISTS opportunity_counters (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_val  BIGINT NOT NULL DEFAULT 1
);

GRANT ALL ON opportunity_counters TO crm;

-- ── 6. Opportunity audit log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunity_audit_log (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opp_id      UUID        NOT NULL REFERENCES sales_opportunities(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,
  action      TEXT        NOT NULL,  -- stage_changed | assigned | field_updated | note_added
  old_value   JSONB,
  new_value   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE opportunity_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON opportunity_audit_log
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX IF NOT EXISTS idx_opp_audit_opp    ON opportunity_audit_log(opp_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_opp_audit_tenant ON opportunity_audit_log(tenant_id, created_at DESC);

GRANT ALL ON opportunity_audit_log TO crm;
