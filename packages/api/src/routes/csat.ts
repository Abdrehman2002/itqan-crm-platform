/**
 * CSAT (Customer Satisfaction) routes
 *
 * Public endpoints — no auth required (token-based access):
 *   GET  /public/csat/:token          — get survey info (ticket subject, company name)
 *   POST /public/csat/:token          — submit rating (1–5) + optional comment
 *
 * Protected endpoints (agents / managers):
 *   GET  /api/v1/tickets/csat/summary — overall CSAT score + response rate for tenant
 *   GET  /api/v1/tickets/csat         — paginated list of all survey responses
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';

const SubmitSchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

// ── Public handler (registered at /public/csat) ───────────────────────────
export function csatPublicRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    // GET /public/csat/:token — fetch survey metadata so the page can render
    fastify.get('/:token', async (req, reply) => {
      const { token } = req.params as { token: string };

      const [survey] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT cs.id, cs.ticket_id, cs.reporter_name, cs.rating, cs.responded_at,
                  cs.expires_at,
                  t.ticket_number, t.subject, t.resolved_at,
                  ten.name AS company_name
           FROM   csat_surveys cs
           JOIN   tickets t  ON t.id  = cs.ticket_id
           JOIN   tenants ten ON ten.id = cs.tenant_id
           WHERE  cs.token = $1`,
          [token],
        );
        return r.rows;
      });

      if (!survey) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Survey not found' } });
      if (new Date(survey.expires_at) < new Date()) {
        return reply.code(410).send({ success: false, error: { code: 'EXPIRED', message: 'This survey has expired' } });
      }

      return reply.send({
        success: true,
        data: {
          ticketNumber:  survey.ticket_number,
          subject:       survey.subject,
          companyName:   survey.company_name,
          reporterName:  survey.reporter_name,
          alreadyRated:  !!survey.rating,
          rating:        survey.rating ?? null,
        },
      });
    });

    // POST /public/csat/:token — submit the rating
    fastify.post('/:token', async (req, reply) => {
      const { token } = req.params as { token: string };
      const body = SubmitSchema.parse(req.body);

      const [survey] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT cs.*, t.subject, t.ticket_number, ten.id AS tenant_id
           FROM   csat_surveys cs
           JOIN   tickets t   ON t.id   = cs.ticket_id
           JOIN   tenants ten ON ten.id  = cs.tenant_id
           WHERE  cs.token = $1`,
          [token],
        );
        return r.rows;
      });

      if (!survey) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Survey not found' } });
      if (new Date(survey.expires_at) < new Date()) {
        return reply.code(410).send({ success: false, error: { code: 'EXPIRED', message: 'This survey has expired' } });
      }
      if (survey.responded_at) {
        return reply.code(409).send({ success: false, error: { code: 'ALREADY_SUBMITTED', message: 'You have already submitted this survey' } });
      }

      // Persist response
      await db.withSuperAdmin(async (c) => {
        await c.query(
          `UPDATE csat_surveys
           SET rating = $1, comment = $2, responded_at = NOW()
           WHERE token = $3`,
          [body.rating, body.comment ?? null, token],
        );

        // Audit log entry
        await c.query(
          `INSERT INTO ticket_audit_log
             (tenant_id, ticket_id, actor_id, action, new_value, meta)
           VALUES ($1, $2, NULL, 'csat_received', $3::jsonb, $4::jsonb)`,
          [
            survey.tenant_id,
            survey.ticket_id,
            JSON.stringify({ rating: body.rating, comment: body.comment }),
            JSON.stringify({ surveyId: survey.id }),
          ],
        );
      });

      await eventBus.publish(survey.tenant_id, CRM_EVENTS.CSAT_RECEIVED, {
        ticketId:  survey.ticket_id,
        surveyId:  survey.id,
        rating:    body.rating,
        comment:   body.comment,
      });

      return reply.send({ success: true, data: { message: 'Thank you for your feedback!' } });
    });
  };
}

// ── Protected CSAT summary (registered under /api/v1/tickets/csat) ────────
export function csatProtectedRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    const preHandler = [requireScope('tickets:read')];

    // GET /api/v1/tickets/csat/summary
    fastify.get('/summary', { preHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;

      const [stats] = await db.withTenant(tenantId, async (c) => {
        const r = await c.query(`
          SELECT
            COUNT(*)                                           AS total_sent,
            COUNT(*) FILTER (WHERE responded_at IS NOT NULL)  AS total_responses,
            ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL), 2)::float8 AS avg_rating,
            COUNT(*) FILTER (WHERE rating = 5)                AS rating_5,
            COUNT(*) FILTER (WHERE rating = 4)                AS rating_4,
            COUNT(*) FILTER (WHERE rating = 3)                AS rating_3,
            COUNT(*) FILTER (WHERE rating = 2)                AS rating_2,
            COUNT(*) FILTER (WHERE rating = 1)                AS rating_1
          FROM csat_surveys
        `);
        return r.rows;
      });

      const responseRate = stats.total_sent > 0
        ? Math.round((stats.total_responses / stats.total_sent) * 100)
        : 0;

      return reply.send({ success: true, data: { ...stats, responseRate } });
    });

    // GET /api/v1/tickets/csat — list responses with pagination
    fastify.get('/', { preHandler }, async (req, reply) => {
      const { page = 1, pageSize = 25, rated } = req.query as any;
      const offset = (page - 1) * pageSize;
      const tenantId = req.tenant.id;

      const rows = await db.withTenant(tenantId, async (c) => {
        const r = await c.query(`
          SELECT cs.id, cs.rating, cs.comment, cs.responded_at, cs.sent_at,
                 cs.reporter_name, cs.reporter_email,
                 t.ticket_number, t.subject, t.id AS ticket_id
          FROM   csat_surveys cs
          JOIN   tickets t ON t.id = cs.ticket_id
          WHERE  ($1::boolean IS NULL OR (cs.responded_at IS NOT NULL) = $1)
          ORDER BY cs.sent_at DESC
          LIMIT $2 OFFSET $3
        `, [rated ?? null, pageSize, offset]);
        return r.rows;
      });

      return reply.send({ success: true, data: rows });
    });
  };
}
