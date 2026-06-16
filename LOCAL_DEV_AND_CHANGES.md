# Local Dev Setup & Change Log

This document explains how to run the CRM platform locally (no Docker, no remote
database, no system PostgreSQL install) and lists every change made to get it
running, load data, and fix the bugs that were blocking the frontend.

---

## 1. Quick Start

```bash
npm install          # once
npm run dev:local    # starts everything
```

`npm run dev:local` does all of the following in one command:

1. Boots an **embedded PostgreSQL 18** (bundled binary, no install) on port **5433**, data stored in `./.pg-data/`
2. Creates the `crm_platform` database (UTF-8)
3. Runs all migrations
4. Seeds the demo workspace (idempotent — skips if already seeded)
5. Starts the **API** on `http://localhost:3000` and the **Frontend** on `http://localhost:5173`

Then open **http://localhost:5173**.

### Login credentials

| Purpose | Workspace | Email | Password | Role |
|---|---|---|---|---|
| Normal app UI | `demo` | `admin@demo.com` | `Demo1234!` | `tenant_admin` |
| Super-admin portal / SQA suite | `demo` | `superadmin@demo.com` | `Vivid@Solutions1` | `super_admin` |

> Super admins are intentionally blocked from tenant-scoped `/api/v1/*` routes
> (they use `/super-admin/*`), so use `admin@demo.com` for the regular dashboard.

### Adding more test data

```bash
# Rich baseline set (idempotent — won't duplicate):
DATABASE_URL="postgresql://postgres@localhost:5433/crm_platform" node scripts/seed-testdata.mjs

# Additive top-up (run repeatedly; multiplier optional):
DATABASE_URL="postgresql://postgres@localhost:5433/crm_platform" node scripts/seed-more.mjs 2
```

### Resetting the database

Stop the app, then delete the data directory and re-run:

```bash
# Windows PowerShell:
Remove-Item -Recurse -Force .pg-data
npm run dev:local
```

---

## 2. Architecture notes for local mode

- **PostgreSQL**: provided by the `embedded-postgres` npm package (bundles a real
  PG binary per-platform). Cluster is initialised as **UTF-8** with **trust auth**
  (no password) on port **5433**. Data persists in `./.pg-data/`.
- **Redis**: not required. `REDIS_URL=disabled` in `.env` triggers the app's
  built-in **in-memory fallback** (see `packages/core/src/config/redis.ts`).
  Note: Redis-backed cross-process features (distributed rate-limit, BullMQ event
  bus) are no-ops locally; in-process event listeners still work.
- **Env propagation**: `scripts/local-dev.mjs` loads `.env` itself and passes all
  vars to the API/frontend child processes (the app's own `dotenv/config` looks in
  the package's working directory, where no `.env` exists).

---

## 3. New files

| File | Purpose |
|---|---|
| `.env` | Local config: DATABASE_URL (embedded PG on :5433), `REDIS_URL=disabled`, generated `JWT_SECRET`, CORS for localhost, Vite URLs |
| `turbo.json` | Turborepo task config (was missing — root `db:migrate`/`dev` scripts need it) |
| `scripts/local-dev.mjs` | One-command launcher: embedded PG → migrate → seed → API + frontend |
| `scripts/seed-testdata.mjs` | Rich, idempotent demo data seeder |
| `scripts/seed-more.mjs` | Additive top-up seeder (extra users/companies/contacts/deals/tickets/invoices) |
| `packages/core/src/database/migrations/012_user_department.sql` | Adds `users.department` + `users.department_type` |
| `packages/core/src/database/migrations/013_tenant_active_modules.sql` | Adds `tenants.active_modules` (text[]) |

---

## 4. Modified files

| File | Change |
|---|---|
| `package.json` (root) | Added `dev:local` script and `embedded-postgres` devDependency |
| `packages/frontend/package.json` | Added `"type": "module"` (PostCSS/Tailwind configs are ESM — without this, styling failed to load) |
| `packages/frontend/src/App.tsx` | Converted ~35 pages to `React.lazy` + `Suspense`, added a `PageLoader`, idle route-prefetch, and tightened react-query caching (`staleTime 60s`, `gcTime 5m`, no refetch-on-focus) |
| `packages/api/src/scripts/seed.ts` | Tenant now seeded with plan **features/limits** and `active_modules`; added the **super_admin** user |
| `packages/core/src/database/migrations/002_billing.sql` | Removed its conflicting `invoices` table (see bug #1) and dropped the now-dangling FK on `payments.invoice_id` |
| `packages/api/src/routes/sales/invoices.ts` | Fixed result handling + wrong column names + invalid status (see bug #2) |
| `packages/api/src/routes/sales/sales-dashboard.ts` | Fixed result handling via a `.rows` helper |
| `packages/api/src/routes/sales/billing-contacts.ts` | Fixed `.rows` destructure on update |
| `packages/api/src/routes/sales/sales-settings.ts` | Fixed `.rows` destructure + a literal `'NOW()'` string bug |
| `tests/sqa/agents/agent-01-superadmin.js` | Pointed super-admin credential at `superadmin@demo.com` |

---

## 5. Bugs fixed

### Bug 1 — Migrations failed on a fresh DB (`invoices` table collision)
`002_billing.sql` and `008_sales_invoicing.sql` both created an `invoices` table
with **incompatible schemas** (`due_at` vs `due_date`, `invoice_number` vs
`number`). On a clean DB, 002 created it first, so 008's `CREATE TABLE IF NOT
EXISTS` was skipped, then 008's index on `due_date` failed. The app's UI uses the
**008** schema, so 002's `invoices` table was removed (matching the original
deployment, which never ran 002).

### Bug 2 — Sales pages returned 500 (`(intermediate value) is not iterable`)
The sales routes called `db.withTenant(tid, (client) => client.query(...))`, which
returns a pg **Result object**, then treated it as an array (`const [{count}] =
...`, `.map(...)`). Fixed to return `.rows`. The invoice **create** path also
referenced old `002`-schema columns (`invoice_number`, `due_at`, `tax`,
`provider`) and an invalid `'open'` status — corrected to the `008` schema.

### Bug 3 — Analytics returned 402 "Feature not available"
The demo tenant was seeded with empty `settings`, so `settings.features.analytics`
was falsy. Seed now writes `PLAN_FEATURES`/`PLAN_LIMITS` for the plan; live tenant
updated to enable all professional features.

### Bug 4 — Dashboard hung forever (500: `column "department" does not exist`)
The dashboard's `/api/v1/analytics/ops-dashboard` and login both read
`users.department`, which the local migrations never created. Added via migration
`012`.

### Bug 5 — Team invite 500 (`active_modules` / `department_type` missing)
`POST /api/v1/settings/team/invite` references `tenants.active_modules` and
`users.department_type`, neither of which existed. Added via migrations `013` and
`012`. Invite now returns 201.

> Bugs 4 & 5 are the same class: the committed migration set was missing several
> columns the application code expects (they had existed in the original
> deployment's separate migration history).

---

## 6. Test data currently seeded (demo tenant)

~9 users (across Sales/Support/Complaints), ~59 companies, ~183 contacts,
~100 deals, ~142 activities, ~120 tickets (+comments), ~52 invoices, plus
voice-bot calls, emails, notifications, ticket queues and SLA policies.
(Exact counts grow if you run `seed-more.mjs` again.)

---

## 7. Verified working (in-browser)

Logged in via the UI and confirmed these render with data and no console errors:
**Dashboard**, **Contacts** (paginated, 183), **Deals** (Kanban, $9.6M pipeline),
**Analytics** (KPIs + revenue chart). API endpoint sweep: 14/14 core endpoints
return 200.

DB triggers functionally verified: `updated_at` auto-bump (PASS) and
`ticket_audit_log` immutability (UPDATE blocked, PASS). Event-bus listeners are
registered at boot but were not individually fire-tested end-to-end.

---

## 8. SQA test suite status (`tests/sqa`)

Run with:
```bash
cd tests/sqa && npm install
DATABASE_URL="postgresql://postgres@localhost:5433/crm_platform" \
TEST_DB_URL="postgresql://postgres@localhost:5433/crm_platform" \
API_URL="http://localhost:3000" node run-all-agents.js --clean
```

- Originally aborted at Agent 01 because no `super_admin` existed → now seeded, so
  the suite runs its **full flow** (Agent 01: 0 → 25 passing).
- The team-invite 500 (bug #5) was causing Agent 02's ~26 "failed to create user"
  failures; fixed but **the full suite has not been re-run since that fix**.

### Known remaining findings (not yet addressed)
- **SEC-01** — no per-account brute-force lockout reported by the suite. NOTE: the
  login code *does* implement lockout, but it relies on Redis counters; with the
  in-memory fallback this may not behave as the test expects. Worth confirming.
- **UX-02** — the contacts list returns `{ data: [...] }` without pagination
  `meta` (the tickets list has it; contacts does not).

---

## 9. Important caveat

Earlier in the session — before the decision to go fully local — the remote
**Supabase `itqan-crm`** project's `public` schema was reset and re-seeded. If you
still rely on that Supabase project, restore/verify it. The current local setup
does **not** use Supabase at all.
