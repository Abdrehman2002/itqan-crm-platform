# Vivid CRM — Technical Architecture Reference
**Prepared:** May 2026  
**Updated:** June 2026 — v2.0 (sectors, custom roles, CSAT, RCA, sales/invoicing, audit log)  
**Status:** Living document — reflects current codebase

---

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Database Schema — Tables & Key Columns](#2-database-schema)
3. [Tenancy Model](#3-tenancy-model)
4. [Role & Permission Implementation](#4-role--permission-implementation)
5. [Sector System](#5-sector-system)
6. [Workflow Handling](#6-workflow-handling)
7. [Voice Bot Architecture](#7-voice-bot-architecture)
8. [Sales & Invoicing Module](#8-sales--invoicing-module)
9. [Complaint Management & CSAT](#9-complaint-management--csat)
10. [End-to-End Flow: Voice Complaint → Ticket → CSAT](#10-end-to-end-flow-voice-complaint--ticket--csat)

---

## 1. System Overview

Vivid CRM is a **multi-tenant SaaS platform** built as a Turborepo monorepo.

```
crm-platform/
├── packages/
│   ├── api/          ← Fastify REST API (Node.js, TypeScript)
│   ├── frontend/     ← Vite + React 18 SPA
│   ├── core/         ← Shared DB client, EventBus, ModuleRegistry
│   └── shared/       ← TypeScript types + sector config shared across packages
└── modules/
    ├── contacts/     ← Feature module
    ├── deals/        ← Feature module
    ├── voice/        ← Feature module
    ├── crm/          ← Platform Hub (CRM product)
    ├── voice-module/ ← Platform Hub (Voice product)
    ├── ticketing/    ← Platform Hub (Ticketing product)
    └── sales/        ← Platform Hub (Sales & Invoicing — NEW v2)
```

**Runtime stack:**

| Layer | Technology |
|---|---|
| API framework | Fastify 4 + TypeScript |
| ORM / DB layer | Raw `pg` (node-postgres) with connection pooling |
| Database | PostgreSQL 15+ with Row-Level Security (RLS) |
| Cache / Queue | Redis + BullMQ (durable event bus, dual-mode: in-process + durable) |
| Auth | JWT HS256 (24h expiry) + API Keys (SHA-256 hashed) |
| Password hashing | bcryptjs cost 12 (~300ms) |
| Frontend | React 18 + Vite + Tailwind CSS + React Query + Zustand |
| Validation | Zod schemas on all API route inputs |
| Email | SendGrid (transactional + webhook tracking) |
| Voice Bot | Vapi / Retell AI / Bland.ai |
| Voice PSTN | Twilio / Vonage |
| Payments | Stripe, Wise, JazzCash, EasyPaisa, Raast |
| Docs | Swagger UI at `/docs` |

---

## 2. Database Schema

### 2.1 Entity Relationship Overview

```
tenants (1) ──< users (many)
tenants (1) ──< roles (many)              ← custom RBAC roles
users    (n) >── roles (1)                ← via custom_role_id

tenants (1) ──< custom_field_definitions  ← sector-driven fields

tenants (1) ──< contacts (many)
tenants (1) ──< companies (many)
contacts ──> companies                    ← optional link

tenants (1) ──< deals (many)
deals ──> pipelines + stages
deals ──> contacts / companies
deals ──> deal_history (audit trail)

tenants (1) ──< tickets (many)
tickets ──> ticket_queues                 ← routing queue
tickets ──> sla_policies                  ← SLA timer
tickets ──> contacts / companies
tickets ──< ticket_comments
tickets ──< ticket_escalations
tickets ──< ticket_audit_log              ← IMMUTABLE (v2 NEW)
tickets ──< csat_surveys (1:1)            ← one per ticket (v2 NEW)
tickets ──> voice_bot_calls               ← origin call (if voice channel)

tenants (1) ──< voice_calls (many)
tenants (1) ──< voice_bot_calls (many)
tenants (1) ──< voice_bot_configs

tenants (1) ──< emails
tenants (1) ──< activities
tenants (1) ──< pipelines

tenants (1) ──< billing_contacts          ← (v2 NEW) invoicing clients
tenants (1) ──< invoices                  ← (v2 NEW)
invoices   ──< invoice_line_items         ← (v2 NEW)
invoices   ──< invoice_payments           ← (v2 NEW)
tenants (1) ──  sales_settings (1:1)      ← (v2 NEW) per-tenant invoice config

tenants (1) ──< api_keys
tenants (1) ──< notifications
tenants (1) ──< usage_metrics
password_reset_tokens ──> users
```

---

### 2.2 Table Reference

#### `tenants` — Workspace / Organisation
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | Workspace identifier |
| name | TEXT | Display name |
| slug | TEXT UNIQUE | Subdomain (e.g. `acme` → `acme.yourcrm.com`) |
| custom_domain | TEXT | Optional CNAME |
| plan | TEXT | `starter / professional / enterprise` |
| status | TEXT | `trialing / active / suspended / cancelled` |
| sector | TEXT | `banking / telecom / public_transport / logistics / insurance / education / ecommerce / other` — **NEW v2** |
| trial_ends_at | TIMESTAMPTZ | 14-day trial from signup |
| settings | JSONB | Timezone, currency, dateFormat, feature flags |
| active_modules | TEXT[] | Which platform Hubs are enabled |
| billing_details | JSONB | Address, VAT, etc. |

---

#### `users` — Platform Users
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK → tenants | RLS key |
| email | TEXT | Unique per tenant |
| name | TEXT | |
| password_hash | TEXT | bcrypt cost 12; `INVITE_PENDING` until set |
| role | TEXT | `super_admin / platform_admin / tenant_admin / manager / agent / viewer` |
| custom_role_id | UUID FK → roles | Optional — overrides base role permissions |
| permissions | JSONB | Per-module permissions snapshot from role |
| department | TEXT | e.g. "Retail Banking", "Support" |
| is_active | BOOLEAN | Soft disable |
| last_login_at | TIMESTAMPTZ | |

---

#### `roles` — Custom RBAC Roles
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK → tenants | Tenant-scoped |
| name | TEXT | e.g. "Regional Manager" |
| description | TEXT | |
| color | TEXT | Hex colour for UI badge |
| is_system | BOOLEAN | System roles can't be renamed or deleted |
| base_role | TEXT | `manager / agent / viewer` — controls API-level access |
| permissions | JSONB | `{ contacts: "full", analytics: "view", billing: "none", … }` |

---

#### `custom_field_definitions` — Sector & Tenant Custom Fields **NEW v2**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | |
| entity | TEXT | `contact / company / deal / ticket` |
| name | TEXT | Snake_case machine key (e.g. `account_number`) |
| label | TEXT | Display label |
| field_type | TEXT | `text / email / phone / number / date / select / textarea / boolean` |
| options | JSONB | For select fields: array of option strings |
| is_required | BOOLEAN | |
| sort_order | INTEGER | UI display order |
| UNIQUE | (tenant_id, entity, name) | |

When a tenant registers, their chosen sector's pre-built fields are seeded automatically into this table.

---

#### `contacts` — People / Leads
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | RLS |
| first_name, last_name | TEXT | |
| email, phone, mobile | TEXT | |
| company_id | UUID FK → companies | Optional |
| owner_id | UUID FK → users | Assigned rep |
| status | TEXT | `lead / prospect / customer / churned / unqualified` |
| source | TEXT | `manual / import / api / voice_bot / web_form` |
| score | INTEGER | Lead score 0–100 |
| custom_fields | JSONB | Values for `custom_field_definitions` (sector fields stored here) |
| tags | TEXT[] | |

---

#### `companies` — Organisations / Accounts
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | |
| name, domain, industry | TEXT | |
| size | TEXT | `1-10 / 11-50 / 51-200 / 201-1000 / 1000+` |
| owner_id | UUID FK → users | |
| custom_fields | JSONB | |
| tags | TEXT[] | |

---

#### `deals` — Sales Opportunities
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | |
| name | TEXT | |
| pipeline_id | UUID FK → pipelines | |
| stage_id | UUID FK → stages | |
| status | TEXT | `open / won / lost` |
| amount | NUMERIC(15,2) | Deal value |
| currency | TEXT | 3-char ISO |
| close_date | DATE | |
| owner_id | UUID FK → users | |
| contact_id, company_id | UUID FK | Optional |
| lost_reason | TEXT | |
| won_at / lost_at | TIMESTAMPTZ | |
| custom_fields | JSONB | |

#### `pipelines` / `stages`
| Column | Type | Notes |
|---|---|---|
| pipelines.name | TEXT | e.g. "Main Sales", "Enterprise" |
| pipelines.is_default | BOOLEAN | |
| stages.position | INTEGER | Order within pipeline |
| stages.probability | INTEGER | 0–100% win likelihood |
| stages.is_won_stage / is_lost_stage | BOOLEAN | Terminal stages |

---

#### `tickets` — Support / Complaint Cases (updated v2)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | |
| ticket_number | SERIAL | Auto-increment; formatted as `TKT-0001` |
| subject | TEXT | |
| description | TEXT | |
| status | TEXT | `open → assigned → accepted → in_progress → pending → resolved → closed` |
| priority | TEXT | `urgent / high / medium / low` |
| channel | TEXT | `manual / email / phone / chat / api / voice_bot` |
| ticket_type | TEXT | `complaint / inquiry / request / incident / feedback` — **NEW v2** |
| queue_id | UUID FK → ticket_queues | Routing |
| sla_policy_id | UUID FK → sla_policies | |
| sla_due_at | TIMESTAMPTZ | Calculated when accepted |
| contact_id, company_id | UUID FK | |
| assignee_id | UUID FK → users | |
| reporter_email, reporter_name, reporter_phone | TEXT | |
| reporter_whatsapp | TEXT | **NEW v2** |
| preferred_channel | TEXT | `email / phone / whatsapp / sms / portal` — **NEW v2** |
| milestones | JSONB `[]` | Sector workflow checkpoints — **NEW v2** |
| escalation_level | INTEGER | `0 / 1 / 2` |
| root_cause | TEXT | RCA field — **NEW v2** |
| corrective_action | TEXT | RCA field — **NEW v2** |
| rca_completed_at | TIMESTAMPTZ | **NEW v2** |
| rca_completed_by | UUID FK → users | **NEW v2** |
| resolution_note | TEXT | |
| resolved_at, closed_at | TIMESTAMPTZ | |
| custom_fields | JSONB | |
| tags | TEXT[] | |

#### `ticket_queues` — Routing Groups
| Column | Type | Notes |
|---|---|---|
| name | TEXT | e.g. "Technical Support", "Billing" |
| is_default | BOOLEAN | Fallback queue |
| color | TEXT | Hex colour |

#### `sla_policies` — SLA Timers
| Column | Type | Notes |
|---|---|---|
| priority | TEXT | Which priority level |
| first_response_hours | INTEGER | e.g. 1 (urgent) |
| resolution_hours | INTEGER | e.g. 4 (urgent) |
| reminder_pct | INTEGER | Warn at X% of time elapsed (default 80) |
| l1_escalation_pct | INTEGER | Escalate at X% (default 100) |
| l2_escalation_pct | INTEGER | Escalate L2 at X% (default 150) |
| business_hours_only | BOOLEAN | |

#### `ticket_audit_log` — Immutable Audit Trail **NEW v2**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | RLS |
| ticket_id | UUID FK | |
| actor_id | UUID FK → users | Who made the change |
| actor_name | TEXT | Denormalised for readability |
| action | TEXT | `status_changed / assigned / field_updated / comment_added / escalated / rca_submitted / csat_sent / csat_received` |
| old_value | JSONB | Previous value |
| new_value | JSONB | New value |
| meta | JSONB | Extra context |
| created_at | TIMESTAMPTZ NOT NULL | |

> **IMMUTABLE:** A PostgreSQL trigger fires on any `UPDATE` or `DELETE` attempt and raises an exception. The audit log cannot be modified or erased — even by the database owner.

#### `csat_surveys` — Customer Satisfaction Surveys **NEW v2**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | |
| ticket_id | UUID FK UNIQUE | One survey per ticket |
| token | TEXT UNIQUE | URL-safe 32-char random token |
| reporter_email | TEXT | Survey recipient |
| sent_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | `sent_at + 7 days` |
| rating | INT | 1–5 (CHECK constraint) |
| comment | TEXT | Optional customer comment |
| responded_at | TIMESTAMPTZ | |

---

#### `voice_calls` — Human Agent Calls
| Column | Type | Notes |
|---|---|---|
| provider | TEXT | `twilio / vonage` |
| direction | TEXT | `inbound / outbound` |
| from_number, to_number | TEXT | |
| started_at, ended_at | TIMESTAMPTZ | |
| duration_seconds | INTEGER | |
| outcome | TEXT | `answered / no_answer / busy / failed` |
| recording_url, transcript | TEXT | |
| agent_id | UUID FK → users | |
| contact_id | UUID FK | |

#### `voice_bot_calls` — AI Voice Bot Calls
| Column | Type | Notes |
|---|---|---|
| provider | TEXT | `vapi / retell / bland` |
| provider_call_id | TEXT | Provider's call ID |
| from_number | TEXT | Caller phone |
| duration_seconds | INTEGER | |
| transcript | TEXT | Full conversation transcript |
| summary | TEXT | AI-generated summary |
| sentiment | TEXT | `positive / neutral / negative / urgent` |
| priority | TEXT | Auto-detected priority |
| contact_id | UUID FK | Matched contact |
| ticket_id | UUID FK → tickets | Created ticket |
| raw_payload | JSONB | Full provider webhook payload |

#### `voice_bot_configs` — AI Bot Configuration (per tenant)
| Column | Type | Notes |
|---|---|---|
| provider | TEXT | `vapi / retell / bland` |
| is_active | BOOLEAN | |
| assistant_id | TEXT | Provider-side bot ID |
| phone_number | TEXT | DID assigned to the bot |
| auto_create_ticket | BOOLEAN | |
| default_queue_id | UUID FK | |
| keyword_urgency | TEXT[] | Custom urgency keywords |

---

#### Sales & Invoicing Tables **NEW v2**

##### `billing_contacts` — Invoice Recipients
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK | |
| name, email | TEXT NOT NULL | |
| phone, company, tax_id | TEXT | |
| currency | TEXT | Default `USD` |
| billing_address | JSONB | Street, city, country, postcode |

##### `invoices`
| Column | Type | Notes |
|---|---|---|
| number | TEXT | Auto-generated: `INV-0001` |
| status | TEXT | `draft / sent / viewed / partial / paid / overdue / cancelled` |
| billing_contact_id | UUID FK | |
| issue_date, due_date | DATE | |
| po_reference | TEXT | |
| currency | TEXT | |
| template_id | TEXT | `tpl-classic` (default), `tpl-modern`, etc. |
| subtotal, total_tax, total | NUMERIC(15,2) | |
| amount_paid, amount_due | NUMERIC(15,2) | |
| notes, terms | TEXT | Footer text |
| logo_url | TEXT | |

##### `invoice_line_items`
| Column | Type | Notes |
|---|---|---|
| invoice_id | UUID FK ON DELETE CASCADE | |
| description | TEXT | |
| quantity | NUMERIC(12,4) | |
| unit_price | NUMERIC(15,2) | |
| tax_rate | NUMERIC(5,2) | % |
| tax_amount, total | NUMERIC(15,2) | Computed |
| sort_order | INT | UI ordering |

##### `invoice_payments`
| Column | Type | Notes |
|---|---|---|
| invoice_id | UUID FK | |
| amount | NUMERIC(15,2) | |
| payment_date | DATE | |
| mode_name | TEXT | e.g. "Bank Transfer", "JazzCash" |
| bank_account_name | TEXT | |
| reference | TEXT | |

##### `sales_settings` (1:1 per tenant)
| Column | Type | Notes |
|---|---|---|
| invoice_prefix | TEXT | `INV-` (default) |
| next_invoice_number | INT | Auto-increments atomically |
| default_currency | TEXT | |
| default_payment_terms | INT | Days (default 30) |
| tax_rates | JSONB `[]` | `[{ name, rate }]` |
| bank_accounts | JSONB `[]` | For invoice payment instructions |
| payment_modes | JSONB `[]` | |
| company_name, company_email, company_phone | TEXT | Invoice header |
| company_address | JSONB | |
| logo_url | TEXT | |

---

#### `emails` — Sent Emails
Tracks every outbound email: `status` (`pending / sent / delivered / failed / spam`), `provider`, `provider_message_id`, `opened_at`, `open_count`, `clicked_at`, `bounced_at`. Linked to `contact_id`.

#### `activities` — Tasks / Calls / Meetings
| Column | Type | Notes |
|---|---|---|
| type | TEXT | `call / email / meeting / task / note / whatsapp / sms / demo / proposal / voice_bot_call` |
| status | TEXT | `pending / completed / cancelled` |
| priority | TEXT | `low / normal / high / urgent` |
| subject, body | TEXT | |
| scheduled_at, due_at, completed_at | TIMESTAMPTZ | |
| contact_id, company_id, deal_id | UUID FK | |
| owner_id | UUID FK → users | |
| metadata | JSONB | |

#### `api_keys`
| Column | Type | Notes |
|---|---|---|
| name | TEXT | Friendly name |
| key_hash | TEXT UNIQUE | SHA-256 of `crm_live_...` key — plain text never stored |
| scopes | TEXT[] | e.g. `['contacts:read', 'tickets:write']` |
| created_by | UUID FK | |
| last_used_at | TIMESTAMPTZ | |

#### `password_reset_tokens`
| Column | Type | Notes |
|---|---|---|
| user_id | UUID PK FK | One active token per user (ON CONFLICT updates) |
| token_hash | TEXT | SHA-256 of actual reset token |
| expires_at | TIMESTAMPTZ | 1 hour from creation |
| used | BOOLEAN | Single-use: marked true immediately on use |

#### `notifications`
In-app notifications: `type`, `title`, `body`, `link`, `read_at`.

#### `usage_metrics`
Rolling counters per tenant: `metric`, `value`, `period` (YYYY-MM).

---

## 3. Tenancy Model

### Approach: Shared Database + Row-Level Security (RLS)

All tenants share **one PostgreSQL database**. Isolation is enforced at the DB layer using **PostgreSQL Row-Level Security** — not at the application layer.

Every data table has a `tenant_id UUID` column and an RLS policy:

```sql
CREATE POLICY tenant_isolation ON contacts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

### How tenant_id Flows Through the Stack

```
1. REQUEST ARRIVES
   └── Every request hits a preHandler hook in server.ts

2. TENANT RESOLUTION (tenant.middleware.ts)
   └── Reads tenant from JWT sub-claim (req.user.tenantId)
       OR from Host header subdomain (acme.yourcrm.com → slug = "acme")
       → Loads tenant from DB, attaches as req.tenant

3. AUTHENTICATION (auth.middleware.ts)
   └── Verifies JWT (HS256) or API Key (SHA-256 hash lookup)
       → Decodes: { sub: userId, tenantId, role, plan, department }
       → Attaches as req.user

4. DATABASE CALL (database/client.ts)
   ┌── withTenant(tenantId, fn)
   │   BEGIN
   │   SELECT set_config('app.tenant_id', tenantId, true)
   │   ← every query inside fn is automatically filtered by RLS →
   │   COMMIT
   └── withSuperAdmin(fn)
       BEGIN
       SET LOCAL app.bypass_rls = 'on'
       ← bypasses all RLS — used for cross-tenant lookups only →
       COMMIT
```

### Which Contexts Use Which Mode

| Context | DB Method | Why |
|---|---|---|
| Login (lookup user by email+tenant) | `withSuperAdmin` | Need to read before tenant context is set |
| Normal API read/write | `withTenant(req.tenant.id, ...)` | RLS-scoped to tenant |
| Super Admin dashboard | `withSuperAdmin` | Cross-tenant visibility |
| Password reset token lookup | `withSuperAdmin` | Token has no tenant context |
| Invite token creation | `withSuperAdmin` | Cross-table write |

### JWT Payload Structure

```json
{
  "sub": "user-uuid",
  "tenantId": "tenant-uuid",
  "role": "manager",
  "plan": "professional",
  "department": "Support",
  "iat": 1748000000,
  "exp": 1748086400
}
```

JWT expiry: **24 hours**. Frontend uses `/auth/refresh` for renewal.

---

## 4. Role & Permission Implementation

### Role Hierarchy (hardcoded, numeric levels)

```
super_admin    (50) — Platform owner; all tenants; billing controls
platform_admin (45) — Platform operations admin
tenant_admin   (40) — Workspace owner; full within their tenant
manager        (30) — Team lead; most modules, no billing admin
agent          (20) — Front-line; contacts/tickets/activities
viewer         (10) — Read-only across allowed modules
```

### Architecture: Hybrid (Code Defaults + DB-Driven Custom Roles)

```
BASE ROLES (code-defined, hardcoded hierarchy):
  super_admin  →  Platform owner — full access, all tenants
  tenant_admin →  Workspace owner — full access within tenant
  manager      →  Team lead — most modules, no billing/settings admin
  agent        →  Front-line — contacts/tickets/activities only
  viewer       →  Read-only

CUSTOM ROLES (DB-driven, tenant-created via roles table):
  Any name (e.g. "Retail Banking Agent", "Claims Adjuster")
  Inherits from a base_role for API-level checks
  Has granular permissions JSONB for per-module access
```

### Permission Matrix

```json
{
  "dashboard":    "view",
  "contacts":     "full",
  "companies":    "view",
  "deals":        "full",
  "activities":   "full",
  "tickets":      "full",
  "emails":       "full",
  "analytics":    "none",
  "voice":        "view",
  "voicebot":     "none",
  "integrations": "none",
  "settings":     "none",
  "billing":      "none"
}
```

**Access levels:** `none` = hidden | `view` = read-only | `full` = create/edit/delete

### How Permissions Are Resolved at Login

```
effectivePermissions =
  user.role_permissions    ← from custom role (roles table) — FIRST PRIORITY
  ?? user.permissions      ← snapshot stored on user row
  ?? {}                    ← fallback empty
```

When a custom role's permissions are updated, the change **propagates immediately to all users** with that `custom_role_id`.

### Permission Check Layers

```
Layer 1 — API Level (base role check):
  requireRole('tenant_admin', 'manager')
  → Checks req.user.role against allowed roles

Layer 2 — Scope Check (for API Keys):
  requireScope('contacts:write')
  → API keys have explicit scope arrays

Layer 3 — Frontend Module Visibility:
  effectivePermissions.contacts === 'none' → hide nav item
  effectivePermissions.contacts === 'view' → hide edit/delete/create buttons

Layer 4 — Feature Flags:
  requireFeature('voice')
  → Checks tenant.active_modules — plan-level gating
```

### Default Permissions by Base Role

| Module | super_admin | tenant_admin | manager | agent | viewer |
|---|---|---|---|---|---|
| Dashboard | view | view | view | view | view |
| Contacts | full | full | full | full | view |
| Companies | full | full | full | view | view |
| Deals | full | full | full | view | view |
| Activities | full | full | full | full | view |
| Tickets | full | full | full | full | view |
| Emails | full | full | full | full | none |
| Analytics | view | view | view | none | none |
| Voice Calls | full | full | full | view | none |
| Voice Bot | full | full | view | none | none |
| Integrations | full | full | view | none | none |
| Settings | view | view | none | none | none |
| Billing | view | view | none | none | none |

---

## 5. Sector System

### Overview

On registration, tenants select an **industry sector**. The sector drives:
- The label used for contacts (e.g. "Account Holder", "Passenger", "Policyholder")
- The label used for tickets (e.g. "Case", "Complaint", "Claim")
- The default departments created in the workspace
- The pre-built custom field definitions seeded into `custom_field_definitions`

### Sector Definitions (`packages/shared/src/config/sectors.ts`)

Each sector is defined as a static config object:

```typescript
{
  id: 'banking',
  label: 'Banking',
  icon: '🏦',
  color: '#1A5276',
  contactLabel: 'Account Holder',
  contactLabelPlural: 'Account Holders',
  ticketLabel: 'Case',
  departments: ['Retail Banking', 'Loans', 'Cards', 'Customer Support', 'Compliance'],
  fields: [
    { name: 'account_number', label: 'Account Number', field_type: 'text', is_required: true },
    { name: 'kyc_status', label: 'KYC Status', field_type: 'select',
      options: ['Pending','Submitted','Verified','Rejected','Expired'] },
    // ...
  ]
}
```

### Supported Sectors

| ID | Label | Contact Label | Ticket Label | Fields |
|---|---|---|---|---|
| `banking` | Banking | Account Holder | Case | 10 |
| `telecom` | Telecom | Subscriber | Trouble Ticket | 9 |
| `public_transport` | Public Transport | Passenger | Complaint | 11 |
| `logistics` | Logistics | Shipper/Consignee | Dispute | 11 |
| `insurance` | Insurance | Policyholder | Claim | 11 |
| `education` | Education | Student | Inquiry | 11 |
| `ecommerce` | eCommerce | Shopper | Issue | 10 |
| `other` | Other | Contact | Ticket | 4 |

### Registration Flow

```
Step 1: GET /sector/all
  ← Returns all 8 sector definitions (public endpoint, no auth)
  ← Frontend renders sector picker grid

Step 2: User selects sector, fills org details
  ← POST /auth/register { tenantName, tenantSlug, name, email, password, sector }

Step 3: Server side (TenantService.create):
  INSERT tenants (sector = 'banking')
  INSERT users (role = 'tenant_admin')
  → getSector('banking').fields.forEach(f => INSERT custom_field_definitions)
  → getSector('banking').departments.forEach(d => INSERT departments)
  → Seed default sales pipeline
  → Issue JWT
  → Return { token, user, tenant }
```

### Custom Fields API

Tenant admins can add/edit/remove fields beyond the sector defaults:

| Endpoint | Action |
|---|---|
| `GET /api/v1/sector` | Current sector config + all field definitions |
| `GET /api/v1/sector/fields` | Just the field list |
| `POST /api/v1/sector/fields` | Add field (`name` must be snake_case) |
| `PATCH /api/v1/sector/fields/:id` | Update label, options, required |
| `DELETE /api/v1/sector/fields/:id` | Remove field |

Field types: `text / email / phone / number / date / select / textarea / boolean`

---

## 6. Workflow Handling

### Approach: Hardcoded Status Enums + Explicit Transition Endpoints

No formal state machine library. Workflows use:
1. **Hardcoded status enum** validated by Zod at the API boundary
2. **Explicit transition endpoints** (e.g. `/tickets/:id/accept`, `/tickets/:id/resolve`)
3. **Side-effects triggered on transition** (SLA timer set, email sent, audit log written, event emitted)

---

### 6.1 Ticket Workflow

```
                     ┌───────────────────────────────────────────────────────┐
                     │                                                       │
  CREATE ──► open ──► assigned ──► accepted ──► in_progress ──► resolved ──► closed
                         │               │
                         │           SLA clock starts
                         │           + ticket_audit_log entry
                         │
                    (assign to agent)
```

**Status transitions and triggers:**

| From → To | Endpoint | Side Effects |
|---|---|---|
| (new) → open | `POST /tickets` | Creates ticket, writes CREATED audit entry |
| open → assigned | `POST /tickets/:id/assign` | Sets `assignee_id`, writes ASSIGNED audit entry |
| assigned → accepted | `POST /tickets/:id/accept` | Sets `accepted_at`, calculates `sla_due_at`, writes ACCEPTED audit entry |
| accepted → in_progress | `PATCH /tickets/:id` | Writes STATUS_CHANGED audit entry |
| any → pending | `PATCH /tickets/:id` | Waiting on customer |
| any → resolved | `POST /tickets/:id/resolve` | Sets `resolved_at`, sends resolution email, **triggers CSAT survey send** |
| resolved → closed | `POST /tickets/:id/close` | Sets `closed_at` |

**SLA Escalation** (background job checks every 15 min):
- At `reminder_pct` % (default 80) → warning notification
- At `l1_escalation_pct` % (default 100) → escalates to level 1 → notify agent + manager → ESCALATED audit entry
- At `l2_escalation_pct` % (default 150) → escalates to level 2 → notify tenant_admin

**Root Cause Analysis (RCA)** — available on resolved tickets:
```
PATCH /tickets/:id
{
  "root_cause": "Software bug in login module",
  "corrective_action": "Deployed hotfix v1.2.3"
}
→ Sets rca_completed_at, rca_completed_by
→ Writes RCA_SUBMITTED audit log entry
```

---

### 6.2 Deal Workflow

```
  (any stage) ──► won   [POST /deals/:id/won]
  (any stage) ──► lost  [POST /deals/:id/lost { reason }]
```

Deals move freely between pipeline stages. Every stage move is recorded in `deal_history`.

---

### 6.3 Activity Workflow

```
pending → completed
pending → cancelled
```

---

### 6.4 Invoice Workflow (NEW v2)

```
draft → sent → viewed → partial → paid
                                ↘ overdue (auto, if due_date passes)
                     ↘ cancelled (manual)
```

Payments are recorded as `invoice_payments` records. When `SUM(payments.amount) >= invoice.total`, status auto-transitions to `paid`. Partial payments set status to `partial`.

---

## 7. Voice Bot Architecture

### Position: Third-Party AI Provider → Webhook → CRM

```
Customer ──[calls phone number]──► AI Voice Provider (Vapi / Retell / Bland.ai)
                                        │
                                 Conducts conversation
                                 Extracts: subject, priority, name, email, sentiment
                                        │
                                 Call ends → POST webhook
                                        │
                              /api/v1/voice-bot/webhook/{provider}
                                        │
                              CRM validates HMAC-SHA256 signature
                              Normalises payload (provider-agnostic NormalisedCall)
                              Writes voice_bot_calls record
                                        │
                              if auto_create_ticket = true:
                                → INSERT tickets (channel='voice_bot')
                                → UPDATE voice_bot_calls SET ticket_id
                                → Contact match by email/phone
                                → Emit TICKET_CREATED event
```

### Supported Providers

| Provider | Webhook Event | Key Payload Fields |
|---|---|---|
| Vapi | `end-of-call-report` | `analysis.summary`, `analysis.customerName`, `call.duration` |
| Retell AI | `call_ended` / `call_analyzed` | `call_analysis.call_summary`, `call_analysis.user_sentiment` |
| Bland.ai | Direct call data | `concatenated_transcript`, `summary`, `call_length` |

### Priority & Sentiment Extraction

```typescript
extractPriority(summary: string): 'urgent' | 'high' | 'medium' | 'low'
  // Matches urgency keywords from voice_bot_configs.keyword_urgency
  // e.g. "emergency", "critical", "outage", "broken" → "urgent"

extractSentiment(text: string): 'positive' | 'neutral' | 'negative' | 'urgent'
  // Keyword-based; providers also supply their own sentiment field
```

### Webhook Security

HMAC-SHA256 verification on raw request body using provider-specific signing key. Requests with invalid signatures → 401.

---

## 8. Sales & Invoicing Module

### Overview

A full invoicing sub-system running alongside the CRM. Invoice data lives in its own tables (`billing_contacts`, `invoices`, `invoice_line_items`, `invoice_payments`, `sales_settings`) and is entirely RLS-scoped.

### Invoice Number Generation (atomic)

```sql
UPDATE sales_settings
SET next_invoice_number = next_invoice_number + 1
WHERE tenant_id = $1
RETURNING invoice_prefix, next_invoice_number - 1 AS seq;
-- Result: "INV-" + LPAD(seq::text, 4, '0') = "INV-0042"
```

### Invoice Lifecycle State Machine

```
draft ──► sent ──► viewed ──► partial ──► paid
                            ↘ overdue (background job: due_date < NOW() AND amount_due > 0)
          ↘ cancelled (manual)
```

### Payment Recording

```
POST /api/v1/sales/invoices/:id/payments
{
  "amount": 500.00,
  "payment_date": "2026-06-08",
  "mode_name": "Bank Transfer",
  "reference": "TRN-12345"
}
→ INSERT invoice_payments
→ UPDATE invoices SET amount_paid += 500, amount_due -= 500
→ if amount_due <= 0 → status = 'paid'
→ if amount_due > 0  → status = 'partial'
```

### Sales Settings API

```
GET  /api/v1/sales/settings   ← returns prefix, tax rates, bank accounts, payment modes
PUT  /api/v1/sales/settings   ← updates any of the above
```

---

## 9. Complaint Management & CSAT

### RCA (Root Cause Analysis) — v2

Extends the ticket record with structured post-resolution analysis fields:

```
Ticket resolved → Agent fills RCA form
  PATCH /api/v1/tickets/:id
  {
    "root_cause": "...",
    "corrective_action": "..."
  }
  → rca_completed_at = NOW(), rca_completed_by = req.user.id
  → ticket_audit_log: action = 'rca_submitted'
```

### CSAT Survey Flow

```
1. Ticket status → 'resolved'
   → System generates token = crypto.randomBytes(16).toString('hex')
   → INSERT csat_surveys (ticket_id, token, reporter_email, expires_at = NOW()+7d)
   → Send email: "Please rate your experience" + https://yourcrm.com/survey/{token}
   → ticket_audit_log: action = 'csat_sent'

2. Customer clicks link
   GET /public/csat/:token        ← public, no auth
   ← Returns: ticket subject, tenant name, sent_at, expires_at

3. Customer submits rating
   POST /public/csat/:token
   { "rating": 4, "comment": "Quick resolution, thanks!" }
   → UPDATE csat_surveys SET rating, comment, responded_at = NOW()
   → ticket_audit_log: action = 'csat_received', new_value: { rating: 4 }
   → if expired (expires_at < NOW()) → 410 Gone

4. Internal analytics
   GET /api/v1/tickets/csat/summary
   ← { avg_rating, total_sent, total_responses, response_rate_pct, distribution: {1:n, 2:n, 3:n, 4:n, 5:n} }
```

### Ticket Audit Log Details

The `ticket_audit_log` table is written by the API on every ticket state change. A PostgreSQL trigger enforces immutability:

```sql
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ticket_audit_log is immutable — records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
BEFORE UPDATE OR DELETE ON ticket_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
```

**Actions logged:**

| Action | When |
|---|---|
| `status_changed` | Any ticket status transition |
| `assigned` | Ticket assigned to agent |
| `field_updated` | Any field update via PATCH |
| `comment_added` | Agent/customer comment |
| `escalated` | SLA escalation level increases |
| `rca_submitted` | Root cause analysis completed |
| `csat_sent` | Survey email dispatched |
| `csat_received` | Customer submits rating |

---

## 10. End-to-End Flow: Voice Complaint → Ticket → CSAT

**Scenario:** Customer calls, AI bot handles call, ticket is auto-created, agent resolves, CSAT survey is sent.

---

**Step 1 — Call arrives at AI provider**

Customer calls `+1-800-XXX-XXXX`. Vapi's AI answers using the `system_prompt` from `voice_bot_configs`.

---

**Step 2 — AI conducts conversation, generates report**

```json
{
  "type": "end-of-call-report",
  "call": { "id": "vapi_call_abc123", "customer": { "number": "+15551234567" }, "duration": 142 },
  "analysis": {
    "summary": "Customer account locked out since this morning, unable to log in.",
    "customerName": "John Smith",
    "customerEmail": "john@example.com"
  },
  "transcript": "Agent: Hi... Customer: My account is locked..."
}
```

---

**Step 3 — Webhook delivered, HMAC validated**

```
POST /api/v1/voice-bot/webhook/vapi
x-vapi-signature: hmac-sha256-of-body
```

---

**Step 4 — Payload normalised**

```typescript
const call: NormalisedCall = normaliseVapi(payload);
// { providerCallId, fromNumber, summary, extractedName, extractedEmail, ... }
```

Priority extracted: `"medium"` (no urgency keywords)  
Sentiment extracted: `"negative"`

---

**Step 5 — DB writes (within withTenant transaction)**

```sql
-- Write 1: voice_bot_calls
INSERT INTO voice_bot_calls (...) RETURNING id;  -- vbc-001

-- Write 2: ticket_counters (atomic)
UPDATE ticket_counters SET next_val = next_val + 1
WHERE tenant_id = $1 RETURNING next_val;  -- → TKT-0042

-- Write 3: tickets
INSERT INTO tickets (
  subject, channel, priority, reporter_name, reporter_email,
  ticket_number, voice_call_id, ...
) VALUES (...) RETURNING id;  -- tkt-001

-- Write 4: link back
UPDATE voice_bot_calls SET ticket_id = 'tkt-001' WHERE id = 'vbc-001';

-- Write 5: audit log
INSERT INTO ticket_audit_log (action='status_changed', new_value={status:'open'}, ...);
```

---

**Step 6 — Event emitted**

```typescript
eventBus.emit(CRM_EVENTS.TICKET_CREATED, { tenantId, ticketId, channel: 'voice_bot' });
```

---

**Step 7 — Agent accepts and works ticket**

```
POST /api/v1/tickets/tkt-001/accept
→ accepted_at = NOW(), sla_due_at = NOW() + 4h (from SLA policy for 'medium')
→ ticket_audit_log: action = 'assigned'
```

---

**Step 8 — Agent resolves with RCA**

```
POST /api/v1/tickets/tkt-001/resolve
{ "resolution_note": "Reset account lock. Customer confirmed access restored." }

PATCH /api/v1/tickets/tkt-001
{ "root_cause": "Account auto-locked after 5 failed attempts",
  "corrective_action": "Customer educated on password reset self-service" }

→ ticket_audit_log: action = 'rca_submitted'
```

---

**Step 9 — CSAT survey triggered**

```
→ token = crypto.randomBytes(16).toString('hex')  -- e.g. "a3f9b2..."
→ INSERT csat_surveys (ticket_id=tkt-001, token, reporter_email=john@example.com, expires_at=+7d)
→ SendGrid email: "How did we do?" → https://yourcrm.com/survey/a3f9b2...
→ ticket_audit_log: action = 'csat_sent'
```

---

**Step 10 — Customer submits rating**

```
POST /public/csat/a3f9b2...
{ "rating": 4, "comment": "Quick fix, thanks!" }

→ UPDATE csat_surveys SET rating=4, comment, responded_at=NOW()
→ ticket_audit_log: action = 'csat_received', new_value: { rating: 4 }
```

---

**Complete data written summary:**

| Step | Table | Action |
|---|---|---|
| Bot call arrives | `voice_bot_calls` | INSERT |
| Ticket created | `tickets` | INSERT TKT-0042 |
| Link back | `voice_bot_calls` | UPDATE ticket_id |
| Audit: created | `ticket_audit_log` | INSERT status_changed(open) |
| Agent accepts | `tickets` | UPDATE accepted_at, sla_due_at |
| Audit: accepted | `ticket_audit_log` | INSERT status_changed(accepted) |
| Agent resolves | `tickets` | UPDATE resolved_at + note |
| Audit: resolved | `ticket_audit_log` | INSERT status_changed(resolved) |
| RCA submitted | `tickets` | UPDATE root_cause, corrective_action |
| Audit: RCA | `ticket_audit_log` | INSERT rca_submitted |
| CSAT sent | `csat_surveys` | INSERT |
| Audit: CSAT sent | `ticket_audit_log` | INSERT csat_sent |
| Customer rates | `csat_surveys` | UPDATE rating, responded_at |
| Audit: CSAT received | `ticket_audit_log` | INSERT csat_received |

---

*End of document — v2.0 June 2026*
