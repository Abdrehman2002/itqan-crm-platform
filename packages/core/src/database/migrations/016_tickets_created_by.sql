-- ============================================================
-- Migration 016: tickets.created_by
--
-- analytics.ts ops-dashboard filters tickets by created_by, but the column
-- was never added (the original schema only had owner_id, which has different
-- semantics — owner_id = who currently owns the contact, created_by = who
-- originally opened the ticket).
-- ============================================================

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_by UUID
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(tenant_id, created_by);
