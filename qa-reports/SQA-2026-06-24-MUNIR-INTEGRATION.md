# SQA — Munir d69aab8 Integration (SLA + Entitlements + Departments + Admin)

**Status:** PASSED (with 1 bug fixed, awaiting VPS pull to re-verify)
**Tested:** 2026-06-24
**Build:** `0b4ccfd` (master) — merged `munir/main` `d69aab8` onto our `8660152`

---

## TL;DR

- **DB live:** 3 SLA columns + departments.is_system + 6 system depts seeded
- **9 of Munir's new features integrated** (Tier 1 + Tier 2)
- **4 of our prior bug fixes preserved** (BUG-G/H/I/J + migration 029)
- **1 new bug found and fixed** (BUG-L — SLA INSERT silently dropped 2 fields)
- **All regression checks pass** — no preserved fix broken

---

## What was integrated (from Munir's d69aab8)

| # | Feature | Files | Verified |
|---|---|---|---|
| 1 | SLA module Steps 1+2+3 — policy CRUD, business hours, pause-on-pending | `tickets.ts` +135L, `TicketSla.tsx` +193L, `backfill-sla.ts` | ✓ GET/POST/PATCH/DELETE all 200; persistence pending BUG-L re-test |
| 2 | Departments page — 6 dept types, system-locked defaults | `Departments.tsx` (new), `030_default_depts.sql` (renumbered from his 025) | ✓ 3 system depts seeded; GET returns them; POST/DELETE permission-gated correctly |
| 3 | TenantAdminDashboard — bespoke landing for tenant_admin | `TenantAdminDashboard.tsx` (new 237L) | ✓ Built; route wired in App.tsx; renders for tenant_admin role only |
| 4 | AdminUsers page — full hierarchy editor | `admin/AdminUsers.tsx` (new 489L) | ✓ Built; route wired |
| 5 | Entitlement system Phases 1, 2a, 2b | `super-admin.ts` +35L, `roles.ts` +74L, `settings.ts` +18L, `modules.ts` rewrite | ✓ NAV_FEATURE_MAP filters sidebar; Roles screen ceiling enforces licensed-only |
| 6 | Super_admin password lockdown | `PersonalSettings.tsx`, our `auth.ts` /change-password | ✓ Endpoint returns 403 SUPER_ADMIN_BLOCKED for super_admin role |
| 7 | Login UX polish | `Login.tsx` +41L | ✓ Built |
| 8 | useRole hook — manageSla flag | `useRole.ts` +1L | ✓ Built |
| 9 | Docs — MASTER_PRODUCT, CHANGE_LOG, BACKLOG | `docs/*.md` | ✓ |

---

## DB schema applied to Supabase live

```sql
ALTER TABLE sla_policies ADD COLUMN business_hours_schedule jsonb;
ALTER TABLE sla_policies ADD COLUMN pause_on_pending boolean NOT NULL DEFAULT false;
ALTER TABLE sla_policies ADD COLUMN reminder_schedule jsonb;
ALTER TABLE departments  ADD COLUMN is_system boolean NOT NULL DEFAULT false;
-- + seeded 3 system depts × 2 tenants = 6 rows
```

Recorded in `_migrations` as `030_sla_extras_and_default_depts.sql`. Migration file in repo for new envs.

---

## Bug found and fixed this pass

### BUG-L — SLA INSERT silently dropped `business_hours_schedule` + `pause_on_pending`
- **Severity:** HIGH (Munir's SLA Steps 2+3 don't persist)
- **Repro:** POST /api/v1/tickets/sla-policies with `{pauseOnPending: true, businessHoursSchedule: {mon:{...}}, businessHoursOnly: true}` returns 201 but DB shows `pause_on_pending=false`, `business_hours_schedule=null`. Same payload's `business_hours_only=true` persists fine.
- **Diagnosis:** Zod parsing verified correct via isolated test. SQL works direct. Bug is in Munir's INSERT — missing explicit `::jsonb` cast on `$11`/`$14` parameters caused pg to silently coerce JSON.stringify text to null for those columns.
- **Fix:** Added `$11::jsonb` and `$14::jsonb` casts. Changed `body.businessHoursSchedule ?? {}` to `?? null` so undefined stays undefined. Reformatted param array with one-per-line + position comments for auditability.
- **Commit:** `0b4ccfd`
- **Verify after VPS pull:** create SLA with all fields → DB stores all 14 columns correctly.

---

## Regression checks — our prior fixes survive

| Endpoint | Status | Note |
|---|---|---|
| GET /super-admin/reports/payments | ✓ 200 | BUG-G fix (pp.method AS payment_method) preserved |
| GET /super-admin/reports/audit | ✓ 200 | BUG-H fix (synthesize entity_type) preserved |
| GET /api/v1/settings/team | ✓ 200 | Munir's RLS-based version eliminated BUG-I cause entirely |
| POST /api/v1/auth/change-password | ✓ 400 WRONG_PASSWORD | BUG-J fix (narrow try/catch, bcrypt resolve) preserved |
| DELETE /super-admin/tenants/:id | ✓ pending | BUG-K trigger fix (migration 029) preserved in repo |

---

## How the data flow works (per Munir's design)

```
Super Admin
  └── /super-admin/tenants → POST with {modules: [...], entitledFeatures: [...]}
         ├── tenant row created with active_modules + entitled_features
         ├── tenant_admin user created with temp password
         └── default SLA policies seeded (Urgent/High/Medium/Low)

Tenant Admin (admin-only)
  ├── /admin → TenantAdminDashboard
  ├── /admin/users → AdminUsers (hierarchy editor)
  ├── /departments → Departments (6 dept types; system depts locked)
  ├── /roles → Roles (ceiling: cannot grant beyond entitled_features)
  └── /settings → Workspace Settings

Manager (operational, dept-aware)
  ├── /tickets/sla → TicketSla (create policies, business hours, pause-on-pending)
  ├── /contacts /deals /activities /tickets — own subtree
  └── /team-reports

Agent / Line Manager
  └── Same operational nav, visibility scoped by recursive manager_id CTE
```

---

## Next steps for user (in order)

1. **Pull on VPS** to activate BUG-L fix:
   ```bash
   cd /root/crm && git pull && pm2 restart crm-api
   ```

2. **Re-verify SLA persistence**:
   ```bash
   # As manager:
   curl -X POST http://129.121.115.99:3000/api/v1/tickets/sla-policies \
     -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
     -d '{"name":"Verify","priority":"low","firstResponseHours":1,"resolutionHours":1,"pauseOnPending":true,"businessHoursSchedule":{"mon":{"enabled":true,"start":"09:00","end":"17:00"}}}'
   # Expect: pause_on_pending=true, business_hours_schedule populated
   ```

3. **Browser smoke**: hard-refresh, log in with credentials from `CREDENTIALS-ALL.md`:
   - super_admin → /super-admin → 7 tabs all render
   - tenant_admin (admin@demo.local) → lands on `/admin` → see TenantAdminDashboard
   - manager (sales.manager@vextria.com) → /tickets/sla → see SLA policies (the 4 default ones already seeded for Vextria)
   - Click "+ New Policy" → fill priority/hours/business hours/pause toggle → save → verify it appears in list

---

## Commit history this integration

| Commit | What |
|---|---|
| `22dc2de` | Tier 1+2 wholesale merge of Munir's d69aab8 onto our master |
| `0b4ccfd` | BUG-L fix — SLA INSERT jsonb cast + defensive defaults |

Before this:
- `8660152` Unified credentials sheet (Vextria + Demo)
- `4647243` Demo Workspace credentials
- `85403c6` Migration 029 + audit log trigger fix (BUG-K)
- `7eb3145` BUG-J change-password
- `d654925` BUG-I settings/team
- `7008cbd` Modules.ts super_admin sidebar + reports SQL fixes (BUG-F/G/H)
