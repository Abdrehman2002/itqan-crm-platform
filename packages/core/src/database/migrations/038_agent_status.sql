-- Migration 038 — agent presence/status (online/away/busy/offline).
-- Sourced from Munir's 032_agent_status (his 032 conflicted with our 032_munir_ideas,
-- so we re-numbered). Agents set this manually from a presence widget in the
-- sidebar; auto-assignment routing should skip 'offline' agents.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS agent_status TEXT NOT NULL DEFAULT 'offline'
    CHECK (agent_status IN ('online','away','busy','offline')),
  ADD COLUMN IF NOT EXISTS agent_status_updated_at TIMESTAMPTZ DEFAULT NOW();
