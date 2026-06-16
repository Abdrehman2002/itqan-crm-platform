import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../../middlewares/auth.middleware';

const AddressSchema = z.object({
  line1: z.string().default(''),
  line2: z.string().optional(),
  city: z.string().default(''),
  state: z.string().default(''),
  country: z.string().default(''),
  postalCode: z.string().default(''),
});

const CreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  company: z.string().optional(),
  currency: z.string().default('USD'),
  taxId: z.string().optional(),
  billingAddress: AddressSchema.default({}),
});

const UpdateSchema = CreateSchema.partial();

export function billingContactRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const search = (req.query as any).search as string | undefined;
      const rows = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `SELECT * FROM billing_contacts
           WHERE tenant_id = $1
           ${search ? `AND (name ILIKE $2 OR email ILIKE $2 OR company ILIKE $2)` : ''}
           ORDER BY name`,
          search ? [tenantId, `%${search}%`] : [tenantId]
        );
        return result.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    fastify.post('/', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const body = CreateSchema.parse(req.body);
      const tenantId = req.tenant.id;
      const [row] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `INSERT INTO billing_contacts (tenant_id, name, email, phone, company, currency, tax_id, billing_address)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenantId, body.name, body.email, body.phone ?? null, body.company ?? null,
           body.currency, body.taxId ?? null, JSON.stringify(body.billingAddress)]
        );
        return result.rows;
      });
      return reply.status(201).send({ success: true, data: row });
    });

    fastify.put('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const body = UpdateSchema.parse(req.body);
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      const sets: string[] = [];
      const vals: unknown[] = [tenantId, id];
      if (body.name)           { sets.push(`name = $${vals.length + 1}`);            vals.push(body.name); }
      if (body.email)          { sets.push(`email = $${vals.length + 1}`);           vals.push(body.email); }
      if (body.phone !== undefined)   { sets.push(`phone = $${vals.length + 1}`);    vals.push(body.phone); }
      if (body.company !== undefined) { sets.push(`company = $${vals.length + 1}`);  vals.push(body.company); }
      if (body.currency)       { sets.push(`currency = $${vals.length + 1}`);        vals.push(body.currency); }
      if (body.taxId !== undefined)   { sets.push(`tax_id = $${vals.length + 1}`);   vals.push(body.taxId); }
      if (body.billingAddress) { sets.push(`billing_address = $${vals.length + 1}`); vals.push(JSON.stringify(body.billingAddress)); }
      if (!sets.length) return reply.send({ success: true });
      sets.push(`updated_at = NOW()`);
      const [row] = await db.withTenant(tenantId, async (client) =>
        (await client.query(
          `UPDATE billing_contacts SET ${sets.join(', ')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          vals
        )).rows
      );
      return reply.send({ success: true, data: row });
    });

    fastify.delete('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM billing_contacts WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
      );
      return reply.send({ success: true });
    });
  };
}
