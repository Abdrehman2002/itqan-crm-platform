import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';

const DEPT_TYPES = [
  'support', 'sales', 'compliance_audit',
  'finance_billing', 'technical_operations', 'operations',
  'complaint',   // Vextria/banking — separate Complaints dept (regulatory)
] as const;

const CreateSchema = z.object({
  name:           z.string().min(1).max(100),
  department_type: z.enum(DEPT_TYPES),
  description:    z.string().optional(),
  head_user_id:   z.string().uuid().optional(),
  color:          z.string().optional(),
});

const UpdateSchema = z.object({
  name:           z.string().min(1).max(100).optional(),
  department_type: z.enum(DEPT_TYPES).optional(),
  description:    z.string().nullable().optional(),
  head_user_id:   z.string().uuid().nullable().optional(),
  color:          z.string().optional(),
  is_active:      z.boolean().optional(),
});

export function departmentRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // LIST
    fastify.get('/', { preHandler: requireScope('admin:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT d.*,
                  u.name  AS head_name,
                  u.email AS head_email,
                  COUNT(DISTINCT um.id) FILTER (WHERE um.is_active) AS member_count
           FROM departments d
           LEFT JOIN users u  ON u.id = d.head_user_id
           LEFT JOIN users um ON um.department_id = d.id AND um.tenant_id = d.tenant_id
           WHERE d.tenant_id = $1
           GROUP BY d.id, u.name, u.email
           ORDER BY d.name`,
          [tenantId]
        )
      );
      return reply.send({ success: true, data: rows });
    });

    // GET single
    fastify.get('/:id', { preHandler: requireScope('admin:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const { rows: [dept] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT d.*, u.name AS head_name, u.email AS head_email
           FROM departments d
           LEFT JOIN users u ON u.id = d.head_user_id
           WHERE d.tenant_id = $1 AND d.id = $2`,
          [tenantId, id]
        )
      );
      if (!dept) return reply.status(404).send({ success: false, error: 'Not found' });

      // Members with their manager chain
      const { rows: members } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT u.id, u.name, u.email, u.role, u.department_type, u.is_active,
                  u.manager_id, m.name AS manager_name
           FROM users u
           LEFT JOIN users m ON m.id = u.manager_id
           WHERE u.tenant_id = $1 AND u.department_id = $2
           ORDER BY u.name`,
          [tenantId, id]
        )
      );

      return reply.send({ success: true, data: { ...dept, members } });
    });

    // CREATE
    fastify.post('/', { preHandler: requireScope('admin:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const body = CreateSchema.parse(req.body);
      const { rows: [dept] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `INSERT INTO departments (tenant_id, name, department_type, description, head_user_id, color)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [tenantId, body.name, body.department_type, body.description ?? null,
           body.head_user_id ?? null, body.color ?? '#6366f1']
        )
      );
      return reply.status(201).send({ success: true, data: dept });
    });

    // UPDATE
    fastify.patch('/:id', { preHandler: requireScope('admin:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const body = UpdateSchema.parse(req.body);

      const sets: string[] = ['updated_at = NOW()'];
      const vals: unknown[] = [tenantId, id];
      const push = (col: string, v: unknown) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };

      if (body.name            !== undefined) push('name',            body.name);
      if (body.department_type !== undefined) push('department_type', body.department_type);
      if (body.description     !== undefined) push('description',     body.description);
      if (body.head_user_id    !== undefined) push('head_user_id',    body.head_user_id);
      if (body.color           !== undefined) push('color',           body.color);
      if (body.is_active       !== undefined) push('is_active',       body.is_active);

      const { rows: [dept] } = await db.withTenant(tenantId, (client) =>
        client.query(
          `UPDATE departments SET ${sets.join(', ')}
           WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          vals
        )
      );
      if (!dept) return reply.status(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: dept });
    });

    // DELETE
    fastify.delete('/:id', { preHandler: requireScope('admin:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      // Unlink members before deleting
      await db.withTenant(tenantId, (client) =>
        client.query(`UPDATE users SET department_id = NULL WHERE tenant_id = $1 AND department_id = $2`, [tenantId, id])
      );
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM departments WHERE tenant_id = $1 AND id = $2`, [tenantId, id])
      );
      return reply.send({ success: true });
    });

    // ASSIGN members to department
    fastify.post('/:id/members', { preHandler: requireScope('admin:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const { user_ids } = z.object({ user_ids: z.array(z.string().uuid()).min(1) }).parse(req.body);

      await db.withTenant(tenantId, (client) =>
        client.query(
          `UPDATE users SET department_id = $1 WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
          [id, tenantId, user_ids]
        )
      );
      return reply.send({ success: true });
    });

    // REMOVE member from department
    fastify.delete('/:id/members/:userId', { preHandler: requireScope('admin:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { userId } = req.params as { id: string; userId: string };
      await db.withTenant(tenantId, (client) =>
        client.query(`UPDATE users SET department_id = NULL WHERE tenant_id = $1 AND id = $2`, [tenantId, userId])
      );
      return reply.send({ success: true });
    });
  };
}
