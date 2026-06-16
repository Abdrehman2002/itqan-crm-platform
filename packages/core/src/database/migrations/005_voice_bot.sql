-- ============================================================
-- MIGRATION 005: Voice Bot calls & configuration
-- ============================================================

-- ── Voice bot calls table ─────────────────────────────────
-- Stores inbound call records from third-party voice bot providers
-- (Vapi, Retell, Bland.ai, etc.) received via webhook.

CREATE TABLE IF NOT EXISTS voice_bot_calls (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Provider info
  provider         TEXT NOT NULL,          -- vapi | retell | bland | twilio_ai
  provider_call_id TEXT,                   -- call ID from the provider

  -- Call details
  from_number      TEXT,                   -- caller's number
  to_number        TEXT,                   -- helpline number dialled
  direction        TEXT NOT NULL DEFAULT 'inbound',
  duration_seconds INTEGER,
  status           TEXT NOT NULL DEFAULT 'completed',
  -- initiated | ringing | in_progress | completed | failed | no_answer

  -- Content
  transcript       TEXT,                   -- full conversation transcript
  summary          TEXT,                   -- AI-generated summary
  recording_url    TEXT,                   -- hosted recording link (if provider stores it)
  sentiment        TEXT,                   -- positive | neutral | negative | urgent

  -- Extracted ticket data (from AI analysis)
  extracted_subject     TEXT,
  extracted_priority    TEXT,
  extracted_category    TEXT,
  extracted_reporter_name  TEXT,
  extracted_reporter_email TEXT,

  -- CRM links
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ticket_id        UUID REFERENCES tickets(id)  ON DELETE SET NULL,

  -- Raw webhook payload (audit + debugging)
  raw_payload      JSONB NOT NULL DEFAULT '{}',

  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE voice_bot_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON voice_bot_calls
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_vbc_tenant    ON voice_bot_calls(tenant_id, created_at DESC);
CREATE INDEX idx_vbc_provider  ON voice_bot_calls(tenant_id, provider);
CREATE INDEX idx_vbc_ticket    ON voice_bot_calls(ticket_id);
CREATE INDEX idx_vbc_contact   ON voice_bot_calls(contact_id);
CREATE INDEX idx_vbc_prov_id   ON voice_bot_calls(provider, provider_call_id);

-- ── Voice bot configuration ───────────────────────────────
-- Per-tenant bot configuration stored alongside connector settings.
-- Actual credentials live in tenants.settings.connectors.*
-- This table stores the assistant / agent configuration.

CREATE TABLE IF NOT EXISTS voice_bot_configs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,              -- vapi | retell | bland | twilio_ai
  is_active    BOOLEAN NOT NULL DEFAULT true,

  -- Provider-specific IDs
  assistant_id TEXT,                       -- Vapi: assistant_id / Retell: agent_id
  phone_number TEXT,                       -- The helpline number published to customers

  -- Conversation configuration
  greeting_message TEXT,
  system_prompt    TEXT,                   -- Custom instructions for the AI agent
  language         TEXT NOT NULL DEFAULT 'en-US',
  voice_id         TEXT,                   -- Provider's voice ID

  -- Ticket extraction rules
  auto_create_ticket  BOOLEAN NOT NULL DEFAULT true,
  default_queue_id    UUID REFERENCES ticket_queues(id) ON DELETE SET NULL,
  default_priority    TEXT NOT NULL DEFAULT 'medium',
  keyword_urgency     TEXT[] NOT NULL DEFAULT ARRAY['urgent','emergency','critical','asap','immediately'],

  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, provider)
);

ALTER TABLE voice_bot_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON voice_bot_configs
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX idx_vbc_config_tenant ON voice_bot_configs(tenant_id);
