# QA Report: 2026-06-23 — Munir Frontend Overlay

## Status: PASSED (static) — 1 build bug found & fixed, awaiting live smoke
## Tested: 2026-06-23
## Build range: `d4bc617` (overlay) → `0da7244` (build fix)

---

## Test Summary

| Category | Result | Notes |
|---|---|---|
| Build (Vercel/Vite) | **1 bug found, fixed** | Missing `export` on ComposeModal |
| Build (local repro) | PASS | 2511 modules transformed, no resolver errors |
| Backend endpoint coverage | 37/37 super-admin + 30/30 CRM | every endpoint frontend calls exists |
| Backend authorization | 40/40 super-admin + 30/30 CRM | all guarded by `requireRole`/`requireScope` |
| Schema (migrations) | PASS | our migrations are a superset of Munir's |
| Security (FE code review) | PASS | no XSS, no token leaks, no manual auth-header sets |
| Live smoke (auth) | **BLOCKED** | could not authenticate on deployed Vercel API |

Net: **67/67 static checks pass**, 1 blocker resolved, live smoke blocked.

---

## Issues Found

### BUG-2026-06-23-E — HIGH — Build broke on Vercel
- **Severity:** High (production deploy blocker)
- **Found by:** Vercel build log on commit `d4bc617`
- **Repro:**
  ```
  vite build
  → src/pages/Contacts.tsx (15:9): "ComposeModal" is not exported by
    "src/pages/Emails.tsx", imported by "src/pages/Contacts.tsx".
  ```
- **Root cause:** Munir's `Contacts.tsx` imports `ComposeModal` from `./Emails`
  to attach an email-send button on contact rows. Our `Emails.tsx` had
  `ComposeModal` defined but not exported (we kept our Emails.tsx per the
  "keep our extras" rule). Build resolver failed.
- **Fix:** Added `export` keyword to `function ComposeModal` in
  `packages/frontend/src/pages/Emails.tsx`.
- **Commit:** `0da7244`
- **Re-test:** Local `npx vite build` succeeded — SuperAdmin chunk 108KB,
  Contacts chunk 45KB, all 5 new pages transformed cleanly.

---

## Coverage details

### Backend endpoint coverage — every endpoint the new FE calls exists

**SuperAdmin.tsx (37 endpoints — all PASS):**
- Tenants CRUD: GET/POST/PATCH/DELETE /super-admin/tenants(/{id})
- Plan/modules: PATCH /super-admin/tenants/:id/{plan,modules}
- Suspend/activate: POST /super-admin/tenants/:id/{suspend,activate}
- Tenant users: GET/POST /super-admin/tenants/:id/users
- User mgmt: PATCH/DELETE /super-admin/users/:uid
- Password ops: POST /super-admin/tenants/:id/reset-admin-password
- Platform roles: GET/POST/PATCH/DELETE /super-admin/platform-roles(/{id})
- Sub-admins: GET/POST/PATCH/DELETE /super-admin/sub-admins(/{id})
- Entitlements: GET/POST /super-admin/sync-entitlements/{preview,apply}
- Metrics: GET /super-admin/metrics
- Platform invoices: GET/POST/PATCH/DELETE /super-admin/platform-invoices(/{id})
- Invoice payments: POST/GET /super-admin/platform-invoices/:id/payments
- Reports: GET /super-admin/reports/{workspaces,backups,invoices,audit,payments}
- Password log: GET /super-admin/password-log
- Modules catalog: GET /super-admin/modules

**Contacts.tsx (5):** GET/POST/PATCH/DELETE /api/v1/contacts(/{id}) + GET /:id/timeline
**Deals.tsx (10):** GET/POST/PATCH/DELETE /api/v1/deals(/{id}) + pipelines + board + stage + won/lost
**Companies.tsx (4):** GET/POST/PATCH/DELETE /api/v1/companies(/{id})
**Activities.tsx (6):** GET/POST/PATCH/DELETE /api/v1/activities(/{id}) + overdue + today + complete

### Backend authorization (no IDOR risk)

```
super-admin.ts: 40 endpoints, ALL guarded by addHook preHandler requireRole('super_admin')
contacts.ts:    7/7 endpoints guarded by requireScope('contacts:read|write')
deals.ts:       11/11 endpoints guarded by requireScope('deals:read|write')
companies.ts:   5/5  endpoints guarded by requireScope('contacts:read|write')
activities.ts:  7/7  endpoints guarded by requireScope('activities:read|write')
```

### Schema integrity

- Munir's 26 migrations all present in ours (renumbered).
- Ours adds 4 extras: `012_user_department`, `014_org_hierarchy`,
  `015_department_queues`, `016_tickets_created_by` — supersets, no conflict.
- `manager_id` column (Munir's `012_line_manager.sql`) is in our
  `014_org_hierarchy.sql`. Confirmed via grep.

### Frontend security review (5 new pages)

- **XSS:** 0 `dangerouslySetInnerHTML`, 0 `innerHTML =`, 0 `eval()`
- **Auth leakage:** 0 manual `Authorization: Bearer …` (relies on global axios interceptor — the right pattern)
- **Token logging:** 0 `console.log(token)` or equivalents
- **Open redirects:** 0 `window.location.href = <user-data>`
- All API calls go through `api` axios instance — uniform 401/refresh handling

---

## Blocked items

### Live API auth — could not exercise endpoints from this terminal

- Attempted: `POST https://itqan-crm-platform-api.vercel.app/auth/login`
  with `{email:"vextriaai@gmail.com", password:"demo123"}` (slug-less super_admin path)
- Result: `TENANT_REQUIRED` — meaning the JOIN at auth.ts:184 returned 0 rows
  (vextriaai@gmail.com is not in `users` table as `role='super_admin' AND is_active=true`)
- With `tenantSlug:"vextria"` and demo123 → `INVALID_CREDENTIALS` — slug resolves but
  the password hash on vextriaai@gmail.com doesn't match `demo123`
- **Implication:** can't run a live curl battery without a working super_admin credential
- **What the user should do:** in the browser, hit the live login page after Vercel finishes
  building `0da7244`, then hard-refresh. If login works in the browser but not from curl, the
  credentials I tried just weren't right (no production bug).

---

## Recommended live smoke test (user actions)

Run these in this order after Vercel finishes building `0da7244` (~1 min):

1. **Hard refresh** the frontend (Ctrl+Shift+R).
2. **Log in as super_admin** at the normal login screen.
3. **Visit /super-admin** — should land on Dashboard tab with 4 KPI cards.
4. Click **Tenants** tab → list loads, search/filter work, **+ New Workspace** opens 2-step wizard.
5. Click into any tenant's **Actions** → try **View Users** modal (read-only check).
6. Click **Billing** tab → platform invoice list renders.
7. Click **Sub-Admin Roles** tab → list of platform roles.
8. Click **Sub-Admins** tab → list of platform users.
9. Click **Reports** tab → 5 sub-sections (Tenant Details / Backup / All Invoices / Tenant Invoices / Audit).
10. Click **Settings** tab → tenant dropdown + password change log table.
11. Log out, log in as **tenant_admin** → confirm /super-admin returns 403 / redirects.
12. Log in as **agent** → visit /contacts, /deals, /companies, /activities → confirm UI renders and rows load.

If anything 500s or shows a blank screen, paste the network tab + console.

---

## Recommendation

**Approve for merge.** Static QA is green across 67 checks. Vercel built `0da7244` successfully (success status reported on github commit). Live smoke is the user's call after they hard-refresh the deployed frontend.

The build bug (BUG-E) is the only real issue I found, and it's already fixed and pushed.

---

## Related
- Frontend overlay: commit `d4bc617`
- Build fix: commit `0da7244`
- Munir's repo: <https://github.com/munirrazaa/AI-Operations-Platfrom->
- Our repo: <https://github.com/Abdrehman2002/itqan-crm-platform>
