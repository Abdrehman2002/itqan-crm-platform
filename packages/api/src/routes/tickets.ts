/**
 * Ticketing routes — /api/v1/tickets
 *
 * Endpoints:
 *   GET    /                       list tickets (filters: status, priority, queue, assignee, search)
 *   GET    /stats                  dashboard counts
 *   GET    /queues                 list queues
 *   POST   /queues                 create queue
 *   PATCH  /queues/:id             update queue
 *   DELETE /queues/:id             delete queue
 *   GET    /sla-policies           list SLA policies
 *   POST   /sla-policies           create SLA policy
 *   PATCH  /sla-policies/:id       update SLA policy
 *   DELETE /sla-policies/:id       delete SLA policy
 *   POST   /                       create ticket (manual)
 *   POST   /from-voice             create ticket from voice bot call
 *   GET    /:id                    get single ticket + comments
 *   PATCH  /:id                    update ticket fields
 *   POST   /:id/assign             assign to agent
 *   POST   /:id/accept             agent accepts ticket (starts SLA timer)
 *   POST   /:id/resolve            mark resolved
 *   POST   /:id/close              close ticket  ← also triggers CSAT survey email
 *   POST   /:id/rca                submit Root Cause Analysis
 *   GET    /:id/rca                get RCA for a ticket
 *   GET    /:id/audit-log          tamper-proof audit trail for a ticket
 *   POST   /:id/comments           add comment / internal note
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { EmailService } from '../services/email.service';
import { SmsService } from '@crm/core/sms.service';

// ── Schemas ────────────────────────────────────────────────────────────────
const CreateTicketSchema = z.object({
  subject:       z.string().min(1),
  description:   z.string().optional(),
  priority:      z.enum(['urgent','high','medium','low']).default('medium'),
  channel:       z.enum(['manual','email','phone','chat','api','voice_bot']).default('manual'),
  queueId:       z.string().uuid().optional(),
  slaPolicyId:   z.string().uuid().optional(),
  contactId:     z.string().uuid().optional(),
  companyId:     z.string().uuid().optional(),
  assigneeId:    z.string().uuid().optional(),
  reporterEmail: z.string().email().optional(),
  reporterName:  z.string().optional(),
  reporterPhone:     z.string().optional(),
  reporterWhatsapp:  z.string().optional(),
  preferredChannel:  z.enum(['email','sms','whatsapp']).default('email'),
  ticketType:        z.enum(['complaint','inquiry','sales']).default('complaint'),
  tags:              z.array(z.string()).optional(),
  customFields:  z.record(z.unknown()).optional(),
});

const UpdateTicketSchema = z.object({
  subject:        z.string().min(1).optional(),
  description:    z.string().optional(),
  priority:       z.enum(['urgent','high','medium','low']).optional(),
  status:         z.enum(['open','assigned','accepted','in_progress','pending','resolved','closed']).optional(),
  queueId:        z.string().uuid().nullable().optional(),
  slaPolicyId:    z.string().uuid().nullable().optional(),
  contactId:      z.string().uuid().nullable().optional(),
  companyId:      z.string().uuid().nullable().optional(),
  assigneeId:     z.string().uuid().nullable().optional(),
  tags:           z.array(z.string()).optional(),
  resolutionNote: z.string().optional(),
  customFields:   z.record(z.unknown()).optional(),
});

const ListQuerySchema = z.object({
  page:       z.coerce.number().min(1).default(1),
  pageSize:   z.coerce.number().min(1).max(100).default(25),
  status:     z.string().optional(),
  priority:   z.string().optional(),
  channel:    z.string().optional(),   // 'manual' | 'voice_bot' | etc.
  queueId:    z.string().optional(),
  assigneeId: z.string().optional(),
  mine:       z.coerce.boolean().optional(),
  overdue:    z.coerce.boolean().optional(),
  contactId:  z.string().uuid().optional(),
  search:     z.string().optional(),
  sortBy:     z.enum(['created_at','updated_at','priority','sla_due_at']).default('created_at'),
  sortOrder:  z.enum(['asc','desc']).default('desc'),
});

const CreateQueueSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  color:       z.string().optional(),
  isDefault:   z.boolean().optional(),
});

const CreateSlaSchema = z.object({
  name:                z.string().min(1),
  description:         z.string().optional(),
  priority:            z.enum(['urgent','high','medium','low']),
  firstResponseHours:  z.number().int().min(0),
  resolutionHours:     z.number().int().min(1),
  reminderPct:         z.number().int().min(1).max(99).default(80),
  l1EscalationPct:     z.number().int().min(1).default(100),
  l2EscalationPct:     z.number().int().min(1).default(150),
  businessHoursOnly:   z.boolean().default(false),
  isActive:            z.boolean().default(true),
  reminderSchedule:    z.array(z.object({
    id:           z.string(),
    pct:          z.number().min(1).max(500),
    level:        z.enum(['reminder','l1','l2']),
    label:        z.string(),
    notifyTarget: z.enum(['assignee','managers','admins','all']),
  })).optional(),
});

const AddCommentSchema = z.object({
  body:        z.string().min(1),              // no max — unlimited remarks
  isInternal:  z.boolean().default(false),
  commentType: z.enum(['reply','remark','note']).default('reply'),
  replyToId:   z.string().uuid().optional(),   // WhatsApp-style quoted reply
});

const RcaSchema = z.object({
  rootCause:          z.string().min(1),
  correctiveAction:   z.string().min(1),
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate next ticket number: TKT-00042 */
async function nextTicketNumber(db: DatabaseClient, tenantId: string): Promise<string> {
  const [row] = await db.withSuperAdmin(async (client) => {
    const r = await client.query(
      `INSERT INTO ticket_counters (tenant_id, next_val)
       VALUES ($1, 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
       RETURNING next_val`,
      [tenantId],
    );
    return r.rows;
  });
  return `TKT-${String(row.next_val - 1).padStart(5, '0')}`;
}

/** Lookup SLA policy for a given priority (fallback to medium) */
async function findSlaPolicy(
  db: DatabaseClient,
  tenantId: string,
  slaPolicyId: string | undefined,
  priority: string,
): Promise<{ id: string; resolution_hours: number } | null> {
  const rows = await db.withTenant(tenantId, async (client) => {
    if (slaPolicyId) {
      const r = await client.query('SELECT id, resolution_hours FROM sla_policies WHERE id = $1', [slaPolicyId]);
      return r.rows;
    }
    const r = await client.query(
      `SELECT id, resolution_hours FROM sla_policies
       WHERE priority = $1 AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [priority],
    );
    return r.rows;
  });
  return rows[0] ?? null;
}

/** Send in-app notification to a list of users */
async function notify(
  db: DatabaseClient,
  tenantId: string,
  userIds: string[],
  type: string,
  title: string,
  body: string,
  entityId: string,
) {
  if (!userIds.length) return;
  await db.withSuperAdmin(async (client) => {
    for (const uid of userIds) {
      await client.query(
        `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
         VALUES ($1,$2,$3,$4,$5,'ticket',$6)`,
        [tenantId, uid, type, title, body, entityId],
      );
    }
  });
}

// ── Immutable audit log writer ─────────────────────────────────────────────
async function auditLog(
  db: DatabaseClient,
  opts: {
    tenantId:  string;
    ticketId:  string;
    actorId?:  string | null;
    actorName?:string | null;
    action:    string;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    meta?:     Record<string, unknown>;
  },
): Promise<void> {
  await db.withSuperAdmin(async (c) => {
    await c.query(
      `INSERT INTO ticket_audit_log
         (tenant_id, ticket_id, actor_id, actor_name, action, old_value, new_value, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
      [
        opts.tenantId,
        opts.ticketId,
        opts.actorId   ?? null,
        opts.actorName ?? null,
        opts.action,
        opts.oldValue  ? JSON.stringify(opts.oldValue)  : null,
        opts.newValue  ? JSON.stringify(opts.newValue)  : null,
        JSON.stringify(opts.meta ?? {}),
      ],
    );
  });
}

/** Generate a CSAT survey token, store it, and email the reporter */
async function sendCsatSurvey(
  db:        DatabaseClient,
  emailSvc:  InstanceType<typeof EmailService>,
  eventBus:  EventBus,
  ticket:    any,
  appUrl:    string,
  csatExpiryDays: number = 7,   // Gap 4: configurable expiry
): Promise<void> {
  if (!ticket.reporter_email) return;

  const token = randomBytes(24).toString('hex'); // 48-char URL-safe token
  const surveyUrl = `${appUrl}/csat/${token}`;
  const expiryLabel = csatExpiryDays === 1 ? '1 day' : `${csatExpiryDays} days`;

  await db.withSuperAdmin(async (c) => {
    await c.query(
      `INSERT INTO csat_surveys
         (tenant_id, ticket_id, token, reporter_email, reporter_name, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' days')::INTERVAL)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [ticket.tenant_id, ticket.id, token, ticket.reporter_email, ticket.reporter_name ?? null, csatExpiryDays],
    );

    // Audit log
    await c.query(
      `INSERT INTO ticket_audit_log
         (tenant_id, ticket_id, actor_id, action, new_value, meta)
       VALUES ($1, $2, NULL, 'csat_sent', $3::jsonb, '{}'::jsonb)`,
      [ticket.tenant_id, ticket.id, JSON.stringify({ surveyToken: token, sentTo: ticket.reporter_email })],
    );
  });

  emailSvc.send(ticket.tenant_id, {
    to:      ticket.reporter_email,
    toName:  ticket.reporter_name ?? undefined,
    subject: `How did we do? — Ticket ${ticket.ticket_number}`,
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <p>Dear ${ticket.reporter_name ?? 'Customer'},</p>
      <p>Your support ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" — has been resolved.</p>
      <p>We'd love to hear how we did. Please take a moment to rate your experience:</p>
      <div style="text-align:center;margin:24px 0;">
        ${[1,2,3,4,5].map(n => `<a href="${surveyUrl}?rating=${n}" style="display:inline-block;margin:0 4px;width:44px;height:44px;line-height:44px;border-radius:50%;background:#f1f5f9;color:#1e293b;font-size:20px;text-decoration:none;font-weight:bold;">${['😞','😕','😐','😊','🤩'][n-1]}</a>`).join('')}
      </div>
      <p style="text-align:center;margin-bottom:24px;">
        <a href="${surveyUrl}" style="background:#6366f1;color:#fff;padding:10px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Rate Your Experience</a>
      </p>
      <p style="color:#94a3b8;font-size:12px;">This survey link expires in ${expiryLabel}.</p>
    </div>`,
    bodyText: `Hi ${ticket.reporter_name ?? 'Customer'},\n\nTicket ${ticket.ticket_number} has been resolved. Please rate your experience:\n${surveyUrl}\n\n(Link expires in 7 days)`,
    ticketId: ticket.id,
  }).catch(() => { /* non-fatal */ });

  await eventBus.publish(ticket.tenant_id, CRM_EVENTS.CSAT_SENT, {
    ticketId: ticket.id,
    surveyToken: token,
    sentTo: ticket.reporter_email,
  });
}

// ── Route factory ──────────────────────────────────────────────────────────

// ── Smart Push Routing Engine ────────────────────────────────────────────
/**
 * Routes a ticket to the best available agent using capacity-aware random selection.
 *
 * Algorithm:
 * 1. Get all active agents who are members of the ticket's queue
 *    (falls back to all active agents in tenant if queue has no members)
 * 2. Filter out agents who currently have >= per_agent_ticket_limit pending tickets
 *    (limit comes from tenant routing settings; default = no limit)
 * 3. From the remaining capacity-available agents, pick one at random
 *    (agents with 0 active tickets get 2× weight for fairness)
 * 4. If NO agent has capacity, route to the agent with fewest active tickets (overflow)
 */
async function assignByPushRouting(
  db: DatabaseClient,
  ticket: any,
  tenantId: string,
  eventBus: EventBus,
): Promise<void> {
  // Read tenant routing config (per_agent_ticket_limit)
  const tenantSettings = await db.withSuperAdmin(async (client) => {
    const r = await client.query(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    return r.rows[0]?.settings ?? {};
  });
  const perAgentLimit: number = tenantSettings?.routing?.per_agent_ticket_limit ?? 0; // 0 = no limit

  // Get queue members — agents explicitly assigned to this queue
  const queueId = ticket.queue_id;
  let candidateIds: string[] = [];

  // Department-aware routing: map ticket_type → department_type so a complaints ticket
  // only routes to agents/line_managers in the Complaints department, etc.
  const TICKET_TYPE_TO_DEPT: Record<string, string> = {
    complaint: 'complaint',
    sales:     'sales',
    inquiry:   'support',   // generic inquiries fall into Support by default
    support:   'support',
  };
  const requiredDept = TICKET_TYPE_TO_DEPT[ticket.ticket_type ?? 'support'] ?? null;
  const deptFilter = requiredDept ? ' AND (u.department_type = $3 OR u.role IN (\'tenant_admin\'))' : '';

  if (queueId) {
    const qm = await db.withSuperAdmin(async (client) => {
      const params: unknown[] = [queueId, ticket.assignee_id ?? '00000000-0000-0000-0000-000000000000'];
      if (requiredDept) params.push(requiredDept);
      const r = await client.query(
        `SELECT qm.user_id
         FROM queue_members qm
         JOIN users u ON u.id = qm.user_id
         WHERE qm.queue_id = $1
           AND u.is_active = true
           AND u.role IN ('agent','line_manager','manager')
           AND u.id != $2${deptFilter}`,
        params,
      );
      return r.rows.map((u: any) => u.user_id as string);
    });
    candidateIds = qm;
  }

  // Fallback: if queue has no members, use all active agents in the matching department
  if (candidateIds.length === 0) {
    const all = await db.withSuperAdmin(async (client) => {
      const params: unknown[] = [tenantId, ticket.assignee_id ?? '00000000-0000-0000-0000-000000000000'];
      if (requiredDept) params.push(requiredDept);
      const r = await client.query(
        `SELECT id FROM users u
         WHERE tenant_id = $1
           AND is_active = true
           AND role IN ('agent','line_manager','manager')
           AND id != $2${deptFilter.replace(/u\./g, '')}`,
        params,
      );
      return r.rows.map((u: any) => u.id as string);
    });
    candidateIds = all;
  }

  if (candidateIds.length === 0) return; // no agents available at all

  // Get active ticket count per candidate
  const loadMap = await db.withSuperAdmin(async (client) => {
    const r = await client.query(
      `SELECT assignee_id, COUNT(*) AS active_count
       FROM tickets
       WHERE assignee_id = ANY($1::uuid[])
         AND tenant_id = $2
         AND status NOT IN ('resolved','closed')
       GROUP BY assignee_id`,
      [candidateIds, tenantId],
    );
    const map: Record<string, number> = {};
    candidateIds.forEach(id => { map[id] = 0; }); // default 0
    r.rows.forEach((row: any) => { map[row.assignee_id] = parseInt(row.active_count, 10); });
    return map;
  });

  // Filter: only agents under the per-agent limit (if limit is set)
  let available = candidateIds.filter(id =>
    perAgentLimit === 0 || (loadMap[id] ?? 0) < perAgentLimit,
  );

  let chosen: string;
  if (available.length > 0) {
    // Weighted random: agents with 0 tickets get 2× chance
    const weighted: string[] = [];
    for (const id of available) {
      weighted.push(id);
      if ((loadMap[id] ?? 0) === 0) weighted.push(id); // double weight for free agents
    }
    chosen = weighted[Math.floor(Math.random() * weighted.length)];
  } else {
    // All agents at capacity — overflow to agent with fewest tickets
    chosen = candidateIds.reduce((best, id) =>
      (loadMap[id] ?? 0) < (loadMap[best] ?? 0) ? id : best,
    );
  }

  await db.withSuperAdmin(async (client) => {
    await client.query(
      `UPDATE tickets SET assignee_id = $1, status = 'assigned', updated_at = NOW() WHERE id = $2`,
      [chosen, ticket.id],
    );
  });

  const atCapacity = perAgentLimit > 0 && available.length === 0;
  const note = atCapacity
    ? `Auto-routed (overflow — all agents at capacity limit of ${perAgentLimit})`
    : `Auto-routed (${available.length} agent${available.length === 1 ? '' : 's'} available)`;

  await notify(db, tenantId, [chosen], 'ticket_assigned',
    `New ticket auto-assigned: ${ticket.ticket_number}`,
    `"${ticket.subject}" has been automatically routed to you. ${note}`,
    ticket.id);

  await eventBus.publish(tenantId, CRM_EVENTS.TICKET_ASSIGNED, {
    ticketId: ticket.id, assigneeId: chosen, source: 'push_routing', note,
  });
}

export function ticketRoutes(db: DatabaseClient, eventBus: EventBus) {
  const emailSvc = new EmailService(db);
  const smsSvc   = new SmsService(db);
  const APP_URL  = process.env.APP_URL ?? 'http://localhost:5173';

  return async function (fastify: FastifyInstance) {

    // ── Stats (dashboard) ─────────────────────────────────────────────────
    fastify.get('/stats', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const role     = (req.user as any).role as string;
      const deptType = (req.user as any).department_type as string | null;

      // Build scope filter per role:
      //   tenant_admin / super_admin → all tickets (whole tenant)
      //   manager / line_manager     → tickets owned by anyone in their reporting subtree
      //                                (recursive CTE down manager_id), OR sitting in their dept queue
      //   agent / viewer             → tickets assigned to them OR sitting unassigned in their dept queue
      //                                (so they see what they can pick up)
      let scopeSql = '';
      const scopeParams: any[] = [userId];

      if (role === 'agent' || role === 'viewer') {
        // Their work + the dept queue they could claim from
        scopeSql = `WHERE (assignee_id = $1 OR (assignee_id IS NULL AND queue_id IN (
                      SELECT id FROM ticket_queues WHERE LOWER(name) LIKE '%' || $2 || '%'
                    )))`;
        scopeParams.push((deptType ?? '').toLowerCase());
      } else if (role === 'manager' || role === 'line_manager') {
        // Recursive subtree of users reporting up to me + tickets in my dept queue
        scopeSql = `WHERE (
          assignee_id IN (
            WITH RECURSIVE h AS (
              SELECT id FROM users WHERE id = $1
              UNION ALL
              SELECT u.id FROM users u INNER JOIN h ON u.manager_id = h.id
            ) SELECT id FROM h
          )
          OR queue_id IN (
            SELECT id FROM ticket_queues WHERE LOWER(name) LIKE '%' || $2 || '%'
          )
        )`;
        scopeParams.push((deptType ?? '').toLowerCase());
      }
      // tenant_admin/super_admin: no WHERE, sees everything

      const [stats] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT
             COUNT(*)                                                            AS total,
             COUNT(*) FILTER (WHERE status = 'open')                            AS open,
             COUNT(*) FILTER (WHERE status = 'assigned')                        AS assigned,
             COUNT(*) FILTER (WHERE status IN ('accepted','in_progress'))        AS in_progress,
             COUNT(*) FILTER (WHERE status = 'pending')                         AS pending,
             COUNT(*) FILTER (WHERE status = 'resolved')                        AS resolved,
             COUNT(*) FILTER (WHERE assignee_id = $1
                               AND status NOT IN ('resolved','closed'))         AS mine,
             COUNT(*) FILTER (WHERE sla_due_at < NOW()
                               AND status NOT IN ('resolved','closed'))         AS overdue,
             COUNT(*) FILTER (WHERE sla_due_at >= NOW()
                               AND accepted_at IS NOT NULL
                               AND status NOT IN ('resolved','closed'))         AS within_tat,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS created_today,
             COUNT(*) FILTER (WHERE status IN ('accepted','in_progress')
                               AND assignee_id IS NOT NULL)                     AS claimed
           FROM tickets ${scopeSql}`,
          scopeParams,
        );
        return r.rows;
      });

      return reply.send({ success: true, data: stats });
    });


    // ── Queue CRUD ────────────────────────────────────────────────────────
    fastify.get('/queues', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const queues = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT q.*, COUNT(t.id) AS ticket_count
           FROM ticket_queues q
           LEFT JOIN tickets t ON t.queue_id = q.id AND t.status NOT IN ('resolved','closed')
           GROUP BY q.id ORDER BY q.is_default DESC, q.name ASC`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: queues });
    });

    fastify.post('/queues', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = CreateQueueSchema.parse(req.body);
      const [queue] = await db.withTenant(req.tenant.id, async (client) => {
        if (body.isDefault) {
          await client.query('UPDATE ticket_queues SET is_default = false');
        }
        const r = await client.query(
          `INSERT INTO ticket_queues (tenant_id, name, description, color, is_default)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.tenant.id, body.name, body.description ?? null, body.color ?? '#6366f1', body.isDefault ?? false],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: queue });
    });

    fastify.patch('/queues/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CreateQueueSchema.partial().parse(req.body);
      const [queue] = await db.withTenant(req.tenant.id, async (client) => {
        if (body.isDefault) await client.query('UPDATE ticket_queues SET is_default = false');
        const r = await client.query(
          `UPDATE ticket_queues SET
             name = COALESCE($1, name),
             description = COALESCE($2, description),
             color = COALESCE($3, color),
             is_default = COALESCE($4, is_default),
             updated_at = NOW()
           WHERE id = $5 RETURNING *`,
          [body.name, body.description, body.color, body.isDefault, id],
        );
        return r.rows;
      });
      if (!queue) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Queue not found' } });
      return reply.send({ success: true, data: queue });
    });

    fastify.delete('/queues/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('UPDATE tickets SET queue_id = NULL WHERE queue_id = $1', [id]);
        await client.query('DELETE FROM ticket_queues WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });

    // ── Queue member management (Gap 2) ───────────────────────────────────
    // GET  /queues/:id/members  — list agents in queue
    fastify.get('/queues/:id/members', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const members = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT u.id, u.name, u.email, u.role, u.department, u.is_active,
                  qm.added_at,
                  COUNT(t.id) FILTER (WHERE t.status NOT IN ('resolved','closed')) AS active_tickets
           FROM queue_members qm
           JOIN users u ON u.id = qm.user_id
           LEFT JOIN tickets t ON t.assignee_id = u.id AND t.tenant_id = $2
           WHERE qm.queue_id = $1
           GROUP BY u.id, u.name, u.email, u.role, u.department, u.is_active, qm.added_at
           ORDER BY u.name`,
          [id, req.tenant.id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: members });
    });

    // POST /queues/:id/members — add agent(s) to queue
    fastify.post('/queues/:id/members', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { userIds } = z.object({ userIds: z.array(z.string().uuid()).min(1) }).parse(req.body);
      await db.withTenant(req.tenant.id, async (client) => {
        for (const uid of userIds) {
          await client.query(
            `INSERT INTO queue_members (queue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, uid],
          );
        }
      });
      return reply.send({ success: true, message: `${userIds.length} agent(s) added to queue` });
    });

    // DELETE /queues/:id/members/:userId — remove agent from queue
    fastify.delete('/queues/:id/members/:userId', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM queue_members WHERE queue_id = $1 AND user_id = $2', [id, userId]);
      });
      return reply.code(204).send();
    });

    // ── Tag management (Gap 5) ────────────────────────────────────────────
    // GET    /tags           — list all tenant tags
    // POST   /tags           — create tag
    // PATCH  /tags/:id       — rename / recolour tag
    // DELETE /tags/:id       — delete tag (also removes from all tickets)
    fastify.get('/tags', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tags = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT tt.id, tt.name, tt.color, tt.description, tt.created_at,
                  (SELECT COUNT(*) FROM tickets WHERE tags @> ARRAY[tt.name] AND tenant_id = tt.tenant_id) AS usage_count
           FROM ticket_tags tt
           ORDER BY tt.name`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: tags });
    });

    fastify.post('/tags', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = z.object({
        name:        z.string().min(1).max(50),
        color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6b7280'),
        description: z.string().max(200).optional(),
      }).parse(req.body);

      const [tag] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `INSERT INTO ticket_tags (tenant_id, name, color, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, name) DO NOTHING
           RETURNING *`,
          [req.tenant.id, body.name.toLowerCase().trim(), body.color, body.description ?? null],
        );
        return r.rows;
      });
      if (!tag) return reply.code(409).send({ success: false, error: { code: 'TAG_EXISTS', message: 'A tag with this name already exists' } });
      return reply.code(201).send({ success: true, data: tag });
    });

    fastify.patch('/tags/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body   = z.object({
        name:        z.string().min(1).max(50).optional(),
        color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        description: z.string().max(200).nullable().optional(),
      }).parse(req.body);

      const [tag] = await db.withTenant(req.tenant.id, async (client) => {
        // If renaming, also update all tickets that use the old tag name
        const [current] = (await client.query('SELECT * FROM ticket_tags WHERE id = $1', [id])).rows;
        if (!current) return [null];

        const newName = body.name ? body.name.toLowerCase().trim() : current.name;
        if (body.name && body.name !== current.name) {
          // Rename tag across all tickets
          await client.query(
            `UPDATE tickets
             SET tags = array_replace(tags, $1, $2)
             WHERE $1 = ANY(tags)`,
            [current.name, newName],
          );
        }
        const r = await client.query(
          `UPDATE ticket_tags SET
             name        = $2,
             color       = COALESCE($3, color),
             description = COALESCE($4, description)
           WHERE id = $1 RETURNING *`,
          [id, newName, body.color ?? null, body.description ?? null],
        );
        return r.rows;
      });
      if (!tag) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tag not found' } });
      return reply.send({ success: true, data: tag });
    });

    fastify.delete('/tags/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        const [tag] = (await client.query('SELECT * FROM ticket_tags WHERE id = $1', [id])).rows;
        if (tag) {
          // Remove this tag from all tickets first
          await client.query(
            `UPDATE tickets SET tags = array_remove(tags, $1) WHERE $1 = ANY(tags)`,
            [tag.name],
          );
          await client.query('DELETE FROM ticket_tags WHERE id = $1', [id]);
        }
      });
      return reply.code(204).send();
    });

    // ── SLA policy CRUD ───────────────────────────────────────────────────
    fastify.get('/sla-policies', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const policies = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query('SELECT * FROM sla_policies ORDER BY priority DESC, name ASC');
        return r.rows;
      });
      return reply.send({ success: true, data: policies });
    });

    fastify.post('/sla-policies', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = CreateSlaSchema.parse(req.body);
      const [policy] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
           `INSERT INTO sla_policies
              (tenant_id, name, description, priority, first_response_hours, resolution_hours,
               reminder_pct, l1_escalation_pct, l2_escalation_pct, business_hours_only, is_active, reminder_schedule)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
           [req.tenant.id, body.name, body.description ?? null, body.priority,
            body.firstResponseHours, body.resolutionHours,
            body.reminderPct, body.l1EscalationPct, body.l2EscalationPct,
            body.businessHoursOnly, body.isActive, JSON.stringify(body.reminderSchedule ?? [])],
         );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: policy });
    });

    fastify.patch('/sla-policies/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CreateSlaSchema.partial().parse(req.body);
      const [policy] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
           `UPDATE sla_policies SET
             name                 = COALESCE($1,  name),
             description          = COALESCE($2,  description),
             priority             = COALESCE($3,  priority),
             first_response_hours = COALESCE($4,  first_response_hours),
             resolution_hours     = COALESCE($5,  resolution_hours),
             reminder_pct         = COALESCE($6,  reminder_pct),
             l1_escalation_pct    = COALESCE($7,  l1_escalation_pct),
             l2_escalation_pct    = COALESCE($8,  l2_escalation_pct),
             business_hours_only  = COALESCE($9,  business_hours_only),
             is_active            = COALESCE($10, is_active),
             reminder_schedule    = COALESCE($11::jsonb, reminder_schedule),
             updated_at           = NOW()
           WHERE id = $12 RETURNING *`,
          [body.name, body.description, body.priority, body.firstResponseHours,
           body.resolutionHours, body.reminderPct, body.l1EscalationPct,
           body.l2EscalationPct, body.businessHoursOnly, body.isActive,
           body.reminderSchedule !== undefined ? JSON.stringify(body.reminderSchedule) : null, id],
        );
        return r.rows;
      });
      if (!policy) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'SLA policy not found' } });
      return reply.send({ success: true, data: policy });
    });

    fastify.delete('/sla-policies/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('UPDATE tickets SET sla_policy_id = NULL WHERE sla_policy_id = $1', [id]);
        await client.query('DELETE FROM sla_policies WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });

    // ── Create ticket (manual) ────────────────────────────────────────────
    fastify.post('/', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body       = CreateTicketSchema.parse(req.body);
      const tenantId   = req.tenant.id;
      const ticketNum  = await nextTicketNumber(db, tenantId);
      const sla        = await findSlaPolicy(db, tenantId, body.slaPolicyId, body.priority);

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        // Auto-assign to default queue if none given
        let queueId = body.queueId;
        if (!queueId) {
          const qr = await client.query('SELECT id FROM ticket_queues WHERE is_default = true LIMIT 1');
          queueId = qr.rows[0]?.id;
        }

        const status = body.assigneeId ? 'assigned' : 'open';
        const r = await client.query(
          `INSERT INTO tickets
             (tenant_id, ticket_number, subject, description, status, priority, channel,
              queue_id, sla_policy_id, contact_id, company_id, assignee_id,
              reporter_email, reporter_name, reporter_phone, reporter_whatsapp,
              preferred_channel, ticket_type, tags, custom_fields)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING *`,
          [tenantId, ticketNum, body.subject, body.description ?? null,
           status, body.priority, body.channel,
           queueId ?? null, sla?.id ?? null,
           body.contactId ?? null, body.companyId ?? null,
           body.assigneeId ?? null,
           body.reporterEmail ?? null, body.reporterName ?? null, body.reporterPhone ?? null,
            body.reporterWhatsapp ?? null, body.preferredChannel ?? 'email',
            body.ticketType ?? 'complaint',
            body.tags ?? [], JSON.stringify(body.customFields ?? {})],
        );
        return r.rows;
      });

      // Notify assignee if set
      if (ticket.assignee_id) {
        await notify(db, tenantId, [ticket.assignee_id], 'ticket_assigned',
          `New ticket assigned: ${ticketNum}`,
          `"${body.subject}" has been assigned to you.`,
          ticket.id);
      }

      // ── Auto-apply milestone template based on ticket_type ──────────────
      const [milTmpl] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT steps FROM ticket_milestone_templates WHERE tenant_id = $1 AND ticket_type = $2`,
          [tenantId, body.ticketType ?? 'complaint'],
        );
        return r.rows;
      });
      if (milTmpl?.steps?.length > 0) {
        await db.withTenant(tenantId, async (client) => {
          await client.query(
            `UPDATE tickets SET milestones = $1::jsonb WHERE id = $2`,
            [JSON.stringify(milTmpl.steps.map((s: any, i: number) => ({ ...s, completed: false, order: i }))), ticket.id],
          );
        });
      }

      // ── Push routing: auto-assign if queue is configured for push ──────
      const [queueCfg] = await db.withTenant(tenantId, async (client) => {
        if (!ticket.queue_id) return [null];
        const r = await client.query(
          `SELECT routing_method FROM ticket_queues WHERE id = $1`,
          [ticket.queue_id],
        );
        return r.rows;
      });

      if (queueCfg?.routing_method === 'push_random' || queueCfg?.routing_method === 'push_criteria') {
        await assignByPushRouting(db, ticket, tenantId, eventBus);
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, { ticket });

      // Audit log — creation
      await auditLog(db, {
        tenantId, ticketId: ticket.id,
        actorId:   req.user.sub,
        action:    'created',
        newValue:  { status: ticket.status, priority: ticket.priority, channel: ticket.channel },
      });

      return reply.code(201).send({ success: true, data: ticket });
    });

    // ── Create ticket from voice bot ──────────────────────────────────────
    // Called automatically by the voice module after a call completes
    // with a support-triggering outcome. Also usable by external APIs.
    fastify.post('/from-voice', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = z.object({
        voiceCallId:   z.string().uuid(),
        subject:       z.string().min(1),
        description:   z.string().optional(),
        priority:      z.enum(['urgent','high','medium','low']).default('medium'),
        reporterName:  z.string().optional(),
        reporterPhone:    z.string().optional(),
        reporterWhatsapp: z.string().optional(),
        preferredChannel: z.enum(['email','sms','whatsapp']).default('email'),
        contactId:        z.string().uuid().optional(),
      }).parse(req.body);

      const tenantId  = req.tenant.id;
      const ticketNum = await nextTicketNumber(db, tenantId);
      const sla       = await findSlaPolicy(db, tenantId, undefined, body.priority);

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const qr = await client.query('SELECT id FROM ticket_queues WHERE is_default = true LIMIT 1');
        const r = await client.query(
          `INSERT INTO tickets
             (tenant_id, ticket_number, subject, description, status, priority, channel,
              queue_id, sla_policy_id, contact_id, voice_call_id,
              reporter_name, reporter_phone, tags, custom_fields)
           VALUES ($1,$2,$3,$4,'open',$5,'voice_bot',$6,$7,$8,$9,$10,$11,'{}','{}')
           RETURNING *`,
          [tenantId, ticketNum, body.subject, body.description ?? null,
           body.priority,
           qr.rows[0]?.id ?? null, sla?.id ?? null,
           body.contactId ?? null, body.voiceCallId,
           body.reporterName ?? null, body.reporterPhone ?? null],
        );
        return r.rows;
      });

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, { ticket, source: 'voice_bot' });
      return reply.code(201).send({ success: true, data: ticket });
    });

    // ── List tickets ──────────────────────────────────────────────────────
    fastify.get('/', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const query    = ListQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const role     = (req.user as any).role as string;
      const deptType = (req.user as any).department_type as string | null;
      const offset   = (query.page - 1) * query.pageSize;

      const params: unknown[] = [];
      const where: string[] = ['1=1'];
      let idx = 1;

      // ── Department-isolation rules ─────────────────────────────────────
      // super_admin / tenant_admin → see all tickets in tenant
      // manager → only tickets in queues for their department, OR assigned to them, OR created by them
      // line_manager → same as manager
      // agent → only tickets assigned to them, OR in queues for their department
      // viewer → only tickets assigned to them
      if (role === 'agent' || role === 'viewer') {
        where.push(`(t.assignee_id = $${idx} OR (t.queue_id IN
          (SELECT id FROM ticket_queues WHERE department_type = $${idx + 1})))`);
        params.push(userId, deptType ?? null);
        idx += 2;
      } else if ((role === 'manager' || role === 'line_manager') && deptType) {
        where.push(`(t.queue_id IN (SELECT id FROM ticket_queues WHERE department_type = $${idx})
                    OR t.assignee_id = $${idx + 1}
                    OR t.created_by = $${idx + 1})`);
        params.push(deptType, userId);
        idx += 2;
      }

      if (query.status) {
        // Allow comma-separated multi-status: "open,assigned"
        const statuses = query.status.split(',').map(s => s.trim());
        where.push(`t.status = ANY($${idx++}::text[])`);
        params.push(statuses);
      }
      if (query.priority) { where.push(`t.priority = $${idx++}`); params.push(query.priority); }
      if (query.channel)  { where.push(`t.channel = $${idx++}`);  params.push(query.channel);  }
      if (query.queueId)  { where.push(`t.queue_id = $${idx++}`); params.push(query.queueId); }
      if (query.assigneeId) { where.push(`t.assignee_id = $${idx++}`); params.push(query.assigneeId); }
      if (query.mine)      { where.push(`t.assignee_id = $${idx++}`); params.push(userId); }
      if (query.contactId) { where.push(`t.contact_id = $${idx++}`); params.push(query.contactId); }
      if (query.overdue)   { where.push(`t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed')`); }
      if (query.search) {
        where.push(`(t.subject ILIKE $${idx++} OR t.ticket_number ILIKE $${idx++} OR t.reporter_email ILIKE $${idx})`);
        const like = `%${query.search}%`;
        params.push(like, like, like); idx += 2;
      }

      const whereStr = where.join(' AND ');
      const orderBy  = `t.${query.sortBy} ${query.sortOrder}`;

      const [count, tickets] = await db.withTenant(tenantId, async (client) => {
        const cntR = await client.query(
          `SELECT COUNT(*) FROM tickets t WHERE ${whereStr}`, params,
        );
        const listR = await client.query(
          `SELECT t.*,
             u.name  AS assignee_name,
             u.avatar AS assignee_avatar,
             c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
             q.name  AS queue_name,
             q.color AS queue_color,
             CASE WHEN t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed')
                  THEN true ELSE false END AS is_overdue,
             EXTRACT(EPOCH FROM (t.sla_due_at - NOW())) AS sla_seconds_remaining
           FROM tickets t
           LEFT JOIN users u    ON t.assignee_id  = u.id
           LEFT JOIN contacts c ON t.contact_id   = c.id
           LEFT JOIN ticket_queues q ON t.queue_id = q.id
           WHERE ${whereStr}
           ORDER BY ${orderBy}
           LIMIT $${idx++} OFFSET $${idx}`,
          [...params, query.pageSize, offset],
        );
        return [parseInt(cntR.rows[0].count), listR.rows];
      });

      return reply.send({
        success: true,
        data: tickets,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: count,
          totalPages: Math.ceil(count / query.pageSize),
        },
      });
    });

    // ── Get single ticket ─────────────────────────────────────────────────
    fastify.get('/:id', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };

      const [ticket, comments, escalations, voiceBotCall] = await db.withTenant(req.tenant.id, async (client) => {
        const tr = await client.query(
          `SELECT t.*,
             u.name   AS assignee_name,
             u.role   AS assignee_role,
             u.avatar AS assignee_avatar,
             pu.name  AS prev_assignee_name,
             mob.name AS manager_overridden_by_name,
             c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
             q.name  AS queue_name,
             q.color AS queue_color,
             s.name  AS sla_name,
             s.resolution_hours,
             CASE WHEN t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed')
                  THEN true ELSE false END AS is_overdue,
             EXTRACT(EPOCH FROM (t.sla_due_at - NOW())) AS sla_seconds_remaining,
             EXTRACT(EPOCH FROM (NOW() - t.created_at)) AS age_seconds
           FROM tickets t
           LEFT JOIN users u         ON t.assignee_id          = u.id
           LEFT JOIN users pu        ON t.prev_assignee_id      = pu.id
           LEFT JOIN users mob       ON t.manager_overridden_by = mob.id
           LEFT JOIN contacts c      ON t.contact_id            = c.id
           LEFT JOIN ticket_queues q ON t.queue_id              = q.id
           LEFT JOIN sla_policies s  ON t.sla_policy_id         = s.id
           WHERE t.id = $1`,
          [id],
        );
        const cr = await client.query(
          `SELECT
             tc.*,
             u.name   AS author_name_resolved,
             u.role   AS author_role,
             u.avatar AS author_avatar,
             -- Quoted (replied-to) remark preview
             rt.id        AS reply_to_id,
             rt.body      AS reply_to_body,
             rt.created_at AS reply_to_created_at,
             ru.name      AS reply_to_author_name
           FROM ticket_comments tc
           LEFT JOIN users u  ON tc.author_id   = u.id
           LEFT JOIN ticket_comments rt ON tc.reply_to_id = rt.id
           LEFT JOIN users ru ON rt.author_id   = ru.id
           WHERE tc.ticket_id = $1
           ORDER BY tc.created_at ASC`,
          [id],
        );
        const er = await client.query(
          `SELECT * FROM ticket_escalations WHERE ticket_id = $1 ORDER BY created_at ASC`,
          [id],
        );
        const vbr = await client.query(
          `SELECT vbc.*, con.first_name || ' ' || COALESCE(con.last_name,'') AS contact_name
           FROM voice_bot_calls vbc
           LEFT JOIN contacts con ON vbc.contact_id = con.id
           WHERE vbc.ticket_id = $1 LIMIT 1`,
          [id],
        );
        return [tr.rows[0], cr.rows, er.rows, vbr.rows[0] ?? null];
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      return reply.send({ success: true, data: { ...ticket, comments, escalations, voiceBotCall } });
    });

    // ── Update ticket ─────────────────────────────────────────────────────
    fastify.patch('/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body  = UpdateTicketSchema.parse(req.body);

      const sets: string[] = ['updated_at = NOW()'];
      const vals: unknown[] = [];
      let idx = 1;

      const map: Record<string, string> = {
        subject: 'subject', description: 'description', priority: 'priority',
        status: 'status', queueId: 'queue_id', slaPolicyId: 'sla_policy_id',
        contactId: 'contact_id', companyId: 'company_id', assigneeId: 'assignee_id',
        resolutionNote: 'resolution_note',
      };
      for (const [k, col] of Object.entries(map)) {
        if (k in body) { sets.push(`${col} = $${idx++}`); vals.push((body as any)[k]); }
      }
      if (body.tags)         { sets.push(`tags = $${idx++}`);          vals.push(body.tags); }
      if (body.customFields) { sets.push(`custom_fields = custom_fields || $${idx++}::jsonb`); vals.push(JSON.stringify(body.customFields)); }

      // Auto-set timestamps for status transitions
      if (body.status === 'resolved') { sets.push(`resolved_at = COALESCE(resolved_at, NOW())`); }
      if (body.status === 'closed')   { sets.push(`closed_at   = COALESCE(closed_at,   NOW())`); }

      vals.push(id);
      const [ticket] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
          vals,
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      await eventBus.publish(req.tenant.id, CRM_EVENTS.TICKET_CREATED, { ticket, changes: body });

      // Audit log — field update
      const changedFields = Object.keys(body).filter(k => (body as any)[k] !== undefined);
      if (changedFields.length > 0) {
        await auditLog(db, {
          tenantId:  req.tenant.id,
          ticketId:  ticket.id,
          actorId:   req.user.sub,
          action:    body.status ? 'status_changed' : 'field_updated',
          newValue:  Object.fromEntries(changedFields.map(k => [k, (body as any)[k]])),
        });
      }

      return reply.send({ success: true, data: ticket });
    });

    // ── Assign ticket ─────────────────────────────────────────────────────
    /**
     * POST /:id/assign
     * Assign (or reassign) a ticket to an agent.
     * When a manager overrides a previous assignment:
     *   - Previous assignee is notified their ticket was moved
     *   - Override is recorded with manager name, timestamp, optional note
     *   - Ticket shows "Reassigned by <manager> to <new agent>" in audit trail
     */
    fastify.post('/:id/assign', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body   = z.object({
        assigneeId: z.string().uuid(),
        note:       z.string().max(500).optional(),  // manager can add a note explaining the reassignment
      }).parse(req.body);
      const { assigneeId, note } = body;
      const tenantId   = req.tenant.id;
      const actorId    = (req as any).user?.sub as string;
      const actorRole  = (req as any).user?.role as string;
      const isManager  = ['manager','tenant_admin','super_admin'].includes(actorRole);

      // Read current ticket to capture previous assignee
      const [currentTicket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query('SELECT * FROM tickets WHERE id = $1', [id]);
        return r.rows;
      });
      if (!currentTicket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      const previousAssigneeId = currentTicket.assignee_id as string | null;
      const isReassignment     = previousAssigneeId && previousAssigneeId !== assigneeId;
      const isManagerOverride  = isReassignment && isManager;

      // Perform the update — record override fields if manager is overriding
      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET assignee_id          = $1,
               prev_assignee_id     = CASE WHEN $3 THEN assignee_id ELSE prev_assignee_id END,
               manager_overridden_by= CASE WHEN $4 THEN $5::uuid ELSE manager_overridden_by END,
               manager_overridden_at= CASE WHEN $4 THEN NOW()    ELSE manager_overridden_at END,
               manager_override_note= CASE WHEN $4 THEN $6       ELSE manager_override_note END,
               status               = CASE WHEN status = 'open' THEN 'assigned' ELSE status END,
               updated_at           = NOW()
           WHERE id = $2 RETURNING *`,
          [assigneeId, id, isReassignment, isManagerOverride, actorId, note ?? null],
        );
        return r.rows;
      });

      // Fetch actor and both agents for notifications
      const userIds = [assigneeId, ...(previousAssigneeId ? [previousAssigneeId] : []), actorId]
        .filter((v, i, a) => a.indexOf(v) === i);
      const users   = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT id, email, name FROM users WHERE id = ANY($1::uuid[])', [userIds]);
        return r.rows as Array<{ id: string; email: string; name: string }>;
      });
      const findUser = (uid: string) => users.find(u => u.id === uid);

      const newAgent   = findUser(assigneeId);
      const prevAgent  = previousAssigneeId ? findUser(previousAssigneeId) : null;
      const actor      = findUser(actorId);

      // ── Notify new assignee ───────────────────────────────────────────
      await notify(db, tenantId, [assigneeId], 'ticket_assigned',
        `Ticket ${ticket.ticket_number} assigned to you`,
        isManagerOverride
          ? `"${ticket.subject}" has been assigned to you by ${actor?.name ?? 'a manager'}. ${note ? `Note: ${note}` : ''}`
          : `"${ticket.subject}" is awaiting your acceptance.`,
        id);

      if (newAgent?.email) {
        emailSvc.send(tenantId, {
          to: newAgent.email, toName: newAgent.name,
          subject: `Ticket ${ticket.ticket_number} assigned to you`,
          bodyHtml: `<p>Hi ${newAgent.name},</p>
<p>Ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" has been assigned to you${isManagerOverride ? ` by ${actor?.name}` : ''}.</p>
${note ? `<p><strong>Note:</strong> ${note}</p>` : ''}
<p>Please log in to the CRM to review and accept this ticket.</p>`,
          bodyText: `Ticket ${ticket.ticket_number} ("${ticket.subject}") assigned to you. Please log in.`,
          ticketId: id,
        }).catch(() => {});
      }

      // ── Notify PREVIOUS assignee if this is a reassignment ───────────
      if (isReassignment && prevAgent) {
        await notify(db, tenantId, [previousAssigneeId!], 'ticket_reassigned',
          `Ticket ${ticket.ticket_number} has been reassigned`,
          `"${ticket.subject}" was assigned to you but has now been ${isManagerOverride ? `reassigned by ${actor?.name}` : 'reassigned'} to ${newAgent?.name ?? 'another agent'}. ${note ? `Note: ${note}` : ''}`,
          id);

        emailSvc.send(tenantId, {
          to: prevAgent.email, toName: prevAgent.name,
          subject: `Ticket ${ticket.ticket_number} has been reassigned`,
          bodyHtml: `<p>Hi ${prevAgent.name},</p>
<p>Ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" that was assigned to you has been reassigned to <strong>${newAgent?.name ?? 'another agent'}</strong>${isManagerOverride ? ` by ${actor?.name}` : ''}.</p>
${note ? `<p><strong>Reason:</strong> ${note}</p>` : ''}
<p>No further action is required from you on this ticket.</p>`,
          bodyText: `Ticket ${ticket.ticket_number} reassigned to ${newAgent?.name ?? 'another agent'}. No action required from you.`,
          ticketId: id,
        }).catch(() => {});
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_ASSIGNED, {
        ticketId: id, assigneeId,
        previousAssigneeId: previousAssigneeId ?? null,
        assignedBy: actorId,
        isManagerOverride,
        note: note ?? null,
      });
      return reply.send({ success: true, data: ticket });
    });

    // ── Overview — everything an agent needs the moment they accept ──────
    // GET /:id/overview returns: the ticket, full voice transcript (if any),
    // prior tickets from the same reporter/contact, related resolved tickets
    // (by category), and contact summary. One request, ready to render.
    fastify.get('/:id/overview', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;

      const data = await db.withTenant(tenantId, async (client) => {
        // 1. The ticket itself with all related fields
        const [ticket] = (await client.query(
          `SELECT t.*, q.name AS queue_name, q.color AS queue_color,
                  s.name AS sla_name, s.resolution_hours,
                  c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
                  c.phone AS contact_phone, c.email AS contact_email,
                  c.company_id, c.status AS contact_status, c.score AS contact_score,
                  co.name AS company_name,
                  ua.name AS assignee_name, ua.email AS assignee_email,
                  uc.name AS creator_name
           FROM tickets t
           LEFT JOIN ticket_queues q ON q.id = t.queue_id
           LEFT JOIN sla_policies s ON s.id = t.sla_policy_id
           LEFT JOIN contacts c ON c.id = t.contact_id
           LEFT JOIN companies co ON co.id = c.company_id
           LEFT JOIN users ua ON ua.id = t.assignee_id
           LEFT JOIN users uc ON uc.id = t.created_by
           WHERE t.id = $1`,
          [id],
        )).rows;
        if (!ticket) return null;

        // 2. Linked voice call (if this ticket came from a call)
        const [voiceCall] = (await client.query(
          `SELECT id, transcript, summary, sentiment, duration_seconds,
                  from_number, started_at, ended_at, recording_url,
                  extracted_reporter_name, extracted_category, extracted_priority
           FROM voice_bot_calls
           WHERE ticket_id = $1
           LIMIT 1`,
          [id],
        )).rows;

        // 3. Prior tickets from the same contact (or same phone if no contact)
        const priorTicketsParams: unknown[] = [id];
        let priorWhere = 'id != $1 AND ';
        if (ticket.contact_id) {
          priorTicketsParams.push(ticket.contact_id);
          priorWhere += `contact_id = $${priorTicketsParams.length}`;
        } else if (ticket.reporter_phone) {
          priorTicketsParams.push(ticket.reporter_phone);
          priorWhere += `reporter_phone = $${priorTicketsParams.length}`;
        } else {
          priorWhere += 'false';
        }
        const priorTickets = (await client.query(
          `SELECT id, ticket_number, subject, status, priority, ticket_type,
                  channel, created_at, resolved_at
           FROM tickets
           WHERE ${priorWhere}
           ORDER BY created_at DESC
           LIMIT 10`,
          priorTicketsParams,
        )).rows;

        // 4. Related resolved tickets — same ticket_type, similar subject keywords
        // (cheap version: same type + status='resolved' or 'closed', recent first)
        const related = (await client.query(
          `SELECT id, ticket_number, subject, ticket_type, resolved_at
           FROM tickets
           WHERE ticket_type = COALESCE($1, ticket_type)
             AND status IN ('resolved', 'closed')
             AND id != $2
           ORDER BY resolved_at DESC NULLS LAST
           LIMIT 5`,
          [ticket.ticket_type ?? null, id],
        )).rows;

        // 5. Recent comments
        const comments = (await client.query(
          `SELECT tc.id, tc.body, tc.is_internal, tc.created_at,
                  u.name AS author_name, u.role AS author_role
           FROM ticket_comments tc
           LEFT JOIN users u ON u.id = tc.author_id
           WHERE tc.ticket_id = $1
           ORDER BY tc.created_at DESC
           LIMIT 20`,
          [id],
        )).rows;

        return { ticket, voiceCall, priorTickets, related, comments };
      });

      if (!data) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      return reply.send({ success: true, data });
    });

    // ── Accept ticket (agent confirms they will work on it) ───────────────
    // This starts the SLA resolution timer.
    fastify.post('/:id/accept', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      // Fetch ticket + SLA policy
      const [existing] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT t.*, s.resolution_hours
           FROM tickets t
           LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
           WHERE t.id = $1`,
          [id],
        );
        return r.rows;
      });

      if (!existing) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (existing.status === 'accepted' || existing.accepted_at) {
        return reply.code(409).send({ success: false, error: { code: 'ALREADY_ACCEPTED', message: 'Ticket already accepted' } });
      }

      const acceptedAt = new Date();
      const resHours   = existing.resolution_hours ?? 24;
      const slaDueAt   = new Date(acceptedAt.getTime() + resHours * 3_600_000);

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET status = 'accepted',
               accepted_at = $1,
               sla_due_at  = $2,
               assignee_id = COALESCE(assignee_id, $3),
               updated_at  = NOW()
           WHERE id = $4 RETURNING *`,
          [acceptedAt, slaDueAt, userId, id],
        );
        return r.rows;
      });

      await notify(db, tenantId, [userId], 'ticket_accepted',
        `You accepted ticket ${ticket.ticket_number}`,
        `SLA timer started. Resolution due by ${slaDueAt.toLocaleString()}.`,
        id);

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_ACCEPTED, {
        ticketId: id, acceptedAt, slaDueAt, assigneeId: userId,
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── Resolve ticket ────────────────────────────────────────────────────
    fastify.post('/:id/resolve', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const { note } = z.object({ note: z.string().optional() }).parse(req.body ?? {});

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET status = 'resolved',
               resolved_at = COALESCE(resolved_at, NOW()),
               resolution_note = COALESCE($1, resolution_note),
               updated_at = NOW()
           WHERE id = $2 RETURNING *`,
          [note ?? null, id],
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // Email reporter on resolution
      if (ticket.reporter_email) {
        emailSvc.send(tenantId, {
          to: ticket.reporter_email,
          toName: ticket.reporter_name ?? undefined,
          subject: `Your ticket ${ticket.ticket_number} has been resolved`,
          bodyHtml: `<p>Dear ${ticket.reporter_name ?? 'Customer'},</p>
<p>We're pleased to let you know that your support ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" — has been resolved.</p>
<p>If you have any further questions, please don't hesitate to reach out.</p>
<p>Thank you for your patience.</p>`,
          bodyText: `Dear ${ticket.reporter_name ?? 'Customer'},\n\nYour ticket ${ticket.ticket_number} ("${ticket.subject}") has been resolved.\n\nThank you.`,
          ticketId: id,
        }).catch(() => { /* non-fatal */ });
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_RESOLVED, { ticket });

      // Audit log
      await auditLog(db, {
        tenantId, ticketId: ticket.id,
        actorId:  req.user.sub,
        action:   'status_changed',
        oldValue: { status: 'in_progress' },
        newValue: { status: 'resolved', resolutionNote: note },
      });

      return reply.send({ success: true, data: ticket });
    });


    // ── Update milestone progress ─────────────────────────────────────────
    // PATCH /:id/milestones
    // body: { steps: [{id, label, completed, completed_at}] }
    fastify.patch('/:id/milestones', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const { steps } = req.body as { steps: Array<{ id: string; label: string; completed: boolean; completed_at?: string }> };

      // Fetch ticket
      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`SELECT * FROM tickets WHERE id = $1`, [id]);
        return r.rows;
      });
      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // Detect newly completed steps (for customer notification)
      const prevMilestones: any[] = ticket.milestones ?? [];
      const prevCompleted = new Set(prevMilestones.filter((s: any) => s.completed).map((s: any) => s.id));
      const newlyCompleted = steps.filter(s => s.completed && !prevCompleted.has(s.id));

      // Persist updated milestones
      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE tickets SET milestones = $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(steps), id],
        );
      });

      // Notify customer on newly completed milestones
      if (newlyCompleted.length > 0 && ticket.reporter_email) {
        for (const step of newlyCompleted) {
          emailSvc.send(tenantId, {
            to:      ticket.reporter_email,
            toName:  ticket.reporter_name ?? undefined,
            subject: `Update on your ticket ${ticket.ticket_number}`,
            bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <p style="color:#1e293b;font-size:15px;">Dear ${ticket.reporter_name ?? 'Customer'},</p>
              <p>We wanted to update you that the following step has been completed for your ticket <strong>${ticket.ticket_number}</strong>:</p>
              <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;">
                <p style="margin:0;font-weight:600;color:#166534;">✅ ${step.label}</p>
              </div>
              <p style="color:#64748b;">Our team is continuing to work on your request.</p>
            </div>`,
            bodyText: `Ticket ${ticket.ticket_number} update: Step "${step.label}" has been completed.`,
            ticketId: id,
            sentBy: userId,
          }).catch(() => {});
        }
      }

      // Compute overall progress
      const completed = steps.filter(s => s.completed).length;
      const total     = steps.length;

      return reply.send({ success: true, data: { steps, progress: total > 0 ? Math.round((completed / total) * 100) : 0 } });
    });

    // ── Close ticket ──────────────────────────────────────────────────────
    fastify.post('/:id/close', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET status = 'closed', closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [id],
        );
        return r.rows;
      });
      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // ── Closure notifications ─────────────────────────────────────────
      const closerName = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT name FROM users WHERE id = $1', [userId]);
        return r.rows[0]?.name ?? 'Support Team';
      });

      // 1. Customer
      if (ticket.reporter_email) {
        emailSvc.send(tenantId, {
          to: ticket.reporter_email, toName: ticket.reporter_name ?? undefined,
          subject: `Your ticket ${ticket.ticket_number} has been closed`,
          bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <p>Dear ${ticket.reporter_name ?? 'Customer'},</p>
            <p>Your support ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" — has been <strong>closed</strong>.</p>
            ${ticket.resolution_note ? `<div style="background:#f8fafc;border-left:4px solid #29ABE2;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;"><p style="margin:0;color:#1e293b;"><strong>Resolution:</strong> ${ticket.resolution_note}</p></div>` : ''}
            <p style="color:#64748b;">If you need further assistance, please don't hesitate to contact us.</p>
          </div>`,
          bodyText: `Ticket ${ticket.ticket_number} has been closed. ${ticket.resolution_note ? 'Resolution: ' + ticket.resolution_note : ''}`,
          ticketId: id, sentBy: userId,
        }).catch(() => {});
      }

      // 2. Assigned agent notification (in-app)
      if (ticket.assignee_id) {
        await notify(db, tenantId, [ticket.assignee_id], 'ticket_closed',
          `Ticket ${ticket.ticket_number} closed`,
          `"${ticket.subject}" has been closed.`, id);
      }

      // 3. Managers / line management (in-app)
      const managers = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('manager','tenant_admin') AND is_active = true`,
          [tenantId],
        );
        return r.rows.map((u: any) => u.id as string);
      });
      if (managers.length > 0) {
        await notify(db, tenantId, managers, 'ticket_closed',
          `Ticket ${ticket.ticket_number} closed by ${closerName}`,
          `"${ticket.subject}" — resolved and closed.`, id);
      }

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CLOSED, { ticket });

      // Audit log — closure
      await auditLog(db, {
        tenantId, ticketId: id,
        actorId:   userId,
        actorName: closerName,
        action:    'status_changed',
        oldValue:  { status: 'resolved' },
        newValue:  { status: 'closed' },
      });

      // CSAT survey — fire and forget (Gap 4: read configurable expiry from tenant settings)
      const csatExpiry = (req.tenant as any)?.settings?.csat_expiry_days ?? 7;
      await sendCsatSurvey(db, emailSvc, eventBus, { ...ticket, tenant_id: tenantId }, APP_URL, csatExpiry);

      return reply.send({ success: true, data: ticket });
    });

    // ── RCA — Root Cause Analysis ─────────────────────────────────────────
    fastify.post('/:id/rca', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;
      const body     = RcaSchema.parse(req.body);

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE tickets
           SET root_cause          = $1,
               corrective_action   = $2,
               rca_completed_at    = COALESCE(rca_completed_at, NOW()),
               rca_completed_by    = COALESCE(rca_completed_by, $3),
               updated_at          = NOW()
           WHERE id = $4
           RETURNING id, ticket_number, subject, root_cause, corrective_action,
                     rca_completed_at, rca_completed_by`,
          [body.rootCause, body.correctiveAction, userId, id],
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });

      // Audit log
      await auditLog(db, {
        tenantId, ticketId: id,
        actorId:  userId,
        action:   'rca_submitted',
        newValue: { rootCause: body.rootCause, correctiveAction: body.correctiveAction },
      });

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_RCA_SUBMITTED, {
        ticketId: id,
        rootCause: body.rootCause,
        correctiveAction: body.correctiveAction,
      });

      return reply.send({ success: true, data: ticket });
    });

    // ── RCA — Get ─────────────────────────────────────────────────────────
    fastify.get('/:id/rca', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;

      const [ticket] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT t.id, t.ticket_number, t.subject, t.root_cause, t.corrective_action,
                  t.rca_completed_at, u.name AS rca_completed_by_name
           FROM   tickets t
           LEFT JOIN users u ON u.id = t.rca_completed_by
           WHERE  t.id = $1`,
          [id],
        );
        return r.rows;
      });

      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      return reply.send({ success: true, data: ticket });
    });

    // ── Audit log — tamper-proof trail ────────────────────────────────────
    fastify.get('/:id/audit-log', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const { page = 1, pageSize = 50 } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      const rows = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT al.id, al.action, al.old_value, al.new_value, al.meta,
                  al.created_at, al.actor_name,
                  u.name AS actor_display_name, u.avatar AS actor_avatar
           FROM   ticket_audit_log al
           LEFT JOIN users u ON u.id = al.actor_id
           WHERE  al.ticket_id = $1
           ORDER BY al.created_at ASC
           LIMIT $2 OFFSET $3`,
          [id, pageSize, offset],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: rows });
    });

    // ── Gap 6: Standalone comments endpoint ──────────────────────────────
    // GET /tickets/:id/comments
    //   ?since=<ISO timestamp>   — return only comments after this time (for polling)
    //   ?type=reply|remark|note  — filter by comment type
    //   ?page=1&pageSize=50
    fastify.get('/:id/comments', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id }       = req.params as { id: string };
      const tenantId     = req.tenant.id;
      const { since, type, page = '1', pageSize = '50' } = req.query as {
        since?: string; type?: string; page?: string; pageSize?: string;
      };

      const conditions: string[] = ['tc.ticket_id = $1'];
      const vals: any[]          = [id];
      let   idx                  = 2;

      if (since) {
        const sinceDate = new Date(since);
        if (!isNaN(sinceDate.getTime())) {
          conditions.push(`tc.created_at > $${idx++}`);
          vals.push(sinceDate.toISOString());
        }
      }
      if (type && ['reply','remark','note'].includes(type)) {
        conditions.push(`tc.comment_type = $${idx++}`);
        vals.push(type);
      }

      const limit  = Math.min(Math.max(1, Number(pageSize) || 50), 200);
      const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
      conditions.push(`TRUE LIMIT $${idx++} OFFSET $${idx++}`);
      vals.push(limit, offset);

      const comments = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT
             tc.*,
             u.name   AS author_name_resolved,
             u.role   AS author_role,
             u.avatar AS author_avatar,
             rt.id           AS reply_to_id,
             rt.body         AS reply_to_body,
             rt.created_at   AS reply_to_created_at,
             ru.name         AS reply_to_author_name
           FROM ticket_comments tc
           LEFT JOIN users u  ON tc.author_id   = u.id
           LEFT JOIN ticket_comments rt ON tc.reply_to_id = rt.id
           LEFT JOIN users ru ON rt.author_id   = ru.id
           WHERE ${conditions.join(' AND ')}
           ORDER BY tc.created_at ASC`,
          vals,
        );
        return r.rows;
      });

      return reply.send({ success: true, data: comments, meta: { page: Number(page), pageSize: limit } });
    });

    // ── Add comment / internal note ───────────────────────────────────────
    fastify.post('/:id/comments', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const body     = AddCommentSchema.parse(req.body);
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [comment] = await db.withTenant(tenantId, async (client) => {
        // If this is the first external reply, record first_response_at
        if (!body.isInternal && body.commentType === 'reply') {
          await client.query(
            `UPDATE tickets SET first_response_at = COALESCE(first_response_at, NOW()) WHERE id = $1`,
            [id],
          );
        }
        // Move status to in_progress if still at accepted
        await client.query(
          `UPDATE tickets SET status = 'in_progress', updated_at = NOW()
           WHERE id = $1 AND status = 'accepted'`,
          [id],
        );
        const inserted = await client.query(
          `INSERT INTO ticket_comments
             (tenant_id, ticket_id, author_id, body, is_internal, comment_type, reply_to_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            tenantId, id, userId, body.body,
            body.commentType === 'remark' ? true : body.isInternal,
            body.commentType,
            body.replyToId ?? null,
          ],
        );
        const newId = inserted.rows[0]?.id;
        // Return enriched row (author name + role + reply_to preview)
        const r = await client.query(
          `SELECT
             tc.*,
             u.name   AS author_name_resolved,
             u.role   AS author_role,
             rt.id        AS reply_to_id,
             rt.body      AS reply_to_body,
             rt.created_at AS reply_to_created_at,
             ru.name      AS reply_to_author_name
           FROM ticket_comments tc
           LEFT JOIN users u  ON tc.author_id  = u.id
           LEFT JOIN ticket_comments rt ON tc.reply_to_id = rt.id
           LEFT JOIN users ru ON rt.author_id  = ru.id
           WHERE tc.id = $1`,
          [newId],
        );
        return r.rows;
      });

      await eventBus.publish(tenantId, CRM_EVENTS.TICKET_COMMENTED, { ticketId: id, comment });

      // Audit log — comment/note
      await auditLog(db, {
        tenantId, ticketId: id,
        actorId:  userId,
        action:   'comment_added',
        newValue: { isInternal: body.isInternal, excerpt: body.body.slice(0, 120) },
      });

      // ── Dispatch reply via customer's preferred channel ────────────────
      if (!body.isInternal) {
        const [ticket] = await db.withTenant(tenantId, async (client) => {
          const r = await client.query(
            `SELECT ticket_number, subject, reporter_email, reporter_name,
                    reporter_phone, reporter_whatsapp, preferred_channel
             FROM tickets WHERE id = $1`,
            [id],
          );
          return r.rows;
        });
        const [agent] = await db.withSuperAdmin(async (client) => {
          const r = await client.query('SELECT name FROM users WHERE id = $1', [userId]);
          return r.rows;
        });
        const agentName = agent?.name ?? 'Support Team';
        const channel   = ticket?.preferred_channel ?? 'email';

        if (channel === 'sms' && ticket?.reporter_phone) {
          smsSvc.send(tenantId, {
            to:       ticket.reporter_phone,
            body:     `[${ticket.ticket_number}] ${body.body.slice(0, 140)} — ${agentName}`,
            ticketId: id,
          }).catch(() => {});
        } else if (channel === 'whatsapp' && (ticket?.reporter_whatsapp || ticket?.reporter_phone)) {
          const waNumber = ticket.reporter_whatsapp ?? ticket.reporter_phone;
          smsSvc.send(tenantId, {
            to:       `whatsapp:${waNumber}`,
            body:     `[${ticket.ticket_number}] ${body.body} — ${agentName}`,
            ticketId: id,
          }).catch(() => {});
        } else if (ticket?.reporter_email) {
          emailSvc.send(tenantId, {
            to:       ticket.reporter_email,
            toName:   ticket.reporter_name ?? undefined,
            subject:  `Re: [${ticket.ticket_number}] ${ticket.subject}`,
            bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#f8fafc;border-left:4px solid #29ABE2;padding:12px 16px;margin-bottom:20px;border-radius:0 8px 8px 0;"><p style="margin:0;font-size:12px;color:#64748b;">Ticket <strong>${ticket.ticket_number}</strong> — ${ticket.subject}</p></div><p style="color:#1e293b;font-size:15px;line-height:1.6;">${body.body.split(String.fromCharCode(10)).join('<br/>')}</p><p style="color:#64748b;font-size:13px;margin-top:24px;">— ${agentName}, Support Team</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/><p style="color:#94a3b8;font-size:11px;">Ticket ${ticket.ticket_number}. Please do not reply directly to this email.</p></div>`,
            bodyText:  `${body.body}\n\n— ${agentName}\n\nTicket: ${ticket.ticket_number}`,
            ticketId: id,
            sentBy:   userId,
          }).catch(() => {});
        }
      }


      return reply.code(201).send({ success: true, data: comment });
    });

    // ── AGENT DASHBOARD — personal ticket counts + TAT health ──────────
    fastify.get('/dashboard/agent', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId   = (req.query as any).user_id ?? req.user.sub;

      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'assigned')                                              AS assigned,
             COUNT(*) FILTER (WHERE status = 'accepted' OR accepted_at IS NOT NULL
                               AND status NOT IN ('resolved','closed'))                               AS accepted,
             COUNT(*) FILTER (WHERE status IN ('pending','in_progress'))                              AS pending,
             COUNT(*) FILTER (WHERE status = 'resolved')                                              AS resolved,
             COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND sla_due_at > NOW()
                               AND status NOT IN ('resolved','closed'))                               AS within_tat,
             COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL
                               AND sla_due_at > NOW()
                               AND sla_due_at <= NOW() + INTERVAL '2 hours'
                               AND status NOT IN ('resolved','closed'))                               AS approaching_tat,
             COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND sla_due_at < NOW()
                               AND status NOT IN ('resolved','closed'))                               AS breached_tat
           FROM tickets
           WHERE tenant_id = $1 AND assignee_id = $2`,
          [tenantId, userId]
        )
      );

      return reply.send({ success: true, data: rows[0] });
    });

    // ── MANAGER ROLLUP — recursive team summary down the manager_id chain ──
    fastify.get('/dashboard/team', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId  = req.tenant.id;
      const managerId = (req.query as any).manager_id ?? req.user.sub;

      const { rows: [totals] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `WITH RECURSIVE team AS (
             SELECT id FROM users WHERE tenant_id = $1 AND id = $2
             UNION ALL
             SELECT u.id FROM users u INNER JOIN team t ON u.manager_id = t.id
             WHERE u.tenant_id = $1
           )
           SELECT
             COUNT(*) FILTER (WHERE t.status = 'assigned')                                           AS assigned,
             COUNT(*) FILTER (WHERE t.status = 'accepted' OR t.accepted_at IS NOT NULL
                               AND t.status NOT IN ('resolved','closed'))                             AS accepted,
             COUNT(*) FILTER (WHERE t.status IN ('pending','in_progress'))                           AS pending,
             COUNT(*) FILTER (WHERE t.status = 'resolved')                                           AS resolved,
             COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at > NOW()
                               AND t.status NOT IN ('resolved','closed'))                             AS within_tat,
             COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL
                               AND t.sla_due_at > NOW()
                               AND t.sla_due_at <= NOW() + INTERVAL '2 hours'
                               AND t.status NOT IN ('resolved','closed'))                             AS approaching_tat,
             COUNT(*) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW()
                               AND t.status NOT IN ('resolved','closed'))                             AS breached_tat
           FROM tickets t
           WHERE t.tenant_id = $1 AND t.assignee_id IN (SELECT id FROM team)`,
          [tenantId, managerId]
        )
      );

      const { rows: agents } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT
             u.id, u.name, u.email, u.department, u.department_type,
             COUNT(t.id) FILTER (WHERE t.status = 'assigned')                                        AS assigned,
             COUNT(t.id) FILTER (WHERE t.status = 'accepted' OR t.accepted_at IS NOT NULL
                                  AND t.status NOT IN ('resolved','closed'))                          AS accepted,
             COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress'))                        AS pending,
             COUNT(t.id) FILTER (WHERE t.status = 'resolved')                                        AS resolved,
             COUNT(t.id) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at > NOW()
                                  AND t.status NOT IN ('resolved','closed'))                          AS within_tat,
             COUNT(t.id) FILTER (WHERE t.sla_due_at IS NOT NULL
                                  AND t.sla_due_at > NOW()
                                  AND t.sla_due_at <= NOW() + INTERVAL '2 hours'
                                  AND t.status NOT IN ('resolved','closed'))                          AS approaching_tat,
             COUNT(t.id) FILTER (WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW()
                                  AND t.status NOT IN ('resolved','closed'))                          AS breached_tat
           FROM users u
           LEFT JOIN tickets t ON t.assignee_id = u.id AND t.tenant_id = $1
           WHERE u.tenant_id = $1 AND u.manager_id = $2
           GROUP BY u.id, u.name, u.email, u.department, u.department_type
           ORDER BY u.name`,
          [tenantId, managerId]
        )
      );

      const { rows: [{ direct_reports }] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT COUNT(*) AS direct_reports FROM users WHERE tenant_id = $1 AND manager_id = $2`,
          [tenantId, managerId]
        )
      );

      return reply.send({
        success: true,
        data: { totals, agents, direct_reports: Number(direct_reports) },
      });
    });
  };
}

// ── SLA Worker (lives in modules/ticketing/src/index.ts) ──────────────────
// The actual SLA worker runs in the TicketingPlatformModule's onLoad().
// This export is kept for backward compatibility only.

export async function runSlaWorker(db: DatabaseClient, eventBus: EventBus): Promise<void> {
  try {
    // ════════════════════════════════════════════════════════════════════
    // GAP 1: FIRST-RESPONSE SLA CHECK
    // Runs for all open/assigned tickets that have not yet received a first
    // response, where the SLA policy defines a first_response_hours limit.
    // ════════════════════════════════════════════════════════════════════
    const firstResponseTickets = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT
           t.id, t.tenant_id, t.ticket_number, t.subject, t.priority,
           t.assignee_id, t.created_at, t.first_response_at,
           t.first_response_breached, t.first_response_warned,
           s.first_response_hours,
           s.id AS sla_policy_id
         FROM tickets t
         LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
         WHERE t.status NOT IN ('resolved','closed')
           AND t.first_response_at IS NULL
           AND s.first_response_hours IS NOT NULL
           AND s.first_response_hours > 0`,
      );
      return r.rows;
    });

    for (const ticket of firstResponseTickets) {
      const now            = Date.now();
      const createdMs      = new Date(ticket.created_at).getTime();
      const deadlineMs     = createdMs + ticket.first_response_hours * 3_600_000;
      const totalMs        = deadlineMs - createdMs;
      const elapsedMs      = now - createdMs;
      const elapsedPct     = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
      const remaining      = Math.round((deadlineMs - now) / 60_000); // minutes

      // Warning at 80% of first_response_hours
      if (elapsedPct >= 80 && !ticket.first_response_warned) {
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE tickets SET first_response_warned = true WHERE id = $1`,
            [ticket.id],
          );
        });
        const targets = ticket.assignee_id ? [ticket.assignee_id] : [];
        await notify(db, ticket.tenant_id, targets,
          'first_response_warning',
          `⚠️ First response due soon: ${ticket.ticket_number}`,
          `"${ticket.subject}" — First response required in ~${Math.max(0, remaining)} minutes. Please respond to the customer.`,
          ticket.id);
        await eventBus.publish(ticket.tenant_id, 'FIRST_RESPONSE_WARNING', {
          ticketId: ticket.id, minutesRemaining: Math.max(0, remaining),
        });
      }

      // Breach at 100%
      if (elapsedPct >= 100 && !ticket.first_response_breached) {
        const overMins = Math.round(-remaining);
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE tickets
             SET first_response_breached = true,
                 first_response_breached_at = NOW()
             WHERE id = $1`,
            [ticket.id],
          );
          // Insert audit record
          await client.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1, $2, 0, 'first_response_breach', '[]')
             ON CONFLICT DO NOTHING`,
            [ticket.tenant_id, ticket.id],
          );
        });

        // Notify assignee + managers
        const managers = await db.withSuperAdmin(async (client) => {
          const r = await client.query(
            `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('manager','tenant_admin') AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });
        const notifyIds = [...(ticket.assignee_id ? [ticket.assignee_id] : []), ...managers];

        await notify(db, ticket.tenant_id, notifyIds,
          'first_response_breach',
          `🚨 First response SLA breached: ${ticket.ticket_number}`,
          `"${ticket.subject}" — No first response was sent within ${ticket.first_response_hours}h. SLA breached by ${overMins} minute${overMins === 1 ? '' : 's'}. Please respond immediately.`,
          ticket.id);

        await eventBus.publish(ticket.tenant_id, 'FIRST_RESPONSE_BREACH', {
          ticketId: ticket.id, overMinutes: overMins,
          slaPolicyId: ticket.sla_policy_id,
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // RESOLUTION SLA CHECK (existing logic — unchanged)
    // ════════════════════════════════════════════════════════════════════
    // Find all active (non-resolved/closed) tickets that have been accepted
    const activeTickets = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT
           t.id, t.tenant_id, t.ticket_number, t.subject, t.priority,
           t.assignee_id, t.accepted_at, t.sla_due_at,
           t.escalation_level, t.reminder_sent_at,
           t.escalated_l1_at, t.escalated_l2_at,
           s.resolution_hours,
           s.reminder_pct,
           s.l1_escalation_pct,
           s.l2_escalation_pct
         FROM tickets t
         LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
         WHERE t.accepted_at IS NOT NULL
           AND t.status NOT IN ('resolved','closed')
           AND t.sla_due_at IS NOT NULL`,
      );
      return r.rows;
    });

    for (const ticket of activeTickets) {
      const now          = Date.now();
      const acceptedMs   = new Date(ticket.accepted_at).getTime();
      const dueMs        = new Date(ticket.sla_due_at).getTime();
      const totalMs      = dueMs - acceptedMs;
      const elapsedMs    = now - acceptedMs;
      const elapsedPct   = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;

      const reminderPct  = ticket.reminder_pct      ?? 80;
      const l1Pct        = ticket.l1_escalation_pct ?? 100;
      const l2Pct        = ticket.l2_escalation_pct ?? 150;

      // ── Multi-step reminder schedule ─────────────────────────────────
      // Uses reminder_schedule if configured (new), else falls back to
      // legacy single reminder_pct field.
      const schedule: Array<{
        id: string; pct: number; level: string; label: string; notifyTarget: string;
      }> = Array.isArray(ticket.reminder_schedule) ? ticket.reminder_schedule : [];

      const sentMap: Record<string, boolean> = ticket.sla_reminders_sent ?? {};

      if (schedule.length > 0) {
        // ── New: iterate schedule steps ──────────────────────────────
        for (const step of schedule) {
          if (elapsedPct < step.pct) continue;  // not reached yet
          if (sentMap[step.id]) continue;        // already fired

          // Determine who to notify
          let notifyIds: string[] = [];
          if (step.notifyTarget === 'assignee' || step.notifyTarget === 'all') {
            if (ticket.assignee_id) notifyIds.push(ticket.assignee_id);
          }
          if (step.notifyTarget === 'managers' || step.notifyTarget === 'all') {
            const mgrs = await db.withSuperAdmin(async (c) => {
              const r = await c.query(
                `SELECT id FROM users WHERE tenant_id=$1 AND role IN ('manager','tenant_admin') AND is_active=true`,
                [ticket.tenant_id],
              );
              return r.rows.map((u: any) => u.id as string);
            });
            notifyIds = [...notifyIds, ...mgrs];
          }
          if (step.notifyTarget === 'admins' || step.notifyTarget === 'all') {
            const admins = await db.withSuperAdmin(async (c) => {
              const r = await c.query(
                `SELECT id FROM users WHERE tenant_id=$1 AND role='tenant_admin' AND is_active=true`,
                [ticket.tenant_id],
              );
              return r.rows.map((u: any) => u.id as string);
            });
            notifyIds = [...notifyIds, ...admins];
          }
          notifyIds = [...new Set(notifyIds)];

          // Mark step as sent
          sentMap[step.id] = true;
          await db.withSuperAdmin(async (c) => {
            await c.query(
              `UPDATE tickets SET sla_reminders_sent = $1::jsonb, reminder_sent_at = COALESCE(reminder_sent_at, NOW()) WHERE id = $2`,
              [JSON.stringify(sentMap), ticket.id],
            );
            // Insert escalation record for L1/L2 steps
            if (step.level === 'l1' && ticket.escalation_level < 1) {
              await c.query(
                `UPDATE tickets SET escalation_level=1, escalated_l1_at=COALESCE(escalated_l1_at,NOW()) WHERE id=$1`,
                [ticket.id],
              );
              await c.query(
                `INSERT INTO ticket_escalations(tenant_id,ticket_id,escalation_level,reason,notified_users) VALUES($1,$2,1,'sla_schedule',$3)`,
                [ticket.tenant_id, ticket.id, notifyIds],
              );
            } else if (step.level === 'l2' && ticket.escalation_level < 2) {
              await c.query(
                `UPDATE tickets SET escalation_level=2, escalated_l2_at=COALESCE(escalated_l2_at,NOW()) WHERE id=$1`,
                [ticket.id],
              );
              await c.query(
                `INSERT INTO ticket_escalations(tenant_id,ticket_id,escalation_level,reason,notified_users) VALUES($1,$2,2,'sla_schedule',$3)`,
                [ticket.tenant_id, ticket.id, notifyIds],
              );
            }
          });

          const remaining   = Math.round((dueMs - now) / 60_000);
          const overMins    = Math.round((now - dueMs) / 60_000);
          const levelEmoji  = step.level === 'l2' ? '🚨' : step.level === 'l1' ? '⚠️' : '⏰';
          const timeNote    = remaining > 0 ? `${remaining} min remaining` : `${overMins} min past deadline`;

          await notify(db, ticket.tenant_id, notifyIds,
            step.level === 'reminder' ? 'sla_reminder' : 'sla_breach',
            `${levelEmoji} ${step.label}: ${ticket.ticket_number}`,
            `"${ticket.subject}" — ${timeNote}.`,
            ticket.id);

          await eventBus.publish(ticket.tenant_id,
            step.level === 'reminder' ? CRM_EVENTS.SLA_REMINDER : CRM_EVENTS.SLA_BREACH,
            { ticketId: ticket.id, stepId: step.id, level: step.level });
        }
      } else {
        // ── Legacy: single reminder_pct check ───────────────────────
        if (elapsedPct >= reminderPct && !ticket.reminder_sent_at && ticket.assignee_id) {
          const remaining = Math.round((dueMs - now) / 60_000);
          await db.withSuperAdmin(async (c) => {
            await c.query(`UPDATE tickets SET reminder_sent_at = NOW() WHERE id = $1`, [ticket.id]);
          });
          await notify(db, ticket.tenant_id, [ticket.assignee_id],
            'sla_reminder',
            `⏰ SLA reminder: ${ticket.ticket_number}`,
            `"${ticket.subject}" — ${remaining > 0 ? `${remaining} minutes remaining` : 'SLA deadline approaching'}.`,
            ticket.id);
          await eventBus.publish(ticket.tenant_id, CRM_EVENTS.SLA_REMINDER, { ticketId: ticket.id });
        }
      }

      // ── L1 Escalation — supervisor/managers notified ─────────────────
      if (elapsedPct >= l1Pct && ticket.escalation_level < 1 && !ticket.escalated_l1_at) {
        const managers = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM users
             WHERE tenant_id = $1 AND role IN ('manager','tenant_admin','super_admin')
               AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });

        const notifyIds = [
          ...(ticket.assignee_id ? [ticket.assignee_id] : []),
          ...managers,
        ].filter((v, i, a) => a.indexOf(v) === i); // dedupe

        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET escalation_level = 1, escalated_l1_at = NOW() WHERE id = $1`,
            [ticket.id],
          );
          await c.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1,$2,1,'sla_breach',$3)`,
            [ticket.tenant_id, ticket.id, notifyIds],
          );
        });

        const overMins = Math.round((now - dueMs) / 60_000);
        await notify(db, ticket.tenant_id, notifyIds,
          'sla_breach',
          `🚨 SLA breached: ${ticket.ticket_number}`,
          `"${ticket.subject}" is ${overMins} min past the SLA deadline. Immediate attention required.`,
          ticket.id);

        await eventBus.publish(ticket.tenant_id, CRM_EVENTS.SLA_BREACH, {
          ticketId: ticket.id, escalationLevel: 1, overMinutes: overMins,
        });
      }

      // ── L2 Escalation — tenant admin notified ────────────────────────
      if (elapsedPct >= l2Pct && ticket.escalation_level < 2 && !ticket.escalated_l2_at) {
        const admins = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM users
             WHERE tenant_id = $1 AND role IN ('tenant_admin','super_admin') AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });

        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET escalation_level = 2, escalated_l2_at = NOW() WHERE id = $1`,
            [ticket.id],
          );
          await c.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1,$2,2,'timeout_l2',$3)`,
            [ticket.tenant_id, ticket.id, admins],
          );
        });

        const overMins = Math.round((now - dueMs) / 60_000);
        await notify(db, ticket.tenant_id, admins,
          'sla_escalated',
          `🔴 Critical escalation: ${ticket.ticket_number}`,
          `"${ticket.subject}" is ${overMins} min past the SLA deadline and has not been resolved. Escalated to you as highest authority.`,
          ticket.id);

        await eventBus.publish(ticket.tenant_id, CRM_EVENTS.TICKET_ESCALATED, {
          ticketId: ticket.id, escalationLevel: 2, overMinutes: overMins,
        });
      }
    }
  } catch (err: any) {
    // Worker errors must not crash the server
    console.error('[SLA Worker] Error:', err.message);
  }
}
