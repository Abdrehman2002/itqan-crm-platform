/**
 * Reports Hub — /api/v1/reports
 *
 * 6 manager reports + 4 agent reports. Each report is a JSON aggregate that
 * can also be downloaded as CSV (query param ?format=csv).
 *
 * Visibility: scoped through the existing visibility model:
 *   - super_admin: all rows
 *   - tenant_admin: blocked (separation of duties — server.ts gateway)
 *   - manager: their department subtree (recursive manager_id CTE)
 *   - line_manager / agent: own records only
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';

const REPORTS: Record<string, {
  roles: string[];
  title: string;
  query: (scope: ScopeCtx) => { sql: string; params: any[] };
  csvHeader: string[];
  rowToCsv: (r: any) => (string | number)[];
}> = {
  // ── MANAGER REPORTS ────────────────────────────────────────────────
  'sla-by-agent': {
    roles: ['manager','line_manager','super_admin'],
    title: 'SLA compliance by agent',
    query: (s) => ({
      sql: `
        SELECT u.id AS agent_id, u.name AS agent_name,
               COUNT(*) FILTER (WHERE t.status IN ('resolved','closed')) AS resolved,
               COUNT(*) FILTER (WHERE t.escalation_level >= 1) AS breached,
               ROUND(100.0 * COUNT(*) FILTER (WHERE t.escalation_level = 0 AND t.status IN ('resolved','closed'))
                     / NULLIF(COUNT(*) FILTER (WHERE t.status IN ('resolved','closed')), 0), 1) AS sla_pct
        FROM tickets t
        JOIN users u ON u.id = t.assignee_id
        WHERE t.created_at > NOW() - INTERVAL '30 days'
          ${s.scopeAssigneeSqlT}
        GROUP BY u.id, u.name
        ORDER BY sla_pct DESC NULLS LAST`,
      params: [],
    }),
    csvHeader: ['agent_id','agent_name','resolved','breached','sla_pct'],
    rowToCsv: r => [r.agent_id, r.agent_name, r.resolved, r.breached, r.sla_pct],
  },
  'tickets-by-department': {
    roles: ['manager','super_admin'],
    title: 'Tickets resolved by department',
    query: (s) => ({
      sql: `
        SELECT COALESCE(u.department,'(unassigned)') AS department,
               COUNT(*) FILTER (WHERE t.status IN ('resolved','closed')) AS resolved,
               COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed')) AS open,
               COUNT(*) AS total
        FROM tickets t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.created_at > NOW() - INTERVAL '30 days'
          ${s.scopeAssigneeSqlT}
        GROUP BY u.department
        ORDER BY total DESC`,
      params: [],
    }),
    csvHeader: ['department','resolved','open','total'],
    rowToCsv: r => [r.department, r.resolved, r.open, r.total],
  },
  'csat-by-agent': {
    roles: ['manager','line_manager','super_admin'],
    title: 'CSAT scores by agent',
    query: (s) => ({
      sql: `
        SELECT u.id AS agent_id, u.name AS agent_name,
               COUNT(cs.rating) AS responses,
               ROUND(AVG(cs.rating::numeric), 2) AS avg_rating
        FROM csat_surveys cs
        JOIN tickets t ON t.id = cs.ticket_id
        JOIN users u   ON u.id = t.assignee_id
        WHERE cs.responded_at IS NOT NULL
          ${s.scopeAssigneeSqlT}
        GROUP BY u.id, u.name
        ORDER BY avg_rating DESC NULLS LAST`,
      params: [],
    }),
    csvHeader: ['agent_id','agent_name','responses','avg_rating'],
    rowToCsv: r => [r.agent_id, r.agent_name, r.responses, r.avg_rating],
  },
  'avg-first-response': {
    roles: ['manager','line_manager','super_admin'],
    title: 'Avg first response time by priority',
    query: (s) => ({
      sql: `
        SELECT t.priority,
               COUNT(*) AS count,
               ROUND(AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at))/60)::numeric) AS avg_minutes
        FROM tickets t
        WHERE t.first_response_at IS NOT NULL
          ${s.scopeAssigneeSqlT}
        GROUP BY t.priority
        ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      params: [],
    }),
    csvHeader: ['priority','count','avg_minutes'],
    rowToCsv: r => [r.priority, r.count, r.avg_minutes],
  },
  'avg-resolution': {
    roles: ['manager','line_manager','super_admin'],
    title: 'Avg resolution time by ticket type',
    query: (s) => ({
      sql: `
        SELECT COALESCE(t.ticket_type,'support') AS ticket_type,
               COUNT(*) AS count,
               ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.accepted_at))/3600)::numeric, 1) AS avg_hours
        FROM tickets t
        WHERE t.resolved_at IS NOT NULL AND t.accepted_at IS NOT NULL
          ${s.scopeAssigneeSqlT}
        GROUP BY t.ticket_type
        ORDER BY count DESC`,
      params: [],
    }),
    csvHeader: ['ticket_type','count','avg_hours'],
    rowToCsv: r => [r.ticket_type, r.count, r.avg_hours],
  },
  'sla-breaches': {
    roles: ['manager','line_manager','super_admin'],
    title: 'Top breached SLAs this week',
    query: (s) => ({
      sql: `
        SELECT t.ticket_number, t.subject, t.priority, t.created_at, t.escalation_level,
               u.name AS assignee_name
        FROM tickets t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.escalation_level >= 1
          AND t.created_at > NOW() - INTERVAL '7 days'
          ${s.scopeAssigneeSqlT}
        ORDER BY t.escalation_level DESC, t.created_at DESC
        LIMIT 50`,
      params: [],
    }),
    csvHeader: ['ticket_number','subject','priority','assignee_name','escalation_level','created_at'],
    rowToCsv: r => [r.ticket_number, r.subject, r.priority, r.assignee_name ?? '', r.escalation_level, r.created_at],
  },

  // ── AGENT REPORTS ──────────────────────────────────────────────────
  'my-resolved-today': {
    roles: ['agent','line_manager','manager','super_admin'],
    title: 'My tickets resolved today',
    query: () => ({
      sql: `
        SELECT ticket_number, subject, priority, resolved_at
        FROM tickets
        WHERE assignee_id = $1 AND resolved_at::date = CURRENT_DATE
        ORDER BY resolved_at DESC`,
      params: ['__USERID__'],
    }),
    csvHeader: ['ticket_number','subject','priority','resolved_at'],
    rowToCsv: r => [r.ticket_number, r.subject, r.priority, r.resolved_at],
  },
  'my-queue': {
    roles: ['agent','line_manager','manager','super_admin'],
    title: 'My current open queue',
    query: () => ({
      sql: `
        SELECT ticket_number, subject, priority, status, sla_due_at,
               EXTRACT(EPOCH FROM (sla_due_at - NOW())) AS seconds_remaining
        FROM tickets
        WHERE assignee_id = $1 AND status NOT IN ('resolved','closed')
        ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 sla_due_at NULLS LAST`,
      params: ['__USERID__'],
    }),
    csvHeader: ['ticket_number','subject','priority','status','sla_due_at'],
    rowToCsv: r => [r.ticket_number, r.subject, r.priority, r.status, r.sla_due_at],
  },
  'my-sla-risk': {
    roles: ['agent','line_manager','manager','super_admin'],
    title: 'My SLA-at-risk tickets (>80% elapsed)',
    query: () => ({
      sql: `
        SELECT ticket_number, subject, priority, sla_due_at,
               EXTRACT(EPOCH FROM (sla_due_at - NOW()))/60 AS minutes_remaining
        FROM tickets
        WHERE assignee_id = $1
          AND status NOT IN ('resolved','closed')
          AND accepted_at IS NOT NULL AND sla_due_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (NOW() - accepted_at)) / NULLIF(EXTRACT(EPOCH FROM (sla_due_at - accepted_at)), 0) >= 0.8
        ORDER BY sla_due_at ASC`,
      params: ['__USERID__'],
    }),
    csvHeader: ['ticket_number','subject','priority','sla_due_at','minutes_remaining'],
    rowToCsv: r => [r.ticket_number, r.subject, r.priority, r.sla_due_at, Math.round(r.minutes_remaining)],
  },
  'my-csat': {
    roles: ['agent','line_manager','manager','super_admin'],
    title: 'My CSAT scores',
    query: () => ({
      sql: `
        SELECT t.ticket_number, t.subject, cs.rating, cs.comment, cs.responded_at
        FROM csat_surveys cs
        JOIN tickets t ON t.id = cs.ticket_id
        WHERE t.assignee_id = $1 AND cs.responded_at IS NOT NULL
        ORDER BY cs.responded_at DESC LIMIT 100`,
      params: ['__USERID__'],
    }),
    csvHeader: ['ticket_number','subject','rating','comment','responded_at'],
    rowToCsv: r => [r.ticket_number, r.subject, r.rating, r.comment ?? '', r.responded_at],
  },
};

interface ScopeCtx {
  scopeAssigneeSqlT: string;
}

function buildScope(scopeIds: string[] | null): ScopeCtx {
  if (!scopeIds) return { scopeAssigneeSqlT: '' };
  const literal = `ARRAY[${scopeIds.map(id => `'${id}'::uuid`).join(',')}]`;
  return { scopeAssigneeSqlT: `AND t.assignee_id = ANY(${literal})` };
}

async function getScopeIds(db: DatabaseClient, tenantId: string, userId: string, role: string): Promise<string[] | null> {
  if (role === 'super_admin' || role === 'tenant_admin') return null;
  return db.withTenant(tenantId, async (client) => {
    const r = await client.query(`
      WITH RECURSIVE h AS (
        SELECT id FROM users WHERE manager_id = $1
        UNION ALL
        SELECT u.id FROM users u INNER JOIN h ON u.manager_id = h.id
      ) SELECT id FROM h`, [userId]);
    return [userId, ...r.rows.map(x => x.id)];
  });
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function reportsRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const role = (req.user as any).role as string;
      const list = Object.entries(REPORTS).map(([key, r]) => ({
        key, title: r.title, available: r.roles.includes(role),
      }));
      return reply.send({ success: true, data: list });
    });

    fastify.get('/:key', { preHandler: requireScope('tickets:read') }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { key } = req.params as { key: string };
      const { format } = z.object({ format: z.enum(['json','csv']).default('json') }).parse(req.query ?? {});
      const report = REPORTS[key];
      if (!report) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown report' } });
      const role = (req.user as any).role as string;
      if (!report.roles.includes(role)) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'This report is not available to your role' } });
      }

      const userId = (req.user as any).sub as string;
      const scope = await getScopeIds(db, req.tenant.id, userId, role);
      const ctx = buildScope(scope);
      const { sql, params } = report.query(ctx);
      const resolvedParams = params.map(p => p === '__USERID__' ? userId : p);

      const rows = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(sql, resolvedParams);
        return r.rows;
      });

      if (format === 'csv') {
        const header = report.csvHeader.join(',');
        const body   = rows.map(r => report.rowToCsv(r).map(csvEscape).join(',')).join('\n');
        reply.header('content-type', 'text/csv; charset=utf-8');
        reply.header('content-disposition', `attachment; filename="${key}-${new Date().toISOString().slice(0,10)}.csv"`);
        return reply.send(header + '\n' + body);
      }
      return reply.send({ success: true, data: rows, meta: { title: report.title, key } });
    });
  };
}
