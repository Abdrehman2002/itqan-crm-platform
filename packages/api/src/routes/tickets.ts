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
import * as sla from '../lib/sla';

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
  businessHoursOnly:       z.boolean().default(false),
  businessHoursSchedule:   z.record(z.object({
    enabled: z.boolean(),
    start:   z.string().regex(/^\d{2}:\d{2}$/),
    end:     z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
  pauseOnPending:      z.boolean().default(false),
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

/**
 * M7: Smart SLA policy matching.
 *
 * Scoring rules (highest-scoring active policy wins; ties broken by created_at):
 *   +100 — matches the ticket's priority
 *   + 10 — match_conditions.channels   contains ticket.channel
 *   + 10 — match_conditions.departments contains ticket.assignee_department
 *   + 10 — match_conditions.tags        intersects ticket.tags (any one)
 *   +  1 — policy is a catch-all (no match_conditions configured)
 *
 * If `slaPolicyId` is provided explicitly, that policy wins regardless.
 */
export async function findSlaPolicy(
  db: DatabaseClient,
  tenantId: string,
  slaPolicyId: string | undefined,
  priority: string,
  ticketCtx?: { channel?: string | null; department?: string | null; tags?: string[] | null },
): Promise<{ id: string; resolution_hours: number } | null> {
  const rows = await db.withTenant(tenantId, async (client) => {
    if (slaPolicyId) {
      const r = await client.query('SELECT id, resolution_hours FROM sla_policies WHERE id = $1', [slaPolicyId]);
      return r.rows;
    }
    const r = await client.query(
      `SELECT id, resolution_hours, priority, match_conditions, created_at
       FROM sla_policies
       WHERE is_active = true
       ORDER BY created_at ASC`,
    );
    return r.rows;
  });
  if (rows.length === 0) return null;

  const channel    = ticketCtx?.channel ?? null;
  const department = ticketCtx?.department ?? null;
  const tags       = ticketCtx?.tags ?? null;

  const scored = rows.map((p: any) => {
    let score = 0;
    if (p.priority === priority) score += 100;
    const mc = p.match_conditions ?? null;
    if (!mc || Object.keys(mc).length === 0) {
      score += 1; // catch-all
    } else {
      if (channel    && Array.isArray(mc.channels)    && mc.channels.includes(channel))   score += 10;
      if (department && Array.isArray(mc.departments) && mc.departments.includes(department)) score += 10;
      if (Array.isArray(tags) && tags.length && Array.isArray(mc.tags)
          && tags.some((t: string) => mc.tags.includes(t))) score += 10;
    }
    return { ...p, _score: score };
  });
  scored.sort((a: any, b: any) => b._score - a._score || +new Date(a.created_at) - +new Date(b.created_at));
  return scored[0]?._score > 0 ? { id: scored[0].id, resolution_hours: scored[0].resolution_hours } : null;
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

  if (queueId) {
    const qm = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT qm.user_id
         FROM queue_members qm
         JOIN users u ON u.id = qm.user_id
         WHERE qm.queue_id = $1
           AND u.is_active = true
           AND u.role IN ('agent','manager')
           AND u.id != $2`,
        [queueId, ticket.assignee_id ?? '00000000-0000-0000-0000-000000000000'],
      );
      return r.rows.map((u: any) => u.user_id as string);
    });
    candidateIds = qm;
  }

  // Fallback: if queue has no members, use all active agents in tenant
  if (candidateIds.length === 0) {
    const all = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT id FROM users
         WHERE tenant_id = $1
           AND is_active = true
           AND role IN ('agent','manager')
           AND id != $2`,
        [tenantId, ticket.assignee_id ?? '00000000-0000-0000-0000-000000000000'],
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

// ── Sales ticket → Deal conversion ──────────────────────────────────────────
// A 'sales' enquiry follows a different lifecycle to a complaint: rather than
// just being resolved & closed, it should feed the sales pipeline so it can be
// forecast and worked as an opportunity. This creates (once) a deal in the
// default pipeline, linked back to the ticket, owned by the handling agent.
// Idempotent: if the ticket already has a linked deal, that deal is returned.
// Returns null only when no pipeline/stage exists to place the deal into.
async function convertSalesTicketToDeal(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  tenantId: string,
  ticket: any,
  ownerId: string,
): Promise<{ deal: any; created: boolean } | null> {
  // Already linked → return the existing deal (no duplicate).
  if (ticket.deal_id) {
    const ex = await client.query(`SELECT * FROM deals WHERE id = $1`, [ticket.deal_id]);
    return ex.rows[0] ? { deal: ex.rows[0], created: false } : null;
  }

  // Place into the tenant's default pipeline, first stage.
  const pipe = await client.query(
    `SELECT id, stages FROM pipelines WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [tenantId],
  );
  const pipeline = pipe.rows[0];
  const firstStage = pipeline?.stages?.[0]?.id ?? null;
  if (!pipeline || !firstStage) return null; // no pipeline configured yet

  const ins = await client.query(
    `INSERT INTO deals
       (tenant_id, name, pipeline_id, stage_id, owner_id, contact_id, company_id, status, source, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', 'ticket', 'USD')
     RETURNING *`,
    [
      tenantId,
      ticket.subject ?? 'Sales enquiry',
      pipeline.id,
      firstStage,
      ownerId,
      ticket.contact_id ?? null,
      ticket.company_id ?? null,
    ],
  );
  const deal = ins.rows[0];
  await client.query(`UPDATE tickets SET deal_id = $1, updated_at = NOW() WHERE id = $2`, [deal.id, ticket.id]);
  return { deal, created: true };
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
           FROM tickets`,
          [userId],
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
      // BUG-L fix: original INSERT silently dropped business_hours_schedule + pause_on_pending.
      // Made the param positions explicit by name + added ::jsonb casts so pg never silently
      // coerces the text payload to null.
      const bhSched = body.businessHoursSchedule !== undefined
        ? JSON.stringify(body.businessHoursSchedule)
        : null;
      const remSched = body.reminderSchedule !== undefined
        ? JSON.stringify(body.reminderSchedule)
        : null;
      const [policy] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
           `INSERT INTO sla_policies
              (tenant_id, name, description, priority, first_response_hours, resolution_hours,
               reminder_pct, l1_escalation_pct, l2_escalation_pct, business_hours_only,
               business_hours_schedule, pause_on_pending, is_active, reminder_schedule)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb)
            RETURNING *`,
           [
             req.tenant.id,                  // $1
             body.name,                      // $2
             body.description ?? null,       // $3
             body.priority,                  // $4
             body.firstResponseHours,        // $5
             body.resolutionHours,           // $6
             body.reminderPct,               // $7
             body.l1EscalationPct,           // $8
             body.l2EscalationPct,           // $9
             body.businessHoursOnly,         // $10
             bhSched,                        // $11 → business_hours_schedule (jsonb)
             body.pauseOnPending,            // $12 → pause_on_pending (bool, has Zod default false)
             body.isActive,                  // $13
             remSched,                       // $14 → reminder_schedule (jsonb)
           ],
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
             business_hours_only     = COALESCE($9,        business_hours_only),
             business_hours_schedule = COALESCE($10::jsonb, business_hours_schedule),
             pause_on_pending        = COALESCE($11,        pause_on_pending),
             is_active               = COALESCE($12,        is_active),
             reminder_schedule       = COALESCE($13::jsonb, reminder_schedule),
             updated_at              = NOW()
           WHERE id = $14 RETURNING *`,
          [body.name, body.description, body.priority, body.firstResponseHours,
           body.resolutionHours, body.reminderPct, body.l1EscalationPct,
           body.l2EscalationPct, body.businessHoursOnly,
           body.businessHoursSchedule !== undefined ? JSON.stringify(body.businessHoursSchedule) : null,
           body.pauseOnPending ?? null,
           body.isActive,
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

    // ════════════════════════════════════════════════════════════════════
    // M1: Holiday calendar — tenant-level public holidays the SLA clock skips
    // ════════════════════════════════════════════════════════════════════
    fastify.get('/sla-holidays', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const rows = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT id, date::text AS date, name, created_at FROM sla_holidays ORDER BY date ASC`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    fastify.post('/sla-holidays', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const body = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
        name: z.string().min(1),
      }).parse(req.body);
      const [row] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `INSERT INTO sla_holidays (tenant_id, date, name) VALUES ($1, $2::date, $3)
           ON CONFLICT (tenant_id, date) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, date::text AS date, name, created_at`,
          [req.tenant.id, body.date, body.name],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    fastify.delete('/sla-holidays/:id', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM sla_holidays WHERE id = $1', [id]);
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
      const offset   = (query.page - 1) * query.pageSize;

      const params: unknown[] = [];
      const where: string[] = ['1=1'];
      let idx = 1;

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
        // M4: Customer 360 — multi-field search across ticket#, name, mobile,
        // NIC (Pakistan ID), email, phone. Joins to contacts inline via EXISTS.
        const a = idx++, b = idx++, c = idx++, d = idx++, e = idx++, f = idx++, g = idx++;
        where.push(`(
          t.subject ILIKE $${a}
          OR t.ticket_number ILIKE $${b}
          OR t.reporter_email ILIKE $${c}
          OR t.reporter_name  ILIKE $${d}
          OR t.reporter_phone ILIKE $${e}
          OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = t.contact_id AND (
               c.first_name ILIKE $${f}
            OR c.last_name  ILIKE $${f}
            OR c.email      ILIKE $${c}
            OR c.phone      ILIKE $${e}
            OR c.nic_number ILIKE $${g}
          ))
        )`);
        const like = `%${query.search}%`;
        params.push(like, like, like, like, like, like, like);
      }

      const whereStr = where.join(' AND ');
      const orderBy  = `t.${query.sortBy} ${query.sortOrder}`;

      const [count, tickets] = await db.withTenant(tenantId, async (client) => {
        const cntR = await client.query(
          `SELECT COUNT(*) FROM tickets t WHERE ${whereStr}`, params,
        );
        const listR = await client.query(
          // M5: Add assignee_department + is_originated_by_me + contact NIC for
          // the originator-view badge + Customer 360 hover card.
          `SELECT t.*,
             u.name  AS assignee_name,
             u.avatar AS assignee_avatar,
             u.department AS assignee_department,
             c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
             c.nic_number AS contact_nic,
             q.name  AS queue_name,
             q.color AS queue_color,
             CASE WHEN t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed')
                  THEN true ELSE false END AS is_overdue,
             EXTRACT(EPOCH FROM (t.sla_due_at - NOW())) AS sla_seconds_remaining,
             CASE WHEN t.created_by = $${idx++} THEN true ELSE false END AS is_originated_by_me,
             CASE WHEN t.created_by = $${idx} AND (t.assignee_id IS NULL OR t.assignee_id <> $${idx})
                       AND (u.department IS NULL OR u.department <> (SELECT department FROM users WHERE id = $${idx}))
                  THEN true ELSE false END AS is_view_only
           FROM tickets t
           LEFT JOIN users u    ON t.assignee_id  = u.id
           LEFT JOIN contacts c ON t.contact_id   = c.id
           LEFT JOIN ticket_queues q ON t.queue_id = q.id
           WHERE ${whereStr}
           ORDER BY ${orderBy}
           LIMIT $${idx + 1} OFFSET $${idx + 2}`,
          [...params, userId, userId, query.pageSize, offset],
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

      // Pre-fetch existing ticket + its SLA policy. Needed for:
      //  (a) pause-on-pending logic (compare old vs new status)
      //  (b) priority-change recompute of sla_due_at
      const [existing] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT t.status, t.accepted_at, t.sla_paused_at,
                  t.sla_paused_total_ms, t.sla_policy_id,
                  s.pause_on_pending,
                  s.business_hours_only, s.business_hours_schedule, s.resolution_hours
           FROM tickets t LEFT JOIN sla_policies s ON s.id = t.sla_policy_id
           WHERE t.id = $1`,
          [id],
        );
        return r.rows;
      });

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

      // ── SLA pause-on-pending state machine ───────────────────────────
      // Only relevant if the policy enables it. State machine:
      //   * status → 'pending' and not already paused → start pause clock
      //   * status changes FROM 'pending' and clock is paused → accumulate
      if (body.status !== undefined && existing?.pause_on_pending) {
        const oldStatus = existing.status as string;
        const newStatus = body.status as string;
        const wasPaused = !!existing.sla_paused_at;

        if (newStatus === 'pending' && oldStatus !== 'pending' && !wasPaused) {
          sets.push(`sla_paused_at = NOW()`);
        }
        if (oldStatus === 'pending' && newStatus !== 'pending' && wasPaused) {
          // Bank the pause duration, then clear the marker
          sets.push(`sla_paused_total_ms = sla_paused_total_ms + (EXTRACT(EPOCH FROM (NOW() - sla_paused_at)) * 1000)::bigint`);
          sets.push(`sla_paused_at = NULL`);
        }
      }

      // Auto-reassign SLA policy when priority changes (and no explicit slaPolicyId given).
      // Also recompute sla_due_at against the new policy + remaining elapsed time.
      if (body.priority && !body.slaPolicyId) {
        const newSla = await findSlaPolicy(db, req.tenant.id, undefined, body.priority);
        if (newSla) { sets.push(`sla_policy_id = $${idx++}`); vals.push(newSla.id); }
      }

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

    // ── Accept ticket (agent confirms they will work on it) ───────────────
    // This starts the SLA resolution timer. sla_due_at honors business hours
    // if the policy is configured (see lib/sla.ts:computeSlaDueAt).
    fastify.post('/:id/accept', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      // Fetch ticket + SLA policy (incl. business hours + pause flags)
      const [existing] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT t.*,
                  s.resolution_hours,
                  s.business_hours_only,
                  s.business_hours_schedule,
                  s.pause_on_pending
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

      // Resolve tenant timezone (Munir's tenants.settings.timezone, default UTC)
      const tenantTz = (req.tenant as any).settings?.timezone ?? 'UTC';
      const resHours = existing.resolution_hours ?? 24;
      const acceptedAt = new Date();
      // Load holiday calendar so the SLA clock skips public holidays
      const holidays = await db.withTenant(tenantId, async (client) => sla.loadHolidays(client));
      const slaDueAt = sla.computeSlaDueAt(acceptedAt, {
        resolution_hours: resHours,
        business_hours_only: existing.business_hours_only,
        business_hours_schedule: existing.business_hours_schedule,
      }, tenantTz, holidays);

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

      // Sales enquiry → feed the pipeline. On acceptance of a 'sales' ticket we
      // create a linked deal (once) so the opportunity is forecast and worked.
      // Complaints/inquiries keep the normal resolve→close lifecycle untouched.
      let convertedDeal: any = null;
      if (ticket.ticket_type === 'sales') {
        const conv = await db.withTenant(tenantId, (client) =>
          convertSalesTicketToDeal(client, tenantId, ticket, userId),
        );
        if (conv?.created) {
          convertedDeal = conv.deal;
          await eventBus.publish(tenantId, CRM_EVENTS.DEAL_CREATED, { deal: conv.deal, fromTicketId: id });
          await notify(db, tenantId, [userId], 'ticket_accepted',
            `Deal created from ${ticket.ticket_number}`,
            `A pipeline deal "${conv.deal.name}" was created from this sales enquiry.`,
            id);
        } else if (conv) {
          convertedDeal = conv.deal;
        }
      }

      return reply.send({ success: true, data: { ...ticket, deal: convertedDeal } });
    });

    // ── Explicit: convert a sales ticket into a pipeline deal ─────────────────
    // Manual counterpart to the auto-conversion on accept. Idempotent — returns
    // the existing linked deal if one was already created.
    fastify.post('/:id/convert-to-deal', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { id }   = req.params as { id: string };
      const tenantId = req.tenant.id;
      const userId   = req.user.sub;

      const [ticket] = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM tickets WHERE id = $1`, [id]).then((r) => r.rows),
      );
      if (!ticket) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      if (ticket.ticket_type !== 'sales') {
        return reply.code(400).send({ success: false, error: { code: 'NOT_A_SALES_TICKET', message: 'Only sales enquiries can be converted into a deal.' } });
      }

      const conv = await db.withTenant(tenantId, (client) =>
        convertSalesTicketToDeal(client, tenantId, ticket, ticket.assignee_id ?? userId),
      );
      if (!conv) {
        return reply.code(409).send({ success: false, error: { code: 'NO_PIPELINE', message: 'No sales pipeline is configured to place the deal into.' } });
      }
      if (conv.created) {
        await eventBus.publish(tenantId, CRM_EVENTS.DEAL_CREATED, { deal: conv.deal, fromTicketId: id });
      }
      return reply.send({ success: true, data: conv.deal, created: conv.created });
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

      // M6: CSAT survey — generate a token, persist, attach the survey link
      // to the resolution email. The customer rates on a public /csat/:token page.
      // ON CONFLICT (ticket_id) matches the actual constraint that exists
      // on the table (a UNIQUE on ticket_id alone, which is enough since
      // ticket UUIDs are globally unique anyway).
      let csatToken: string | null = null;
      if (ticket.reporter_email) {
        csatToken = randomBytes(24).toString('hex');
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `INSERT INTO csat_surveys (tenant_id, ticket_id, token)
             VALUES ($1, $2, $3)
             ON CONFLICT (ticket_id) DO UPDATE
               SET token = EXCLUDED.token, sent_at = NOW(),
                   rating = NULL, comment = NULL, responded_at = NULL`,
            [tenantId, id, csatToken],
          );
        });
      }
      const csatUrl = csatToken
        ? `${process.env.APP_URL ?? 'http://localhost:5173'}/csat/${csatToken}`
        : null;

      // Email reporter on resolution
      if (ticket.reporter_email) {
        const csatBlock = csatUrl
          ? `<p>Could you spare 10 seconds to rate this experience? <a href="${csatUrl}">Leave feedback →</a></p>`
          : '';
        const csatBlockText = csatUrl ? `\nRate your experience: ${csatUrl}` : '';
        emailSvc.send(tenantId, {
          to: ticket.reporter_email,
          toName: ticket.reporter_name ?? undefined,
          subject: `Your ticket ${ticket.ticket_number} has been resolved`,
          bodyHtml: `<p>Dear ${ticket.reporter_name ?? 'Customer'},</p>
<p>We're pleased to let you know that your support ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" — has been resolved.</p>
${csatBlock}
<p>If you have any further questions, please don't hesitate to reach out.</p>
<p>Thank you for your patience.</p>`,
          bodyText: `Dear ${ticket.reporter_name ?? 'Customer'},\n\nYour ticket ${ticket.ticket_number} ("${ticket.subject}") has been resolved.${csatBlockText}\n\nThank you.`,
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
      const limitClause = `LIMIT $${idx++} OFFSET $${idx++}`;
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
           ORDER BY tc.created_at ASC
           ${limitClause}`,
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
        // If this is the first external reply, record first_response_at + first_replied_at.
        // M2: first_replied_at specifically tracks the first PUBLIC agent reply,
        // separately from first_response_at which fires on any first action.
        if (!body.isInternal && body.commentType === 'reply') {
          await client.query(
            `UPDATE tickets
             SET first_response_at = COALESCE(first_response_at, NOW()),
                 first_replied_at  = COALESCE(first_replied_at,  NOW())
             WHERE id = $1`,
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

    // ── AGENT DASHBOARD — department-aware ticket counts ──────────────
    // Returns counts bucketed by status + TAT health for the calling agent
    // (or any user_id when called by a manager).
    fastify.get('/dashboard/agent', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const userId = (req.query as any).user_id ?? req.user.sub;

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

    // ── MANAGER ROLLUP — recursive team ticket summary ────────────────
    // Walks the manager_id hierarchy from the given manager downward,
    // returning aggregated counts for the entire reporting tree.
    // Also returns per-agent breakdown for drill-down.
    fastify.get('/dashboard/team', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const managerId = (req.query as any).manager_id ?? req.user.sub;

      // Aggregate totals for the whole tree
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

      // Per-agent breakdown (direct reports only — drill further by calling with their id)
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

      // Count sub-reports (people reporting to these agents)
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

    // ════════════════════════════════════════════════════════════════════
    // M3: Any-agent internal notes
    // Any authenticated user in the tenant (regardless of ticket ownership)
    // can attach an internal note. Useful for cross-team context handoffs.
    // Read visibility still scoped by the usual rules — only the assignee
    // dept can see this in the comments thread, but writes are open.
    // ════════════════════════════════════════════════════════════════════
    fastify.post('/:id/notes', { preHandler: requireScope('tickets:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body   = z.object({ note: z.string().min(1) }).parse(req.body);
      const [comment] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `INSERT INTO ticket_comments
             (tenant_id, ticket_id, author_id, body, is_internal, comment_type)
           VALUES ($1, $2, $3, $4, true, 'note')
           RETURNING *`,
          [req.tenant.id, id, req.user.sub, body.note],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: comment });
    });

    // ════════════════════════════════════════════════════════════════════
    // M6: CSAT survey — public endpoints (no auth) for customer to respond
    // GET  /tickets/csat-public/:token  — fetch survey metadata for the form
    // POST /tickets/csat-public/:token  — submit rating + comment
    //
    // These are namespaced under /tickets (which mounts at /api/v1/tickets)
    // so a single router export covers it. server.ts also registers a
    // public route alias /public/csat/:token for the email link.
    // ════════════════════════════════════════════════════════════════════
    fastify.get('/csat-public/:token', async (req, reply) => {
      const { token } = req.params as { token: string };
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT cs.id, cs.ticket_id, cs.sent_at, cs.rating, cs.responded_at,
                  t.ticket_number, t.subject, tn.name AS workspace_name
           FROM csat_surveys cs
           JOIN tickets t   ON t.id   = cs.ticket_id
           JOIN tenants tn  ON tn.id  = cs.tenant_id
           WHERE cs.token = $1`,
          [token],
        );
        return r.rows;
      });
      if (!row) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Survey link is invalid or expired' } });
      return reply.send({ success: true, data: row });
    });

    fastify.post('/csat-public/:token', async (req, reply) => {
      const { token } = req.params as { token: string };
      const body = z.object({
        rating:  z.number().int().min(1).max(5),
        comment: z.string().max(2000).optional(),
      }).parse(req.body);
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE csat_surveys
           SET rating = $1, comment = $2, responded_at = COALESCE(responded_at, NOW())
           WHERE token = $3 AND responded_at IS NULL
           RETURNING id, ticket_id, rating, comment, responded_at`,
          [body.rating, body.comment ?? null, token],
        );
        return r.rows;
      });
      if (!row) return reply.code(409).send({ success: false, error: { code: 'ALREADY_RESPONDED', message: 'You have already submitted this survey' } });
      await eventBus.publish((row as any).tenant_id ?? '', 'csat.received', { ticketId: row.ticket_id, rating: row.rating });
      return reply.send({ success: true, data: row });
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

// ── Default SLA seed ──────────────────────────────────────────────────────────
//
// Benchmarked against Zendesk, Freshdesk, and Jira Service Management defaults:
//   Urgent  — 1h first response / 4h resolution   (Zendesk critical / Freshdesk urgent)
//   High    — 2h first response / 8h resolution   (Zendesk high)
//   Medium  — 8h first response / 24h resolution  (Freshdesk medium / Jira SM normal)
//   Low     — 24h first response / 72h resolution (Zendesk low / Freshdesk low)
//
// All four tiers use business hours by default (industry standard).
// Escalation schedule mirrors Freshdesk/Zendesk three-tier pattern:
//   50% warning → agent, 75% warning → agent, 100% L1 breach → managers, 150% L2 → admins.

const DEFAULT_SLA_POLICIES = [
  {
    priority: 'urgent',
    name: 'Urgent — Fraud & Critical',
    description: 'Fraud alerts, account blocks, security incidents. 24/7 clock — business hours OFF.',
    first_response_hours: 1,
    resolution_hours: 4,
    business_hours_only: false,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 150,
    reminder_schedule: [
      { id: 'u1', pct: 50,  level: 'reminder', label: '50% Warning — Notify Agent',          notifyTarget: 'assignee' },
      { id: 'u2', pct: 75,  level: 'reminder', label: '75% Warning — Urgent Alert to Agent',  notifyTarget: 'assignee' },
      { id: 'u3', pct: 100, level: 'l1',       label: 'SLA Breached — Escalate to Managers', notifyTarget: 'managers' },
      { id: 'u4', pct: 150, level: 'l2',       label: 'Critical Breach — Notify All Admins', notifyTarget: 'admins'  },
    ],
  },
  {
    priority: 'high',
    name: 'High — Card & Loan Issues',
    description: 'Card disputes, loan queries, payment failures. Business hours.',
    first_response_hours: 2,
    resolution_hours: 8,
    business_hours_only: true,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 150,
    reminder_schedule: [
      { id: 'h1', pct: 50,  level: 'reminder', label: '50% Warning to Agent',               notifyTarget: 'assignee' },
      { id: 'h2', pct: 75,  level: 'reminder', label: '75% Final Warning to Agent',          notifyTarget: 'assignee' },
      { id: 'h3', pct: 100, level: 'l1',       label: 'SLA Breached — Notify Managers',     notifyTarget: 'managers' },
      { id: 'h4', pct: 150, level: 'l2',       label: 'Critical Breach — Notify Admins',    notifyTarget: 'admins'  },
    ],
  },
  {
    priority: 'medium',
    name: 'Medium — General Complaints',
    description: 'Service complaints, account queries, general support. Business hours.',
    first_response_hours: 8,
    resolution_hours: 24,
    business_hours_only: true,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 200,
    reminder_schedule: [
      { id: 'm1', pct: 50,  level: 'reminder', label: '50% Warning to Agent',               notifyTarget: 'assignee' },
      { id: 'm2', pct: 75,  level: 'reminder', label: '75% Warning — Act Now',               notifyTarget: 'assignee' },
      { id: 'm3', pct: 90,  level: 'reminder', label: '90% Final Warning',                   notifyTarget: 'assignee' },
      { id: 'm4', pct: 100, level: 'l1',       label: 'SLA Breached — Notify Managers',     notifyTarget: 'managers' },
      { id: 'm5', pct: 200, level: 'l2',       label: 'Severely Overdue — Notify Admins',   notifyTarget: 'admins'  },
    ],
  },
  {
    priority: 'low',
    name: 'Low — Balance & Info Queries',
    description: 'Balance checks, statement requests, informational queries. Business hours.',
    first_response_hours: 24,
    resolution_hours: 72,
    business_hours_only: true,
    reminder_pct: 75,
    l1_escalation_pct: 100,
    l2_escalation_pct: 200,
    reminder_schedule: [
      { id: 'l1', pct: 50,  level: 'reminder', label: '50% Warning to Agent',               notifyTarget: 'assignee' },
      { id: 'l2', pct: 75,  level: 'reminder', label: '75% Warning to Agent',                notifyTarget: 'assignee' },
      { id: 'l3', pct: 100, level: 'l1',       label: 'SLA Breached — Notify Managers',     notifyTarget: 'managers' },
      { id: 'l4', pct: 200, level: 'l2',       label: 'Long Overdue — Notify Admins',       notifyTarget: 'admins'  },
    ],
  },
];

export async function seedDefaultSlaPolicies(db: any, tenantId: string): Promise<void> {
  await db.withTenant(tenantId, async (client: any) => {
    const existing = await client.query('SELECT COUNT(*) FROM sla_policies WHERE tenant_id = $1', [tenantId]);
    if (parseInt(existing.rows[0].count) > 0) return; // already seeded

    for (const p of DEFAULT_SLA_POLICIES) {
      await client.query(
        `INSERT INTO sla_policies
           (tenant_id, name, description, priority, first_response_hours, resolution_hours,
            reminder_pct, l1_escalation_pct, l2_escalation_pct, business_hours_only, is_active, reminder_schedule)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
        [
          tenantId, p.name, p.description, p.priority,
          p.first_response_hours, p.resolution_hours,
          p.reminder_pct, p.l1_escalation_pct, p.l2_escalation_pct,
          p.business_hours_only, JSON.stringify(p.reminder_schedule),
        ],
      );
    }
  });
}
