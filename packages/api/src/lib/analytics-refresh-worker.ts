/**
 * Analytics Refresh Worker
 *
 * Refreshes materialized views on startup and then every REFRESH_INTERVAL_MS.
 * Uses CONCURRENTLY so reads are never blocked during a refresh (requires the
 * unique indexes defined in migration 020).
 *
 * A single row per view is upserted into analytics_refresh_log after each
 * successful refresh — visible via GET /api/v1/analytics/refresh-status.
 *
 * With multiple API instances, every instance runs this worker.  That is
 * safe: REFRESH MATERIALIZED VIEW CONCURRENTLY takes a ShareUpdateExclusiveLock
 * (non-blocking for readers) and Postgres serialises concurrent refresh calls
 * — the second one to arrive simply sees the first already running and returns
 * immediately.
 */

import { logger } from '@crm/core/config/logger';
import type { DatabaseClient } from '@crm/core';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;  // 1 hour

const VIEWS = [
  'mv_daily_deal_stats',
  'mv_daily_ticket_stats',
  'mv_contact_source_stats',
  'mv_daily_activity_stats',
] as const;

export function startAnalyticsRefreshWorker(db: DatabaseClient): () => void {
  let running = true;
  let timer: NodeJS.Timeout;

  async function refresh() {
    for (const view of VIEWS) {
      if (!running) break;
      const start = Date.now();
      try {
        await db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
        const ms = Date.now() - start;
        await db.query(
          `INSERT INTO analytics_refresh_log (view_name, refreshed_at, duration_ms)
           VALUES ($1, NOW(), $2)
           ON CONFLICT (view_name) DO UPDATE
             SET refreshed_at = NOW(), duration_ms = EXCLUDED.duration_ms`,
          [view, ms],
        );
        logger.info('Analytics MV refreshed', { view, ms });
      } catch (err: any) {
        logger.error('Analytics MV refresh failed', { view, error: err.message });
      }
    }
  }

  async function tick() {
    if (!running) return;
    await refresh();
    if (running) timer = setTimeout(tick, REFRESH_INTERVAL_MS);
  }

  // Warm up immediately on startup, then hourly
  timer = setTimeout(tick, 0);

  return () => {
    running = false;
    clearTimeout(timer);
    logger.info('Analytics refresh worker stopped');
  };
}
