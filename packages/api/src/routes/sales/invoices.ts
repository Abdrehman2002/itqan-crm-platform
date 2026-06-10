import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../../middlewares/auth.middleware';

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100).default(0),
  taxAmount: z.number().min(0).default(0),
  total: z.number().min(0),
  sortOrder: z.number().int().default(0),
});

const CreateInvoiceSchema = z.object({
  billingContactId: z.string().uuid().optional(),
  issueDate: z.string(),
  dueDate: z.string(),
  currency: z.string().default('USD'),
  poReference: z.string().optional(),
  templateId: z.string().default('tpl-classic'),
  lineItems: z.array(LineItemSchema).min(1),
  subtotal: z.number().min(0),
  totalTax: z.number().min(0),
  total: z.number().min(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  status: z.enum(['draft', 'sent']).default('draft'),
});

const UpdateInvoiceSchema = z.object({
  status: z.enum(['draft','sent','viewed','partial','paid','overdue','cancelled']).optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  amountPaid: z.number().min(0).optional(),
  amountDue: z.number().min(0).optional(),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  status: z.string().optional(),
  contactId: z.string().optional(),
  search: z.string().optional(),
});

export function invoiceRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // LIST
    fastify.get('/', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const q = ListQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;
      const offset = (q.page - 1) * q.pageSize;
      const conditions: string[] = ['i.tenant_id = $1'];
      const vals: unknown[] = [tenantId];

      if (q.status) { conditions.push(`i.status = $${vals.length + 1}`); vals.push(q.status); }
      if (q.contactId) { conditions.push(`i.billing_contact_id = $${vals.length + 1}`); vals.push(q.contactId); }
      if (q.search) { conditions.push(`(i.number ILIKE $${vals.length + 1} OR bc.name ILIKE $${vals.length + 1})`); vals.push(`%${q.search}%`); }

      const where = conditions.join(' AND ');
      const rows = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT i.*, bc.name as contact_name, bc.email as contact_email, bc.company as contact_company,
                  bc.billing_address as contact_billing_address, bc.currency as contact_currency
           FROM invoices i
           LEFT JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           WHERE ${where}
           ORDER BY i.created_at DESC
           LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, q.pageSize, offset]
        )
      );
      const [{ count }] = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT COUNT(*) FROM invoices i LEFT JOIN billing_contacts bc ON bc.id = i.billing_contact_id WHERE ${where}`, vals)
      );
      return reply.send({ success: true, data: rows, total: Number(count), page: q.page, pageSize: q.pageSize });
    });

    // GET single
    fastify.get('/:id', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      const [inv] = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT i.*, bc.name as contact_name, bc.email as contact_email, bc.company as contact_company,
                  bc.billing_address as contact_billing_address, bc.currency as contact_currency, bc.tax_id as contact_tax_id
           FROM invoices i LEFT JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           WHERE i.tenant_id=$1 AND i.id=$2`,
          [tenantId, id]
        )
      );
      if (!inv) return reply.status(404).send({ success: false, error: 'Not found' });

      const lineItems = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM invoice_line_items WHERE invoice_id=$1 ORDER BY sort_order`, [id])
      );
      const payments = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY payment_date DESC`, [id])
      );
      return reply.send({ success: true, data: { ...inv, lineItems, payments } });
    });

    // CREATE
    fastify.post('/', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const body = CreateInvoiceSchema.parse(req.body);
      const tenantId = req.tenant.id;

      // Get & increment next invoice number from settings
      const [settings] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`SELECT * FROM sales_settings WHERE tenant_id=$1`, [tenantId]);
        return result.rows;
      });
      const prefix = settings?.invoice_prefix ?? 'INV-';
      const nextNum = settings?.next_invoice_number ?? 1;
      const invoiceNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;

      const [inv] = await db.withTenant(tenantId, async (client) => {
        const insertResult = await client.query(
          `INSERT INTO invoices (tenant_id, invoice_number, status, billing_contact_id, due_at, due_date,
            currency, po_reference, template_id, subtotal, tax, total, provider, notes, terms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [tenantId, invoiceNumber, body.status === 'draft' ? 'open' : body.status,
           body.billingContactId ?? null,
           body.dueDate, body.dueDate, body.currency, body.poReference ?? null,
           body.templateId, body.subtotal, body.totalTax, body.total, 'manual',
           body.notes ?? null, body.terms ?? null]
        );
        const row = insertResult.rows[0];
        for (let i = 0; i < body.lineItems.length; i++) {
          const li = body.lineItems[i];
          await client.query(
            `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, tax_rate, tax_amount, total, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [row.id, li.description, li.quantity, li.unitPrice, li.taxRate, li.taxAmount, li.total, i]
          );
        }
        return [row];
      });

      // Increment next invoice number
      await db.withTenant(tenantId, (client) =>
        client.query(
          `INSERT INTO sales_settings (tenant_id, next_invoice_number) VALUES ($1, 2)
           ON CONFLICT (tenant_id) DO UPDATE SET next_invoice_number = sales_settings.next_invoice_number + 1`,
          [tenantId]
        )
      );

      return reply.status(201).send({ success: true, data: inv });
    });

    // UPDATE (status, notes, etc.)
    fastify.patch('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const body = UpdateInvoiceSchema.parse(req.body);
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      const sets: string[] = [];
      const vals: unknown[] = [tenantId, id];
      if (body.status !== undefined)     { sets.push(`status = $${vals.length + 1}`);      vals.push(body.status === 'sent' ? 'open' : body.status); }
      if (body.dueDate !== undefined)    { sets.push(`due_date = $${vals.length + 1}`);     vals.push(body.dueDate); }
      if (body.notes !== undefined)      { sets.push(`notes = $${vals.length + 1}`);        vals.push(body.notes); }
      if (body.terms !== undefined)      { sets.push(`terms = $${vals.length + 1}`);        vals.push(body.terms); }
      if (!sets.length) return reply.send({ success: true, data: null });
      const [row] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`UPDATE invoices SET ${sets.join(',')} WHERE tenant_id=$1 AND id=$2 RETURNING *`, vals);
        return result.rows;
      });
      return reply.send({ success: true, data: row });
    });

    // DELETE
    fastify.delete('/:id', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM invoices WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
      );
      return reply.send({ success: true });
    });

    // RECORD PAYMENT
    fastify.post('/:id/payments', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      const body = z.object({
        amount: z.number().positive(),
        paymentDate: z.string(),
        modeName: z.string(),
        bankAccountName: z.string().optional(),
        reference: z.string().optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const [inv] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
        return result.rows;
      });
      if (!inv) return reply.status(404).send({ success: false, error: 'Not found' });

      const [payment] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `INSERT INTO invoice_payments (tenant_id, invoice_id, amount, payment_date, mode_name, bank_account_name, reference, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenantId, id, body.amount, body.paymentDate, body.modeName,
           body.bankAccountName ?? null, body.reference ?? null, body.notes ?? null]
        );
        // Update invoice status to 'paid'
        await client.query(
          `UPDATE invoices SET status='paid' WHERE id=$1`,
          [id]
        );
        return result.rows;
      });
      return reply.status(201).send({ success: true, data: payment });
    });
  };
}
