import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireScope } from '../../middlewares/auth.middleware';

export function salesDashboardRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', { preHandler: requireScope('contacts:read') }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const q = (sql: string, params: unknown[]) =>
        db.withTenant(tenantId, async (client) => (await client.query(sql, params)).rows);

      const [totals] = await q(
        `SELECT
             COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled') THEN amount_due ELSE 0 END), 0) AS total_receivable,
             COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount_due ELSE 0 END), 0) AS overdue_amount,
             COALESCE(SUM(CASE WHEN status = 'draft' THEN total ELSE 0 END), 0) AS draft_amount,
             COUNT(*) FILTER (WHERE status = 'draft')     AS draft_count,
             COUNT(*) FILTER (WHERE status = 'sent')      AS sent_count,
             COUNT(*) FILTER (WHERE status = 'viewed')    AS viewed_count,
             COUNT(*) FILTER (WHERE status = 'partial')   AS partial_count,
             COUNT(*) FILTER (WHERE status = 'paid')      AS paid_count,
             COUNT(*) FILTER (WHERE status = 'overdue')   AS overdue_count,
             COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count
           FROM invoices WHERE tenant_id = $1`,
        [tenantId]
      );

      const paidThisMonth = await q(
        `SELECT COALESCE(SUM(amount),0) AS paid
           FROM invoice_payments
           WHERE tenant_id=$1 AND date_trunc('month', payment_date) = date_trunc('month', NOW())`,
        [tenantId]
      );

      // Aging buckets (open invoices only)
      const aging = await q(
        `SELECT
             CASE
               WHEN due_date >= CURRENT_DATE                         THEN 'Current'
               WHEN due_date >= CURRENT_DATE - INTERVAL '30 days'   THEN '1-30 days'
               WHEN due_date >= CURRENT_DATE - INTERVAL '60 days'   THEN '31-60 days'
               WHEN due_date >= CURRENT_DATE - INTERVAL '90 days'   THEN '61-90 days'
               ELSE '90+ days'
             END AS bucket,
             COALESCE(SUM(amount_due),0) AS amount,
             COUNT(*) AS count
           FROM invoices
           WHERE tenant_id=$1 AND status NOT IN ('paid','cancelled') AND amount_due > 0
           GROUP BY 1`,
        [tenantId]
      );

      // Top customers by total invoiced
      const topCustomers = await q(
        `SELECT bc.id, bc.name, SUM(i.total) AS amount, COUNT(i.id) AS invoice_count
           FROM invoices i JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           WHERE i.tenant_id=$1 AND i.status = 'paid'
           GROUP BY bc.id, bc.name ORDER BY amount DESC LIMIT 5`,
        [tenantId]
      );

      // Top defaulters (most amount due, overdue/partial)
      const topDefaulters = await q(
        `SELECT bc.id, bc.name, SUM(i.amount_due) AS amount, COUNT(i.id) AS invoice_count
           FROM invoices i JOIN billing_contacts bc ON bc.id = i.billing_contact_id
           WHERE i.tenant_id=$1 AND i.status IN ('overdue','partial')
           GROUP BY bc.id, bc.name ORDER BY amount DESC LIMIT 5`,
        [tenantId]
      );

      // Monthly revenue (last 6 months)
      const monthly = await q(
        `SELECT to_char(date_trunc('month', issue_date),'Mon') AS month,
                  COALESCE(SUM(total),0) AS invoiced,
                  COALESCE(SUM(amount_paid),0) AS collected
           FROM invoices WHERE tenant_id=$1 AND issue_date >= NOW() - INTERVAL '6 months'
           GROUP BY 1, date_trunc('month', issue_date)
           ORDER BY date_trunc('month', issue_date)`,
        [tenantId]
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
