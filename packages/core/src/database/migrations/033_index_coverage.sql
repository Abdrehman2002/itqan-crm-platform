-- ============================================================
-- Migration 033: B2 audit — close index gaps on hot paths
-- ============================================================
-- The backend audit found 2 genuinely missing indexes (every other
-- expected index was already covered). Both already applied live to
-- Supabase on 2026-06-26.

-- Used by the SLA worker every 5 minutes:
--   SELECT ... FROM tickets t LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
--   WHERE t.accepted_at IS NOT NULL AND t.status NOT IN ('resolved','closed')
CREATE INDEX IF NOT EXISTS idx_tickets_sla_policy
  ON tickets(tenant_id, sla_policy_id)
  WHERE sla_policy_id IS NOT NULL;

-- Used by ContactDetail.tsx "deals for this contact" panel:
--   GET /api/v1/deals?contactId=...
CREATE INDEX IF NOT EXISTS idx_deals_contact
  ON deals(tenant_id, contact_id)
  WHERE contact_id IS NOT NULL;
