-- 034 — Soft-delete users so historical FKs survive.
--
-- Hard DELETE on users currently fails for any user who has touched a ticket,
-- activity, deal, or call (FK constraints from those tables). And even if it
-- succeeded, every report covering "users who worked tickets last quarter" would
-- show NULL for assignee_name because the row disappeared.
--
-- Soft-delete keeps the row in place, marks it inactive, and lets every
-- historical report continue to render the user's name in the period they
-- were available.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index so the standard "list active users" filter is fast.
CREATE INDEX IF NOT EXISTS idx_users_deleted_at_null
  ON users (tenant_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN users.deleted_at IS
  'When set, user is soft-deleted: hidden from active lists but historical FKs to '
  'tickets/activities/deals still resolve their name. NULL = active row.';
