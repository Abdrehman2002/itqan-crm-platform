import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import type { EventBus } from '@crm/core';
import type { Currency, PaymentProvider } from '@crm/shared';
import { PLAN_PRICING } from '@crm/shared';
import { BillingService } from '../../../../modules/billing/src/billing.service';
import { requireRole } from '../middlewares/auth.middleware';

const CheckoutSchema = z.object({
  plan: z.enum(['starter', 'professional', 'enterprise']),
  billingCycle: z.enum(['monthly', 'annual']).default('monthly'),
  currency: z.enum(['USD', 'PKR', 'GBP', 'EUR', 'AED', 'SAR']),
  provider: z.enum(['stripe', 'wise', 'jazzcash', 'easypaisa', 'raast', 'paypal']),
  billingDetails: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    ntn: z.string().optional(),       // National Tax Number — Pakistan
    taxId: z.string().optional(),
    address: z.object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().length(2),  // ISO alpha-2: PK, US, GB, AE
    }).optional(),
  }),
});

export function billingRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {
    const billing = new BillingService(db, eventBus, process.env as any);

    // ── Available pricing ─────────────────────────────────────
    fastify.get('/pricing', async (req, reply) => {
      const { currency } = req.query as { currency?: Currency };

      const pricing = currency
        ? PLAN_PRICING.filter((p) => p.currency === currency)
        : PLAN_PRICING;

      // Attach which providers support each currency
      const currencies: Currency[] = ['USD', 'PKR', 'GBP', 'EUR', 'AED'];
      const providersByCurrency: Record<string, PaymentProvider[]> = {};
      for (const cur of currencies) {
        providersByCurrency[cur] = billing.getAvailableProviders(cur);
      }

      return reply.send({
        success: true,
        data: { pricing, providersByCurrency },
      });
    });

    // ── Create checkout session ───────────────────────────────
    fastify.post('/checkout', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = CheckoutSchema.parse(req.body);
      const baseUrl = `${req.protocol}://${req.headers.host}`;

      const result = await billing.createCheckoutSession({
        tenantId: req.tenant.id,
        plan: body.plan,
        billingCycle: body.billingCycle,
        currency: body.currency as Currency,
        provider: body.provider as PaymentProvider,
        billingDetails: body.billingDetails as any,
        baseUrl,
      });

      return reply.code(201).send({ success: true, data: result });
    });

    // ── Invoices list ─────────────────────────────────────────
    fastify.get('/invoices', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const invoices = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT * FROM invoices ORDER BY created_at DESC LIMIT 50`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: invoices });
    });

    // ── Download invoice PDF ──────────────────────────────────
    fastify.get('/invoices/:id/pdf', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [invoice] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT * FROM invoices WHERE id = $1', [id]);
        return result.rows;
      });
      if (!invoice) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });

      // Generate PDF — in production use puppeteer or a PDF service
      const html = generateInvoiceHtml(invoice, req.tenant);
      reply.header('Content-Type', 'text/html');
      reply.header('Content-Disposition', `attachment; filename="${invoice.invoice_number}.html"`);
      return reply.send(html);
    });

    // ── Current subscription ──────────────────────────────────
    fastify.get('/subscription', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const [sub] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT * FROM subscriptions WHERE status IN ('active','trialing','past_due') ORDER BY created_at DESC LIMIT 1`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: sub ?? null });
    });

    // ── Current plan usage vs limits ─────────────────────────
    fastify.get('/usage', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const plan     = req.tenant.plan;
      const limits   = req.tenant.settings?.limits as any ?? {};
      const period   = new Date().toISOString().slice(0, 7); // YYYY-MM

      const [counts] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(
          `SELECT
             (SELECT COUNT(*) FROM contacts)  AS contacts,
             (SELECT COUNT(*) FROM users)     AS seats,
             (SELECT COUNT(*) FROM pipelines) AS pipelines`,
        );
        return result.rows;
      });

      const usageRows = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT metric, value FROM usage_metrics
           WHERE tenant_id = $1 AND period = $2`,
          [tenantId, period],
        );
        return result.rows;
      });

      const usageMap: Record<string, number> = {};
      for (const row of usageRows) usageMap[row.metric] = Number(row.value);

      return reply.send({
        success: true,
        data: {
          plan,
          period,
          usage: [
            { key: 'contacts',           label: 'Contacts',           used: Number(counts.contacts),                limit: limits.contacts           ?? 0 },
            { key: 'seats',              label: 'Team Seats',          used: Number(counts.seats),                   limit: limits.seats              ?? 0 },
            { key: 'pipelines',          label: 'Pipelines',           used: Number(counts.pipelines),               limit: limits.pipelines          ?? 0 },
            { key: 'voiceMinutesPerMonth', label: 'Voice Minutes (mo)', used: usageMap.voiceMinutesPerMonth ?? 0,     limit: limits.voiceMinutesPerMonth ?? 0 },
            { key: 'apiCallsPerMonth',   label: 'API Calls (mo)',      used: usageMap.apiCallsPerMonth    ?? 0,     limit: limits.apiCallsPerMonth   ?? 0 },
          ],
        },
      });
    });

    // ── Cancel subscription ───────────────────────────────────
    fastify.post('/subscription/cancel', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const [sub] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT * FROM subscriptions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
        );
        return result.rows;
      });
      if (!sub) return reply.code(404).send({ success: false, error: { code: 'NO_SUBSCRIPTION', message: 'No active subscription' } });

      if (sub.provider === 'stripe' && sub.provider_subscription_id) {
        const adapter = billing.getAdapter('stripe');
        await adapter.cancelSubscription!(sub.provider_subscription_id);
      }

      await db.withTenant(req.tenant.id, async (client) => {
        await client.query(
          `UPDATE subscriptions SET cancel_at_period_end = true WHERE id = $1`,
          [sub.id],
        );
      });

      return reply.send({ success: true, message: 'Subscription will cancel at end of billing period' });
    });

    // ── Provider webhooks — single endpoint handles all providers ─
    fastify.post('/webhook/:provider', {
      config: { rawBody: true },
    }, async (req, reply) => {
      const { provider } = req.params as { provider: string };

      try {
        await billing.handleWebhook(
          provider as PaymentProvider,
          req.body,
          req.headers as Record<string, string>,
        );
        return reply.send({ received: true });
      } catch (err: any) {
        if (err.message.includes('signature')) {
          return reply.code(403).send({ error: 'Invalid signature' });
        }
        return reply.code(400).send({ error: err.message });
      }
    });

    // ── Update billing details (NTN/GST for Pakistan) ─────────
    fastify.put('/billing-details', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = req.body as any;
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants SET billing_details = $1::jsonb WHERE id = $2`,
          [JSON.stringify(body), req.tenant.id],
        );
      });
      return reply.send({ success: true });
    });

    // ── Payment history ───────────────────────────────────────
    fastify.get('/payments', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const payments = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT p.*, i.invoice_number FROM payments p
           LEFT JOIN invoices i ON p.invoice_id = i.id
           ORDER BY p.created_at DESC LIMIT 50`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: payments });
    });
  };
}

function generateInvoiceHtml(invoice: any, tenant: any): string {
  const isPKR = invoice.currency === 'PKR';
  const fmt = (n: number) => `${invoice.currency} ${(n / 100).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;
  const bd = invoice.billing_details ?? {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #1a1a1a; }
  .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .logo { font-size: 24px; font-weight: bold; color: #6366f1; }
  .status { padding: 4px 12px; border-radius: 20px; background: ${invoice.status === 'paid' ? '#d1fae5' : '#fef3c7'}; color: ${invoice.status === 'paid' ? '#065f46' : '#92400e'}; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th { background: #f8f7ff; padding: 10px 12px; text-align: left; font-size: 13px; color: #6366f1; border-bottom: 2px solid #e0e7ff; }
  td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
  .totals { margin-left: auto; width: 280px; }
  .totals td { border: none; padding: 6px 12px; }
  .total-row { font-weight: bold; font-size: 16px; background: #f8f7ff; }
  .footer { margin-top: 48px; font-size: 12px; color: #94a3b8; }
  .note { background: #fef9ec; border-left: 4px solid #f59e0b; padding: 12px 16px; font-size: 13px; margin: 16px 0; border-radius: 4px; }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">CRM Platform</div>
    <p style="font-size:13px;color:#64748b;margin-top:4px">your-crm-platform.com</p>
  </div>
  <div style="text-align:right">
    <h2 style="margin:0">INVOICE</h2>
    <p style="margin:4px 0;color:#64748b">${invoice.invoice_number}</p>
    <span class="status">${invoice.status.toUpperCase()}</span>
  </div>
</div>

<div style="display:flex;gap:40px;margin-bottom:32px">
  <div>
    <p style="font-size:12px;color:#94a3b8;margin:0">BILLED TO</p>
    <p style="margin:4px 0;font-weight:600">${bd.name ?? tenant.name}</p>
    <p style="margin:2px 0;font-size:14px">${bd.email ?? ''}</p>
    ${bd.address ? `<p style="margin:2px 0;font-size:14px">${bd.address.line1}, ${bd.address.city}, ${bd.address.country}</p>` : ''}
    ${bd.ntn ? `<p style="margin:2px 0;font-size:13px;color:#64748b">NTN: ${bd.ntn}</p>` : ''}
    ${bd.taxId ? `<p style="margin:2px 0;font-size:13px;color:#64748b">Tax ID: ${bd.taxId}</p>` : ''}
  </div>
  <div>
    <p style="font-size:12px;color:#94a3b8;margin:0">DETAILS</p>
    <p style="margin:4px 0;font-size:14px">Date: ${new Date(invoice.created_at).toLocaleDateString()}</p>
    <p style="margin:2px 0;font-size:14px">Due: ${new Date(invoice.due_at).toLocaleDateString()}</p>
    <p style="margin:2px 0;font-size:14px">Method: ${invoice.provider.toUpperCase()}</p>
  </div>
</div>

${isPKR ? `<div class="note">⚠️ GST Notice: This invoice includes 18% General Sales Tax (GST) as applicable under Pakistani Federal Board of Revenue (FBR) regulations for SaaS services. STRN: [Your STRN Number]</div>` : ''}

<table>
  <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
  <tbody>
    ${invoice.line_items.map((li: any) => `
    <tr>
      <td>${li.description}</td>
      <td>${li.quantity}</td>
      <td>${fmt(li.unitAmount)}</td>
      <td>${fmt(li.total)}</td>
    </tr>`).join('')}
  </tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td style="text-align:right">${fmt(invoice.subtotal)}</td></tr>
  ${invoice.tax > 0 ? `<tr><td>GST (${(invoice.tax_rate * 100).toFixed(0)}%)</td><td style="text-align:right">${fmt(invoice.tax)}</td></tr>` : ''}
  <tr class="total-row"><td>Total</td><td style="text-align:right">${fmt(invoice.total)}</td></tr>
  ${invoice.status === 'paid' ? `<tr><td style="color:#059669">Amount Paid</td><td style="text-align:right;color:#059669">${fmt(invoice.total)}</td></tr>` : ''}
</table>

<div class="footer">
  <p>CRM Platform — [Company Name] · [Address] · [City, Country]</p>
  <p>For billing queries: billing@yourcrm.com</p>
  ${isPKR ? '<p>Sales Tax Registration No (STRN): [Your STRN] · NTN: [Your NTN]</p>' : ''}
</div>
</body>
</html>`;
}
