# CRM Platform — Multi-Agent Test Results
**Tested:** 2026-06-09 | **Agents:** 5 parallel personas | **Total TCs Run:** 87

---

## 🚨 EXECUTIVE SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| P0 Critical | 3 | Must fix before ANY production use |
| P1 High | 4 | Fix before production |
| P2 Medium | 3 | Fix in next sprint |
| PASS | 51 | Working correctly |
| Route Mismatches | 6 | Docs/spec issue, not functional bug |

---

## P0 CRITICAL — Fix Immediately

---

### P0-001 🔴 PostgreSQL RLS `FORCE ROW LEVEL SECURITY` Missing — Complete Multi-Tenant Data Leak

**Discovered by:** TelecomAdmin agent + Security agent (independently confirmed)

**What happened in testing:**
- TelecomAdmin logged in and called `GET /api/v1/contacts` → received contacts from ALL tenants
- TelecomAdmin called `PATCH /api/v1/contacts/{BANK_CONTACT_ID}` → **successfully renamed a Banking tenant's contact to "HACKED"**
- TelecomAdmin called `DELETE /api/v1/contacts/{BANK_CONTACT_ID}` → **permanently deleted a Banking tenant's contact**
- Security agent confirmed: GET `/api/v1/settings/team` returned **32 users from ALL tenants** when called by any authenticated user

**Root Cause:**
PostgreSQL RLS policies exist and are syntactically correct, but `FORCE ROW LEVEL SECURITY` is `OFF` on all 29 tables. In PostgreSQL, the database user `crm` is the table owner — table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is explicitly set. Every application query runs as this owner, silently ignoring all tenant isolation policies.

**Affected tables (all 29):**
```
contacts, users, tickets, deals, companies, activities, api_keys,
emails, invoices, invoice_payments, payments, pipelines,
ticket_comments, ticket_queues, ticket_audit_log, ticket_escalations,
webhooks, webhook_deliveries, notifications, voice_calls,
voice_bot_calls, voice_bot_configs, csat_surveys, subscriptions,
billing_contacts, sla_policies, custom_field_definitions,
deal_history, email_templates
```

**Fix — Run this SQL immediately:**
```sql
ALTER TABLE contacts                FORCE ROW LEVEL SECURITY;
ALTER TABLE users                   FORCE ROW LEVEL SECURITY;
ALTER TABLE tickets                 FORCE ROW LEVEL SECURITY;
ALTER TABLE deals                   FORCE ROW LEVEL SECURITY;
ALTER TABLE companies               FORCE ROW LEVEL SECURITY;
ALTER TABLE activities              FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys                FORCE ROW LEVEL SECURITY;
ALTER TABLE emails                  FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices                FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments        FORCE ROW LEVEL SECURITY;
ALTER TABLE payments                FORCE ROW LEVEL SECURITY;
ALTER TABLE pipelines               FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments         FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_queues           FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_audit_log        FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_escalations      FORCE ROW LEVEL SECURITY;
ALTER TABLE webhooks                FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries      FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications           FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_calls             FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_bot_calls         FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_bot_configs       FORCE ROW LEVEL SECURITY;
ALTER TABLE csat_surveys            FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions           FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_contacts        FORCE ROW LEVEL SECURITY;
ALTER TABLE sla_policies            FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_history            FORCE ROW LEVEL SECURITY;
ALTER TABLE email_templates         FORCE ROW LEVEL SECURITY;
```

**Long-term fix:** Create a dedicated non-owner `crm_app` DB role for the connection pool — owners should never be the runtime user in a multi-tenant system.

---

### P0-002 🔴 Billing Routes Have Zero Role Guards — Any Agent/Viewer Can Access All Billing Data

**Discovered by:** RetailAgent + SupportAgent agents

**What happened:**
- `GET /api/v1/billing/subscription` → **200 OK** for agent-role users (should be 403)
- `GET /api/v1/billing/invoices` → **200 OK** for viewer-role users (should be 403)
- `POST /api/v1/billing/checkout` → returns **500** (server error) instead of 403 — the route doesn't even guard before attempting payment processing

**File:** `/packages/api/src/routes/billing.ts` — no `requireRole` or `requireScope` guards on any route handler

**Fix:** Add role guards to all billing routes:
```typescript
// All billing routes should require tenant_admin
fastify.addHook('preHandler', requireRole('tenant_admin'));
// or per-route:
{ preHandler: [authenticate, requireRole('tenant_admin')] }
```

---

### P0-003 🔴 Department Segregation NOT Implemented — Any Agent Sees All Modules

**Discovered by:** SupportAgent/RetailAgent department segregation agent

**What happened:**
- Support agent (`department: Customer Support`) called `GET /api/v1/deals` → **200 OK**, saw all 8 deals (should be 403)
- Retail agent (`department: Retail Banking`) called `GET /api/v1/tickets` → **200 OK**, saw all 6 tickets (should be 403)
- Support agent could `PATCH /api/v1/deals/:id/stage` → **200 OK** (cross-department write access)
- Retail agent could `POST /api/v1/tickets` → **201 Created** (should not have access)
- Both agents could read Voice calls even though Voice module is inactive

**Root Cause (3 layers of missing enforcement):**
1. The `permissions` JSONB object stored per user in the DB (e.g., `{"deals":"view","tickets":"full","billing":"none"}`) is **never read by any middleware** — it is dead code
2. The `department` field in the DB is **not propagated into the JWT** — guards have no data to check
3. `GET /api/v1/modules` shows only `crm` as active, but inactive modules (Ticketing, Voice, Sales) still serve full API responses — module activation flag is decorative

**Fix required:**
1. Include `department` and `permissions` in JWT payload on login
2. Implement a `requirePermission(module, level)` middleware that reads the user's `permissions` object
3. Make module activation actually gate the API routes (check `tenant.settings.activeModules` in route handlers)
4. Wire department to ticket queue visibility (users see only their department's queues)

---

## P1 HIGH — Fix Before Production

---

### P1-001 🟠 API Key Prefix Length Mismatch — All API Keys Non-Functional

**Discovered by:** Security agent

**Issue:** Creation stores `rawKey.slice(0, 12)` as `key_prefix`. Auth lookup uses `rawKey.slice(0, 8)`. Every API key authentication returns `INVALID_API_KEY`.

**Files:**
- `/packages/api/src/routes/api-keys.ts` line ~28: `slice(0, 12)`
- `/packages/api/src/middlewares/auth.middleware.ts` line ~55: `slice(0, 8)`

**Fix:** Make both consistent — change auth middleware to `slice(0, 12)`.

---

### P1-002 🟠 GET /api/v1/settings Base Route Exposes Tenant Config to All Roles

**Discovered by:** RetailAgent agent

**Issue:** `GET /api/v1/settings` (no suffix) returns tenant name, slug, plan, status, `billing_details`, sector settings to any authenticated user including agents and viewers. All sub-routes (`/settings/workspace`, `/settings/team`, etc.) are correctly guarded with `manager+` requirement, but the base route has no `preHandler`.

**File:** `/packages/api/src/routes/settings.ts` — base GET route missing preHandler

**Fix:** Add `preHandler: [authenticate, requireRole('manager')]` to the base settings route.

---

### P1-003 🟠 User Invite Flow Cannot Set Password Directly — Breaks Test Setup

**Discovered by:** BankAdmin agent

**Issue:** `POST /api/v1/settings/team/invite` creates users with `INVITE_PENDING` password hash. There is no admin API to set a password directly — users must click their email invite link. This makes programmatic test user creation impossible without direct DB access.

**Impact:** Cannot automate user creation in test environments; staging/dev environments without email configured are blocked.

**Fix:** Add an optional `password` field to the invite endpoint (for dev/test environments behind a feature flag), or add a `POST /api/v1/settings/team/:id/set-password` endpoint gated to `tenant_admin`.

---

### P1-004 🟠 Sector-Required Custom Fields Not Validated Server-Side

**Discovered by:** RetailAgent agent

**Issue:** Banking sector declares `customer_type`, `account_number`, `account_type` as `is_required: true` in `sectors.ts`. However, `POST /api/v1/contacts` accepts and saves contacts with empty `custom_fields: {}` — no validation error returned.

**Impact:** Contacts created in Banking tenant without KYC/account data — undermines compliance and data integrity requirements.

**Fix:** On contact creation, read the tenant's sector config, validate `custom_fields` against required sector fields, and return 400 with field-level errors for missing required fields.

---

## P2 MEDIUM — Fix in Next Sprint

---

### P2-001 🟡 System Roles Not Returned from GET /api/v1/roles

**Discovered by:** BankAdmin agent

**Issue:** `GET /api/v1/roles` returns only DB-stored custom roles (empty array for new tenants). System roles (`tenant_admin`, `manager`, `agent`, `viewer`) are hardcoded in app logic and not seeded to the DB or returned by this endpoint.

**Impact:** Frontend cannot enumerate available roles for user assignment unless custom roles exist. Role picker would show empty on a fresh tenant.

**Fix:** Return a merged list — hardcoded system roles + DB custom roles — from the roles endpoint.

---

### P2-002 🟡 Module Activation Flag Is Decorative — Routes Not Actually Gated

**Discovered by:** SupportAgent agent

**Issue:** `GET /api/v1/modules` correctly returns only `crm` as active for a tenant. However, `GET /api/v1/voice/calls`, `GET /api/v1/tickets`, and `GET /api/v1/sales/invoices` all respond to non-admin users regardless of whether the module is in `settings.activeModules`.

**Fix:** Add a `requireFeature(moduleName)` guard at the route level that checks `tenant.settings.activeModules`.

---

### P2-003 🟡 GET /api/v1/sales/invoices Returns 500 for Agent Users

**Discovered by:** Department segregation agent

**Issue:** Instead of 403, the sales invoices endpoint throws an unhandled internal server error for non-admin users. The route likely crashes before reaching the auth check.

**Fix:** Add error boundary and ensure the `requireRole` guard is the first preHandler — or fix the crash in the route handler.

---

## ✅ PASSING — Security Controls Working Correctly

| Test | Result | Notes |
|------|--------|-------|
| JWT X-Tenant-ID header injection | BLOCKED | JWT claim correctly wins over header |
| Token replay after logout | BLOCKED | Redis jti blocklist working |
| Tampered JWT (modified payload, old sig) | BLOCKED | HMAC-SHA256 verification correct |
| No token on protected routes | BLOCKED | 401 returned |
| Wrong password | BLOCKED | 401 + brute-force counter active |
| Cross-tenant login (FNB creds → Telecom) | BLOCKED | User lookup is tenant-scoped |
| Super-admin routes blocked for tenant_admin | BLOCKED | 403 correct |
| API key scope enforcement (logic) | BLOCKED | contacts:write blocked for contacts:read key |
| Random UUID enumeration | BLOCKED | 404 returned |
| Viewer cannot create contacts | BLOCKED | 403 correct |
| Viewer cannot create deals | BLOCKED | 403 correct |
| Viewer cannot create tickets | BLOCKED | 403 correct |
| Agent cannot create/modify roles | BLOCKED | 403 correct |
| Agent cannot modify other users | BLOCKED | 403 correct |
| Duplicate tenant slug rejected | BLOCKED | 409 correct |
| JWT payload has all required claims | PASS | sub, tenantId, role, plan, jti + sector bonus |
| Token expiry set to 8h | PASS | exp = iat + 28800 |
| Banking sector fields seeded on registration | PASS | 10 fields seeded |
| Banking departments seeded (5 depts) | PASS | Retail Banking, Loans, Cards, Customer Support, Compliance |
| Brute-force protection active | PASS | 5 attempts → lockout |

---

## Route Path Corrections (Not Bugs — Spec Issues)

The testing discovered these routes differ from the test checklist:

| Checklist Path | Actual Path |
|---------------|-------------|
| `GET /api/v1/users` | `GET /api/v1/settings/team` |
| `POST /api/v1/users` | `POST /api/v1/settings/team/invite` |
| `PATCH /api/v1/users/:id` | `PATCH /api/v1/settings/team/:id` |
| `GET /api/v1/settings/tenant` | `GET /api/v1/settings` or `/api/v1/settings/workspace` |
| `GET /api/v1/billing/subscriptions` | `GET /api/v1/billing/subscription` (singular) |

Update `CRM_TESTING_MASTER.md` with correct paths.

---

## Fix Priority Order

```
IMMEDIATE (block all deployments):
  1. P0-001 — Run FORCE ROW LEVEL SECURITY SQL on all 29 tables
  2. P0-002 — Add requireRole('tenant_admin') to billing routes
  3. P0-003 — Implement department/module permission enforcement

BEFORE PRODUCTION:
  4. P1-001 — Fix API key prefix slice(0,8) → slice(0,12)
  5. P1-002 — Add route guard to GET /api/v1/settings base
  6. P1-003 — Add password field to invite endpoint (test mode)
  7. P1-004 — Server-side sector custom field validation

NEXT SPRINT:
  8. P2-001 — Return system roles from GET /api/v1/roles
  9. P2-002 — Wire module activation to route guards
  10. P2-003 — Fix 500 on sales invoices for non-admin users
```

---

## How to Apply the P0-001 Fix Right Now

```bash
cd /Users/mba/Desktop/crm-platform

# Connect to the running PostgreSQL container
docker-compose exec postgres psql -U crm -d crm

# Then paste the ALTER TABLE block from P0-001 above
# Or run it non-interactively:
docker-compose exec -T postgres psql -U crm -d crm << 'EOF'
ALTER TABLE contacts                FORCE ROW LEVEL SECURITY;
ALTER TABLE users                   FORCE ROW LEVEL SECURITY;
ALTER TABLE tickets                 FORCE ROW LEVEL SECURITY;
ALTER TABLE deals                   FORCE ROW LEVEL SECURITY;
ALTER TABLE companies               FORCE ROW LEVEL SECURITY;
ALTER TABLE activities              FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys                FORCE ROW LEVEL SECURITY;
ALTER TABLE emails                  FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices                FORCE ROW LEVEL SECURITY;
ALTER TABLE payments                FORCE ROW LEVEL SECURITY;
ALTER TABLE pipelines               FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments         FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_queues           FORCE ROW LEVEL SECURITY;
ALTER TABLE webhooks                FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries      FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications           FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_calls             FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_bot_configs       FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions           FORCE ROW LEVEL SECURITY;
ALTER TABLE sla_policies            FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_history            FORCE ROW LEVEL SECURITY;
EOF

# Verify fix applied
docker-compose exec -T postgres psql -U crm -d crm -c \
  "SELECT relname, relforcerowsecurity FROM pg_class WHERE relkind='r' AND relrowsecurity=true ORDER BY relname;"
# All rows should show: relforcerowsecurity = t
```

This fix does NOT require a restart — takes effect immediately.
