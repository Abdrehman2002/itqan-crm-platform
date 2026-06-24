-- ============================================================
-- Migration 029: audit log immutability — allow super_admin bypass
-- ============================================================
-- The ticket_audit_log_immutable() trigger blocks all DELETEs on the audit
-- table to keep it tamper-proof. But that ALSO blocked tenant-level cascade
-- deletes, so `DELETE FROM tenants` always 500'd when a tenant had any audit
-- rows.
--
-- Found in SQA pass 2026-06-24: super_admin DELETE /tenants/:id returned 500
-- with Postgres P0001 "ticket_audit_log is immutable". Discovered by direct
-- SQL repro against Supabase.
--
-- Fix: allow DELETE only when the connection has set app.bypass_rls='on' —
-- which is set EXCLUSIVELY by db.withSuperAdmin(). Tenant-level audit log
-- integrity stays intact for normal traffic; only platform-level tenant
-- purges go through.
-- ============================================================

CREATE OR REPLACE FUNCTION ticket_audit_log_immutable()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.bypass_rls', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ticket_audit_log is immutable';
END;
$$ LANGUAGE plpgsql;
