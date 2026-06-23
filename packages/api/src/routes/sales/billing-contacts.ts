import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope, requireEntitlement, requirePermission } from '../../middlewares/auth.middleware';

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
    // Hard ceiling: workspace must be licensed for the Billing Contacts feature.
    fastify.addHook('preHandler', requireEntitlement('sales.contacts'));
    fastify.get('/', { preHandler: [requireScope('contacts:read'), requirePermission('billing_contacts:read')] }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const search = (req.query as any).search as string | undefined;
      const rows = await db.withTenant(tenantId, async (client) => {
        const searchClause = search ? `AND (name ILIKE $2 OR email ILIKE $2 OR company ILIKE $2)` : '';
        const params = search ? [tenantId, `%${search}%`] : [tenantId];

        // Return dedicated billing contacts + CRM contacts (deduplicated by name)
        const result = await client.query(
          `SELECT id, name, email, phone, company, currency, tax_id, billing_address,
                  'billing' AS source
           FROM billing_contacts
           WHERE tenant_id = $1 ${searchClause}

           UNION

           SELECT
             c.id,
             TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')) AS name,
             c.email,
             c.phone,
             comp.name AS company,
             'USD' AS currency,
             NULL AS tax_id,
             '{}' :: jsonb AS billing_address,
             'crm' AS source
           FROM contacts c
           LEFT JOIN companies comp ON comp.id = c.company_id
           WHERE c.tenant_id = $1
             AND c.email IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM billing_contacts bc
               WHERE bc.tenant_id = $1
                 AND bc.email = c.email
             )
             ${search ? `AND (
               TRIM(c.first_name || ' ' || COALESCE(c.last_name,'')) ILIKE $2
               OR c.email ILIKE $2
               OR comp.name ILIKE $2
             )` : ''}

           ORDER BY name`,
          params,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    fastify.post('/', { preHandler: [requireScope('contacts:write'), requirePermission('billing_contacts:create')] }, async (req, reply) => {
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

    fastify.put('/:id', { preHandler: [requireScope('contacts:write'), requirePermission('billing_contacts:edit')] }, async (req, reply) => {
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
      const [row] = await db.withTenant(tenantId, (client) =>
        client.query(
          `UPDATE billing_contacts SET ${sets.join(', ')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          vals
        ).then(r => r.rows)
      );
      return reply.send({ success: true, data: row });
    });

    fastify.delete('/:id', { preHandler: [requireScope('contacts:write'), requirePermission('billing_contacts:delete')] }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const { id } = req.params as { id: string };
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM billing_contacts WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
      );
      return reply.send({ success: true });
    });
  };
}
