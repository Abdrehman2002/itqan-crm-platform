/**
 * Ticket Analytics routes — /api/v1/tickets/analytics
 *
 * Endpoints:
 *   GET /trends        — complaint volume over time (day/week/month), filterable by priority/channel/type
 *   GET /heatmap       — recurring issue heatmap: top categories/tags by volume + repeat rate
 *   GET /resolution    — avg resolution time, first-response time, SLA compliance % over time
 *   GET /csat/summary  → forwarded from csat.ts (registered separately)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';

const TrendsQuerySchema = z.object({
  period:    z.enum(['day', 'week', 'month']).default('day'),
  days:      z.coerce.number().min(7).max(365).default(30),
  priority:  z.string().optional(),   // urgent | high | medium | low
  channel:   z.string().optional(),   // manual | voice_bot | email | etc.
  ticketType:z.string().optional(),   // complaint | inquiry | sales
  queueId:   z.string().uuid().optional(),
});

const HeatmapQuerySchema = z.object({
  days:     z.coerce.number().min(7).max(365).default(90),
  topN:     z.coerce.number().min(5).max(50).default(15),
});

const ResolutionQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
  days:   z.coerce.number().min(7).max(365).default(90),
});

export function ticketAnalyticsRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    const preHandler = [requireScope('tickets:read')];

    // ── GET /trends ────────────────────────────────────────────────────────
    // Reads from mv_daily_ticket_stats (refreshed hourly).
    // Falls back to live query only when optional filters (queueId) are
    // requested that are not captured in the MV.
    fastify.get('/trends', { preHandler }, async (req, reply) => {
      const q = TrendsQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;

      // queueId can't be pre-aggregated in the MV — fall back to live query
      if (q.queueId) {
        const filters: string[] = [];
        const params: any[] = [q.period, q.days, tenantId];
        let p = 4;
        if (q.priority)    { filters.push(`priority = $${p++}`);    params.push(q.priority); }
        if (q.channel)     { filters.push(`channel = $${p++}`);     params.push(q.channel); }
        if (q.ticketType)  { filters.push(`ticket_type = $${p++}`); params.push(q.ticketType); }
        filters.push(`queue_id = $${p++}`); params.push(q.queueId);
        const filterSql = 'AND ' + filters.join(' AND ');

        const rows = await db.withTenant(tenantId, async (c) => {
          const r = await c.query(`
            WITH periods AS (
              SELECT generate_series(
                DATE_TRUNC($1, NOW() - ($2 || ' days')::INTERVAL),
                DATE_TRUNC($1, NOW()),
                ('1 ' || $1)::INTERVAL
              ) AS period
            ),
            actuals AS (
              SELECT DATE_TRUNC($1, created_at) AS period,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status IN ('resolved','closed')) AS resolved,
                COUNT(*) FILTER (WHERE sla_due_at < NOW() AND status NOT IN ('resolved','closed')) AS sla_breached,
                COUNT(*) FILTER (WHERE priority='urgent') AS urgent,
                COUNT(*) FILTER (WHERE priority='high')   AS high,
                COUNT(*) FILTER (WHERE priority='medium') AS medium,
                COUNT(*) FILTER (WHERE priority='low')    AS low,
                COUNT(*) FILTER (WHERE channel='voice_bot') AS via_voice,
                COUNT(*) FILTER (WHERE channel='email')     AS via_email,
                COUNT(*) FILTER (WHERE channel='manual')    AS via_manual
              FROM tickets
              WHERE tenant_id=$3 AND created_at >= NOW() - ($2 || ' days')::INTERVAL ${filterSql}
              GROUP BY 1
            )
            SELECT p.period,
              COALESCE(a.total,0) AS total, COALESCE(a.resolved,0) AS resolved,
              COALESCE(a.sla_breached,0) AS sla_breached,
              COALESCE(a.urgent,0) AS urgent, COALESCE(a.high,0) AS high,
              COALESCE(a.medium,0) AS medium, COALESCE(a.low,0) AS low,
              COALESCE(a.via_voice,0) AS via_voice, COALESCE(a.via_email,0) AS via_email,
              COALESCE(a.via_manual,0) AS via_manual
            FROM periods p LEFT JOIN actuals a USING (period) ORDER BY p.period`, params);
          return r.rows;
        });
        return reply.send({ success: true, data: rows });
      }

      // Fast path: read from materialized view
      const mvFilters: string[] = ['tenant_id = $1', 'day >= (NOW() - ($2 || \' days\')::INTERVAL)::date'];
      const mvParams: any[] = [tenantId, q.days];
      let p = 3;
      if (q.priority)   { mvFilters.push(`priority = $${p++}`);    mvParams.push(q.priority); }
      if (q.channel)    { mvFilters.push(`channel = $${p++}`);     mvParams.push(q.channel); }
      if (q.ticketType) { mvFilters.push(`ticket_type = $${p++}`); mvParams.push(q.ticketType); }

      const result = await db.query(`
        WITH periods AS (
          SELECT generate_series(
            DATE_TRUNC($3_period, NOW() - ($2 || ' days')::INTERVAL),
            DATE_TRUNC($3_period, NOW()),
            ('1 ' || $3_period)::INTERVAL
          ) AS period
        ),
        actuals AS (
          SELECT
            DATE_TRUNC('${q.period}', day)   AS period,
            SUM(total)::int                  AS total,
            SUM(resolved)::int               AS resolved,
            SUM(sla_breached)::int           AS sla_breached,
            SUM(CASE WHEN priority='urgent' THEN total ELSE 0 END)::int AS urgent,
            SUM(CASE WHEN priority='high'   THEN total ELSE 0 END)::int AS high,
            SUM(CASE WHEN priority='medium' THEN total ELSE 0 END)::int AS medium,
            SUM(CASE WHEN priority='low'    THEN total ELSE 0 END)::int AS low,
            SUM(CASE WHEN channel='voice_bot' THEN total ELSE 0 END)::int AS via_voice,
            SUM(CASE WHEN channel='email'     THEN total ELSE 0 END)::int AS via_email,
            SUM(CASE WHEN channel='manual'    THEN total ELSE 0 END)::int AS via_manual
          FROM mv_daily_ticket_stats
          WHERE ${mvFilters.join(' AND ')}
          GROUP BY 1
        )
        SELECT p.period,
          COALESCE(a.total,0) AS total, COALESCE(a.resolved,0) AS resolved,
          COALESCE(a.sla_breached,0) AS sla_breached,
          COALESCE(a.urgent,0) AS urgent, COALESCE(a.high,0) AS high,
          COALESCE(a.medium,0) AS medium, COALESCE(a.low,0) AS low,
          COALESCE(a.via_voice,0) AS via_voice, COALESCE(a.via_email,0) AS via_email,
          COALESCE(a.via_manual,0) AS via_manual
        FROM periods p LEFT JOIN actuals a USING (period) ORDER BY p.period`
        .replaceAll('$3_period', `'${q.period}'`),
        mvParams,
      );
      return reply.send({ success: true, data: result.rows });
    });

    // ── GET /heatmap ───────────────────────────────────────────────────────
    // Top recurring complaint categories (tags) with repeat-customer detection
    fastify.get('/heatmap', { preHandler }, async (req, reply) => {
      const q = HeatmapQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;

      // Top tags by frequency
      const tagRows = await db.withTenant(tenantId, async (c) => {
        const r = await c.query(`
          SELECT
            tag,
            COUNT(*)                                              AS total,
            COUNT(*) FILTER (WHERE status IN ('resolved','closed')) AS resolved,
            COUNT(*) FILTER (WHERE sla_due_at < NOW()
                             AND status NOT IN ('resolved','closed')) AS sla_breached,
            ROUND(AVG(
              CASE WHEN resolved_at IS NOT NULL AND accepted_at IS NOT NULL
                   THEN EXTRACT(EPOCH FROM (resolved_at - accepted_at))/3600
              END
            )::numeric, 1)::float8                               AS avg_resolution_hrs
          FROM tickets, unnest(tags) AS tag
          WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
          GROUP BY tag
          ORDER BY total DESC
          LIMIT $2
        `, [q.days, q.topN]);
        return r.rows;
      });

      // Repeat reporters (same email, >1 ticket in window)
      const repeatReporters = await db.withTenant(tenantId, async (c) => {
        const r = await c.query(`
          SELECT reporter_email, COUNT(*) AS ticket_count
          FROM tickets
          WHERE reporter_email IS NOT NULL
            AND created_at >= NOW() - ($1 || ' days')::INTERVAL
          GROUP BY reporter_email
          HAVING COUNT(*) > 1
          ORDER BY ticket_count DESC
          LIMIT 10
        `, [q.days]);
        return r.rows;
      });

      // Volume by ticket_type
      const byType = await db.withTenant(tenantId, async (c) => {
        const r = await c.query(`
          SELECT ticket_type, COUNT(*) AS total
          FROM tickets
          WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
          GROUP BY ticket_type
          ORDER BY total DESC
        `, [q.days]);
        return r.rows;
      });

      // Volume by channel
      const byChannel = await db.withTenant(tenantId, async (c) => {
        const r = await c.query(`
          SELECT channel, COUNT(*) AS total
          FROM tickets
          WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
          GROUP BY channel
          ORDER BY total DESC
        `, [q.days]);
        return r.rows;
      });

      return reply.send({
        success: true,
        data: { topTags: tagRows, repeatReporters, byType, byChannel },
      });
    });

    // ── GET /resolution ────────────────────────────────────────────────────
    // Avg resolution time, first-response time, and SLA compliance % per period
    fastify.get('/resolution', { preHandler }, async (req, reply) => {
      const q = ResolutionQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;

      const rows = await db.withTenant(tenantId, async (c) => {
        const r = await c.query(`
          WITH periods AS (
            SELECT generate_series(
              DATE_TRUNC($1, NOW() - ($2 || ' days')::INTERVAL),
              DATE_TRUNC($1, NOW()),
              ('1 ' || $1)::INTERVAL
            ) AS period
          ),
          actuals AS (
            SELECT
              DATE_TRUNC($1, created_at)                                    AS period,
              COUNT(*)                                                       AS total,
              COUNT(*) FILTER (WHERE status IN ('resolved','closed'))       AS resolved,
              -- Avg resolution time in hours (accepted → resolved)
              ROUND(AVG(
                CASE WHEN resolved_at IS NOT NULL AND accepted_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (resolved_at - accepted_at))/3600
                END
              )::numeric, 1)::float8                                        AS avg_resolution_hrs,
              -- Avg first-response time in hours (created → first_response_at)
              ROUND(AVG(
                CASE WHEN first_response_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (first_response_at - created_at))/3600
                END
              )::numeric, 1)::float8                                        AS avg_first_response_hrs,
              -- SLA compliance %: resolved within SLA
              ROUND(100.0 * COUNT(*) FILTER (
                WHERE resolved_at IS NOT NULL
                  AND (sla_due_at IS NULL OR resolved_at <= sla_due_at)
              ) / NULLIF(COUNT(*) FILTER (WHERE status IN ('resolved','closed')), 0), 1)::float8 AS sla_compliance_pct,
              -- Escalation rate
              ROUND(100.0 * COUNT(*) FILTER (WHERE escalation_level >= 1)
                / NULLIF(COUNT(*), 0), 1)::float8                          AS escalation_rate_pct
            FROM tickets
            WHERE created_at >= NOW() - ($2 || ' days')::INTERVAL
            GROUP BY 1
          )
          SELECT
            p.period,
            COALESCE(a.total,                0)    AS total,
            COALESCE(a.resolved,             0)    AS resolved,
            a.avg_resolution_hrs,
            a.avg_first_response_hrs,
            a.sla_compliance_pct,
            a.escalation_rate_pct
          FROM periods p
          LEFT JOIN actuals a USING (period)
          ORDER BY p.period ASC
        `, [q.period, q.days]);
        return r.rows;
      });

      return reply.send({ success: true, data: rows });
    });
  };
}
