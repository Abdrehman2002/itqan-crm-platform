import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope, requireEntitlement, requirePermission } from '../../middlewares/auth.middleware';

// Per-tenant custom tax rate catalogue. Backed by the tax_rates table
// (migration 037_tax_rates.sql), RLS-forced so cross-tenant reads are
// impossible even if a query forgets the tenant_id predicate.

const CreateSchema = z.object({
  name:        z.string().min(1).max(120),
  ratePercent: z.number().min(0).max(100),
  isDefault:   z.boolean().optional(),
});

const UpdateSchema = CreateSchema.partial();

type Row = {
  id: string;
  tenant_id: string;
  name: string;
  rate_percent: string;          // pg numeric → string
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

function rowToDto(row: Row) {
  return {
    id:          row.id,
    name:        row.name,
    ratePercent: Number(row.rate_percent),
    isDefault:   row.is_default,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

export function taxRatesRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    // Same entitlement gate as the rest of Sales settings.
    fastify.addHook('preHandler', requireEntitlement('sales.settings'));

    // GET /api/v1/sales/tax-rates
    fastify.get('/', {
      preHandler: [requireScope('contacts:read'), requirePermission('sales_settings:read')],
    }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const rows = await db.withTenant(tenantId, (client) =>
        client.query<Row>(
          `SELECT * FROM tax_rates WHERE tenant_id = $1 ORDER BY is_default DESC, name ASC`,
          [tenantId],
        ).then(r => r.rows),
      );
      return reply.send({ success: true, data: rows.map(rowToDto) });
    });

    // POST /api/v1/sales/tax-rates
    fastify.post('/', {
      preHandler: [requireScope('contacts:write'), requirePermission('sales_settings:edit')],
    }, async (req, reply) => {
      const body = CreateSchema.parse(req.body);
      const tenantId = req.tenant.id;
      const row = await db.withTenant(tenantId, async (client) => {
        // If is_default, clear any existing default first to honour the partial
        // unique index (idx_tax_rates_one_default_per_tenant).
        if (body.isDefault) {
          await client.query(
            `UPDATE tax_rates SET is_default = FALSE, updated_at = NOW()
             WHERE tenant_id = $1 AND is_default = TRUE`,
            [tenantId],
          );
        }
        const result = await client.query<Row>(
          `INSERT INTO tax_rates (tenant_id, name, rate_percent, is_default)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [tenantId, body.name, body.ratePercent, body.isDefault ?? false],
        );
        return result.rows[0];
      });
      return reply.status(201).send({ success: true, data: rowToDto(row) });
    });

    // PATCH /api/v1/sales/tax-rates/:id
    fastify.patch('/:id', {
      preHandler: [requireScope('contacts:write'), requirePermission('sales_settings:edit')],
    }, async (req, reply) => {
      const body = UpdateSchema.parse(req.body);
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;

      const row = await db.withTenant(tenantId, async (client) => {
        if (body.isDefault === true) {
          await client.query(
            `UPDATE tax_rates SET is_default = FALSE, updated_at = NOW()
             WHERE tenant_id = $1 AND is_default = TRUE AND id <> $2`,
            [tenantId, id],
          );
        }

        const sets: string[] = [];
        const vals: unknown[] = [tenantId, id];
        if (body.name        !== undefined) { sets.push(`name = $${vals.length + 1}`);         vals.push(body.name); }
        if (body.ratePercent !== undefined) { sets.push(`rate_percent = $${vals.length + 1}`); vals.push(body.ratePercent); }
        if (body.isDefault   !== undefined) { sets.push(`is_default = $${vals.length + 1}`);   vals.push(body.isDefault); }
        if (!sets.length) {
          const existing = await client.query<Row>(
            `SELECT * FROM tax_rates WHERE tenant_id = $1 AND id = $2`,
            [tenantId, id],
          );
          return existing.rows[0];
        }
        sets.push(`updated_at = NOW()`);
        const result = await client.query<Row>(
          `UPDATE tax_rates SET ${sets.join(', ')}
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          vals,
        );
        return result.rows[0];
      });

      if (!row) return reply.status(404).send({ success: false, error: { message: 'Tax rate not found' } });
      return reply.send({ success: true, data: rowToDto(row) });
    });

    // DELETE /api/v1/sales/tax-rates/:id
    fastify.delete('/:id', {
      preHandler: [requireScope('contacts:write'), requirePermission('sales_settings:edit')],
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM tax_rates WHERE tenant_id = $1 AND id = $2`, [tenantId, id]),
      );
      return reply.send({ success: true });
    });
  };
}
