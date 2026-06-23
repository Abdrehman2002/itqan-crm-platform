import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { getVisibleUserIds, ownerScopeSql } from '../lib/visibility';

const CreateActivitySchema = z.object({
  type: z.enum(['call','voice_bot_call','email','meeting','task','note','whatsapp','sms','demo','proposal']),
  subject: z.string().min(1),
  body: z.string().optional(),
  status: z.enum(['pending','completed','cancelled']).default('pending'),
  priority: z.enum(['low','normal','high','urgent']).default('normal'),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  duration: z.number().optional(),
  outcome: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function activityRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    // List activities with filters
    fastify.get('/', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { type, status, contactId, dealId, ownerId, dueFrom, dueTo, page = 1, pageSize = 25 } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      // Hard visibility filter — only activities owned by the user or their reportees.
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );

      const activities = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT a.*,
             c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name,
             u.name as owner_name,
             d.name as deal_name
           FROM activities a
           LEFT JOIN contacts c ON a.contact_id = c.id
           LEFT JOIN users u ON a.owner_id = u.id
           LEFT JOIN deals d ON a.deal_id = d.id
           WHERE 1=1
           ${ownerScopeSql('a.owner_id', scopeIds)}
           ${type      ? `AND a.type = '${type}'`          : ''}
           ${status    ? `AND a.status = '${status}'`      : ''}
           ${contactId ? `AND a.contact_id = '${contactId}'` : ''}
           ${dealId    ? `AND a.deal_id = '${dealId}'`     : ''}
           ${ownerId   ? `AND a.owner_id = '${ownerId}'`   : ''}
           ${dueFrom   ? `AND a.due_at >= '${dueFrom}'`    : ''}
           ${dueTo     ? `AND a.due_at <= '${dueTo}'`      : ''}
           ORDER BY COALESCE(a.due_at, a.created_at) ASC
           LIMIT $1 OFFSET $2`,
          [Number(pageSize), offset],
        );
        return result.rows;
      });

      return reply.send({ success: true, data: activities });
    });

    // Overdue tasks — key metric for sales managers
    fastify.get('/overdue', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );
      const activities = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT a.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name, u.name as owner_name
           FROM activities a
           LEFT JOIN contacts c ON a.contact_id = c.id
           LEFT JOIN users u ON a.owner_id = u.id
           WHERE a.status = 'pending' AND a.due_at < NOW()
           ${ownerScopeSql('a.owner_id', scopeIds)}
           ORDER BY a.due_at ASC
           LIMIT 100`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: activities });
    });

    // Today's schedule
    fastify.get('/today', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      // Hard visibility filter via the reporting tree (replaces the old "managers
      // see everyone" rule — a manager now sees only their own sub-tree).
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );
      const activities = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT a.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name, u.name as owner_name
           FROM activities a
           LEFT JOIN contacts c ON a.contact_id = c.id
           LEFT JOIN users u ON a.owner_id = u.id
           WHERE a.status = 'pending'
             AND (a.due_at::date = CURRENT_DATE OR a.scheduled_at::date = CURRENT_DATE)
             ${ownerScopeSql('a.owner_id', scopeIds)}
           ORDER BY COALESCE(a.scheduled_at, a.due_at) ASC`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: activities });
    });

    // Create activity
    fastify.post('/', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const body = CreateActivitySchema.parse(req.body);
      const ownerId = body.ownerId ?? req.user.sub;

      const [activity] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO activities
             (tenant_id, type, subject, body, status, priority, contact_id, company_id,
              deal_id, owner_id, scheduled_at, due_at, duration, outcome, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
           RETURNING *`,
          [
            req.tenant.id, body.type, body.subject, body.body,
            body.status, body.priority, body.contactId, body.companyId,
            body.dealId, ownerId, body.scheduledAt, body.dueAt,
            body.duration, body.outcome, JSON.stringify(body.metadata ?? {}),
          ],
        );
        return result.rows;
      });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.ACTIVITY_CREATED, { activity });
      return reply.code(201).send({ success: true, data: activity });
    });

    // Mark complete
    fastify.post('/:id/complete', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { outcome } = (req.body ?? {}) as { outcome?: string };

      const [activity] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE activities
           SET status = 'completed', completed_at = NOW(), outcome = COALESCE($1, outcome)
           WHERE id = $2 RETURNING *`,
          [outcome, id],
        );
        return result.rows;
      });

      if (!activity) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.ACTIVITY_COMPLETED, { activity });
      return reply.send({ success: true, data: activity });
    });

    // Update activity
    fastify.patch('/:id', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CreateActivitySchema.partial().parse(req.body);

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const map: Record<string, string> = {
        type: 'type', subject: 'subject', body: 'body', status: 'status',
        priority: 'priority', contactId: 'contact_id', companyId: 'company_id',
        dealId: 'deal_id', scheduledAt: 'scheduled_at', dueAt: 'due_at',
        duration: 'duration', outcome: 'outcome', ownerId: 'owner_id',
      };
      for (const [k, col] of Object.entries(map)) {
        if (k in body) { sets.push(`${col} = $${i++}`); vals.push((body as any)[k]); }
      }
      if (!sets.length) return reply.send({ success: true, data: null });
      vals.push(id);

      const [activity] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE activities SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
          vals,
        );
        return result.rows;
      });

      if (!activity) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } });
      return reply.send({ success: true, data: activity });
    });

    // Delete
    fastify.delete('/:id', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM activities WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });
  };
}
