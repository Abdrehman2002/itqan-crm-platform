import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import type { DatabaseClient, EventBus } from '@crm/core';
import { requireFeature, requireScope } from '../middlewares/auth.middleware';

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

export function webhookRoutes(db: DatabaseClient, eventBus: EventBus) {
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

      // Register event listeners for each subscribed event
      for (const evt of body.events) {
        eventBus.on(evt, async (event) => {
          if (event.tenantId !== req.tenant.id) return;
          await dispatchWebhook(webhook.id, evt, event.payload, secret, body.url, db);
        });
      }

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
      await dispatchWebhook(id, 'webhook.test', testPayload, webhook.secret, webhook.url, db);
      return reply.send({ success: true, message: 'Test webhook dispatched' });
    });
  };
}

async function dispatchWebhook(
  webhookId: string,
  event: string,
  payload: Record<string, unknown>,
  secret: string,
  url: string,
  db: DatabaseClient,
): Promise<void> {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  let statusCode: number | undefined;
  let response: string | undefined;
  let succeeded = false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CRM-Signature': `sha256=${signature}`,
        'X-CRM-Event': event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = res.status;
    response = await res.text().catch(() => '');
    succeeded = res.ok;
  } catch (err: any) {
    response = err.message;
  }

  await db.query(
    `INSERT INTO webhook_deliveries (webhook_id, tenant_id, event, payload, status_code, response, attempts, succeeded)
     SELECT id, tenant_id, $2, $3::jsonb, $4, $5, 1, $6 FROM webhooks WHERE id = $1`,
    [webhookId, event, JSON.stringify(payload), statusCode, response, succeeded],
  );
}
