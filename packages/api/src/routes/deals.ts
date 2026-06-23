import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { getVisibleUserIds, ownerScopeSql } from '../lib/visibility';

const CreateDealSchema = z.object({
  name: z.string().min(1),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  pipelineId: z.string().uuid(),
  stageId: z.string(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).default('USD'),
  closeDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.unknown()).optional(),
  ownerId: z.string().uuid().optional(),
});

const MoveStageSchema = z.object({
  stageId: z.string(),
  reason: z.string().optional(),
});

export function dealRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    // List all pipelines for this tenant
    fastify.get('/pipelines', { preHandler: requireScope('deals:read') }, async (req, reply) => {
      // Scope the open-deal counts and pipeline value to what this user may see
      // (own + reportees), so summary figures match the filtered deal list.
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );
      const dealScope = ownerScopeSql('d.owner_id', scopeIds); // '' for super_admin
      const pipelines = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT p.*,
             COUNT(d.id) FILTER (WHERE d.status = 'open') as open_deals,
             COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'open'), 0) as pipeline_value
           FROM pipelines p
           LEFT JOIN deals d ON d.pipeline_id = p.id ${dealScope}
           GROUP BY p.id
           ORDER BY p.is_default DESC, p.created_at ASC`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: pipelines });
    });

    // Create pipeline
    fastify.post('/pipelines', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { name, stages } = req.body as { name: string; stages: any[] };
      const [pipeline] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO pipelines (tenant_id, name, stages, is_default)
           VALUES ($1, $2, $3::jsonb, false) RETURNING *`,
          [req.tenant.id, name, JSON.stringify(stages ?? DEFAULT_STAGES)],
        );
        return result.rows;
      });
      return reply.code(201).send({ success: true, data: pipeline });
    });

    // List deals with optional pipeline filter
    fastify.get('/', { preHandler: requireScope('deals:read') }, async (req, reply) => {
      const { pipelineId, stageId, ownerId, companyId, contactId, status, page = 1, pageSize = 50 } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      // Hard visibility filter — only deals owned by the user or their reportees.
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );

      const params: unknown[] = [];
      let where = "WHERE 1=1";
      if (status)     { params.push(status);     where += ` AND d.status = $${params.length}`; }
      else            { where += " AND d.status = 'open'"; }
      if (pipelineId) { params.push(pipelineId); where += ` AND d.pipeline_id = $${params.length}`; }
      if (stageId)    { params.push(stageId);    where += ` AND d.stage_id = $${params.length}`; }
      if (ownerId)    { params.push(ownerId);    where += ` AND d.owner_id = $${params.length}`; }
      if (companyId)  { params.push(companyId);  where += ` AND d.company_id = $${params.length}`; }
      if (contactId)  { params.push(contactId);  where += ` AND d.contact_id = $${params.length}`; }
      where += ` ${ownerScopeSql('d.owner_id', scopeIds)}`;
      params.push(Number(pageSize), offset);

      const deals = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT d.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name,
                  comp.name as company_name, u.name as owner_name,
                  (SELECT elem->>'name' FROM pipelines p
                   CROSS JOIN LATERAL jsonb_array_elements(p.stages) AS elem
                   WHERE p.id = d.pipeline_id AND (elem->>'id') = d.stage_id::text LIMIT 1) as stage_name
           FROM deals d
           LEFT JOIN contacts c ON d.contact_id = c.id
           LEFT JOIN companies comp ON d.company_id = comp.id
           LEFT JOIN users u ON d.owner_id = u.id
           ${where}
           ORDER BY d.updated_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        return result.rows;
      });

      return reply.send({ success: true, data: deals });
    });

    // Kanban board view — deals grouped by stage
    fastify.get('/board/:pipelineId', { preHandler: requireScope('deals:read') }, async (req, reply) => {
      const { pipelineId } = req.params as { pipelineId: string };

      const [pipeline] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT * FROM pipelines WHERE id = $1', [pipelineId]);
        return result.rows;
      });
      if (!pipeline) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Pipeline not found' } });

      // Hard visibility filter — only deals owned by the user or their reportees.
      const scopeIds = await db.withTenant(req.tenant.id, (client) =>
        getVisibleUserIds(client, req.user.sub, req.user.role),
      );

      const deals = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT d.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name
           FROM deals d LEFT JOIN contacts c ON d.contact_id = c.id
           WHERE d.pipeline_id = $1 AND d.status = 'open'
           ${ownerScopeSql('d.owner_id', scopeIds)}
           ORDER BY d.updated_at DESC`,
          [pipelineId],
        );
        return result.rows;
      });

      // Group by stage
      const stages = pipeline.stages as Array<{ id: string; name: string; order: number }>;
      const board = stages.map((stage) => ({
        ...stage,
        deals: deals.filter((d: any) => d.stage_id === stage.id),
        totalValue: deals.filter((d: any) => d.stage_id === stage.id)
          .reduce((sum: number, d: any) => sum + (parseFloat(d.amount) || 0), 0),
      }));

      return reply.send({ success: true, data: { pipeline, board } });
    });

    // Get single deal
    fastify.get('/:id', { preHandler: requireScope('deals:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [deal] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT d.*,
             c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name,
             comp.name as company_name,
             u.name as owner_name,
             p.name as pipeline_name, p.stages as pipeline_stages
           FROM deals d
           LEFT JOIN contacts c ON d.contact_id = c.id
           LEFT JOIN companies comp ON d.company_id = comp.id
           LEFT JOIN users u ON d.owner_id = u.id
           LEFT JOIN pipelines p ON d.pipeline_id = p.id
           WHERE d.id = $1`,
          [id],
        );
        return result.rows;
      });
      if (!deal) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Deal not found' } });
      return reply.send({ success: true, data: deal });
    });

    // Create deal
    fastify.post('/', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const body = CreateDealSchema.parse(req.body);
      const ownerId = body.ownerId ?? req.user.sub;

      const [deal] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO deals (tenant_id, name, contact_id, company_id, pipeline_id, stage_id,
            owner_id, amount, currency, close_date, priority, source, tags, custom_fields)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            req.tenant.id, body.name, body.contactId, body.companyId,
            body.pipelineId, body.stageId, ownerId, body.amount, body.currency,
            body.closeDate, body.priority, body.source, body.tags ?? [], JSON.stringify(body.customFields ?? {}),
          ],
        );
        return result.rows;
      });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.DEAL_CREATED, { deal });
      return reply.code(201).send({ success: true, data: deal });
    });

    // Update deal fields
    fastify.patch('/:id', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CreateDealSchema.partial().parse(req.body);

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const map: Record<string, string> = {
        name: 'name', amount: 'amount', contactId: 'contact_id', companyId: 'company_id',
        stageId: 'stage_id', closeDate: 'close_date', priority: 'priority',
        source: 'source', tags: 'tags', ownerId: 'owner_id',
      };
      for (const [k, col] of Object.entries(map)) {
        if (k in body) { sets.push(`${col} = $${i++}`); vals.push((body as any)[k]); }
      }
      if (body.customFields !== undefined) {
        sets.push(`custom_fields = custom_fields || $${i++}::jsonb`);
        vals.push(JSON.stringify(body.customFields));
      }
      if (!sets.length) return reply.send({ success: true, data: null });
      vals.push(id);

      const [deal] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE deals SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
          vals,
        );
        return result.rows;
      });

      if (!deal) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Deal not found' } });
      return reply.send({ success: true, data: deal });
    });

    // Delete deal
    fastify.delete('/:id', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const deleted = await db.withTenant(req.tenant.id, async (client) => {
        await client.query('UPDATE activities SET deal_id = NULL WHERE deal_id = $1', [id]);
        const result = await client.query('DELETE FROM deals WHERE id = $1', [id]);
        return result.rowCount ?? 0;
      });
      if (!deleted) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Deal not found' } });
      return reply.code(204).send();
    });

    // Move deal to different stage
    fastify.patch('/:id/stage', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { stageId } = MoveStageSchema.parse(req.body);

      const [old] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT stage_id FROM deals WHERE id = $1', [id]);
        return result.rows;
      });

      if (!old) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Deal not found' } });

      const [deal] = await db.withTenant(req.tenant.id, async (client) => {
        // Update deal
        await client.query('UPDATE deals SET stage_id = $1 WHERE id = $2', [stageId, id]);

        // Log history
        await client.query(
          `INSERT INTO deal_history (tenant_id, deal_id, field, old_value, new_value, changed_by)
           VALUES ($1,$2,'stage_id',$3::jsonb,$4::jsonb,$5)`,
          [req.tenant.id, id, JSON.stringify(old.stage_id), JSON.stringify(stageId), req.user.sub],
        );

        const result = await client.query('SELECT * FROM deals WHERE id = $1', [id]);
        return result.rows;
      });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.DEAL_STAGE_CHANGED, {
        deal, oldStageId: old.stage_id, newStageId: stageId,
      });

      return reply.send({ success: true, data: deal });
    });

    // Mark deal as won
    fastify.post('/:id/won', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [deal] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE deals SET status = 'won', won_at = NOW() WHERE id = $1 RETURNING *`,
          [id],
        );
        return result.rows;
      });
      await eventBus.publish(req.tenant.id, CRM_EVENTS.DEAL_WON, { deal });
      return reply.send({ success: true, data: deal });
    });

    // Mark deal as lost
    fastify.post('/:id/lost', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason?: string };
      const [deal] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE deals SET status = 'lost', lost_at = NOW(), lost_reason = $1 WHERE id = $2 RETURNING *`,
          [reason, id],
        );
        return result.rows;
      });
      await eventBus.publish(req.tenant.id, CRM_EVENTS.DEAL_LOST, { deal, reason });
      return reply.send({ success: true, data: deal });
    });
  };
}

const DEFAULT_STAGES = [
  { id: crypto.randomUUID(), name: 'New',          order: 1, probability: 10,  color: '#94a3b8', rottenAfterDays: 14 },
  { id: crypto.randomUUID(), name: 'Qualified',    order: 2, probability: 25,  color: '#6366f1', rottenAfterDays: 14 },
  { id: crypto.randomUUID(), name: 'Proposal',     order: 3, probability: 50,  color: '#8b5cf6', rottenAfterDays: 10 },
  { id: crypto.randomUUID(), name: 'Negotiation',  order: 4, probability: 75,  color: '#06b6d4', rottenAfterDays: 7  },
  { id: crypto.randomUUID(), name: 'Closed Won',   order: 5, probability: 100, color: '#10b981', rottenAfterDays: null },
];

// Seed a default pipeline when a new tenant is created — call this from tenant.service.ts
export async function seedDefaultPipeline(db: any, tenantId: string): Promise<void> {
  await db.withTenant(tenantId, async (client: any) => {
    await client.query(
      `INSERT INTO pipelines (tenant_id, name, stages, is_default)
       VALUES ($1, 'Sales Pipeline', $2::jsonb, true)
       ON CONFLICT DO NOTHING`,
      [tenantId, JSON.stringify(DEFAULT_STAGES)],
    );
  });
}
