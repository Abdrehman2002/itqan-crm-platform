import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import type { DatabaseClient, EventBus } from '@crm/core';
import { requireFeature, requireScope } from '../middlewares/auth.middleware';
import { enqueueWebhookDelivery } from '../lib/webhook-worker';

const WebhookSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  headers: z.record(z.string()).optional(),
  retryPolicy: z.object({
    maxRetries: z.number().min(0).max(10).default(3),
    backoffMs: z.number().default(1000),
  }).optional(),
});

export function webhookRoutes(db: DatabaseClient, _eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {
    const preHandler = [requireFeature('webhooks'), requireScope('webhooks:manage')];

    fastify.get('/', { preHandler }, async (req, reply) => {
      const webhooks = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT id, name, url, events, is_active, created_at FROM webhooks ORDER BY created_at DESC');
        return result.rows;
      });
      return reply.send({ success: true, data: webhooks });
    });

    fastify.post('/', { preHandler }, async (req, reply) => {
      const body = WebhookSchema.parse(req.body);
      const secret = crypto.randomBytes(32).toString('hex');

      const [webhook] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO webhooks (tenant_id, name, url, secret, events, headers, retry_policy)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, url, events, is_active`,
          [req.tenant.id, body.name, body.url, secret, body.events,
           JSON.stringify(body.headers ?? {}), JSON.stringify(body.retryPolicy ?? { maxRetries: 3, backoffMs: 1000 })],
        );
        return result.rows;
      });

      // No in-process listener needed — the WebhookDispatcher BullMQ worker
      // consumes the crm-events queue and fans out to all matching webhooks in
      // the DB, so delivery works correctly across all API instances.

      return reply.code(201).send({ success: true, data: { ...webhook, secret } });
    });

    fastify.delete('/:id', { preHandler }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM webhooks WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });

    // Delivery log
    fastify.get('/:id/deliveries', { preHandler }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const deliveries = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: deliveries });
    });

    // Test webhook
    fastify.post('/:id/test', { preHandler }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [webhook] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT * FROM webhooks WHERE id = $1', [id]);
        return result.rows;
      });
      if (!webhook) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });

      const testPayload = { event: 'webhook.test', timestamp: new Date().toISOString(), tenantId: req.tenant.id };
      const retryPolicy = (webhook.retry_policy as any) ?? { maxRetries: 3, backoffMs: 1000 };
      await enqueueWebhookDelivery(db, {
        webhookId:  id,
        tenantId:   req.tenant.id,
        event:      'webhook.test',
        payload:    testPayload,
        maxRetries: retryPolicy.maxRetries ?? 3,
        backoffMs:  retryPolicy.backoffMs  ?? 1000,
      });
      return reply.send({ success: true, message: 'Test webhook enqueued for delivery' });
    });

    // Dead-letter queue — rows that exhausted all retries
    fastify.get('/dead-letter', { preHandler }, async (req, reply) => {
      const rows = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT wd.id, wd.webhook_id, w.name AS webhook_name, wd.event,
                  wd.attempts, wd.max_retries, wd.status_code, wd.last_error,
                  wd.created_at, wd.updated_at
           FROM webhook_deliveries wd
           JOIN webhooks w ON w.id = wd.webhook_id
           WHERE wd.dead_lettered = true
           ORDER BY wd.updated_at DESC
           LIMIT 200`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // Replay a dead-lettered delivery (re-enqueue with reset attempts)
    fastify.post('/dead-letter/:deliveryId/replay', { preHandler }, async (req, reply) => {
      const { deliveryId } = req.params as { deliveryId: string };
      const [dl] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT wd.*, w.retry_policy FROM webhook_deliveries wd
           JOIN webhooks w ON w.id = wd.webhook_id
           WHERE wd.id=$1 AND wd.dead_lettered=true`,
          [deliveryId],
        );
        return result.rows;
      });
      if (!dl) return reply.code(404).send({ success: false, error: 'Dead-letter entry not found' });

      const retryPolicy = (dl.retry_policy as any) ?? { maxRetries: 3, backoffMs: 1000 };

      // Reset the existing row rather than inserting a duplicate
      await db.query(
        `UPDATE webhook_deliveries
         SET attempts=0, succeeded=false, dead_lettered=false,
             last_error=NULL, next_attempt_at=NOW(), updated_at=NOW()
         WHERE id=$1`,
        [deliveryId],
      );

      return reply.send({ success: true, message: 'Delivery re-enqueued', deliveryId });
    });
  };
}
