-- ============================================================
-- Migration 015: Department-based queues with auto-membership
--
-- Creates 3 standard queues per tenant (Sales / Support / Complaints),
-- each tagged with a department_type. Adds triggers that:
--   1) auto-create the 3 queues whenever a new tenant signs up
--   2) auto-sync queue membership whenever a user's department_type,
--      role, or is_active flag changes
-- So the tenant admin only ever picks a department_type when inviting
-- a user — queue membership maintains itself.
-- ============================================================

-- 1. Tag queues by department
ALTER TABLE ticket_queues ADD COLUMN IF NOT EXISTS department_type TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_queue_per_dept
  ON ticket_queues (tenant_id, department_type)
  WHERE department_type IS NOT NULL;

-- 2. Function to create the 3 standard dept queues for a tenant (idempotent)
CREATE OR REPLACE FUNCTION ensure_dept_queues(p_tenant UUID) RETURNS void AS $$
BEGIN
  INSERT INTO ticket_queues (tenant_id, name, color, routing_method, is_default, department_type, description)
  VALUES
    (p_tenant, 'Sales Queue',      '#10b981', 'push_random', false, 'sales',     'Auto-routes sales leads to agents in the Sales department'),
    (p_tenant, 'Support Queue',    '#0ea5e9', 'push_random', false, 'support',   'Auto-routes inquiries to agents in the Support department'),
    (p_tenant, 'Complaints Queue', '#ef4444', 'push_random', false, 'complaint', 'Auto-routes complaints to agents in the Complaints department')
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 3. Backfill: create dept queues for every existing tenant
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM tenants LOOP PERFORM ensure_dept_queues(r.id); END LOOP;
END $$;

-- 4. Trigger: auto-create dept queues whenever a new tenant is added
CREATE OR REPLACE FUNCTION trg_tenant_create_dept_queues() RETURNS trigger AS $$
BEGIN
  PERFORM ensure_dept_queues(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_dept_queues ON tenants;
CREATE TRIGGER tenants_dept_queues AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION trg_tenant_create_dept_queues();

-- 5. Function: sync a single user's queue membership to their current department_type
CREATE OR REPLACE FUNCTION sync_user_queue_membership(p_user UUID) RETURNS void AS $$
DECLARE
  v_tenant UUID;
  v_dept   TEXT;
  v_role   TEXT;
  v_active BOOLEAN;
BEGIN
  SELECT tenant_id, department_type, role, is_active
    INTO v_tenant, v_dept, v_role, v_active
    FROM users WHERE id = p_user;

  -- Remove user from ALL dept queues first (handles dept change / role change / deactivation)
  DELETE FROM queue_members
    WHERE user_id = p_user
      AND queue_id IN (SELECT id FROM ticket_queues WHERE tenant_id = v_tenant AND department_type IS NOT NULL);

  -- Add back to the matching dept queue if they're active + agent-tier + have a dept
  IF v_active = true
     AND v_dept IS NOT NULL
     AND v_role IN ('agent', 'line_manager', 'manager') THEN
    INSERT INTO queue_members (queue_id, user_id)
    SELECT id, p_user
      FROM ticket_queues
      WHERE tenant_id = v_tenant AND department_type = v_dept
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger: keep queue membership in sync as department_type/role/is_active changes
CREATE OR REPLACE FUNCTION trg_user_sync_queue() RETURNS trigger AS $$
BEGIN
  PERFORM sync_user_queue_membership(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_sync_queue ON users;
CREATE TRIGGER users_sync_queue
  AFTER INSERT OR UPDATE OF department_type, role, is_active ON users
  FOR EACH ROW EXECUTE FUNCTION trg_user_sync_queue();

-- 7. Backfill: sync every existing user's queue membership now
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM users LOOP PERFORM sync_user_queue_membership(r.id); END LOOP;
END $$;
