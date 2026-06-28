-- 035 — Workspace isolation hardening.
--
-- The B3 audit (after the user clarification "agent in workspace A must never
-- see / message / email users from workspace B") found these tenant-scoped
-- tables with NO row-level security. Application code currently filters by
-- tenant_id manually, but defense-in-depth says if anyone ever forgets the
-- WHERE clause RLS catches it. Enabling + forcing + a policy that requires
-- tenant_id = current_setting('app.tenant_id').
--
-- Skipping super_admin-only tables (platform_invoices, platform_payments,
-- super_admin_password_log) — those don't live inside a workspace's scope.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team_messages',
    'invoice_templates',
    'sales_settings',
    'opportunity_counters',
    'ticket_counters',
    'usage_metrics'
  ] LOOP
    -- Only act if the table actually exists (some are optional per env).
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname='public' AND c.relname=tbl AND c.relkind='r') THEN
      EXECUTE format('ALTER TABLE %I ENABLE  ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE %I FORCE   ROW LEVEL SECURITY', tbl);
      -- Drop any prior partial policy so re-running is idempotent.
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        'USING (tenant_id::text = current_setting(''app.tenant_id'', true)) '
        'WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
        tbl
      );
    END IF;
  END LOOP;
END $$;
