/**
 * Email routes
 *
 * POST   /api/v1/emails/send          — compose & send an email
 * POST   /api/v1/emails/test          — test the configured email connector
 * GET    /api/v1/emails               — list sent emails (paged, filterable)
 * GET    /api/v1/emails/:id           — single email detail
 * POST   /api/v1/emails/:id/resend    — re-send a failed email
 * DELETE /api/v1/emails/:id           — soft-delete / archive
 *
 * GET    /api/v1/emails/templates     — list email templates
 * POST   /api/v1/emails/templates     — create template
 * PUT    /api/v1/emails/templates/:id — update template
 * DELETE /api/v1/emails/templates/:id — delete template
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope } from '../middlewares/auth.middleware';
import { EmailService } from '../services/email.service';

// ── Validation schemas ─────────────────────────────────────────────────────

const SendSchema = z.object({
  to:        z.union([z.string().email(), z.array(z.string().email())]),
  toName:    z.string().optional(),
  subject:   z.string().min(1).max(998),
  bodyHtml:  z.string().optional(),
  bodyText:  z.string().optional(),
  cc:        z.array(z.string().email()).optional(),
  bcc:       z.array(z.string().email()).optional(),
  replyTo:   z.string().email().optional(),
  // CRM context
  contactId: z.string().uuid().optional(),
  dealId:    z.string().uuid().optional(),
  ticketId:  z.string().uuid().optional(),
}).refine((d) => d.bodyHtml || d.bodyText, {
  message: 'At least one of bodyHtml or bodyText is required',
});

const TemplateSchema = z.object({
  name:      z.string().min(1).max(100),
  subject:   z.string().min(1).max(998),
  bodyHtml:  z.string().min(1),
  bodyText:  z.string().optional(),
  category:  z.enum(['general','ticket_opened','ticket_resolved','deal_won','contact_welcome']).default('general'),
});

// ── Route factory ──────────────────────────────────────────────────────────

export function emailRoutes(db: DatabaseClient, eventBus: EventBus) {
  const emailSvc = new EmailService(db);

  return async function (fastify: FastifyInstance) {

    // ── Send ────────────────────────────────────────────────────────────
    fastify.post('/send', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const body = SendSchema.parse(req.body);

      const result = await emailSvc.send(req.tenant.id, {
        ...body,
        sentBy: req.user.id,
      });

      if (result.status === 'delivered') {
        eventBus.publish(CRM_EVENTS.ACTIVITY_CREATED, {
          tenantId: req.tenant.id,
          type: 'email',
          emailId: result.emailId,
        }).catch(() => {});
      }

      const statusCode = result.status === 'delivered' ? 200 : 422;
      return reply.code(statusCode).send({ success: result.status === 'delivered', data: result });
    });

    // ── Test connector ──────────────────────────────────────────────────
    fastify.post('/test', { preHandler: requireScope('settings:write') }, async (req, reply) => {
      const result = await emailSvc.testConnection(req.tenant.id);
      return reply.send({ success: result.ok, message: result.message });
    });

    // ── List emails ─────────────────────────────────────────────────────
    fastify.get('/', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const {
        contactId, dealId, ticketId, status, sentBy,
        search, page = 1, pageSize = 25,
      } = req.query as Record<string, string>;

      const offset = (Number(page) - 1) * Number(pageSize);

      const emails = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT e.*,
             c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
             u.name AS sent_by_name
           FROM emails e
           LEFT JOIN contacts c ON e.contact_id = c.id
           LEFT JOIN users u ON e.sent_by = u.id
           WHERE e.status != 'archived'
           ${contactId ? `AND e.contact_id = '${contactId}'` : ''}
           ${dealId    ? `AND e.deal_id    = '${dealId}'`    : ''}
           ${ticketId  ? `AND e.ticket_id  = '${ticketId}'`  : ''}
           ${status    ? `AND e.status     = '${status}'`    : ''}
           ${sentBy    ? `AND e.sent_by    = '${sentBy}'`    : ''}
           ${search    ? `AND (e.subject ILIKE '%${search.replace(/'/g, "''")}%'
                           OR e.to_email ILIKE '%${search.replace(/'/g, "''")}%'
                           OR e.from_email ILIKE '%${search.replace(/'/g, "''")}%')` : ''}
           ORDER BY e.created_at DESC
           LIMIT $1 OFFSET $2`,
          [Number(pageSize), offset],
        );

        const cnt = await client.query(
          `SELECT COUNT(*) FROM emails e
           WHERE e.status != 'archived'
           ${contactId ? `AND e.contact_id = '${contactId}'` : ''}
           ${dealId    ? `AND e.deal_id    = '${dealId}'`    : ''}
           ${ticketId  ? `AND e.ticket_id  = '${ticketId}'`  : ''}
           ${status    ? `AND e.status     = '${status}'`    : ''}
           ${sentBy    ? `AND e.sent_by    = '${sentBy}'`    : ''}
           ${search    ? `AND (e.subject ILIKE '%${search.replace(/'/g, "''")}%'
                           OR e.to_email ILIKE '%${search.replace(/'/g, "''")}%'
                           OR e.from_email ILIKE '%${search.replace(/'/g, "''")}%')` : ''}`,
        );

        return { rows: r.rows, total: parseInt(cnt.rows[0].count) };
      });

      return reply.send({
        success: true,
        data: emails.rows,
        meta: { total: emails.total, page: Number(page), pageSize: Number(pageSize) },
      });
    });

    // ── Single email ────────────────────────────────────────────────────
    fastify.get('/:id', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };

      const [email] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT e.*,
             c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
             c.email AS contact_email,
             u.name AS sent_by_name,
             d.name AS deal_name
           FROM emails e
           LEFT JOIN contacts c ON e.contact_id = c.id
           LEFT JOIN users u ON e.sent_by = u.id
           LEFT JOIN deals d ON e.deal_id = d.id
           WHERE e.id = $1`,
          [id],
        );
        return r.rows;
      });

      if (!email) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      return reply.send({ success: true, data: email });
    });

    // ── Resend ──────────────────────────────────────────────────────────
    fastify.post('/:id/resend', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };

      const [email] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query('SELECT * FROM emails WHERE id = $1', [id]);
        return r.rows;
      });

      if (!email) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      if (email.status === 'delivered') {
        return reply.code(400).send({ success: false, error: { code: 'ALREADY_SENT', message: 'Email already delivered' } });
      }

      const result = await emailSvc.send(req.tenant.id, {
        to: email.to_email,
        toName: email.to_name,
        subject: email.subject,
        bodyHtml: email.body_html,
        bodyText: email.body_text,
        cc: email.cc,
        bcc: email.bcc,
        replyTo: email.reply_to,
        contactId: email.contact_id,
        dealId: email.deal_id,
        ticketId: email.ticket_id,
        sentBy: req.user.id,
      });

      return reply.send({ success: result.status === 'delivered', data: result });
    });

    // ── Archive / delete ────────────────────────────────────────────────
    fastify.delete('/:id', { preHandler: requireScope('activities:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query(
          `UPDATE emails SET status = 'archived', updated_at = NOW() WHERE id = $1`,
          [id],
        );
      });
      return reply.send({ success: true });
    });

    // ── Templates ───────────────────────────────────────────────────────

    fastify.get('/templates', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const templates = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT t.*, u.name AS created_by_name FROM email_templates t
           LEFT JOIN users u ON t.created_by = u.id
           ORDER BY t.category, t.name`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: templates });
    });

    fastify.post('/templates', { preHandler: requireScope('settings:write') }, async (req, reply) => {
      const body = TemplateSchema.parse(req.body);
      const [tmpl] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `INSERT INTO email_templates (tenant_id, name, subject, body_html, body_text, category, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [req.tenant.id, body.name, body.subject, body.bodyHtml, body.bodyText ?? null, body.category, req.user.id],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: tmpl });
    });

    fastify.put('/templates/:id', { preHandler: requireScope('settings:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = TemplateSchema.partial().parse(req.body);

      const sets: string[] = [];
      const vals: unknown[] = [];
      let n = 1;
      if (body.name      !== undefined) { sets.push(`name = $${n++}`);       vals.push(body.name); }
      if (body.subject   !== undefined) { sets.push(`subject = $${n++}`);    vals.push(body.subject); }
      if (body.bodyHtml  !== undefined) { sets.push(`body_html = $${n++}`);  vals.push(body.bodyHtml); }
      if (body.bodyText  !== undefined) { sets.push(`body_text = $${n++}`);  vals.push(body.bodyText); }
      if (body.category  !== undefined) { sets.push(`category = $${n++}`);   vals.push(body.category); }
      sets.push(`updated_at = NOW()`);

      const [tmpl] = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `UPDATE email_templates SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
          [...vals, id],
        );
        return r.rows;
      });

      if (!tmpl) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      return reply.send({ success: true, data: tmpl });
    });

    fastify.delete('/templates/:id', { preHandler: requireScope('settings:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM email_templates WHERE id = $1', [id]);
      });
      return reply.send({ success: true });
    });

    // ── SendGrid event webhook (public — no auth) ──────────────────────
    // POST /api/v1/emails/webhook/sendgrid
    // Receives delivery/open/click/bounce events from SendGrid
    fastify.post('/webhook/sendgrid', async (req, reply) => {
      // Verify SendGrid ECDSA webhook signature to prevent forged event payloads.
      // Signature verification uses the public key from SENDGRID_WEBHOOK_PUBLIC_KEY env var.
      const webhookPublicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
      if (webhookPublicKey) {
        const signature  = req.headers['x-twilio-email-event-webhook-signature'] as string;
        const timestamp  = req.headers['x-twilio-email-event-webhook-timestamp'] as string;
        if (!signature || !timestamp) {
          return reply.code(401).send({ ok: false, error: 'Missing webhook signature headers' });
        }
        try {
          const crypto = await import('node:crypto');
          const payload = timestamp + JSON.stringify(req.body);
          const verify  = crypto.createVerify('SHA256');
          verify.update(payload);
          const isValid = verify.verify(
            { key: webhookPublicKey, format: 'pem' },
            signature,
            'base64',
          );
          if (!isValid) {
            return reply.code(401).send({ ok: false, error: 'Invalid webhook signature' });
          }
        } catch {
          return reply.code(401).send({ ok: false, error: 'Signature verification failed' });
        }
      }
      // If SENDGRID_WEBHOOK_PUBLIC_KEY is not set, log a security warning but continue
      // (allows the feature to work during initial setup before key is configured).
      else {
        req.log?.warn?.('SENDGRID_WEBHOOK_PUBLIC_KEY not set — webhook signature verification skipped');
      }

      const events = req.body as Array<{
        sg_message_id?: string;  // provider_id stored without trailing .filter0 suffix
        event: string;           // delivered | open | click | bounce | spamreport | unsubscribe | dropped
        timestamp?: number;
        url?: string;
      }>;

      if (!Array.isArray(events)) return reply.code(400).send({ ok: false });

      // Process each event; look up email record by provider_id
      await db.withSuperAdmin(async (client) => {
        for (const ev of events) {
          const rawId = ev.sg_message_id ?? '';
          // SendGrid appends .filter0 etc — strip everything after first dot or dot+numbers
          const providerId = rawId.split('.filter')[0].split('.')[0] || rawId;

          if (!providerId) continue;

          const ts = ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : new Date().toISOString();

          switch (ev.event) {
            case 'delivered':
              await client.query(
                `UPDATE emails SET status = 'delivered', updated_at = NOW()
                 WHERE provider_id = $1 AND status IN ('queued','sending')`,
                [providerId],
              );
              break;

            case 'open':
              await client.query(
                `UPDATE emails SET opened_at = COALESCE(opened_at, $2), updated_at = NOW()
                 WHERE provider_id = $1`,
                [providerId, ts],
              );
              break;

            case 'click':
              await client.query(
                `UPDATE emails SET clicked_at = COALESCE(clicked_at, $2), updated_at = NOW()
                 WHERE provider_id = $1`,
                [providerId, ts],
              );
              break;

            case 'bounce':
            case 'dropped':
              await client.query(
                `UPDATE emails SET status = 'bounced', updated_at = NOW()
                 WHERE provider_id = $1`,
                [providerId],
              );
              break;

            case 'spamreport':
            case 'unsubscribe':
              // Mark as bounced so we don't resend; optionally could set a contact flag
              await client.query(
                `UPDATE emails SET status = 'bounced', updated_at = NOW()
                 WHERE provider_id = $1`,
                [providerId],
              );
              break;

            default:
              break;
          }
        }
      });

      return reply.send({ ok: true });
    });

    // ── Generic SMTP open-tracking pixel (public) ───────────────────────
    // GET /api/v1/emails/track/open/:emailId
    fastify.get('/track/open/:emailId', async (req, reply) => {
      const { emailId } = req.params as { emailId: string };
      // Fire-and-forget update; don't wait
      db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE emails SET opened_at = COALESCE(opened_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [emailId],
        );
      }).catch(() => {});

      // Return 1×1 transparent GIF
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      reply.header('Content-Type', 'image/gif').header('Cache-Control', 'no-store').send(gif);
    });
  };
}
