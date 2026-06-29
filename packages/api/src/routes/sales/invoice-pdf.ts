// Server-side invoice rendering for "Export as PDF".
//
// Approach: we emit a fully styled, print-ready HTML document with a small
// onload script that calls window.print(). Modern browsers offer a built-in
// "Save as PDF" destination, so the user gets a real PDF without needing
// puppeteer / chromium / native binaries on the server. This matches the
// existing pattern in routes/billing.ts (#### generateInvoiceHtml), which
// the original author explicitly chose over puppeteer.
//
// If we later decide to render a true application/pdf binary, swap this for
// pdfkit (pure JS, no native deps) — the layout templates here translate
// directly to pdfkit drawing calls.

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireScope, requireEntitlement, requirePermission } from '../../middlewares/auth.middleware';

type Layout = 'classic' | 'minimal' | 'consulting';

// Mirror of frontend INVOICE_TEMPLATES — keep these two in sync.
// Each template id maps to one of three concrete visual layouts plus an accent.
const TEMPLATE_TO_LAYOUT: Record<string, { layout: Layout; accent: string }> = {
  'tpl-classic':      { layout: 'classic',    accent: '#2563eb' },
  'tpl-minimal':      { layout: 'minimal',    accent: '#0f172a' },
  'tpl-consulting':   { layout: 'consulting', accent: '#4f46e5' },
  'tpl-retail':       { layout: 'classic',    accent: '#f97316' },
  'tpl-construction': { layout: 'classic',    accent: '#d97706' },
  'tpl-medical':      { layout: 'minimal',    accent: '#0d9488' },
  'tpl-agency':       { layout: 'consulting', accent: '#9333ea' },
  'tpl-logistics':    { layout: 'classic',    accent: '#0284c7' },
};

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCurrency(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(amount ?? 0));
  } catch {
    return `${currency} ${Number(amount ?? 0).toFixed(2)}`;
  }
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return String(d); }
}

interface InvoiceCtx {
  inv: any;
  lineItems: any[];
  workspace: { name?: string; email?: string; address?: string };
  accent: string;
}

// ── Shared CSS + page chrome ─────────────────────────────────────────────────
function pageShell(title: string, accent: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #1f2937; margin: 0; background: #f3f4f6; }
  .sheet { max-width: 820px; margin: 24px auto; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); padding: 48px; }
  .accent { color: ${accent}; }
  .accent-bg { background: ${accent}; color: #fff; }
  table { width: 100%; border-collapse: collapse; }
  .muted { color: #6b7280; }
  .small { font-size: 12px; }
  .totals { width: 280px; margin-left: auto; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; color: #4b5563; }
  .totals .grand { border-top: 1px solid #e5e7eb; padding-top: 8px; font-weight: 700; color: #111827; font-size: 16px; }
  .totals .due { border-top: 1px solid #e5e7eb; padding-top: 8px; font-weight: 700; color: #dc2626; font-size: 16px; }
  .status-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; background: #e5e7eb; color: #374151; }
  .toolbar { max-width: 820px; margin: 0 auto; padding: 12px 0 0; text-align: right; }
  .toolbar button { background: ${accent}; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 600; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; margin: 0; padding: 0; max-width: none; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Save as PDF / Print</button></div>
  <div class="sheet">${body}</div>
  <script>
    // Auto-open the browser print dialog so the user can pick "Save as PDF".
    window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });
  </script>
</body>
</html>`;
}

function renderTotals(inv: any): string {
  const rows: string[] = [];
  rows.push(`<div class="row"><span>Subtotal</span><span>${fmtCurrency(inv.subtotal, inv.currency)}</span></div>`);
  rows.push(`<div class="row"><span>Tax</span><span>${fmtCurrency(inv.total_tax ?? 0, inv.currency)}</span></div>`);
  rows.push(`<div class="row grand"><span>Total</span><span>${fmtCurrency(inv.total, inv.currency)}</span></div>`);
  const amountPaid = Number(inv.amount_paid ?? 0);
  const amountDue = Number(inv.total) - amountPaid;
  if (amountPaid > 0) rows.push(`<div class="row" style="color:#059669"><span>Paid</span><span>-${fmtCurrency(amountPaid, inv.currency)}</span></div>`);
  if (amountDue > 0) rows.push(`<div class="row due"><span>Balance Due</span><span>${fmtCurrency(amountDue, inv.currency)}</span></div>`);
  return `<div class="totals">${rows.join('')}</div>`;
}

// ── CLASSIC layout ───────────────────────────────────────────────────────────
function renderClassic(ctx: InvoiceCtx): string {
  const { inv, lineItems, workspace, accent } = ctx;
  const initial = (workspace.name?.[0] ?? inv.contact_name?.[0] ?? '?').toString().toUpperCase();
  return pageShell(`Invoice ${inv.number}`, accent, `
    <div style="text-align:center;border-bottom:1px solid #e5e7eb;padding-bottom:24px;margin-bottom:32px;">
      <div style="width:64px;height:64px;border-radius:12px;background:${accent};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;">${escapeHtml(initial)}</div>
      ${workspace.name ? `<div style="font-size:18px;font-weight:700;margin-top:12px;">${escapeHtml(workspace.name)}</div>` : ''}
      <div class="small muted" style="text-transform:uppercase;letter-spacing:0.2em;margin-top:4px;">Invoice</div>
      <div class="accent" style="font-size:32px;font-weight:900;margin-top:4px;">${escapeHtml(inv.number)}</div>
    </div>

    <table style="margin-bottom:32px;"><tr>
      <td style="vertical-align:top;width:50%;">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Billed To</div>
        <div style="font-weight:600;">${escapeHtml(inv.contact_name ?? '')}</div>
        <div class="small muted">${escapeHtml(inv.contact_company ?? '')}</div>
        <div class="small muted">${escapeHtml(inv.contact_email ?? '')}</div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div class="small muted">Issue: <span style="color:#111827;font-weight:500;">${fmtDate(inv.issue_date)}</span></div>
        <div class="small muted">Due: <span style="color:#111827;font-weight:500;">${fmtDate(inv.due_date)}</span></div>
        ${inv.po_reference ? `<div class="small muted">PO: <span style="color:#111827;font-weight:500;">${escapeHtml(inv.po_reference)}</span></div>` : ''}
        <div style="margin-top:8px;"><span class="status-pill">${escapeHtml(inv.status)}</span></div>
      </td>
    </tr></table>

    <table style="margin-bottom:24px;font-size:13px;">
      <thead><tr style="background:#111827;color:#fff;">
        <th style="text-align:left;padding:10px 14px;border-radius:6px 0 0 6px;">Description</th>
        <th style="text-align:center;padding:10px 14px;">Qty</th>
        <th style="text-align:right;padding:10px 14px;">Unit Price</th>
        <th style="text-align:right;padding:10px 14px;">Tax</th>
        <th style="text-align:right;padding:10px 14px;border-radius:0 6px 6px 0;">Total</th>
      </tr></thead>
      <tbody>
        ${lineItems.map(li => `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:12px 14px;">${escapeHtml(li.description)}</td>
          <td style="padding:12px 14px;text-align:center;">${escapeHtml(li.quantity)}</td>
          <td style="padding:12px 14px;text-align:right;">${fmtCurrency(li.unit_price, inv.currency)}</td>
          <td style="padding:12px 14px;text-align:right;">${fmtCurrency(li.tax_amount, inv.currency)}</td>
          <td style="padding:12px 14px;text-align:right;font-weight:500;">${fmtCurrency(li.total, inv.currency)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    ${renderTotals(inv)}
    ${inv.notes ? `<div style="margin-top:32px;font-size:13px;color:#6b7280;"><div style="font-weight:600;color:#374151;margin-bottom:4px;">Notes</div>${escapeHtml(inv.notes)}</div>` : ''}
  `);
}

// ── MINIMAL layout ───────────────────────────────────────────────────────────
function renderMinimal(ctx: InvoiceCtx): string {
  const { inv, lineItems, workspace, accent } = ctx;
  return pageShell(`Invoice ${inv.number}`, accent, `
    <div style="border-top:4px solid ${accent};margin:-48px -48px 0;padding:40px 48px 0;">
      <table><tr>
        <td style="vertical-align:bottom;">
          <div style="font-size:26px;font-weight:300;color:#111827;">${escapeHtml(workspace.name ?? 'Invoice')}</div>
          <div class="small muted" style="text-transform:uppercase;letter-spacing:0.3em;margin-top:4px;">Statement of Charges</div>
        </td>
        <td style="text-align:right;vertical-align:bottom;">
          <div class="small muted" style="text-transform:uppercase;letter-spacing:0.18em;">No.</div>
          <div class="accent" style="font-size:22px;font-family:'Courier New',monospace;">${escapeHtml(inv.number)}</div>
        </td>
      </tr></table>
    </div>

    <div style="margin:40px 0 32px;font-size:13px;">
      <div class="muted">Billed to</div>
      <div style="font-weight:500;color:#111827;">${escapeHtml(inv.contact_name ?? '')}</div>
      ${inv.contact_company ? `<div style="color:#4b5563;">${escapeHtml(inv.contact_company)}</div>` : ''}
      ${inv.contact_email ? `<div class="muted">${escapeHtml(inv.contact_email)}</div>` : ''}
    </div>

    <table style="margin-bottom:24px;font-size:13px;"><tr>
      <td style="padding-right:32px;"><div class="small muted" style="text-transform:uppercase;letter-spacing:0.06em;">Issued</div><div>${fmtDate(inv.issue_date)}</div></td>
      <td style="padding-right:32px;"><div class="small muted" style="text-transform:uppercase;letter-spacing:0.06em;">Due</div><div>${fmtDate(inv.due_date)}</div></td>
      ${inv.po_reference ? `<td style="padding-right:32px;"><div class="small muted" style="text-transform:uppercase;letter-spacing:0.06em;">PO</div><div>${escapeHtml(inv.po_reference)}</div></td>` : ''}
      <td><div class="small muted" style="text-transform:uppercase;letter-spacing:0.06em;">Status</div><div><span class="status-pill">${escapeHtml(inv.status)}</span></div></td>
    </tr></table>

    <table style="margin-bottom:24px;font-size:13px;">
      <thead><tr style="border-bottom:1px solid ${accent};">
        <th style="text-align:left;padding:8px 0;text-transform:uppercase;letter-spacing:0.06em;font-size:11px;color:#9ca3af;font-weight:500;">Item</th>
        <th style="text-align:right;padding:8px 0;text-transform:uppercase;letter-spacing:0.06em;font-size:11px;color:#9ca3af;font-weight:500;">Amount</th>
      </tr></thead>
      <tbody>
        ${lineItems.map(li => `<tr style="border-bottom:1px solid #f9fafb;">
          <td style="padding:12px 0;">
            <div>${escapeHtml(li.description)}</div>
            <div class="small muted" style="margin-top:2px;">${escapeHtml(li.quantity)} × ${fmtCurrency(li.unit_price, inv.currency)}</div>
          </td>
          <td style="padding:12px 0;text-align:right;">${fmtCurrency(li.total, inv.currency)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    ${renderTotals(inv)}
    ${inv.notes ? `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #f3f4f6;font-size:13px;color:#6b7280;">${escapeHtml(inv.notes)}</div>` : ''}
  `);
}

// ── CONSULTING layout ────────────────────────────────────────────────────────
function renderConsulting(ctx: InvoiceCtx): string {
  const { inv, lineItems, workspace, accent } = ctx;
  const amountDue = Number(inv.total) - Number(inv.amount_paid ?? 0);
  return pageShell(`Invoice ${inv.number}`, accent, `
    <div style="margin:-48px -48px 32px;padding:32px 48px;background:linear-gradient(135deg, ${accent} 0%, ${accent}dd 100%);color:#fff;">
      <table><tr>
        <td style="vertical-align:top;">
          <div style="font-size:28px;font-weight:700;">${escapeHtml(workspace.name ?? 'Consulting Group')}</div>
          <div style="font-size:13px;font-style:italic;color:rgba(255,255,255,0.85);margin-top:4px;">Trusted advisory · Strategic counsel</div>
          ${workspace.email ? `<div class="small" style="color:rgba(255,255,255,0.75);margin-top:8px;">${escapeHtml(workspace.email)}</div>` : ''}
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div class="small" style="text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.75);">Statement</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px;">${escapeHtml(inv.number)}</div>
          <div style="margin-top:8px;display:inline-block;padding:4px 12px;background:rgba(255,255,255,0.2);border-radius:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(inv.status)}</div>
        </td>
      </tr></table>
    </div>

    <table style="margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #e5e7eb;"><tr>
      <td style="vertical-align:top;width:33%;padding-right:16px;">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Client</div>
        <div style="font-weight:600;">${escapeHtml(inv.contact_name ?? '')}</div>
        <div class="small" style="color:#4b5563;">${escapeHtml(inv.contact_company ?? '')}</div>
        <div class="small muted">${escapeHtml(inv.contact_email ?? '')}</div>
      </td>
      <td style="vertical-align:top;width:33%;padding-right:16px;">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Engagement</div>
        <div class="small" style="color:#4b5563;">Issue: <span style="color:#111827;">${fmtDate(inv.issue_date)}</span></div>
        <div class="small" style="color:#4b5563;">Due: <span style="color:#111827;">${fmtDate(inv.due_date)}</span></div>
        ${inv.po_reference ? `<div class="small" style="color:#4b5563;">Ref: <span style="color:#111827;">${escapeHtml(inv.po_reference)}</span></div>` : ''}
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">Amount Due</div>
        <div class="accent" style="font-size:28px;font-weight:700;">${fmtCurrency(amountDue, inv.currency)}</div>
        <div class="small muted" style="margin-top:2px;">${escapeHtml(inv.currency)}</div>
      </td>
    </tr></table>

    <table style="margin-bottom:24px;border-spacing:12px;border-collapse:separate;">
      ${(() => {
        const rows: string[] = [];
        for (let i = 0; i < lineItems.length; i += 2) {
          const a = lineItems[i];
          const b = lineItems[i + 1];
          const cell = (li: any) => li ? `<td style="vertical-align:top;width:50%;border:1px solid #e5e7eb;border-left:3px solid ${accent};border-radius:8px;padding:16px;">
            <div style="font-weight:500;font-size:13px;">${escapeHtml(li.description)}</div>
            <table style="margin-top:12px;font-size:11px;color:#6b7280;"><tr>
              <td>${escapeHtml(li.quantity)} × ${fmtCurrency(li.unit_price, inv.currency)}</td>
              <td style="text-align:right;font-weight:600;color:#111827;">${fmtCurrency(li.total, inv.currency)}</td>
            </tr></table>
          </td>` : '<td style="width:50%;"></td>';
          rows.push(`<tr>${cell(a)}${cell(b)}</tr>`);
        }
        return rows.join('');
      })()}
    </table>

    ${renderTotals(inv)}
    ${inv.notes ? `<div style="margin-top:24px;padding:16px;border-radius:8px;background:${accent}15;font-size:13px;">
      <div style="font-weight:600;color:#374151;margin-bottom:4px;">Engagement Notes</div>
      <div style="color:#4b5563;">${escapeHtml(inv.notes)}</div>
    </div>` : ''}
  `);
}

export function invoicePdfRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireEntitlement('sales.invoices'));

    fastify.get('/:id/pdf', {
      preHandler: [requireScope('contacts:read'), requirePermission('invoices:read')],
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.tenant.id;

      // BUG-AB (2026-06-29) — the original query referenced a `workspace_settings`
      // table that doesn't exist in this schema. Workspace name comes from the
      // `tenants` table directly. The redundant invoice_payments subquery is also
      // dropped since `invoices.amount_paid` is already maintained on the row.
      const [inv] = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT i.*,
                  bc.name    AS contact_name,
                  bc.email   AS contact_email,
                  bc.company AS contact_company,
                  bc.billing_address AS contact_billing_address,
                  t.name     AS workspace_name,
                  t.settings AS workspace_settings_json
           FROM invoices i
           LEFT JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           LEFT JOIN tenants          t  ON t.id  = i.tenant_id
           WHERE i.tenant_id = $1 AND i.id = $2`,
          [tenantId, id],
        ).then(r => r.rows),
      );
      if (!inv) return reply.status(404).send({ success: false, error: 'Invoice not found' });
      // Pull optional contact fields out of the workspace settings JSONB if present.
      const wsSettings: any = inv.workspace_settings_json ?? {};
      inv.workspace_email   = wsSettings.contactEmail   ?? wsSettings.email   ?? null;
      inv.workspace_address = wsSettings.contactAddress ?? wsSettings.address ?? null;

      const lineItems = await db.withTenant(tenantId, (client) =>
        client.query(`SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order`, [id]).then(r => r.rows),
      );

      const mapping = TEMPLATE_TO_LAYOUT[inv.template_id] ?? TEMPLATE_TO_LAYOUT['tpl-classic'];
      const ctx: InvoiceCtx = {
        inv,
        lineItems,
        workspace: {
          name: inv.workspace_name,
          email: inv.workspace_email,
          address: inv.workspace_address,
        },
        accent: mapping.accent,
      };

      let html: string;
      if (mapping.layout === 'minimal')         html = renderMinimal(ctx);
      else if (mapping.layout === 'consulting') html = renderConsulting(ctx);
      else                                      html = renderClassic(ctx);

      // We're returning text/html (not application/pdf): the page auto-triggers
      // window.print() so the user can save as PDF from the browser dialog.
      // This avoids adding puppeteer / chromium to the server image.
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Content-Disposition', `inline; filename="${inv.number}.html"`);
      return reply.send(html);
    });
  };
}
