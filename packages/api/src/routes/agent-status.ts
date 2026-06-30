/**
 * Agent presence + Live Wallboard endpoints.
 *
 *   GET    /          → current user's agent_status
 *   PATCH  /          → update current user's agent_status
 *   GET    /wallboard → manager+ only — all agents in tenant w/ ticket load
 *
 * Backed by users.agent_status + users.agent_status_updated_at (migration 038).
 * Tenant isolation via db.withTenant — RLS handles the rest.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';

const STATUS_VALUES = ['online', 'busy', 'away', 'offline'] as const;

const PatchSchema = z.object({
  status: z.enum(STATUS_VALUES),
});

// Roles allowed to view the wallboard. Mirrors the frontend route guard.
const WALLBOARD_ROLES = new Set([
  'super_admin', 'tenant_admin', 'manager', 'line_manager',
  'support_manager', 'sales_manager',
]);

export function agentStatusRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // GET / — current user's status
    fastify.get('/status', async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = (req.user as any).sub;
      const { rows: [row] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT agent_status AS status, agent_status_updated_at AS updated_at
             FROM users
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, userId]
        )
      );
      if (!row) return reply.code(404).send({ success: false, error: 'User not found' });
      return reply.send({ success: true, data: row });
    });

    // PATCH / — update current user's status
    fastify.patch('/status', async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = (req.user as any).sub;
      const { status } = PatchSchema.parse(req.body);

      const { rows: [row] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `UPDATE users
              SET agent_status = $3,
                  agent_status_updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING agent_status AS status, agent_status_updated_at AS updated_at`,
          [tenantId, userId, status]
        )
      );
      if (!row) return reply.code(404).send({ success: false, error: 'User not found' });
      return reply.send({ success: true, data: row });
    });

    // GET /wallboard — manager+ only. All agents in tenant with active/breached ticket counts.
    fastify.get('/wallboard', async (req, reply) => {
      const role = (req.user as any)?.role as string | undefined;
      if (!role || !WALLBOARD_ROLES.has(role)) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Wallboard is restricted to managers and admins.' },
        });
      }

      const tenantId = req.tenant.id;

      // One query: users left-joined to their open tickets, aggregated for
      // active/breached counts. Excludes admin roles from the listing —
      // the wallboard is about the people doing the work.
      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT u.id,
                  u.name,
                  u.email,
                  u.role,
                  u.department,
                  u.agent_status,
                  u.agent_status_updated_at,
                  COALESCE(SUM(CASE
                    WHEN t.status IS NOT NULL
                     AND t.status NOT IN ('resolved','closed')
                    THEN 1 ELSE 0 END), 0)::int AS active_tickets,
                  COALESCE(SUM(CASE
                    WHEN t.status IS NOT NULL
                     AND t.status NOT IN ('resolved','closed')
                     AND t.sla_due_at IS NOT NULL
                     AND t.sla_due_at < NOW()
                    THEN 1 ELSE 0 END), 0)::int AS breached_tickets
             FROM users u
             LEFT JOIN tickets t
                    ON t.tenant_id = u.tenant_id
                   AND t.assignee_id = u.id
            WHERE u.tenant_id = $1
              AND u.is_active = TRUE
              AND u.role NOT IN ('super_admin','tenant_admin')
            GROUP BY u.id
            ORDER BY
              CASE u.agent_status
                WHEN 'online'  THEN 1
                WHEN 'busy'    THEN 2
                WHEN 'away'    THEN 3
                WHEN 'offline' THEN 4
                ELSE 5
              END,
              u.name`,
          [tenantId]
        )
      );

      return reply.send({ success: true, data: rows });
    });
  };
}
