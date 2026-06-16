import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../../middlewares/auth.middleware';

const SettingsSchema = z.object({
  invoicePrefix: z.string().optional(),
  nextInvoiceNumber: z.number().int().positive().optional(),
  defaultCurrency: z.string().optional(),
  defaultPaymentTerms: z.number().int().min(0).optional(),
  taxRates: z.array(z.object({ id: z.string(), name: z.string(), rate: z.number(), isDefault: z.boolean() })).optional(),
  bankAccounts: z.array(z.object({ id: z.string(), bankName: z.string(), accountName: z.string(), accountNumber: z.string(), ifsc: z.string().optional(), swift: z.string().optional(), iban: z.string().optional(), isDefault: z.boolean() })).optional(),
  paymentModes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), details: z.string().optional() })).optional(),
  smtpConfigured: z.boolean().optional(),
  companyName: z.string().optional(),
  companyEmail: z.string().optional(),
  companyPhone: z.string().optional(),
  companyAddress: z.record(z.unknown()).optional(),
  logoUrl: z.string().optional(),
});

const DEFAULT_SETTINGS = {
  invoice_prefix: 'INV-',
  next_invoice_number: 1,
  default_currency: 'USD',
  default_payment_terms: 30,
  tax_rates: [
    { id: 'tx-001', name: 'No Tax',   rate: 0,  isDefault: false },
    { id: 'tx-002', name: 'Tax 10%',  rate: 10, isDefault: true  },
    { id: 'tx-003', name: 'VAT 20%',  rate: 20, isDefault: false },
    { id: 'tx-004', name: 'GST 18%',  rate: 18, isDefault: false },
  ],
  bank_accounts: [],
  payment_modes: [
    { id: 'pm-001', name: 'Bank Transfer', type: 'bank_transfer' },
    { id: 'pm-002', name: 'Cash',          type: 'cash' },
    { id: 'pm-003', name: 'Cheque',        type: 'cheque' },
    { id: 'pm-004', name: 'Credit Card',   type: 'card' },
    { id: 'pm-005', name: 'UPI / PayNow',  type: 'upi' },
  ],
  smtp_configured: false,
};

export function salesSettingsRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const [row] = await db.withTenant(tenantId, async (client) =>
        (await client.query(`SELECT * FROM sales_settings WHERE tenant_id=$1`, [tenantId])).rows
      );
      return reply.send({ success: true, data: row ?? { ...DEFAULT_SETTINGS, tenant_id: tenantId } });
    });

    fastify.put('/', { preHandler: requireScope('contacts:write') }, async (req, reply) => {
      const body = SettingsSchema.parse(req.body);
      const tenantId = req.tenant.id;
      const fields: Record<string, unknown> = {};
      if (body.invoicePrefix !== undefined)       fields.invoice_prefix         = body.invoicePrefix;
      if (body.nextInvoiceNumber !== undefined)   fields.next_invoice_number    = body.nextInvoiceNumber;
      if (body.defaultCurrency !== undefined)     fields.default_currency       = body.defaultCurrency;
      if (body.defaultPaymentTerms !== undefined) fields.default_payment_terms  = body.defaultPaymentTerms;
      if (body.taxRates !== undefined)            fields.tax_rates              = JSON.stringify(body.taxRates);
      if (body.bankAccounts !== undefined)        fields.bank_accounts          = JSON.stringify(body.bankAccounts);
      if (body.paymentModes !== undefined)        fields.payment_modes          = JSON.stringify(body.paymentModes);
      if (body.smtpConfigured !== undefined)      fields.smtp_configured        = body.smtpConfigured;
      if (body.companyName !== undefined)         fields.company_name           = body.companyName;
      if (body.companyEmail !== undefined)        fields.company_email          = body.companyEmail;
      if (body.companyPhone !== undefined)        fields.company_phone          = body.companyPhone;
      if (body.companyAddress !== undefined)      fields.company_address        = JSON.stringify(body.companyAddress);
      if (body.logoUrl !== undefined)             fields.logo_url               = body.logoUrl;

      const keys = Object.keys(fields);
      const setClauses = [...keys.map((k, i) => `${k} = $${i + 2}`), 'updated_at = NOW()'].join(', ');
      const vals = [tenantId, ...Object.values(fields)];

      const [row] = await db.withTenant(tenantId, async (client) =>
        (await client.query(
          `INSERT INTO sales_settings (tenant_id, ${keys.join(', ')})
           VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
           ON CONFLICT (tenant_id) DO UPDATE SET ${setClauses}
           RETURNING *`,
          vals
        )).rows
      );
      return reply.send({ success: true, data: row });
    });
  };
}
