-- Migration 020: Analytics materialized views
--
-- Pre-aggregates the heaviest OLTP analytics queries into materialized views
-- so dashboard endpoints read from pre-computed data instead of scanning
-- million-row tables on every request.
--
-- Each view is tenant-partitioned (tenant_id column) so per-tenant queries
-- remain fast with a WHERE clause.  RLS is NOT applied to MVs (they are
-- not regular tables), so routes must always filter by tenant_id explicitly.
--
-- Refresh is handled by the analytics-refresh worker (hourly, concurrent).

-- ── 1. Daily deal stats ────────────────────────────────────────────────────
-- Backs: GET /analytics/revenue (last N months, grouped by day/month)
--        GET /analytics/leaderboard (deals won + revenue per owner)

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_deal_stats AS
SELECT
  tenant_id,
  owner_id,
  DATE_TRUNC('day', won_at)::date          AS day,
  COUNT(*) FILTER (WHERE status = 'won')   AS deals_won,
  COUNT(*) FILTER (WHERE status = 'lost')  AS deals_lost,
  COALESCE(SUM(amount) FILTER (WHERE status = 'won'), 0)::float8 AS revenue_won
FROM deals
WHERE won_at IS NOT NULL
GROUP BY 1, 2, 3
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_deal_stats_pk
  ON mv_daily_deal_stats (tenant_id, owner_id, day);

CREATE INDEX IF NOT EXISTS mv_daily_deal_stats_tenant_day
  ON mv_daily_deal_stats (tenant_id, day);

-- ── 2. Daily ticket stats ──────────────────────────────────────────────────
-- Backs: GET /ticket-analytics/trends
--        GET /ticket-analytics/resolution

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_ticket_stats AS
SELECT
  tenant_id,
  DATE_TRUNC('day', created_at)::date                              AS day,
  ticket_type,
  channel,
  priority,
  COUNT(*)                                                          AS total,
  COUNT(*) FILTER (WHERE status IN ('resolved','closed'))          AS resolved,
  COUNT(*) FILTER (WHERE sla_due_at < NOW()
                   AND status NOT IN ('resolved','closed'))        AS sla_breached,
  ROUND(AVG(
    CASE WHEN first_response_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (first_response_at - created_at))/60
    END
  )::numeric, 2)::float8                                           AS avg_first_response_mins,
  ROUND(AVG(
    CASE WHEN resolved_at IS NOT NULL AND accepted_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (resolved_at - accepted_at))/3600
    END
  )::numeric, 2)::float8                                           AS avg_resolution_hrs
FROM tickets
GROUP BY 1, 2, 3, 4, 5
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_ticket_stats_pk
  ON mv_daily_ticket_stats (tenant_id, day, ticket_type, channel, priority);

CREATE INDEX IF NOT EXISTS mv_daily_ticket_stats_tenant_day
  ON mv_daily_ticket_stats (tenant_id, day);

-- ── 3. Contact source stats ────────────────────────────────────────────────
-- Backs: GET /analytics/contact-sources

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_contact_source_stats AS
SELECT
  tenant_id,
  COALESCE(source, 'unknown')                         AS source,
  COUNT(*)                                             AS total,
  COUNT(*) FILTER (WHERE status = 'customer')         AS converted
FROM contacts
GROUP BY 1, 2
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_contact_source_stats_pk
  ON mv_contact_source_stats (tenant_id, source);

-- ── 4. Daily activity stats ────────────────────────────────────────────────
-- Backs: GET /analytics/leaderboard (activities_completed + voice calls per user)

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_activity_stats AS
SELECT
  a.tenant_id,
  a.owner_id,
  DATE_TRUNC('day', a.completed_at)::date  AS day,
  COUNT(*)                                  AS activities_completed,
  COUNT(*) FILTER (WHERE a.type = 'call')  AS calls_logged
FROM activities a
WHERE a.status = 'completed'
  AND a.completed_at IS NOT NULL
GROUP BY 1, 2, 3
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_activity_stats_pk
  ON mv_daily_activity_stats (tenant_id, owner_id, day);

CREATE INDEX IF NOT EXISTS mv_daily_activity_stats_tenant_day
  ON mv_daily_activity_stats (tenant_id, day);

-- ── Refresh tracking table ─────────────────────────────────────────────────
-- The analytics worker writes here after each refresh so operators can
-- monitor staleness via GET /api/v1/analytics/refresh-status.

CREATE TABLE IF NOT EXISTS analytics_refresh_log (
  view_name    TEXT        NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms  INTEGER,
  PRIMARY KEY (view_name)
);
