-- ============================================================
-- Migration 031: SLA pause-on-pending + multi-step reminders
-- ============================================================
-- Adds the columns the SLA worker (modules/ticketing/src/index.ts) and the
-- ticket PATCH handler (packages/api/src/routes/tickets.ts) need to make
-- Munir's SLA Steps 2+3 actually function:
--
--   sla_paused_at        — set when ticket enters 'pending' status if the
--                          policy has pause_on_pending=true. Live pause.
--   sla_paused_total_ms  — accumulated pause time. Updated when the ticket
--                          leaves 'pending' status.
--   sla_reminders_sent   — { stepId: true } map so multi-step reminder
--                          schedules don't double-fire.
--
-- Already applied to Supabase live during SLA-1 work.
-- ============================================================

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_paused_at        TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_paused_total_ms  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_reminders_sent   JSONB  NOT NULL DEFAULT '{}'::jsonb;

-- Index for the worker's frequent "currently paused" filter
CREATE INDEX IF NOT EXISTS idx_tickets_sla_paused
  ON tickets(tenant_id, sla_paused_at)
  WHERE sla_paused_at IS NOT NULL;
