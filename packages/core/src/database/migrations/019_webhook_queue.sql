-- Migration 019: Webhook delivery queue
-- Adds queue state columns to webhook_deliveries so a background worker
-- can perform retries with exponential backoff and dead-letter after max retries.

-- Queue state columns
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS next_attempt_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_retries      INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS backoff_ms       INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS dead_lettered    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_error       TEXT,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Index for the worker poll query:
-- SELECT ... WHERE succeeded=false AND dead_lettered=false AND next_attempt_at <= NOW()
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_queue
  ON webhook_deliveries (next_attempt_at)
  WHERE succeeded = false AND dead_lettered = false;

-- Backfill: existing rows with attempts > 0 and not succeeded → mark dead_lettered
-- (they were delivered synchronously and already failed with no retry path)
UPDATE webhook_deliveries
SET dead_lettered = true, updated_at = NOW()
WHERE succeeded = false AND attempts > 0 AND next_attempt_at IS NULL;
