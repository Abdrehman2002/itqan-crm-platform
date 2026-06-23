/**
 * Webhook Dispatcher — horizontally scalable webhook fan-out
 *
 * Consumes the `crm-events` BullMQ queue that EventBus.publish() writes to.
 * For each event, queries the DB for active webhooks subscribed to that event
 * type and calls enqueueWebhookDelivery() for each one.
 *
 * Because BullMQ workers use Redis-backed locking, each event is processed by
 * exactly one API instance even when many are running — correct fan-out with
 * no duplicate deliveries and no in-process state.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { DatabaseClient, CRMEvent } from '@crm/core';
import { logger } from '@crm/core/config/logger';
import { enqueueWebhookDelivery } from './webhook-worker';

const QUEUE_NAME = 'crm-events';
const CONCURRENCY = 10;

export function startWebhookDispatcher(
  db: DatabaseClient,
  redis: Redis,
): () => Promise<void> {
  const worker = new Worker<CRMEvent>(
    QUEUE_NAME,
    async (job: Job<CRMEvent>) => {
      const event = job.data;
      if (!event?.type || !event?.tenantId) return;

      // Find all active webhooks for this tenant subscribed to this event type
      const webhooks = await db.query<{ id: string; retry_policy: unknown }>(
        `SELECT id, retry_policy
         FROM webhooks
         WHERE tenant_id = $1
           AND is_active = true
           AND $2 = ANY(events)`,
        [event.tenantId, event.type],
      );

      if (webhooks.length === 0) return;

      await Promise.all(
        webhooks.map((wh) => {
          const rp = (wh.retry_policy as any) ?? {};
          return enqueueWebhookDelivery(db, {
            webhookId:  wh.id,
            tenantId:   event.tenantId,
            event:      event.type,
            payload:    event.payload,
            maxRetries: rp.maxRetries ?? 3,
            backoffMs:  rp.backoffMs  ?? 1000,
          });
        }),
      );

      logger.debug('Webhook dispatcher: enqueued deliveries', {
        event: event.type,
        tenantId: event.tenantId,
        webhookCount: webhooks.length,
      });
    },
    {
      connection: redis,
      concurrency: CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Webhook dispatcher job failed', {
      jobId: job?.id,
      event: job?.data?.type,
      error: err.message,
    });
  });

  logger.info('Webhook dispatcher started');

  return async () => {
    await worker.close();
    logger.info('Webhook dispatcher stopped');
  };
}
