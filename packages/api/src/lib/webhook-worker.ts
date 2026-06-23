/**
 * Webhook Delivery Worker
 *
 * Polls `webhook_deliveries` for pending rows and delivers them to tenant
 * endpoints with exponential backoff.  Rows that exceed `max_retries` are
 * marked `dead_lettered = true` and will no longer be retried.
 *
 * Back-off formula:  next_attempt_at = NOW() + (backoff_ms * 2^(attempts - 1))
 *   attempt 1 → +1 s   (immediate; set at enqueue time)
 *   attempt 2 → +1 s
 *   attempt 3 → +2 s
 *   attempt 4 → +4 s
 *   …up to max_retries
 *
 * Designed to run in a single process.  For horizontal scaling, add a
 * pg_advisory_lock around the poll query so only one worker processes each row.
 */

import crypto from 'node:crypto';
import { logger } from '@crm/core/config/logger';
import type { DatabaseClient } from '@crm/core';

const POLL_INTERVAL_MS = 5_000;   // check every 5 s
const DELIVERY_TIMEOUT_MS = 10_000;
const BATCH_SIZE = 20;            // max rows per poll cycle

// ── Public API ────────────────────────────────────────────────────────────────

export function startWebhookWorker(db: DatabaseClient): () => void {
  let running = true;
  let timer: NodeJS.Timeout;

  async function tick() {
    if (!running) return;
    try {
      await processBatch(db);
    } catch (err: any) {
      logger.error('Webhook worker tick error', { error: err.message });
    } finally {
      if (running) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  }

  timer = setTimeout(tick, 0);   // start immediately

  return () => {
    running = false;
    clearTimeout(timer);
    logger.info('Webhook worker stopped');
  };
}

// ── Enqueue a delivery (called from webhook route instead of dispatching inline)

export async function enqueueWebhookDelivery(
  db: DatabaseClient,
  opts: {
    webhookId:  string;
    tenantId:   string;
    event:      string;
    payload:    Record<string, unknown>;
    maxRetries: number;
    backoffMs:  number;
  },
): Promise<string> {
  const { webhookId, tenantId, event, payload, maxRetries, backoffMs } = opts;

  const rows = await db.query<{ id: string }>(
    `INSERT INTO webhook_deliveries
       (webhook_id, tenant_id, event, payload, attempts, succeeded,
        max_retries, backoff_ms, next_attempt_at, dead_lettered)
     VALUES ($1,$2,$3,$4::jsonb,0,false,$5,$6,NOW(),false)
     RETURNING id`,
    [webhookId, tenantId, event, JSON.stringify(payload), maxRetries, backoffMs],
  );

  return rows[0].id as string;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function processBatch(db: DatabaseClient): Promise<void> {
  // Claim up to BATCH_SIZE rows that are due for delivery using a CTE with
  // FOR UPDATE SKIP LOCKED — safe for concurrent workers (future horizontal scaling).
  const pending = await db.query<any>(
    `WITH claimed AS (
       SELECT wd.id, wd.webhook_id, wd.tenant_id, wd.event, wd.payload,
              wd.attempts, wd.max_retries, wd.backoff_ms,
              w.url, w.secret, w.headers
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       WHERE wd.succeeded = false
         AND wd.dead_lettered = false
         AND wd.next_attempt_at <= NOW()
       ORDER BY wd.next_attempt_at
       LIMIT $1
       FOR UPDATE OF wd SKIP LOCKED
     )
     SELECT * FROM claimed`,
    [BATCH_SIZE],
  );

  if (pending.length === 0) return;

  await Promise.allSettled(pending.map((row) => deliverRow(db, row)));
}

async function deliverRow(db: DatabaseClient, row: any): Promise<void> {
  const {
    id, webhook_id, tenant_id, event, payload,
    attempts, max_retries, backoff_ms,
    url, secret, headers: extraHeaders,
  } = row;

  const newAttempts = (attempts as number) + 1;
  const body        = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const signature   = crypto.createHmac('sha256', secret).update(body).digest('hex');

  let statusCode: number | undefined;
  let responseText: string | undefined;
  let succeeded = false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'X-CRM-Signature': `sha256=${signature}`,
        'X-CRM-Event':    event,
        ...(extraHeaders ?? {}),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    statusCode   = res.status;
    responseText = (await res.text().catch(() => '')).slice(0, 2000);
    succeeded    = res.ok;
  } catch (err: any) {
    responseText = (err.message ?? String(err)).slice(0, 2000);
  }

  if (succeeded) {
    await db.query(
      `UPDATE webhook_deliveries
       SET attempts=$1, status_code=$2, response=$3, succeeded=true,
           last_error=NULL, updated_at=NOW()
       WHERE id=$4`,
      [newAttempts, statusCode, responseText, id],
    );
    logger.info('Webhook delivered', { deliveryId: id, webhookId: webhook_id, event, attempt: newAttempts });
    return;
  }

  // Failed — decide retry or dead-letter
  const deadLetter = newAttempts >= max_retries;
  const delayMs    = backoff_ms * Math.pow(2, newAttempts - 1);
  const nextAt     = deadLetter ? null : new Date(Date.now() + delayMs).toISOString();

  await db.query(
    `UPDATE webhook_deliveries
     SET attempts=$1, status_code=$2, response=$3, succeeded=false,
         last_error=$4, dead_lettered=$5, next_attempt_at=$6, updated_at=NOW()
     WHERE id=$7`,
    [newAttempts, statusCode ?? null, responseText, responseText, deadLetter, nextAt, id],
  );

  if (deadLetter) {
    logger.warn('Webhook dead-lettered', {
      deliveryId: id, webhookId: webhook_id, event,
      attempts: newAttempts, url,
    });
  } else {
    logger.info('Webhook delivery failed — will retry', {
      deliveryId: id, attempt: newAttempts, nextAt, event,
    });
  }
}
