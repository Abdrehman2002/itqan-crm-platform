import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope, requireEntitlement, requirePermission } from '../../middlewares/auth.middleware';
import { EmailService } from '../../services/email.service';

const LineItemSchema = z.object({
  description: z.string(),
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

function rowToInvoice(row: Record<string, any>) {
  const total = Number(row.total);
  const payments = Array.isArray(row.payments) ? row.payments : [];

  // Amount paid: either from payments array (GET single) or amount_paid field (LIST)
  let amountPaid: number;
  if (payments.length > 0) {
    amountPaid = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  } else {
    amountPaid = Number(row.amount_paid ?? 0);
  }

  const amountDue = total - amountPaid;

  let status = row.status;
  if (amountPaid > 0 && amountDue > 0) {
    status = 'partially paid';
  } else if (amountDue <= 0) {
    status = 'paid';
  }

  return {
    id: row.id,
    number: row.number ?? row.invoice_number,
    status,
    billingContactId: row.billing_contact_id,
    contactName: row.contact_name ?? row.client_name,
    contactEmail: row.contact_email ?? row.client_email,
    contactCompany: row.contact_company,
    contactBillingAddress: row.contact_billing_address,
    issueDate: row.issue_date ?? row.created_at,
    dueDate: row.due_date,
    poReference: row.po_reference,
    currency: row.currency,
    templateId: row.template_id,
    subtotal: Number(row.subtotal),
    totalTax: Number(row.total_tax ?? row.tax ?? 0),
    total,
    amountPaid,
    amountDue: amountDue > 0 ? amountDue : 0,
    notes: row.notes,
    terms: row.terms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
    payments,
  };
}

export function invoiceRoutes(db: DatabaseClient) {
  const emailSvc = new EmailService(db);

  return async function (fastify: FastifyInstance) {
    // Hard ceiling: workspace must be licensed for the Invoices feature.
    fastify.addHook('preHandler', requireEntitlement('sales.invoices'));

    // LIST
    fastify.get('/', { preHandler: [requireScope('contacts:read'), requirePermission('invoices:read')] }, async (req, reply) => {
      const q = ListQuerySchema.parse(req.query);
      const tenantId = req.tenant.id;
      const offset = (q.page - 1) * q.pageSize;
      const conditions: string[] = ['i.tenant_id = $1'];
      const vals: unknown[] = [tenantId];

      if (q.status) { conditions.push(`i.status = $${vals.length + 1}`); vals.push(q.status); }
      if (q.contactId) { conditions.push(`i.billing_contact_id = $${vals.length + 1}`); vals.push(q.contactId); }
      if (q.search) { conditions.push(`(i.number ILIKE $${vals.length + 1} OR bc.name ILIKE $${vals.length + 1})`); vals.push(`%${q.search}%`); }

      const where = conditions.join(' AND ');
      const { rows } = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT i.*, bc.name as contact_name, bc.email as contact_email, bc.company as contact_company,
                  bc.billing_address as contact_billing_address, bc.currency as contact_currency,
                  COALESCE(p.total_paid, 0) as amount_paid
           FROM invoices i
           LEFT JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           LEFT JOIN (SELECT invoice_id, SUM(amount) as total_paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id = i.id
           WHERE ${where}
           ORDER BY i.created_at DESC
           LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, q.pageSize, offset]
        )
      );
      const { rows: [{ count }] } = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT COUNT(*) FROM invoices i LEFT JOIN billing_contacts bc ON bc.id = i.billing_contact_id WHERE ${where}`, vals)
      );
      return reply.send({ success: true, data: rows.map(rowToInvoice), total: Number(count), page: q.page, pageSize: q.pageSize });
    });

    // GET single
    fastify.get('/:id', { preHandler: [requireScope('contacts:read'), requirePermission('invoices:read')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      const [inv] = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT i.*, bc.name as contact_name, bc.email as contact_email, bc.company as contact_company,
                  bc.billing_address as contact_billing_address, bc.currency as contact_currency, bc.tax_id as contact_tax_id
           FROM invoices i LEFT JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           WHERE i.tenant_id=$1 AND i.id=$2`,
          [tenantId, id]
        ).then(r => r.rows)
      );
      if (!inv) return reply.status(404).send({ success: false, error: 'Not found' });

      const lineItems = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM invoice_line_items WHERE invoice_id=$1 ORDER BY sort_order`, [id]).then(r => r.rows)
      );
      const payments = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY payment_date DESC`, [id]).then(r => r.rows)
      );
      return reply.send({ success: true, data: rowToInvoice({ ...inv, lineItems, payments }) });
    });

    // CREATE
    fastify.post('/', { preHandler: [requireScope('contacts:write'), requirePermission('invoices:create')] }, async (req, reply) => {
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

      // If billingContactId is a CRM contact (not yet in billing_contacts), auto-create it
      let resolvedContactId = body.billingContactId ?? null;
      if (resolvedContactId) {
        const existing = await db.withTenant(tenantId, (client) =>
          client.query(`SELECT id FROM billing_contacts WHERE id=$1`, [resolvedContactId])
        );
        if (!existing.rows.length) {
          // Try to find in CRM contacts
          const [crmContact] = await db.withTenant(tenantId, (client) =>
            client.query(
              `SELECT c.*, comp.name as company_name FROM contacts c
               LEFT JOIN companies comp ON comp.id = c.company_id
               WHERE c.id=$1`,
              [resolvedContactId]
            ).then(r => r.rows)
          );
          if (crmContact) {
            const [newBc] = await db.withTenant(tenantId, (client) =>
              client.query(
                `INSERT INTO billing_contacts (tenant_id, name, email, phone, company, currency, billing_address)
                 VALUES ($1,$2,$3,$4,$5,'USD','{}') RETURNING id`,
                [tenantId,
                 `${crmContact.first_name} ${crmContact.last_name ?? ''}`.trim(),
                 crmContact.email ?? '',
                 crmContact.phone ?? null,
                 crmContact.company_name ?? null]
              ).then(r => r.rows)
            );
            resolvedContactId = newBc?.id ?? null;
          }
        }
      }

      const [inv] = await db.withTenant(tenantId, async (client) => {
        // Column names must match migration 008_sales_invoicing.sql:
        //   number, due_date, total_tax  (NOT invoice_number/due_at/tax)
        // status CHECK only permits draft|sent|viewed|partial|paid|overdue|cancelled
        // (so 'open' would violate the constraint and surface as "Unexpected Error").
        const insertResult = await client.query(
          `INSERT INTO invoices (tenant_id, number, status, billing_contact_id, issue_date, due_date,
            currency, po_reference, template_id, subtotal, total_tax, total, notes, terms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [tenantId, invoiceNumber, body.status,
           resolvedContactId,
           body.issueDate, body.dueDate, body.currency, body.poReference ?? null,
           body.templateId, body.subtotal, body.totalTax, body.total,
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

      return reply.status(201).send({ success: true, data: rowToInvoice({ ...inv, lineItems: [], payments: [] }) });
    });

    // UPDATE (status, notes, etc.)
    fastify.patch('/:id', { preHandler: [requireScope('contacts:write'), requirePermission('invoices:edit')] }, async (req, reply) => {
      const body = UpdateInvoiceSchema.parse(req.body);
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      const sets: string[] = [];
      const vals: unknown[] = [tenantId, id];
      if (body.status !== undefined)     { sets.push(`status = $${vals.length + 1}`);      vals.push(body.status); }
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
    fastify.delete('/:id', { preHandler: [requireScope('contacts:write'), requirePermission('invoices:delete')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;
      await db.withTenant(tenantId, (client) =>
        client.query(`DELETE FROM invoices WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
      );
      return reply.send({ success: true });
    });

    // RECORD PAYMENT
    fastify.post('/:id/payments', { preHandler: [requireScope('contacts:write'), requirePermission('payments:record')] }, async (req, reply) => {
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

    // EMAIL INVOICE TO BILLING CONTACT
    // POST /api/v1/sales/invoices/:id/send
    fastify.post('/:id/send', { preHandler: [requireScope('billing:manage'), requirePermission('invoices:send')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;

      // Optionally override recipient from body; defaults to billing contact on the invoice
      const body = z.object({
        to:      z.string().email().optional(),
        toName:  z.string().optional(),
        subject: z.string().optional(),
        message: z.string().optional(),  // prepended note above the invoice summary
      }).parse(req.body ?? {});

      // Fetch invoice + billing contact in one query
      const [inv] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `SELECT i.*,
                  bc.email  AS contact_email,
                  bc.name   AS contact_name,
                  bc.company AS contact_company,
                  ws.name   AS workspace_name,
                  ws.email  AS workspace_email,
                  ws.address AS workspace_address
           FROM invoices i
           LEFT JOIN billing_contacts bc ON i.billing_contact_id = bc.id
           LEFT JOIN workspace_settings ws ON ws.tenant_id = $1
           WHERE i.tenant_id=$1 AND i.id=$2`,
          [tenantId, id],
        );
        return result.rows;
      });

      if (!inv) return reply.status(404).send({ success: false, error: 'Invoice not found' });

      const toEmail  = body.to     ?? inv.contact_email;
      const toName   = body.toName ?? inv.contact_name  ?? undefined;

      if (!toEmail) {
        return reply.status(422).send({
          success: false,
          error: 'No recipient email address. Either supply `to` in the request body or ensure the billing contact has an email.',
        });
      }

      const subject = body.subject ?? `Invoice ${inv.number} from ${inv.workspace_name ?? 'Us'}`;

      const formattedTotal  = new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency ?? 'USD' }).format(inv.total ?? 0);
      const formattedDue    = inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
      const customNote      = body.message ? `<p style="color:#1e293b;font-size:15px;line-height:1.6;margin-bottom:20px;">${body.message}</p>` : '';

      const bodyHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;">
  <div style="background:#0f172a;padding:24px 28px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;">${inv.workspace_name ?? 'Invoice'}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px 28px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;">
    ${customNote}
    <p style="font-size:15px;line-height:1.6;">Hi ${toName ?? 'there'},</p>
    <p style="font-size:15px;line-height:1.6;">Please find your invoice details below.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr style="background:#e2e8f0;">
        <td style="padding:10px 14px;font-weight:bold;">Invoice Number</td>
        <td style="padding:10px 14px;">${inv.number}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;background:#f8fafc;">Issue Date</td>
        <td style="padding:10px 14px;background:#f8fafc;">${inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}</td>
      </tr>
      <tr style="background:#e2e8f0;">
        <td style="padding:10px 14px;font-weight:bold;">Due Date</td>
        <td style="padding:10px 14px;">${formattedDue}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;background:#fff3cd;">Amount Due</td>
        <td style="padding:10px 14px;font-weight:bold;font-size:16px;background:#fff3cd;color:#92400e;">${formattedTotal}</td>
      </tr>
    </table>
    ${inv.notes ? `<p style="font-size:13px;color:#64748b;margin-top:16px;"><strong>Notes:</strong> ${inv.notes}</p>` : ''}
    ${inv.terms ? `<p style="font-size:13px;color:#64748b;"><strong>Terms:</strong> ${inv.terms}</p>` : ''}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
    <p style="font-size:12px;color:#94a3b8;">
      ${inv.workspace_name ?? ''}${inv.workspace_address ? ' · ' + inv.workspace_address : ''}
      ${inv.workspace_email ? ' · ' + inv.workspace_email : ''}
    </p>
  </div>
</div>`.trim();

      const bodyText = [
        `Invoice ${inv.number}`,
        body.message ?? '',
        `Amount Due: ${formattedTotal}`,
        `Due Date: ${formattedDue}`,
        inv.notes  ? `Notes: ${inv.notes}`  : '',
        inv.terms  ? `Terms: ${inv.terms}`  : '',
      ].filter(Boolean).join('\n\n');

      const result = await emailSvc.send(tenantId, {
        to: toEmail,
        toName,
        subject,
        bodyHtml,
        bodyText,
        sentBy: req.user.id,
      });

      // Update invoice status to 'sent' if it was still a draft
      if (result.status === 'delivered') {
        await db.withTenant(tenantId, (client) =>
          client.query(
            `UPDATE invoices SET status = CASE WHEN status='draft' THEN 'sent' ELSE status END,
                                 updated_at = NOW()
             WHERE tenant_id=$1 AND id=$2`,
            [tenantId, id],
          ),
        );
      }

      return reply.send({ success: result.status === 'delivered', data: result });
    });
  };
}
