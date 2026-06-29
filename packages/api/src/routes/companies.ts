import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { readCsvFromRequest, validateRows, type BulkRowError } from '../lib/bulk-csv';

const CreateCompanySchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  industry: z.string().optional(),
  size: z.enum(['1-10','11-50','51-200','201-500','501-1000','1000+']).optional(),
  annualRevenue: z.number().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  website: z.string().url().optional(),
  phone: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ownerId: z.string().uuid().optional(),
});

export function companyRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    fastify.get('/', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { search, page = 1, pageSize = 25, industry } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      const countParams: unknown[] = [];
      let countWhere = 'WHERE 1=1';
      if (search) { countParams.push(`%${search}%`); countWhere += ` AND name ILIKE $${countParams.length}`; }

      const [{ count }] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(`SELECT COUNT(*) FROM companies ${countWhere}`, countParams);
        return result.rows;
      });

      const listParams: unknown[] = [];
      let listWhere = 'WHERE 1=1';
      if (search)   { listParams.push(`%${search}%`);  listWhere += ` AND (co.name ILIKE $${listParams.length} OR co.domain ILIKE $${listParams.length})`; }
      if (industry) { listParams.push(industry);        listWhere += ` AND co.industry = $${listParams.length}`; }
      listParams.push(Number(pageSize), offset);

      const companies = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT co.*, u.name as owner_name
           FROM companies co
           LEFT JOIN users u ON co.owner_id = u.id
           ${listWhere}
           ORDER BY co.name ASC
           LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
          listParams,
        );
        return result.rows;
      });

      return reply.send({
        success: true,
        data: companies,
        meta: {
          page: Number(page),
          pageSize: Number(pageSize),
          total: parseInt(count),
          totalPages: Math.ceil(parseInt(count) / Number(pageSize)),
        },
      });
    });

    fastify.get('/:id', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [company] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT co.*, u.name as owner_name FROM companies co
           LEFT JOIN users u ON co.owner_id = u.id WHERE co.id = $1`,
          [id],
        );
        return result.rows;
      });
      if (!company) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Company not found' } });
      return reply.send({ success: true, data: company });
    });

    fastify.post('/', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const body = CreateCompanySchema.parse(req.body);
      const [company] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO companies
             (tenant_id, name, domain, industry, size, annual_revenue, country, city, website, phone, tags, owner_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            req.tenant.id, body.name, body.domain, body.industry, body.size,
            body.annualRevenue, body.country, body.city, body.website, body.phone,
            body.tags ?? [], body.ownerId ?? req.user.sub,
          ],
        );
        return result.rows;
      });
      return reply.code(201).send({ success: true, data: company });
    });

    fastify.patch('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CreateCompanySchema.partial().parse(req.body);

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const map: Record<string, string> = {
        name: 'name', domain: 'domain', industry: 'industry', size: 'size',
        annualRevenue: 'annual_revenue', country: 'country', city: 'city',
        website: 'website', phone: 'phone', tags: 'tags', ownerId: 'owner_id',
      };
      for (const [k, col] of Object.entries(map)) {
        if (k in body) { sets.push(`${col} = $${i++}`); vals.push((body as any)[k]); }
      }
      if (!sets.length) return reply.send({ success: true, data: null });
      vals.push(id);

      const [company] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `UPDATE companies SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
          vals,
        );
        return result.rows;
      });

      if (!company) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Company not found' } });
      return reply.send({ success: true, data: company });
    });

    // BULK UPLOAD companies from a multipart CSV file.
    // POST /api/v1/companies/bulk
    // Expected headers (lower-cased on parse):
    //   name, industry, website, phone, email, billing_address_line1,
    //   billing_address_city, billing_country
    //
    // Note: the `companies` table doesn't have address_line1/email columns —
    // we map billing_address_line1 → custom_fields.address_line1,
    // billing_address_city → city, billing_country → country, email → custom_fields.email.
    // This keeps the CSV spec stable across modules even where the table shape differs.
    fastify.post('/bulk', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const rawRows = await readCsvFromRequest(req, reply);
      if (!rawRows) return;

      const BulkCompanyRowSchema = z.object({
        name:                  z.string().min(1, 'required'),
        industry:              z.string().optional().default(''),
        website:               z
          .string()
          .optional()
          .default('')
          .refine((v) => v === '' || /^https?:\/\//i.test(v), 'must start with http:// or https://'),
        phone:                 z.string().optional().default(''),
        email:                 z.string().email().optional().or(z.literal('')).transform((v) => v || undefined),
        billing_address_line1: z.string().optional().default(''),
        billing_address_city:  z.string().optional().default(''),
        billing_country:       z.string().optional().default(''),
      });

      const { valid, failed } = validateRows(rawRows, BulkCompanyRowSchema);
      const errors: BulkRowError[] = [...failed];
      const tenantId = req.tenant.id;
      const ownerId  = req.user.sub;

      let inserted = 0;

      if (valid.length > 0) {
        await db.withTenant(tenantId, async (client) => {
          for (const { row, value } of valid) {
            await client.query('SAVEPOINT bulk_row');
            try {
              const customFields: Record<string, string> = {};
              if (value.billing_address_line1) customFields.address_line1 = value.billing_address_line1;
              if (value.email)                 customFields.email         = value.email;

              await client.query(
                `INSERT INTO companies
                   (tenant_id, name, industry, website, phone,
                    city, country, owner_id, custom_fields)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                [
                  tenantId,
                  value.name,
                  value.industry || null,
                  value.website  || null,
                  value.phone    || null,
                  value.billing_address_city || null,
                  value.billing_country      || null,
                  ownerId,
                  JSON.stringify(customFields),
                ],
              );
              await client.query('RELEASE SAVEPOINT bulk_row');
              inserted++;
            } catch (err: any) {
              await client.query('ROLLBACK TO SAVEPOINT bulk_row');
              errors.push({ row, errors: [err.message ?? 'insert failed'] });
            }
          }
        });
      }

      return reply.send({ success: true, data: { inserted, failed: errors } });
    });

    fastify.delete('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const deleted = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('DELETE FROM companies WHERE id = $1', [id]);
        return result.rowCount ?? 0;
      });
      if (!deleted) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Company not found' } });
      return reply.code(204).send();
    });
  };
}
