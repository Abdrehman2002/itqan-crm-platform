import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';

const STAGES = [
  'assigned', 'accepted', 'contacted', 'quoted', 'kyc_requested', 'closed_won', 'closed_lost',
] as const;

const CreateSchema = z.object({
  title:         z.string().min(1).max(200),
  description:   z.string().optional(),
  assignee_id:   z.string().uuid().optional(),
  contact_id:    z.string().uuid().optional(),
  company_id:    z.string().uuid().optional(),
  value:         z.number().min(0).optional(),
  currency:      z.string().length(3).default('USD'),
  probability:   z.number().int().min(0).max(100).default(50),
  expected_close: z.string().optional(),
  source:        z.string().optional(),
  tags:          z.array(z.string()).default([]),
});

const UpdateStageSchema = z.object({
  stage:          z.enum(STAGES),
  contact_notes:  z.string().optional(),
  quote_reference: z.string().optional(),
  kyc_notes:      z.string().optional(),
  close_notes:    z.string().optional(),
});

const UpdateSchema = z.object({
  title:          z.string().min(1).max(200).optional(),
  description:    z.string().nullable().optional(),
  assignee_id:    z.string().uuid().nullable().optional(),
  contact_id:     z.string().uuid().nullable().optional(),
  company_id:     z.string().uuid().nullable().optional(),
  value:          z.number().min(0).nullable().optional(),
  probability:    z.number().int().min(0).max(100).optional(),
  expected_close: z.string().nullable().optional(),
  source:         z.string().nullable().optional(),
  tags:           z.array(z.string()).optional(),
});

const ListQuerySchema = z.object({
  page:        z.coerce.number().min(1).default(1),
  pageSize:    z.coerce.number().min(1).max(100).default(25),
  stage:       z.string().optional(),
  assignee_id: z.string().optional(),
  search:      z.string().optional(),
});

// Stage-to-timestamp column mapping
const STAGE_TS: Partial<Record<string, string>> = {
  accepted:      'accepted_at',
  contacted:     'contacted_at',
  quoted:        'quoted_at',
  kyc_requested: 'kyc_requested_at',
  closed_won:    'closed_at',
  closed_lost:   'closed_at',
};

export function opportunityRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // LIST
    fastify.get('/', { preHandler: requireScope('deals:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const q = ListQuerySchema.parse(req.query);
      const offset = (q.page - 1) * q.pageSize;

      const conds: string[] = ['o.tenant_id = $1'];
      const vals: unknown[] = [tenantId];
      const p = () => `$${vals.length + 1}`;

      if (q.stage)       { conds.push(`o.stage = ${p()}`);                         vals.push(q.stage); }
      if (q.assignee_id) { conds.push(`o.assignee_id = ${p()}`);                   vals.push(q.assignee_id); }
      if (q.search)      { conds.push(`o.title ILIKE ${p()}`);                     vals.push(`%${q.search}%`); }

      const where = conds.join(' AND ');

      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT o.*,
                  u.name  AS assignee_name,
                  c.name  AS contact_name,
                  co.name AS company_name
           FROM sales_opportunities o
           LEFT JOIN users     u  ON u.id  = o.assignee_id
           LEFT JOIN contacts  c  ON c.id  = o.contact_id
           LEFT JOIN companies co ON co.id = o.company_id
           WHERE ${where}
           ORDER BY o.created_at DESC
           LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, q.pageSize, offset]
        )
      );
      const { rows: [{ count }] } = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT COUNT(*) FROM sales_opportunities o WHERE ${where}`, vals)
      );

      return reply.send({ success: true, data: rows, total: Number(count), page: q.page, pageSize: q.pageSize });
    });

    // GET single
    fastify.get('/:id', { preHandler: requireScope('deals:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const { rows: [opp] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT o.*,
                  u.name  AS assignee_name,
                  c.name  AS contact_name, c.email AS contact_email,
                  co.name AS company_name
           FROM sales_opportunities o
           LEFT JOIN users     u  ON u.id  = o.assignee_id
           LEFT JOIN contacts  c  ON c.id  = o.contact_id
           LEFT JOIN companies co ON co.id = o.company_id
           WHERE o.tenant_id = $1 AND o.id = $2`,
          [tenantId, id]
        )
      );
      if (!opp) return reply.status(404).send({ success: false, error: 'Not found' });

      const { rows: audit } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT * FROM opportunity_audit_log WHERE opp_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [id]
        )
      );

      return reply.send({ success: true, data: { ...opp, audit } });
    });

    // CREATE
    fastify.post('/', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const body = CreateSchema.parse(req.body);
      const actorId = req.user.sub;

      // Auto-increment opportunity number
      const { rows: [counter] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `INSERT INTO opportunity_counters (tenant_id, next_val) VALUES ($1, 2)
           ON CONFLICT (tenant_id) DO UPDATE SET next_val = opportunity_counters.next_val + 1
           RETURNING next_val - 1 AS current_val`,
          [tenantId]
        )
      );
      const oppNumber = `OPP-${String(counter.current_val).padStart(5, '0')}`;

      const { rows: [opp] } = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `INSERT INTO sales_opportunities
             (tenant_id, opportunity_number, title, description, assignee_id, contact_id, company_id,
              value, currency, probability, expected_close, source, tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [tenantId, oppNumber, body.title, body.description ?? null,
           body.assignee_id ?? null, body.contact_id ?? null, body.company_id ?? null,
           body.value ?? null, body.currency, body.probability,
           body.expected_close ?? null, body.source ?? null, body.tags]
        );
        await client.query(
          `INSERT INTO opportunity_audit_log (tenant_id, opp_id, actor_id, action, new_value)
           VALUES ($1,$2,$3,'created',$4)`,
          [tenantId, r.rows[0].id, actorId, JSON.stringify({ stage: 'assigned' })]
        );
        return r.rows;
      });

      return reply.status(201).send({ success: true, data: opp });
    });

    // ADVANCE STAGE
    fastify.post('/:id/stage', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const body = UpdateStageSchema.parse(req.body);
      const actorId = req.user.sub;

      const { rows: [current] } = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM sales_opportunities WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
      );
      if (!current) return reply.status(404).send({ success: false, error: 'Not found' });

      const sets: string[] = ['stage = $3', 'updated_at = NOW()'];
      const vals: unknown[] = [tenantId, id, body.stage];
      const push = (col: string, v: unknown) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };

      // Stamp the stage timestamp
      const tsCol = STAGE_TS[body.stage];
      if (tsCol) push(tsCol, new Date().toISOString());

      // Persist stage notes
      if (body.contact_notes  !== undefined) push('contact_notes',   body.contact_notes);
      if (body.quote_reference !== undefined) push('quote_reference', body.quote_reference);
      if (body.kyc_notes       !== undefined) push('kyc_notes',       body.kyc_notes);
      if (body.close_notes     !== undefined) push('close_notes',     body.close_notes);

      const { rows: [opp] } = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE sales_opportunities SET ${sets.join(', ')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          vals
        );
        await client.query(
          `INSERT INTO opportunity_audit_log (tenant_id, opp_id, actor_id, action, old_value, new_value)
           VALUES ($1,$2,$3,'stage_changed',$4,$5)`,
          [tenantId, id, actorId,
           JSON.stringify({ stage: current.stage }),
           JSON.stringify({ stage: body.stage, notes: body.close_notes ?? body.contact_notes ?? null })]
        );
        return r.rows;
      });

      return reply.send({ success: true, data: opp });
    });

    // UPDATE fields
    fastify.patch('/:id', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const body = UpdateSchema.parse(req.body);

      const sets: string[] = ['updated_at = NOW()'];
      const vals: unknown[] = [tenantId, id];
      const push = (col: string, v: unknown) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };

      if (body.title          !== undefined) push('title',          body.title);
      if (body.description    !== undefined) push('description',    body.description);
      if (body.assignee_id    !== undefined) push('assignee_id',    body.assignee_id);
      if (body.contact_id     !== undefined) push('contact_id',     body.contact_id);
      if (body.company_id     !== undefined) push('company_id',     body.company_id);
      if (body.value          !== undefined) push('value',          body.value);
      if (body.probability    !== undefined) push('probability',    body.probability);
      if (body.expected_close !== undefined) push('expected_close', body.expected_close);
      if (body.source         !== undefined) push('source',         body.source);
      if (body.tags           !== undefined) push('tags',           body.tags);

      const { rows: [opp] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `UPDATE sales_opportunities SET ${sets.join(', ')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          vals
        )
      );
      if (!opp) return reply.status(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: opp });
    });

    // DELETE
    fastify.delete('/:id', { preHandler: requireScope('deals:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM sales_opportunities WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
      );
      return reply.send({ success: true });
    });

    // MANAGER ROLLUP — recursive team summary
    // Returns stage counts for the calling user's entire reporting tree
    fastify.get('/team/summary', { preHandler: requireScope('deals:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const managerId = (req.query as any).manager_id ?? req.user.sub;

      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `WITH RECURSIVE team AS (
             SELECT id FROM users WHERE tenant_id=$1 AND id=$2
             UNION ALL
             SELECT u.id FROM users u INNER JOIN team t ON u.manager_id = t.id
             WHERE u.tenant_id=$1
           )
           SELECT
             o.stage,
             COUNT(*)               AS total,
             COUNT(*) FILTER (WHERE o.assignee_id = $2) AS mine
           FROM sales_opportunities o
           WHERE o.tenant_id=$1 AND o.assignee_id IN (SELECT id FROM team)
           GROUP BY o.stage
           ORDER BY array_position(
             ARRAY['assigned','accepted','contacted','quoted','kyc_requested','closed_won','closed_lost'],
             o.stage
           )`,
          [tenantId, managerId]
        )
      );

      // Also get direct report count
      const { rows: [{ direct_reports }] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT COUNT(*) AS direct_reports FROM users WHERE tenant_id=$1 AND manager_id=$2`,
          [tenantId, managerId]
        )
      );

      return reply.send({ success: true, data: { summary: rows, direct_reports: Number(direct_reports) } });
    });
  };
}
