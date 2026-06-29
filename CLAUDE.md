# AmanahCX (Itqan) CRM — contributor notes

## Plaintext credentials file

`qa-reports/CREDENTIALS-ALL.md` contains 17 production passwords in plaintext.
This file is intentionally kept in the repo as a QA fixture, accepted by the
project owner (2026-06-29) because the repo is private and the credentials
table all share `demo12345` / `demo123` — well-known low-value seeds, not real
account passwords.

If this repo is ever made public, forked to a public location, or the password
table is reseeded with stronger values:
- Remove the file from the working tree (`git rm`).
- Add `qa-reports/CREDENTIALS-*.md` to `.gitignore`.
- Consider history scrub (`git filter-repo`) only if the new values are
  high-value (the current `demo12345` set is not).

## Deployment

- **Main branch:** `main` (NOT `master`). Vercel watches `main` for Production
  builds; pushes to `master` only produce Preview deployments.
- **VPS API:** root@129.121.115.99, PM2 process `crm-api`, path `~/crm`,
  pulls from `origin/main`. Deploy chain uses `;` between `npx tsc` calls
  (the api tsconfig includes `../../modules` which triggers a rootDir warning
  that emits exit 2 but still writes correct `.js` output).
- **Supabase:** project `sydkawiuxmunbjhsozic`, region Mumbai.

## Soft delete

Users are soft-deleted: `deleted_at = NOW()`, `is_active = false`, email bumped
with `+deleted-<epoch>` so the address can be re-invited. The login endpoint
(packages/api/src/routes/auth.ts) filters on `deleted_at IS NULL` so a deleted
user can never authenticate, but their FK references stay valid for historical
reports.

## Audit log

Migration 036 adds `system_audit_log` (tamper-proof, RLS-forced) for
cross-domain admin activity. The existing `ticket_audit_log` covers ticket
events. Both are UNIONed in `GET /api/v1/settings/audit-log` for tenant_admin /
manager. `audit()` helper in settings.ts is the single insert path — always
best-effort (a failed insert never blocks the actual mutation).
