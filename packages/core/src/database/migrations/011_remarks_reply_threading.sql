-- ============================================================
-- Migration 011 — Remarks reply-threading + remark type
-- Applied: 2026-06-10
-- ============================================================

-- Add reply-to self-reference so any remark can quote an earlier one
-- (WhatsApp-style: reply shows a preview of the original message)
ALTER TABLE ticket_comments
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES ticket_comments(id) ON DELETE SET NULL;

-- Distinguish remark type:
--   'reply'  — outbound customer-visible reply (existing behaviour, is_internal=false)
--   'remark' — internal agent/manager remark (is_internal=true, new dedicated type)
--   'note'   — existing internal notes (is_internal=true)
ALTER TABLE ticket_comments
  ADD COLUMN IF NOT EXISTS comment_type TEXT NOT NULL DEFAULT 'reply'
    CHECK (comment_type IN ('reply','remark','note'));

-- Index for threaded lookups
CREATE INDEX IF NOT EXISTS idx_ticket_comments_reply_to ON ticket_comments(reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- Backfill: existing internal records → 'note', external → 'reply'
UPDATE ticket_comments
  SET comment_type = CASE WHEN is_internal THEN 'note' ELSE 'reply' END
  WHERE comment_type = 'reply' AND is_internal = true;
