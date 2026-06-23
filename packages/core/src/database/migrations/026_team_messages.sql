-- Team messaging: internal channels + DMs between users in a tenant
CREATE TABLE IF NOT EXISTS team_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_id    UUID        NOT NULL,
  sender_name  TEXT        NOT NULL,
  channel      TEXT,                          -- null = DM
  recipient_id UUID,                          -- null = channel message
  content      TEXT        NOT NULL,
  message_type TEXT        NOT NULL DEFAULT 'channel' CHECK (message_type IN ('channel', 'dm')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_msgs_tenant   ON team_messages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_msgs_channel  ON team_messages(tenant_id, channel, created_at DESC) WHERE channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_msgs_dm       ON team_messages(tenant_id, sender_id, recipient_id, created_at DESC) WHERE message_type = 'dm';

-- Default channels seed (optional - frontend can handle this)
-- '#general' is the default channel everyone can use
