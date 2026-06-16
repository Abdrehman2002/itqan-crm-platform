/**
 * Sector routes
 *  GET  /api/v1/sector              — current tenant's sector + field definitions
 *  GET  /api/v1/sector/fields        — custom_field_definitions for contacts
 *  POST /api/v1/sector/fields        — add a new custom field
 *  DELETE /api/v1/sector/fields/:id  — remove a custom field
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { getSector, SECTORS } from '@crm/shared';

export function sectorRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    const authHandler = [requireScope('admin:read')];
    const writeHandler = [requireScope('admin:write')];

    // ── GET /api/v1/sector  —  sector + all fields ───────────────────────
    fastify.get('/', { preHandler: authHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;

      const [tenantRow] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT sector, settings FROM tenants WHERE id = $1', [tenantId]);
        return r.rows;
      });

      const sectorId = tenantRow?.sector ?? 'other';
      const sectorCfg = getSector(sectorId);

      const fields = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT id, name, label, field_type, options, is_required, sort_order
           FROM custom_field_definitions
           WHERE entity = 'contact'
           ORDER BY sort_order, label`,
        );
        return r.rows;
      });

      return reply.send({
        success: true,
        data: {
          sector:   sectorId,
          config:   sectorCfg,
          fields,
          allSectors: SECTORS.map(s => ({ id: s.id, label: s.label, icon: s.icon, description: s.description, color: s.color, bg: s.bg })),
        },
      });
    });

    // ── GET /api/v1/sector/fields  —  just the field list ───────────────
    fastify.get('/fields', { preHandler: authHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const fields = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT id, name, label, field_type, options, is_required, sort_order
           FROM custom_field_definitions
           WHERE entity = 'contact'
           ORDER BY sort_order, label`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: fields });
    });

    // ── POST /api/v1/sector/fields  —  add a custom field ───────────────
    const AddFieldSchema = z.object({
      name:        z.string().min(1).regex(/^[a-z0-9_]+$/, 'name must be snake_case'),
      label:       z.string().min(1),
      field_type:  z.enum(['text','email','phone','number','date','select','textarea','boolean']),
      is_required: z.boolean().default(false),
      sort_order:  z.number().int().default(100),
      options:     z.array(z.string()).optional(),
    });

    fastify.post('/fields', { preHandler: writeHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const body = AddFieldSchema.parse(req.body);

      const field = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `INSERT INTO custom_field_definitions
             (tenant_id, entity, name, label, field_type, options, is_required, sort_order)
           VALUES ($1, 'contact', $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, entity, name) DO UPDATE
             SET label = EXCLUDED.label, field_type = EXCLUDED.field_type,
                 options = EXCLUDED.options, is_required = EXCLUDED.is_required,
                 sort_order = EXCLUDED.sort_order
           RETURNING *`,
          [tenantId, body.name, body.label, body.field_type,
           body.options ? JSON.stringify(body.options) : null,
           body.is_required, body.sort_order],
        );
        return r.rows[0];
      });

      return reply.code(201).send({ success: true, data: field });
    });

    // ── PATCH /api/v1/sector/fields/:id  —  update a field ───────────────
    const UpdateFieldSchema = z.object({
      label:       z.string().min(1).optional(),
      is_required: z.boolean().optional(),
      sort_order:  z.number().int().optional(),
      options:     z.array(z.string()).optional(),
    });

    fastify.patch('/fields/:id', { preHandler: writeHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const body = UpdateFieldSchema.parse(req.body);

      const field = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE custom_field_definitions
           SET
             label       = COALESCE($2, label),
             is_required = COALESCE($3, is_required),
             sort_order  = COALESCE($4, sort_order),
             options     = COALESCE($5, options)
           WHERE id = $1 AND entity = 'contact'
           RETURNING *`,
          [id, body.label ?? null, body.is_required ?? null, body.sort_order ?? null,
           body.options ? JSON.stringify(body.options) : null],
        );
        return r.rows[0];
      });

      if (!field) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Field not found' } });
      return reply.send({ success: true, data: field });
    });

    // ── DELETE /api/v1/sector/fields/:id ─────────────────────────────────
    fastify.delete('/fields/:id', { preHandler: writeHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };

      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `DELETE FROM custom_field_definitions WHERE id = $1 AND entity = 'contact'`,
          [id],
        );
      });

      return reply.code(204).send();
    });

    // ── GET /api/v1/sector/all  —  list all available sectors ────────────
    fastify.get('/all', async (_req, reply) => {
      return reply.send({
        success: true,
        data: SECTORS.map(s => ({
          id: s.id, label: s.label, icon: s.icon,
          description: s.description, color: s.color, bg: s.bg,
          contactLabel: s.contactLabel, departments: s.departments,
        })),
      });
    });
  };
}
