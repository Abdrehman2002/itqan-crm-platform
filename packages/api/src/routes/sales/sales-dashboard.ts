import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../../middlewares/auth.middleware';

export function salesDashboardRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const q = req.query as { from?: string; to?: string };
      const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : null;
      const to   = q.to   && /^\d{4}-\d{2}-\d{2}$/.test(q.to)   ? q.to   : null;
      const rangeClause = from && to ? `AND i.issue_date >= $2::date AND i.issue_date <= $3::date` : '';
      const rangeParams: unknown[] = from && to ? [from, to] : [];

      const [totals] = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT
             COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled') THEN i.total - COALESCE(p.paid, 0) ELSE 0 END), 0) AS total_receivable,
             COALESCE(SUM(CASE WHEN status = 'overdue' THEN i.total - COALESCE(p.paid, 0) ELSE 0 END), 0) AS overdue_amount,
             COALESCE(SUM(CASE WHEN status = 'draft' THEN i.total ELSE 0 END), 0) AS draft_amount,
             COUNT(*) FILTER (WHERE i.status = 'draft')     AS draft_count,
             COUNT(*) FILTER (WHERE i.status = 'sent')      AS sent_count,
             COUNT(*) FILTER (WHERE i.status = 'viewed')    AS viewed_count,
             COUNT(*) FILTER (WHERE i.status = 'partial')   AS partial_count,
             COUNT(*) FILTER (WHERE i.status = 'paid')      AS paid_count,
             COUNT(*) FILTER (WHERE i.status = 'overdue')   AS overdue_count,
             COUNT(*) FILTER (WHERE i.status = 'cancelled') AS cancelled_count
           FROM invoices i
           LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id = i.id
           WHERE i.tenant_id = $1 ${rangeClause}`,
          [tenantId, ...rangeParams]
        ).then(r => r.rows)
      );

      const paidThisMonth = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT COALESCE(SUM(amount),0) AS paid
           FROM invoice_payments
           WHERE tenant_id=$1 AND date_trunc('month', payment_date) = date_trunc('month', NOW())`,
          [tenantId]
        ).then(r => r.rows)
      );

      // Aging buckets (open invoices only)
      const aging = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT
             CASE
               WHEN due_date >= CURRENT_DATE                         THEN 'Current'
               WHEN due_date >= CURRENT_DATE - INTERVAL '30 days'   THEN '1-30 days'
               WHEN due_date >= CURRENT_DATE - INTERVAL '60 days'   THEN '31-60 days'
               WHEN due_date >= CURRENT_DATE - INTERVAL '90 days'   THEN '61-90 days'
               ELSE '90+ days'
             END AS bucket,
             COALESCE(SUM(i.total - COALESCE(p.paid, 0)),0) AS amount,
             COUNT(*) AS count
           FROM invoices i
           LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id = i.id
           WHERE i.tenant_id=$1 AND i.status NOT IN ('paid','cancelled') AND (i.total - COALESCE(p.paid, 0)) > 0
           GROUP BY 1`,
          [tenantId]
        ).then(r => r.rows)
      );

      // Top customers by total invoiced
      const topCustomers = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT bc.id, bc.name, SUM(i.total) AS amount, COUNT(i.id) AS invoice_count
           FROM invoices i JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           WHERE i.tenant_id=$1 AND i.status = 'paid'
           GROUP BY bc.id, bc.name ORDER BY amount DESC LIMIT 5`,
          [tenantId]
        ).then(r => r.rows)
      );

      // Top defaulters (most amount due, overdue/partial)
      const topDefaulters = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT bc.id, bc.name, SUM(i.total - COALESCE(p.paid, 0)) AS amount, COUNT(i.id) AS invoice_count
           FROM invoices i
           LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id = i.id
           JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           WHERE i.tenant_id=$1 AND i.status IN ('overdue','partial')
           GROUP BY bc.id, bc.name ORDER BY amount DESC LIMIT 5`,
          [tenantId]
        ).then(r => r.rows)
      );

      // Monthly revenue (custom range when from/to provided, else last 6 months)
      const monthlyRangeClause = from && to
        ? `AND i.issue_date >= $2::date AND i.issue_date <= $3::date`
        : `AND i.issue_date >= NOW() - INTERVAL '6 months'`;
      const monthlyParams: unknown[] = from && to ? [tenantId, from, to] : [tenantId];
      const monthly = await db.withTenant(tenantId, (client) =>
        client.query(
          `SELECT to_char(date_trunc('month', i.issue_date),'Mon') AS month,
                  COALESCE(SUM(i.total),0) AS invoiced,
                  COALESCE(SUM(COALESCE(p.paid, 0)),0) AS collected
           FROM invoices i
           LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id = i.id
           WHERE i.tenant_id=$1 ${monthlyRangeClause}
           GROUP BY 1, date_trunc('month', i.issue_date)
           ORDER BY date_trunc('month', i.issue_date)`,
          monthlyParams
        ).then(r => r.rows)
      );

      return reply.send({
        success: true,
        data: {
          totalReceivable: Number(totals.total_receivable),
          overdueAmount:   Number(totals.overdue_amount),
          draftAmount:     Number(totals.draft_amount),
          paidThisMonth:   Number(paidThisMonth[0]?.paid ?? 0),
          invoicesByStatus: {
            draft:     Number(totals.draft_count),
            sent:      Number(totals.sent_count),
            viewed:    Number(totals.viewed_count),
            partial:   Number(totals.partial_count),
            paid:      Number(totals.paid_count),
            overdue:   Number(totals.overdue_count),
            cancelled: Number(totals.cancelled_count),
          },
          agingBuckets:  aging.map((r: any) => ({ label: r.bucket, amount: Number(r.amount), count: Number(r.count) })),
          topCustomers:  topCustomers.map((r: any) => ({ contactId: r.id, name: r.name, amount: Number(r.amount), invoiceCount: Number(r.invoice_count) })),
          topDefaulters: topDefaulters.map((r: any) => ({ contactId: r.id, name: r.name, amount: Number(r.amount), invoiceCount: Number(r.invoice_count) })),
          monthlyRevenue: monthly.map((r: any) => ({ month: r.month, invoiced: Number(r.invoiced), collected: Number(r.collected) })),
        },
      });
    });
  };
}
