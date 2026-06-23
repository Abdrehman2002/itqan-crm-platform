import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope, requireEntitlement, requirePermission } from '../../middlewares/auth.middleware';
import { buildFileStorage } from '../../lib/file-storage';

const storage = buildFileStorage();
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// All merge fields available for DOCX templates
export const MERGE_FIELDS = [
  { field: '{{invoice_number}}',   description: 'Invoice number, e.g. INV-0042' },
  { field: '{{issue_date}}',       description: 'Date the invoice was issued' },
  { field: '{{due_date}}',         description: 'Payment due date' },
  { field: '{{currency}}',         description: 'Currency code, e.g. GBP' },
  { field: '{{subtotal}}',         description: 'Subtotal before tax' },
  { field: '{{tax}}',              description: 'Total tax amount' },
  { field: '{{total}}',            description: 'Grand total' },
  { field: '{{notes}}',            description: 'Invoice notes' },
  { field: '{{terms}}',            description: 'Payment terms' },
  { field: '{{client_name}}',      description: 'Billing contact name' },
  { field: '{{client_email}}',     description: 'Billing contact email' },
  { field: '{{client_company}}',   description: 'Billing contact company' },
  { field: '{{client_address}}',   description: 'Billing contact address' },
  { field: '{{company_name}}',     description: 'Your company name (from workspace settings)' },
  { field: '{{company_email}}',    description: 'Your company email' },
  { field: '{{company_address}}',  description: 'Your company address' },
  { field: '{{line_items_table}}', description: 'Full line items table (HTML block)' },
  { field: '{{po_reference}}',     description: 'Purchase order reference number' },
];


const SaveBuilderSchema = z.object({
  name:      z.string().min(1).max(100),
  layout:    z.array(z.any()).min(1),
  isDefault: z.boolean().optional(),
});

const UpdateSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  layout:    z.array(z.any()).optional(),
  isDefault: z.boolean().optional(),
});

export function invoiceTemplateRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    // Hard ceiling: workspace must be licensed for the Invoice Templates feature.
    fastify.addHook('preHandler', requireEntitlement('sales.templates'));

    // List merge fields — any authenticated user can view
    fastify.get('/merge-fields', { preHandler: [requireScope('contacts:read'), requirePermission('invoice_templates:read')] }, async (_req, reply) => {
      return reply.send({ success: true, data: MERGE_FIELDS });
    });

    // List templates for tenant
    fastify.get('/', { preHandler: [requireScope('billing:read'), requirePermission('invoice_templates:read')] }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const rows = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT id, name, type, is_default, file_name, created_at, updated_at,
                  CASE WHEN type='builder' THEN layout ELSE NULL END as layout
           FROM invoice_templates WHERE tenant_id=$1 ORDER BY is_default DESC, created_at DESC`,
          [tenantId]
        )
      );
      return reply.send({ success: true, data: rows });
    });

    // Save builder template
    fastify.post('/', { preHandler: [requireScope('billing:manage'), requirePermission('invoice_templates:manage')] }, async (req, reply) => {
      const body = SaveBuilderSchema.parse(req.body);
      const tenantId = req.tenant.id;

      const [row] = await db.withTenant(tenantId, async (client) => {
        if (body.isDefault) {
          await client.query(
            `UPDATE invoice_templates SET is_default=false WHERE tenant_id=$1`,
            [tenantId]
          );
        }
        const result = await client.query(
          `INSERT INTO invoice_templates (tenant_id, name, type, layout, is_default)
           VALUES ($1, $2, 'builder', $3, $4) RETURNING *`,
          [tenantId, body.name, JSON.stringify(body.layout), body.isDefault ?? false]
        );
        return result.rows;
      });
      return reply.status(201).send({ success: true, data: row });
    });

    // Update (rename, set default, update layout)
    fastify.patch('/:id', { preHandler: [requireScope('billing:manage'), requirePermission('invoice_templates:manage')] }, async (req, reply) => {
      const body = UpdateSchema.parse(req.body);
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;

      const sets: string[] = ['updated_at = NOW()'];
      const vals: unknown[] = [tenantId, id];

      if (body.name !== undefined)   { sets.push(`name=$${vals.length+1}`);   vals.push(body.name); }
      if (body.layout !== undefined) { sets.push(`layout=$${vals.length+1}`); vals.push(JSON.stringify(body.layout)); }
      if (body.isDefault === true) {
        await db.withTenant(tenantId, (client) =>
          client.query(`UPDATE invoice_templates SET is_default=false WHERE tenant_id=$1`, [tenantId])
        );
        sets.push(`is_default=true`);
      }

      const [row] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `UPDATE invoice_templates SET ${sets.join(',')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          vals
        );
        return result.rows;
      });
      if (!row) return reply.status(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: row });
    });

    // Delete
    fastify.delete('/:id', { preHandler: [requireScope('billing:manage'), requirePermission('invoice_templates:manage')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;

      const [tpl] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `DELETE FROM invoice_templates WHERE tenant_id=$1 AND id=$2 RETURNING file_path, type`,
          [tenantId, id]
        );
        return result.rows;
      });

      // Clean up stored file for DOCX templates so storage doesn't accumulate orphans
      if (tpl?.type === 'docx' && tpl.file_path) {
        await storage.remove(tpl.file_path).catch(() => { /* already gone — ignore */ });
      }

      return reply.send({ success: true });
    });

    // Upload DOCX template
    fastify.post('/upload', { preHandler: [requireScope('billing:manage'), requirePermission('invoice_templates:manage')] }, async (req, reply) => {
      const tenantId = req.tenant.id;

      const data = await req.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });

      const allowedTypes = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/html',
      ];
      if (!allowedTypes.includes(data.mimetype) && !data.filename.endsWith('.docx') && !data.filename.endsWith('.html')) {
        return reply.status(400).send({ success: false, error: 'Only .docx and .html files are accepted' });
      }

      const templateName = (req.query as any).name ?? data.filename.replace(/\.[^.]+$/, '');

      // storage.save() handles local filesystem or S3 depending on STORAGE_BACKEND env var
      const stored = await storage.save(data.file, data.filename, tenantId);

      const [row] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `INSERT INTO invoice_templates (tenant_id, name, type, file_path, file_name, is_default)
           VALUES ($1, $2, 'docx', $3, $4, false) RETURNING *`,
          [tenantId, templateName, stored.key, data.filename]
        );
        return result.rows;
      });

      return reply.status(201).send({ success: true, data: row });
    });

    // Render a DOCX template with invoice data — returns filled .docx binary
    fastify.post('/:id/render', { preHandler: [requireScope('billing:read'), requirePermission('invoice_templates:read')] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;

      const [tpl] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `SELECT * FROM invoice_templates WHERE tenant_id=$1 AND id=$2 AND type='docx'`,
          [tenantId, id]
        );
        return result.rows;
      });
      if (!tpl) return reply.status(404).send({ success: false, error: 'Template not found' });
      if (!tpl.file_path) return reply.status(400).send({ success: false, error: 'No file associated with this template' });

      // Invoice data to substitute — caller provides this in the request body
      const invoiceData = req.body as Record<string, unknown>;

      try {
        const content = await storage.load(tpl.file_path);
        const zip = new PizZip(content);

        // Collect every tag the template contains so we can diff against
        // the provided data and report missing fields precisely.
        const missingFields: string[] = [];

        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          // nullGetter: called for every tag that resolves to null/undefined.
          // Return empty string (graceful) but record the field as missing.
          nullGetter(part: any) {
            if (!part.module && part.value !== '') {
              missingFields.push(`{{${part.value}}}`);
            }
            return '';
          },
        });

        doc.render(invoiceData);

        // If any placeholders were not supplied, return 422 with the list
        // so the caller knows exactly which fields need to be provided.
        if (missingFields.length > 0) {
          const unique = [...new Set(missingFields)];
          return reply.status(422).send({
            success: false,
            error: 'Template contains fields that were not supplied in the request body.',
            missing_fields: unique,
          });
        }

        const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });

        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        reply.header('Content-Disposition', `attachment; filename="invoice-${invoiceData['invoice_number'] ?? 'draft'}.docx"`);
        return reply.send(buf);
      } catch (err: any) {
        // Docxtemplater throws a structured error with a list of problems
        // when it encounters malformed syntax (e.g. unclosed {{ or invalid loops).
        const dtErrors: string[] = err?.properties?.errors?.map((e: any) => e.message) ?? [];
        return reply.status(400).send({
          success: false,
          error: 'Template syntax error. Check that all merge fields use {{field}} syntax with no typos.',
          details: dtErrors.length > 0 ? dtErrors : [err.message],
        });
      }
    });
  };
}
