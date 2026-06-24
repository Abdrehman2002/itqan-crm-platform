# MASTER PRODUCT DOCUMENT
**AI Operations Platform — Multi-Tenant CRM, Contact-Centre & Sales Suite**
_Single source of truth for system requirements & behaviour. Update only affected sections on each change._

Last updated: 2026-06-23

---

## 1. Overview
A multi-tenant SaaS suite hosting many isolated customer organisations ("tenants") on one system.
Each tenant combines CRM, a contact centre (with an AI voice agent), sales & invoicing, analytics,
and team collaboration.

- **Frontend:** React + TanStack, Vite (`packages/frontend`)
- **API:** Fastify + GraphQL/Mercurius, Zod, JWT (`packages/api`)
- **DB:** PostgreSQL with Row-Level Security; 24 migrations (`packages/core`)
- **Voice:** LiveKit ("Nadia" agent) · **Email:** SMTP / SendGrid / MS365

## 2. Roles & Access Control (three layers + separation of duties)
1. **Entitlement (what is licensed):** super-admin licenses modules + features per tenant
   (`tenants.entitled_features`). Unlicensed features hidden in nav and refused by API.
2. **Roles (who may act):** tenant admin assigns create/edit/delete per role (Admin, Manager,
   Agent, Viewer + custom). Four system roles auto-seeded.
3. **Record visibility (whose records):** hard filter by line-manager tree
   (`getVisibleUserIds`, `packages/api/src/lib/visibility.ts`) — agent = own; line manager = team;
   manager = department. Applies to contacts, deals, activities, companies, opportunities, dashboards.
4. **Separation of duties:** `tenant_admin` is administrative-only — **blocked** from all operational
   + billing routes (gateway in `server.ts`); home is Settings. Billing (subscription + invoicing)
   belongs to a Finance/Sales role, never the admin.

## 3. Modules (capability surface)
Core CRM (contacts, companies, deals, activities) · Sales & Invoicing (invoices, billing-contacts,
payments, dashboard, templates, settings) · Ticketing/Contact-Centre (queues, routing, SLA/TAT, CSAT,
milestones) · Voice + Voice-bot (Nadia/LiveKit) · Email inbox · Analytics & Reports · Team Messaging ·
Integrations (connectors, webhooks, API keys) · Departments & Opportunities · Super-Admin console.

## 4. Key Workflows
### 4.1 Customer onboarding
Super-admin creates workspace (details+admin → modules+features) → first tenant admin provisioned with
one-time temp password → password e-mailed (SendGrid); super-admin can reset/re-send → system roles
seeded → tenant admin tailors roles, invites staff, sets each person's line manager & department.

### 4.2 Inbound handling (enquiry → resolution)
Customer calls → voice bot greets & understands → creates complaint / support / sales ticket →
smart routing to the right team → agent accepts (TAT/SLA starts) → worked through stages + milestones →
interval reminders + auto-escalation before breach → resolved → customer informed + CSAT survey.
Ticket + live status also appear on the customer's CRM record (Contact → Tickets tab, with TAT countdown).

### 4.3 Sales ticket → pipeline deal
A `sales` ticket, on acceptance (or via manual **Convert to Deal** button), creates a linked deal in the
default pipeline (owner = handling agent; carries contact/company). Idempotent (`tickets.deal_id`).
Complaints keep the normal resolve→close lifecycle.

## 5. Data Model
24 ordered migrations. Notable: `012_line_manager` (manager_id), `018_departments_and_opportunities`,
`023_tenant_entitlements`, `024_ticket_deal_link`. Users link to departments by `department`/`department_type`
text (no `department_id` column).

## 6. Environments & Access
Repo: github.com/munirrazaa/AI-Operations-Platfrom- (main). Frontend: Vercel · API: VPS ·
DB: PostgreSQL (Supabase pooler, TLS) · Storage: S3-compatible · Redis optional.
Secrets in local `.env` only (git-ignored). Demo: workspace `demo`, super-admin `admin@demo.com`.
