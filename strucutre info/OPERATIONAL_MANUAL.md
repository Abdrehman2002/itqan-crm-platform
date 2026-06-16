# CRM Platform — Operational Manual

**Version:** 2.0  
**Date:** June 2026 — Updated for v2 features (sectors, custom roles, CSAT, RCA, Sales & Invoicing, audit log, login credentials)  
**Audience:** System Administrators, Tenant Administrators, Agents, Managers

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Registration & Onboarding](#2-registration--onboarding)
3. [Industry Sectors](#3-industry-sectors)
4. [Architecture & Information Flow](#4-architecture--information-flow)
5. [User Roles & Permissions](#5-user-roles--permissions)
6. [Login URLs & Credentials](#6-login-urls--credentials)
7. [Module 1 — Contacts (CRM Core)](#7-module-1--contacts-crm-core)
8. [Module 2 — Companies](#8-module-2--companies)
9. [Module 3 — Deals & Pipelines](#9-module-3--deals--pipelines)
10. [Module 4 — Activities & Tasks](#10-module-4--activities--tasks)
11. [Module 5 — Email](#11-module-5--email)
12. [Module 6 — Voice Calls](#12-module-6--voice-calls)
13. [Module 7 — Voice Bot (AI)](#13-module-7--voice-bot-ai)
14. [Module 8 — Ticketing & Help Desk](#14-module-8--ticketing--help-desk)
15. [Module 9 — CSAT Surveys (NEW v2)](#15-module-9--csat-surveys-new-v2)
16. [Module 10 — Ticket Audit Log (NEW v2)](#16-module-10--ticket-audit-log-new-v2)
17. [Module 11 — Analytics & Reporting](#17-module-11--analytics--reporting)
18. [Module 12 — Sales & Invoicing (NEW v2)](#18-module-12--sales--invoicing-new-v2)
19. [Module 13 — Billing & Subscriptions](#19-module-13--billing--subscriptions)
20. [Module 14 — Settings & Team Management](#20-module-14--settings--team-management)
21. [Module 15 — API Keys & Integrations](#21-module-15--api-keys--integrations)
22. [Inter-Module Data Flow](#22-inter-module-data-flow)
23. [On-Premises Installation Guide](#23-on-premises-installation-guide)
24. [Cloud Installation Guide](#24-cloud-installation-guide)
25. [Environment Variables Reference](#25-environment-variables-reference)
26. [Database Schema Reference](#26-database-schema-reference)
27. [API Reference Overview](#27-api-reference-overview)
28. [Troubleshooting Guide](#28-troubleshooting-guide)
29. [Security Best Practices](#29-security-best-practices)
30. [Upgrade & Maintenance](#30-upgrade--maintenance)

---

## 1. System Overview

**Vivid CRM** is a **multi-tenant SaaS Customer Relationship Management platform** built by Vivid Solutions & Services for businesses across multiple industry verticals. It combines traditional CRM (contacts, deals, pipelines) with a full-featured help desk, AI-powered voice bot triage, email tracking, invoicing, complaint management with CSAT, and real-time analytics — all in a single unified platform with complete data isolation per workspace.

**Platform:** yourcrm.com | **Version:** 2.0 (June 2026)

### 1.1 Key Capabilities

| Capability | Description |
|---|---|
| **CRM Core** | Contact and company management with sector-specific custom fields, tags, and lifecycle tracking |
| **Industry Sectors** | 8 built-in vertical presets (Banking, Telecom, Transport, Logistics, Insurance, Education, eCommerce, Other) — **NEW v2** |
| **Deal Pipelines** | Kanban-style deal management with customisable stages and probability tracking |
| **Activity Tracking** | Tasks, calls, meetings, notes, emails — all linked to contacts and deals |
| **Email** | Outbound email with open/click tracking and bounce handling via SendGrid |
| **Voice** | Inbound/outbound call logging via Twilio or Vonage |
| **AI Voice Bot** | Automated inbound triage via Vapi, Retell AI, or Bland.ai — auto-creates tickets |
| **Help Desk** | Full ticketing system with SLA policies, queues, escalation chains, RCA, milestones |
| **CSAT Surveys** | Auto-sent on ticket close; 1–5 star rating with analytics dashboard — **NEW v2** |
| **Ticket Audit Log** | Immutable DB-level audit trail of all ticket state changes — **NEW v2** |
| **Sales & Invoicing** | Full invoice lifecycle with billing contacts, line items, payments, templates — **NEW v2** |
| **Custom Roles** | Granular module-level permissions (none/view/full) per role — **NEW v2** |
| **Analytics** | Real-time dashboard, revenue charts, pipeline funnel, agent leaderboard |
| **Billing** | Plan management with Stripe, Wise, JazzCash, EasyPaisa, Raast, PayPal |
| **Multi-Tenancy** | Complete data isolation per workspace using PostgreSQL Row-Level Security |

### 1.2 Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Recharts, React Query |
| **API** | Node.js 20, Fastify, TypeScript, Zod (validation) |
| **Database** | PostgreSQL 15+ with Row-Level Security (RLS) |
| **Auth** | JWT HS256 (24h expiry), bcryptjs (cost 12), SHA-256 API key hashing |
| **Queue / Cache** | Redis + BullMQ (durable event bus) |
| **Email** | SendGrid (transactional + tracking webhooks) |
| **Voice Bot** | Vapi / Retell AI / Bland.ai (third-party AI providers) |
| **Voice PSTN** | Twilio / Vonage |
| **Payments** | Stripe, Wise, JazzCash, EasyPaisa, Raast, PayPal |
| **Monorepo** | Turborepo with pnpm workspaces |
| **Containers** | Docker + Docker Compose / AWS ECS |

---

## 2. Registration & Onboarding

### 2.1 Self-Service Registration (2-Step)

**Step 1 — Select Industry Sector**
1. Navigate to `https://yourcrm.com/register`
2. The sector picker grid displays all 8 industry sectors with icons and descriptions
3. Click your sector tile → review contact label, pre-built fields, default departments
4. Click **Continue**

**Step 2 — Create Your Workspace**
1. Fill in Organisation Name (auto-generates Workspace Slug)
2. Review/edit Workspace Slug — lowercase letters, numbers, hyphens only
3. Fill in Full Name, Work Email, Password (min 8 characters), Confirm Password
4. Click **Create Workspace**

On success:
- Tenant workspace created (status: `trialing`, plan: `starter`, 14-day trial)
- First user assigned `tenant_admin` role
- Sector custom fields seeded into `custom_field_definitions`
- Default departments and sales pipeline created
- Auto-login → redirect to `/dashboard`

### 2.2 Invited User Registration

1. Admin: **Settings → Team → Invite Member** (enter name, email, role)
2. Invitation email sent with one-time login link
3. User clicks link → sets password → added to workspace

### 2.3 Login & Password Reset

| URL | Purpose |
|---|---|
| `https://yourcrm.com/login` | Enter workspace slug + email + password |
| `https://[slug].yourcrm.com/login` | Direct subdomain (auto-fills slug) |
| `https://yourcrm.com/forgot-password` | Request 1-hour reset email |

JWT issued on login (24h expiry). Password reset tokens: SHA-256 hashed, single-use, 1-hour expiry.

---

## 3. Industry Sectors

### 3.1 Overview

On registration, each workspace is assigned an industry sector. The sector controls:
- What contacts are called (e.g. "Account Holder", "Passenger", "Policyholder")
- What tickets/cases are called (e.g. "Case", "Claim", "Dispute")
- Default departments created in the workspace
- Pre-built custom fields seeded into the workspace

### 3.2 Sector Reference

| Sector | Contact Label | Ticket Label | Departments | Pre-built Fields |
|---|---|---|---|---|
| 🏦 Banking | Account Holder | Case | Retail Banking, Loans, Cards, Customer Support, Compliance | 10 |
| 📡 Telecom | Subscriber | Trouble Ticket | Mobile Services, Broadband, Enterprise, Technical Support, Billing | 9 |
| 🚌 Public Transport | Passenger | Complaint | Passenger Services, Operations, Ticketing, Lost & Found, Accessibility | 11 |
| 🚚 Logistics | Shipper/Consignee | Dispute | Customer Service, Operations, Customs & Compliance, Warehousing, Last Mile | 11 |
| 🛡️ Insurance | Policyholder | Claim | New Business, Claims, Renewals, Customer Support, Underwriting | 11 |
| 🎓 Education | Student | Inquiry | Admissions, Student Services, Finance & Fees, Academic Affairs, Alumni | 11 |
| 🛒 eCommerce | Shopper | Issue | Customer Support, Returns & Refunds, Payments, Logistics, Seller Support | 10 |
| 🏢 Other | Contact | Ticket | Customer Support, Sales, Operations | 4 |

### 3.3 Custom Field Types

Tenant admins can add fields beyond sector defaults via **Settings → Sector Fields** or `POST /api/v1/sector/fields`:

`text` | `email` | `phone` | `number` | `date` | `select` | `textarea` | `boolean`

---

## 4. Architecture & Information Flow

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER / CLIENT                           │
│              React SPA  ─── Vite Dev Proxy (dev only)              │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FASTIFY API SERVER                          │
│                                                                     │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Auth   │  │  Routes  │  │ Middleware│  │  Event Bus       │   │
│  │ JWT/Key │  │ /api/v1/ │  │ RLS/Role │  │ (in-process pub) │   │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       └────────────┴─────────────┘                  │             │
│                          │                           │             │
└──────────────────────────┼───────────────────────────┼─────────────┘
                           │                           │
                           ▼                           ▼
┌────────────────────────────────┐   ┌───────────────────────────────┐
│       PostgreSQL (RLS)         │   │      External Services         │
│                                │   │                               │
│  tenant schema per row via     │   │  SendGrid  (email)            │
│  SET app.tenant_id = $uuid     │   │  Vapi / Retell / Bland (bot)  │
│                                │   │  Twilio / Vonage (voice)      │
│  Tables:                       │   │  Stripe / Wise / JazzCash     │
│  tenants  users  contacts      │   │  EasyPaisa / Raast (billing)  │
│  companies deals activities    │   │                               │
│  tickets  emails voice_calls   │   └───────────────────────────────┘
│  voice_bot_calls pipelines     │
│  stages   queues  sla_policies │
│  notifications  api_keys       │
└────────────────────────────────┘
```

### 4.2 Request Authentication Flow

```
Client Request
     │
     ▼
Extract token from Authorization header
     │
     ├── Bearer <JWT>  ──► Verify JWT signature → decode { sub, tenantId, role, scopes }
     │
     └── ApiKey <key>  ──► Hash key → lookup api_keys table → get { tenantId, scopes }
                                │
                                ▼
                    Set req.tenant.id + req.user
                                │
                                ▼
                    requireRole() / requireScope() checks
                                │
                    ┌───────────┴───────────┐
                   PASS                   FAIL
                    │                      │
                    ▼                      ▼
              Route Handler          403 Forbidden
                    │
                    ▼
          db.withTenant(tenantId, fn)
          — SET app.tenant_id = $id
          — All queries auto-filtered by RLS
```

### 4.3 Multi-Tenancy Data Isolation

Every database table that contains tenant-specific data has:
1. A `tenant_id UUID` column
2. A PostgreSQL Row-Level Security policy: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`

The API wrapper `db.withTenant(tenantId, fn)` sets the session variable before any query, ensuring **absolute data isolation** between workspaces. The `db.withSuperAdmin(fn)` wrapper bypasses RLS for system-level operations (e.g. reading tenant config).

---

## 5. User Roles & Permissions

### 5.1 Role Hierarchy

```
super_admin    (level 50)  — Platform-wide admin; access to all tenants; billing controls
     │
platform_admin (level 45)  — Platform operations admin (NEW v2)
     │
tenant_admin   (level 40)  — Workspace owner; manages team, settings, modules
     │
manager        (level 30)  — Team lead; full CRM access; reports; cannot change billing
     │
agent          (level 20)  — Frontline staff; CRM read/write; cannot manage team
     │
viewer         (level 10)  — Read-only access to assigned records
```

### 5.2 Custom Roles (NEW v2)

Tenant Admins can create custom roles with per-module permissions:
1. Go to **Roles** (sidebar footer) → **+ New Role**
2. Enter name, description, colour, select base role (agent/manager/viewer)
3. Adjust each module's access level: `none` | `view` | `full`
4. Click **Create Role** → assign to team members in **Settings → Team**

### 5.3 Module Permission Matrix

| Module | viewer | agent | manager | tenant_admin | super_admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Dashboard | view | view | view | view | view |
| Contacts | view | full | full | full | full |
| Companies | view | view | full | full | full |
| Deals | view | view | full | full | full |
| Activities | view | full | full | full | full |
| Tickets | view | full | full | full | full |
| Emails | none | full | full | full | full |
| Analytics | none | none | view | view | view |
| Voice Calls | none | view | full | full | full |
| Voice Bot | none | none | view | full | full |
| Integrations | none | none | view | full | full |
| Settings | none | none | none | view | view |
| Billing | none | none | none | view | view |

### 5.4 Permission Matrix (Feature Level)

| Feature | viewer | agent | manager | tenant_admin | super_admin |
|---|:---:|:---:|:---:|:---:|:---:|
| View contacts | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit contacts | — | ✓ | ✓ | ✓ | ✓ |
| Delete contacts | — | — | ✓ | ✓ | ✓ |
| View deals | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/move deals | — | ✓ | ✓ | ✓ | ✓ |
| Mark deal won/lost | — | ✓ | ✓ | ✓ | ✓ |
| View activities | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create activities | — | ✓ | ✓ | ✓ | ✓ |
| View tickets | ✓ | ✓ | ✓ | ✓ | ✓ |
| Resolve tickets | — | ✓ | ✓ | ✓ | ✓ |
| Manage queues/SLA | — | — | ✓ | ✓ | ✓ |
| View analytics | — | — | ✓ | ✓ | ✓ |
| Invite team members | — | — | — | ✓ | ✓ |
| Change team roles | — | — | — | ✓ | ✓ |
| Workspace settings | — | — | — | ✓ | ✓ |
| Billing management | — | — | — | ✓ | ✓ |
| Manage API keys | — | — | — | ✓ | ✓ |
| Super-admin panel | — | — | — | — | ✓ |

### 5.5 API Scopes

API keys use fine-grained scopes independent of roles:

| Scope | Access Granted |
|---|---|
| `contacts:read` | List and view contacts |
| `contacts:write` | Create, update, delete contacts |
| `deals:read` | View pipelines and deals |
| `deals:write` | Create, move, close deals |
| `tickets:read` | View tickets and comments |
| `tickets:write` | Create, update, resolve tickets |
| `activities:read` | View activities |
| `activities:write` | Create and complete activities |
| `analytics:read` | Access analytics endpoints |
| `emails:read` | View email logs |
| `emails:write` | Send emails |
| `voice:read` | View call logs |
| `voice:write` | Initiate calls |

---

## 6. Login URLs & Credentials

### 6.1 Platform URLs

| URL | Purpose |
|---|---|
| `http://localhost:5173/login` | Development login |
| `https://yourcrm.com/login` | Production login |
| `https://[slug].yourcrm.com/login` | Subdomain login (auto-fills workspace slug) |
| `https://yourcrm.com/register` | New workspace registration |
| `https://yourcrm.com/forgot-password` | Password reset |

**How to log in:**
1. Go to login URL
2. Enter the **Workspace Slug** (e.g. `demo-logistics`)
3. Enter **Email** and **Password**
4. Click **Sign In**

### 6.2 Password Policy (enforced for all accounts)
- Minimum 10 characters
- Must contain uppercase, lowercase, number, and special character

### 6.3 Banking — Workspace: `demo`

| Role | Email | Password | Department |
|---|---|---|---|
| Super Admin | admin@demo.com | Vivid@Solutions1 | — |
| Tenant Admin | munir@vividsns.com | Vivid@Solutions1 | — |
| Sales Manager | sales.manager@demo.com | Manager@Vivid1 | Sales |
| Support Manager | support.manager@demo.com | Manager@Vivid1 | Support |
| Sales Agent | sales.agent@demo.com | Agent@Vivid123 | Sales |
| Support Agent | support.agent@demo.com | Agent@Vivid123 | Support |
| Complaints Agent | complaints.agent@demo.com | Agent@Vivid123 | Complaints |

### 6.4 All Workspace Credentials — Quick Reference

| Sector | Workspace Slug | Tenant Admin Email | Password |
|---|---|---|---|
| 🏦 Banking | `demo` | munir@vividsns.com | Vivid@Solutions1 |
| 📡 Telecom | `demo-telecom` | admin@demo-telecom.com | Vivid@Solutions1 |
| 🚌 Public Transport | `demo-transport` | admin@demo-transport.com | Vivid@Solutions1 |
| 🚚 Logistics | `demo-logistics` | admin@demo-logistics.com | Vivid@Solutions1 |
| 🛡️ Insurance | `demo-insurance` | admin@demo-insurance.com | Vivid@Solutions1 |
| 🎓 Education | `demo-education` | admin@demo-education.com | Vivid@Solutions1 |
| 🛒 eCommerce | `demo-ecommerce` | admin@demo-ecommerce.com | Vivid@Solutions1 |
| 🏢 Other / General | `demo-other` | admin@demo-other.com | Vivid@Solutions1 |

> ⚠️ **These are demo/development credentials. Never use in production. Change all passwords after deployment.**

---

## 7. Module 1 — Contacts (CRM Core)

### 7.1 What is the Contacts Module?

The Contacts module is the **central record store** of the CRM. Every person your business interacts with — leads, prospects, customers, or churned accounts — is a contact. All other modules (Deals, Activities, Tickets, Emails, Calls) reference contacts as the primary entity.

### 7.2 Contact Lifecycle

```
     Import/Manual Entry
            │
            ▼
         [lead]  ──── First interaction recorded
            │
            ▼
       [prospect] ──── Qualified; deal may be created
            │
            ▼
       [customer] ──── Deal won; onboarded
            │
            ▼
       [churned]  ──── Subscription cancelled / no repeat purchase
            │
            ▼
     [unqualified] ── Does not meet buyer criteria
```

### 7.3 Contact Fields

| Field | Type | Description |
|---|---|---|
| `first_name` | text | Required |
| `last_name` | text | Optional |
| `email` | text (unique per tenant) | Primary contact email |
| `phone` | text | Office phone |
| `mobile` | text | Mobile / WhatsApp number |
| `job_title` | text | Role at their company |
| `company_id` | UUID → companies | Linked employer |
| `owner_id` | UUID → users | Assigned CRM agent |
| `status` | enum | lead / prospect / customer / churned / unqualified |
| `source` | text | manual / import / api / voice_bot / web_form |
| `score` | integer | Lead score (0–100) |
| `tags` | text[] | Freeform labels |
| `custom_fields` | JSONB | Tenant-defined additional fields |
| `last_contacted_at` | timestamp | Auto-updated on activity |
| `created_at` | timestamp | Record creation time |

### 7.4 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CONTACTS MODULE                               │
│                                                                      │
│  Input Sources                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ Manual Form │  │  CSV Import  │  │  API POST  │  │ Voice Bot│  │
│  │  (UI)       │  │  (/import)   │  │  /contacts │  │ (webhook)│  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └────┬─────┘  │
│         └────────────────┴────────────────┴───────────────┘        │
│                                    │                                 │
│                                    ▼                                 │
│                          ┌─────────────────┐                        │
│                          │ contacts table  │                        │
│                          │ (RLS isolated)  │                        │
│                          └────────┬────────┘                        │
│                                   │                                  │
│         ┌─────────────────────────┼───────────────────────┐         │
│         │                         │                        │         │
│         ▼                         ▼                        ▼         │
│  ┌─────────────┐        ┌──────────────────┐    ┌───────────────┐  │
│  │  Deals      │        │  Activities/     │    │  Tickets      │  │
│  │  (contact_id│        │  Timeline        │    │  (contact_id) │  │
│  │  linkage)   │        │  (contact_id)    │    │               │  │
│  └─────────────┘        └──────────────────┘    └───────────────┘  │
│                                                                      │
│  Output: Contact 360° view (left panel + Timeline/Deals/Email tabs) │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.5 Key Operations

**Creating a Contact**
1. Navigate to **Contacts** in the left sidebar.
2. Click **+ New Contact** (top right).
3. Fill in First Name (required), email, phone, status, and assign an owner.
4. Click **Save**.

**Importing Contacts (CSV)**
1. Go to **Contacts → Import**.
2. Upload a `.csv` file (max 5,000 rows per batch).
3. Map CSV column headers to CRM fields (e.g. "Email Address" → `email`).
4. Click **Import**. Duplicate emails are updated, not duplicated.

**Contact 360° View**
- Click any contact row to open the detail panel.
- Click **Full Profile** for the dedicated contact page showing:
  - **Timeline tab** — All activities, calls, and notes in chronological order
  - **Deals tab** — All linked opportunities
  - **Emails tab** — Sent/received emails with open tracking status
  - **Tickets tab** — Support tickets raised by this contact

**Deleting a Contact**
- Associated activities and calls are de-linked (contact_id set to NULL).
- Associated deals must be removed first (the API will return 409 Conflict if FK constraints are violated).

---

## 8. Module 2 — Companies

### 8.1 What is the Companies Module?

Companies represent organisations — the employers of your contacts. A company groups multiple contacts under a single account, enabling account-level views of deals, activities, and revenue.

### 8.2 Company Fields

| Field | Type | Description |
|---|---|---|
| `name` | text | Company / organisation name |
| `domain` | text | Website domain (e.g. `acme.com`) |
| `industry` | text | Sector classification |
| `size` | text | Employee band (1–10, 11–50, 51–200, 201–1000, 1000+) |
| `country` | text | ISO alpha-2 country code |
| `owner_id` | UUID → users | Account manager |
| `custom_fields` | JSONB | Tenant-defined fields |
| `tags` | text[] | Labels |

### 8.3 Process Flow

```
Company Created
      │
      ▼
Contact(s) linked via company_id
      │
      ├──► Deals reference both contact_id + company_id
      │
      ├──► Tickets can be raised at company level
      │
      └──► Analytics: account-level revenue roll-up
```

---

## 9. Module 3 — Deals & Pipelines

### 9.1 What is the Deals Module?

Deals (opportunities) track potential revenue through a customisable sales pipeline. Each deal moves through stages — from initial qualification to won or lost. The module provides a **Kanban board** view for visual pipeline management.

### 9.2 Key Concepts

| Concept | Description |
|---|---|
| **Pipeline** | A named sales process (e.g. "Enterprise Sales", "SMB Sales") with ordered stages |
| **Stage** | A step in the pipeline (e.g. Lead, Qualified, Proposal Sent, Negotiation, Closed Won) |
| **Probability** | Win likelihood (%) per stage — used for weighted pipeline value |
| **Deal** | A specific opportunity linked to a contact and stage |
| **Close Date** | Projected closing date |

### 9.3 Deal Lifecycle

```
  Created (any stage)
         │
         ▼
  ┌─────────────────────────────────────────────────────────┐
  │  PIPELINE KANBAN BOARD                                  │
  │                                                         │
  │  [Lead] → [Qualified] → [Proposal] → [Negotiation]     │
  │     ↑_____ Drag & Drop between stages ________________  │
  └─────────────────────────────────────────────────────────┘
         │
         ├──► Mark WON  → status='won', won_at=NOW()
         │               → Revenue recorded in analytics
         │               → Event: DEAL_WON published
         │
         └──► Mark LOST → status='lost', lost_at=NOW()
                         → Reason recorded
```

### 9.4 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DEALS MODULE                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    PIPELINE BOARD                           │    │
│  │  Stage 1   Stage 2   Stage 3   Stage 4   Stage 5           │    │
│  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐        │    │
│  │  │Deal A│  │Deal B│  │Deal C│  │      │  │      │        │    │
│  │  │Deal D│  │      │  │      │  │      │  │      │        │    │
│  │  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘        │    │
│  │                ↑ Drag & Drop → PATCH /deals/:id/stage      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Create Deal                  Move Stage              Mark Won/Lost  │
│  POST /deals                  PATCH /deals/:id/stage  POST /deals/  │
│   - name, amount              → updates stage_id      :id/won        │
│   - stageId, contactId        → fires event           POST /deals/  │
│   - pipelineId                                        :id/lost       │
│                                                                      │
│  Outputs to Analytics:                                               │
│   - pipeline_value (SUM of open deal amounts)                       │
│   - revenue_30d / revenue_7d (SUM of won deal amounts)              │
│   - deals_won_30d (count)                                           │
│   - Funnel: count + value per stage                                 │
│   - Revenue over time chart (monthly/weekly)                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.5 Key Operations

**Create a Pipeline**
1. Go to **Settings → Pipelines** (or via API `POST /api/v1/deals/pipelines`).
2. Name the pipeline and add stages with probabilities.
3. Mark one stage as the default entry stage.

**Add a Deal**
1. Go to **Deals** and select a pipeline from the dropdown.
2. Click **+ Add Deal**.
3. Enter deal name (required), amount, stage (required), and linked contact.
4. Click **Create Deal**.

**Move a Deal**
- Drag the deal card to the target stage column.
- Or use the stage dropdown in the deal detail view.

**Mark as Won**
- Click the **Trophy** icon on the deal card.
- The deal is moved to won status and the close date is recorded.

**Pipeline Value Calculation**
- Each stage sums `amount` of all open deals.
- Total pipeline = sum across all stages.
- Weighted pipeline = `amount × (probability / 100)` per stage.

---

## 10. Module 4 — Activities & Tasks

### 10.1 What is the Activities Module?

Activities are the **action log** of your CRM. Every interaction — planned or completed — is recorded as an activity. They serve as a timeline and task manager in one.

### 10.2 Activity Types

| Type | Description |
|---|---|
| `call` | Phone call (manual log) |
| `voice_bot_call` | AI-handled inbound call |
| `email` | Email sent or received |
| `meeting` | In-person or video meeting |
| `task` | General to-do item |
| `note` | Internal note or memo |
| `whatsapp` | WhatsApp message |
| `sms` | SMS text |
| `demo` | Product demonstration |
| `proposal` | Proposal or quote sent |

### 10.3 Activity Status Flow

```
  [pending]  →  [completed]
      │
      └──►  [cancelled]
```

### 10.4 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      ACTIVITIES MODULE                               │
│                                                                      │
│  Create Activity (manual, from voice call, from ticket)             │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  activities table                                        │       │
│  │  - type, subject, status, priority                       │       │
│  │  - due_at (for task scheduling)                          │       │
│  │  - contact_id ──► contact timeline                       │       │
│  │  - deal_id    ──► deal activity log                      │       │
│  │  - owner_id   ──► agent's task list                      │       │
│  └──────────────────────────────────────────────────────────┘       │
│         │                                                            │
│         ▼                                                            │
│  Dashboard Metrics:                                                  │
│   - overdue_tasks  (due_at < NOW() AND status='pending')            │
│   - due_today      (due_at::date = CURRENT_DATE)                    │
│                                                                      │
│  Leaderboard Metrics:                                                │
│   - activities_completed (agent performance)                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.5 Key Operations

**Log a Completed Call**
1. Go to **Activities → + New Activity**.
2. Select type **Call**, enter subject, set status to **Completed**.
3. Link to a contact and deal if applicable.

**Create a Task**
1. Select type **Task**, set due date and priority.
2. Assign to an agent (owner_id).
3. The task appears in the agent's queue and dashboard overdue count.

**Overdue Task Alerts**
- The Dashboard KPI strip shows **Overdue Tasks** (tasks with `due_at < NOW()` and `status = pending`).
- Managers can filter the Activities list by `overdue=true`.

---

## 11. Module 5 — Email

### 11.1 What is the Email Module?

The Email module provides **outbound transactional email** sending with real-time delivery tracking. It records every email sent, and processes webhook events from SendGrid to update open, click, bounce, and spam report statuses.

### 11.2 Email Lifecycle

```
  POST /api/v1/emails/send
         │
         ▼
  EmailService.send()
  → Calls SendGrid API
  → Inserts record into emails table (status='sent')
         │
         ▼
  SendGrid delivers email
  → Sends webhook to POST /api/v1/emails/webhook/sendgrid
         │
         ├── Event: delivered  → status='delivered'
         ├── Event: open       → opened_at=NOW(), open_count++
         ├── Event: click      → clicked_at=NOW()
         ├── Event: bounce     → status='failed', bounced_at=NOW()
         └── Event: spamreport → status='spam'

  GET /api/v1/emails/track/open/:emailId
  → Returns 1×1 GIF pixel
  → opened_at updated (fallback if webhook not set up)
```

### 11.3 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         EMAIL MODULE                                 │
│                                                                      │
│  ┌───────────────┐        ┌─────────────────┐                       │
│  │  CRM Agent    │        │  Voice Bot       │                       │
│  │  sends email  │        │  ticket confirm  │                       │
│  └───────┬───────┘        └────────┬────────┘                       │
│          └────────────┬────────────┘                                 │
│                       │                                              │
│                       ▼                                              │
│            ┌──────────────────────┐                                  │
│            │   EmailService       │                                  │
│            │   (SendGrid adapter) │                                  │
│            └──────────┬───────────┘                                  │
│                       │                                              │
│          ┌────────────┴─────────────────┐                           │
│          │                              │                            │
│          ▼                              ▼                            │
│  ┌──────────────┐            ┌────────────────────┐                 │
│  │ emails table │            │  SendGrid Cloud     │                 │
│  │ (status log) │◄──────────│  → Delivery events  │                 │
│  └──────────────┘  webhooks  └────────────────────┘                 │
│          │                                                           │
│          ▼                                                           │
│  Contact 360° View → Emails tab shows delivery + open status        │
│  Dashboard KPIs → emails_sent_30d, emails_failed_30d                │
└──────────────────────────────────────────────────────────────────────┘
```

### 11.4 Configuration

**SendGrid Setup**
1. Create a SendGrid account at `sendgrid.com`.
2. Generate an API key with **Mail Send** permission.
3. Set `SENDGRID_API_KEY=SG.xxxx` in your environment.
4. Set `SENDGRID_FROM_EMAIL=noreply@yourdomain.com`.
5. In SendGrid dashboard → Settings → Mail Settings → Event Webhook:
   - URL: `https://your-api-domain/api/v1/emails/webhook/sendgrid`
   - Events: Delivered, Opened, Clicked, Bounced, Spam Reports
6. Set `SENDGRID_WEBHOOK_SECRET` in your environment (from SendGrid webhook signing key).

**Open Tracking Pixel**
- Automatically appended to HTML emails when `trackOpens: true`.
- URL: `https://your-api-domain/api/v1/emails/track/open/{emailId}`

---

## 12. Module 6 — Voice Calls

### 12.1 What is the Voice Module?

The Voice module logs **inbound and outbound phone calls** made via PSTN providers (Twilio or Vonage). Call records are linked to contacts and contribute to activity timelines and agent performance metrics.

### 12.2 Voice Call Record

| Field | Description |
|---|---|
| `provider` | twilio / vonage |
| `direction` | inbound / outbound |
| `from_number` | Caller's phone number |
| `to_number` | Dialled number |
| `started_at` | Call start time |
| `ended_at` | Call end time |
| `duration_seconds` | Call length |
| `outcome` | answered / no_answer / busy / failed |
| `recording_url` | Link to call recording (if enabled) |
| `transcript` | Auto-transcribed text (if provider supports) |
| `agent_id` | Assigned CRM agent |
| `contact_id` | Linked contact |

### 12.3 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        VOICE MODULE                                  │
│                                                                      │
│  Inbound Call                        Outbound Call                  │
│  (Customer → Twilio/Vonage)         (Agent initiates)               │
│         │                                    │                       │
│         ▼                                    ▼                       │
│  POST /api/v1/voice/webhook         POST /api/v1/voice/call         │
│         │                                    │                       │
│         └─────────────────┬─────────────────┘                       │
│                           │                                          │
│                           ▼                                          │
│              ┌─────────────────────────┐                            │
│              │  voice_calls table      │                            │
│              │  (linked to contact_id) │                            │
│              └────────────┬────────────┘                            │
│                           │                                          │
│         ┌─────────────────┼────────────────────┐                   │
│         ▼                 ▼                     ▼                   │
│  Contact Timeline   Dashboard KPIs         Leaderboard              │
│  (calls_7d,         (calls_30d,            (calls_made              │
│   calls_30d)         calls_7d)              per agent)              │
└──────────────────────────────────────────────────────────────────────┘
```

### 12.4 Provider Configuration

**Twilio**
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```
Webhook URL in Twilio console: `https://your-api/api/v1/connectors/twilio/webhook`

**Vonage**
```env
VONAGE_API_KEY=your_key
VONAGE_API_SECRET=your_secret
VONAGE_VIRTUAL_NUMBER=+447700900000
```
Webhook URL in Vonage dashboard: `https://your-api/api/v1/connectors/vonage/webhook`

---

## 13. Module 7 — Voice Bot (AI)

### 13.1 What is the Voice Bot Module?

The Voice Bot module integrates with **third-party AI voice platforms** (Vapi, Retell AI, Bland.ai) to automate inbound call triage. When a customer calls your helpline, the AI bot answers, conducts a structured conversation, extracts key information, and automatically creates a support ticket — with priority, sentiment, and transcript — without any human involvement.

### 13.2 Supported Providers

| Provider | Website | Capability |
|---|---|---|
| **Vapi** | vapi.ai | Conversational AI with function calling |
| **Retell AI** | retellai.com | Real-time voice AI with sentiment |
| **Bland.ai** | bland.ai | Programmable voice AI |

### 13.3 Bot Configuration Fields

| Setting | Description |
|---|---|
| `provider` | vapi / retell / bland |
| `api_key` | Your provider's API key |
| `bot_id` / `agent_id` | The configured AI agent identifier |
| `phone_number` | The helpline number the bot answers |
| `auto_create_ticket` | true = create ticket automatically on call end |
| `urgency_keywords` | Custom words that escalate priority to "urgent" |
| `system_prompt` | Instructions for the AI bot's behaviour |

### 13.4 Voice Bot Call Lifecycle

```
Customer calls helpline number
         │
         ▼
AI Bot (Vapi/Retell/Bland) answers
  - Greets customer
  - Asks about issue
  - Extracts: name, email, phone, complaint
  - Generates summary + transcript
         │
         ▼
Call ends → Provider sends webhook
  POST /api/v1/voice-bot/webhook/{provider}
         │
         ▼
Platform normalises payload:
  - extracts from_number, duration, transcript, summary
  - detects sentiment (positive/neutral/negative/urgent)
  - detects priority from urgency keywords
  - extracts subject from summary
         │
         ▼
voice_bot_calls record created
         │
         ├──► If auto_create_ticket = true:
         │      POST /api/v1/tickets/from-voice
         │      Creates ticket with:
         │       - channel = 'voice_bot'
         │       - transcript attached
         │       - priority from sentiment
         │       - contact linked if phone matches
         │
         └──► Dashboard: bot_calls_30d, bot_untriaged_30d
```

### 13.5 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      VOICE BOT MODULE                                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              EXTERNAL AI PROVIDERS                          │    │
│  │   [Vapi]        [Retell AI]        [Bland.ai]              │    │
│  │      └──────────────┴──────────────────┘                   │    │
│  │                         │                                   │    │
│  │              Webhook (POST /webhook/{provider})             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                             │                                        │
│                             ▼                                        │
│                    Payload Normaliser                                │
│                    ┌──────────────────────────────┐                 │
│                    │ - fromNumber                 │                 │
│                    │ - duration, transcript       │                 │
│                    │ - summary → subject          │                 │
│                    │ - sentiment detection        │                 │
│                    │ - priority from keywords     │                 │
│                    └──────────────┬───────────────┘                 │
│                                   │                                  │
│                    ┌──────────────┴───────────────┐                 │
│                    │                              │                  │
│                    ▼                              ▼                  │
│           voice_bot_calls table          Auto-create Ticket         │
│           (full record stored)           (channel='voice_bot')      │
│                    │                              │                  │
│         ┌──────────┼──────────────────────────────┤                 │
│         ▼          ▼                              ▼                  │
│  Bot Tickets  Dashboard KPIs              Ticketing Module          │
│  Page (UI)    (bot_calls_30d)             (SLA timer starts)        │
└──────────────────────────────────────────────────────────────────────┘
```

### 13.6 Setting Up a Voice Bot Provider

**Step 1: Configure the Provider**
1. Go to **Settings → Voice Bot** (or API `PUT /api/v1/voice-bot/config`).
2. Select your provider (Vapi / Retell / Bland).
3. Enter your API key from the provider dashboard.
4. Enter the Bot/Agent ID of your configured AI assistant.
5. Toggle **Auto-create ticket** ON.
6. Add urgency keywords for your business (e.g. "not working", "broken", "emergency").

**Step 2: Get Your Webhook URL**
- Call `GET /api/v1/voice-bot/webhook-url` to retrieve your unique webhook URL.
- Format: `https://your-api/api/v1/voice-bot/webhook/{provider}?tenantId={id}&apiKey={key}`

**Step 3: Configure in Provider Dashboard**
- **Vapi**: Assistant Settings → Server URL → paste webhook URL
- **Retell AI**: Agent Settings → Webhook URL → paste webhook URL
- **Bland.ai**: Pathway → Webhook → paste webhook URL

**Step 4: Initiate a Test Call**
```http
POST /api/v1/voice-bot/test-call
{
  "to": "+1234567890",
  "message": "This is a test call from your CRM."
}
```

### 13.7 Bot Tickets Page

Navigate to **Voice Bot → Bot Tickets** to see:
- All tickets created by voice bot calls
- Call transcript (expandable)
- Audio playback (if recording URL available)
- Sentiment badge (positive/neutral/negative/urgent)
- Provider badge (Vapi/Retell/Bland)
- KPI strip: Total / Open / Urgent / Resolved

---

## 14. Module 8 — Ticketing & Help Desk

### 14.1 What is the Ticketing Module?

The Ticketing module is a full-featured **customer support help desk**. It manages customer issues from initial report through resolution, with SLA enforcement, queue routing, escalation chains, and multi-channel intake (email, voice bot, manual, API).

### 14.2 Ticket Channels

| Channel | How tickets arrive |
|---|---|
| `manual` | Agent creates ticket manually in the UI |
| `email` | Customer sends email to support mailbox |
| `phone` | Agent creates ticket during phone call |
| `chat` | Created from live chat widget |
| `api` | Created via REST API |
| `voice_bot` | AI bot auto-creates on call completion |

### 14.3 Ticket Lifecycle

```
  Created (open)
       │
       ▼
  Assigned to agent (assigned)
       │
       ▼
  Agent accepts ticket — SLA timer starts (accepted)
       │
       ▼
  Work in progress (in_progress)
       │
       ├──► Pending customer reply (pending)
       │           │
       │           └──► Reply received → back to in_progress
       │
       ▼
  Resolved (resolved)
       │
       ▼
  Closed (closed)  ← auto-close after N days if not reopened
```

### 14.4 SLA Policies

SLA (Service Level Agreement) policies define **response and resolution time commitments** by priority.

| Field | Description |
|---|---|
| `priority` | urgent / high / medium / low |
| `first_response_hours` | Max hours until first agent reply |
| `resolution_hours` | Max hours until ticket is resolved |
| `reminder_pct` | Alert at this % of time elapsed (default 80%) |
| `l1_escalation_pct` | Escalate to L2 at this % (default 100%) |
| `l2_escalation_pct` | Escalate to L3 at this % (default 150%) |
| `business_hours_only` | Count only business hours (Mon–Fri 9am–5pm) |

**Example SLA Setup:**

| Priority | First Response | Resolution |
|---|---|---|
| Urgent | 1 hour | 4 hours |
| High | 4 hours | 8 hours |
| Medium | 8 hours | 24 hours |
| Low | 24 hours | 72 hours |

### 14.5 Queues

Queues are **routing groups** for tickets. Agents are assigned to queues and see only their queue's tickets by default.

- A **default queue** catches unrouted tickets.
- Queues have names, descriptions, and display colors.
- Voice bot tickets are auto-assigned to the queue configured in the bot settings.

### 14.6 Escalation Flow

```
  Ticket Created (SLA timer starts on accept)
         │
         ▼
  [reminder_pct elapsed] → Notification sent to assigned agent
         │
         ▼
  [l1_escalation_pct elapsed] → escalation_level = 1
         │                     → Notify agent + manager
         ▼
  [l2_escalation_pct elapsed] → escalation_level = 2
                               → Notify tenant_admin
                               → Appears in Dashboard "Escalated L2" count
```

### 14.7 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      TICKETING MODULE                                │
│                                                                      │
│  Intake Channels                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │  Manual  │ │  Email   │ │ Voice Bot│ │   API    │              │
│  │  (UI)    │ │ (mailbox)│ │(webhook) │ │ (/create)│              │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘              │
│       └────────────┴────────────┴─────────────┘                    │
│                             │                                        │
│                             ▼                                        │
│                   ┌─────────────────┐                               │
│                   │  tickets table  │                               │
│                   │  (RLS isolated) │                               │
│                   └────────┬────────┘                               │
│                            │                                         │
│       ┌────────────────────┼──────────────────────┐                │
│       ▼                    ▼                       ▼                │
│  Queue Routing         SLA Timer              Comments/Notes        │
│  (queue_id)            (sla_due_at)           (ticket_comments)     │
│       │                    │                                         │
│       ▼                    ▼                                         │
│  Agent Accepts         Escalation              Email Notification   │
│  (status=accepted)     (if SLA breached)       (on assign/resolve)  │
│       │                                                              │
│       ▼                                                              │
│  Dashboard KPIs:                                                    │
│   - open_tickets         - sla_breached                            │
│   - unassigned_tickets   - escalated_l2                            │
│   - tickets_30d          - bot_untriaged_30d                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 14.8 Key Operations

**Create a Queue**
1. Go to **Settings → Queues** or call `POST /api/v1/tickets/queues`.
2. Enter queue name, description, and color.
3. Mark as default if this should catch unrouted tickets.

**Create an SLA Policy**
1. Go to **Settings → SLA Policies** or call `POST /api/v1/tickets/sla-policies`.
2. Select the priority level this policy applies to.
3. Enter `firstResponseHours` and `resolutionHours`.
4. Toggle `businessHoursOnly` for support teams working specific hours.

**Assign a Ticket**
```http
POST /api/v1/tickets/:id/assign
{ "agentId": "uuid-of-agent" }
```

**Accept a Ticket (Start SLA Timer)**
```http
POST /api/v1/tickets/:id/accept
```
This sets `status = accepted` and starts the SLA countdown.

**Add a Comment / Internal Note**
```http
POST /api/v1/tickets/:id/comments
{
  "body": "Checked with the engineering team — fix deployed.",
  "isInternal": true
}
```
Internal notes are visible only to agents, not to the customer.

**Resolve a Ticket**
```http
POST /api/v1/tickets/:id/resolve
{ "resolutionNote": "Issue resolved by deploying hotfix v2.3.1" }
```

---

## 15. Module 9 — CSAT Surveys (NEW v2)

Customer Satisfaction surveys are automatically sent when a ticket is resolved and closed.

### 15.1 CSAT Flow

1. Ticket moves to `resolved` status
2. System generates a unique 32-char URL-safe token
3. Survey email sent: `https://yourcrm.com/survey/{token}`
4. Customer clicks → rates 1–5 stars + optional comment
5. Response recorded → `ticket_audit_log` entry written
6. Surveys expire after **7 days** (returns 410 Gone)
7. One survey per ticket — cannot be re-submitted

### 15.2 CSAT Metrics (`GET /api/v1/tickets/csat/summary`)

| Metric | Description |
|---|---|
| Total Sent | Surveys dispatched |
| Total Responses | Customers who rated |
| Response Rate % | (Responses ÷ Sent) × 100 |
| Average Rating | Mean 1.0–5.0 |
| Rating Distribution | Count per star 1–5 |

---

## 16. Module 10 — Ticket Audit Log (NEW v2)

Every ticket state change is recorded in the `ticket_audit_log` table. A PostgreSQL trigger makes this table **completely immutable** — no UPDATE or DELETE is possible, even by the database owner.

### 16.1 Events Tracked

| Action | When |
|---|---|
| `status_changed` | Any status transition |
| `assigned` | Ticket assigned to agent |
| `field_updated` | Any field update |
| `comment_added` | Agent/customer comment |
| `escalated` | SLA escalation level increases |
| `rca_submitted` | Root cause analysis completed |
| `csat_sent` | Survey email dispatched |
| `csat_received` | Customer submits rating |

This log satisfies compliance requirements for regulated industries (banking, insurance, telecom).

---

## 17. Module 11 — Analytics & Reporting

### 17.1 What is the Analytics Module?

The Analytics module provides **real-time business intelligence** across all CRM activities. It includes a dashboard with KPI cards, a revenue trend chart, pipeline funnel, agent leaderboard, and contact source breakdown.

> **Access:** Requires the `analytics` feature enabled on the tenant plan and the `analytics:read` scope.

### 17.2 Dashboard KPIs

| KPI | Source | Description |
|---|---|---|
| Total Contacts | contacts | All contacts in workspace |
| New Contacts (30d) | contacts | Created in last 30 days |
| Total Companies | companies | All companies |
| Open Deals | deals | `status = 'open'` |
| Pipeline Value | deals | `SUM(amount)` of open deals |
| Deals Won (30d) | deals | Won in last 30 days |
| Revenue (30d) | deals | `SUM(amount)` of won deals in 30d |
| Revenue (7d) | deals | `SUM(amount)` of won deals in 7d |
| Overdue Tasks | activities | `due_at < NOW() AND status = pending` |
| Due Today | activities | `due_at::date = CURRENT_DATE` |
| Calls (30d) | voice_calls | Calls in last 30 days |
| Calls (7d) | voice_calls | Calls in last 7 days |
| Open Tickets | tickets | Not resolved or closed |
| Unassigned Tickets | tickets | `status = 'open'` (no assignee) |
| SLA Breached | tickets | `sla_due_at < NOW()` and open |
| Escalated L2 | tickets | `escalation_level >= 2` |
| Tickets (30d) | tickets | Created in last 30 days |
| Emails Sent (30d) | emails | `status = 'delivered'` in 30d |
| Emails Failed (30d) | emails | `status = 'failed'` in 30d |
| Bot Calls (30d) | voice_bot_calls | AI calls in last 30 days |
| Bot Untriaged (30d) | voice_bot_calls | Bot calls without a ticket |

### 17.3 Available Reports

**Revenue Over Time**
- `GET /api/v1/analytics/revenue?period=month&months=12`
- Returns all period slots (zero-padded) with: `deals_won`, `revenue`, `deals_lost`
- Displayed as an area chart on the dashboard

**Pipeline Funnel**
- `GET /api/v1/analytics/funnel/:pipelineId`
- Returns per-stage: `count`, `value`, `avg_age_days`

**Agent Leaderboard**
- `GET /api/v1/analytics/leaderboard?from=2026-01-01&to=2026-05-01`
- Returns per-agent: `deals_won`, `revenue`, `activities_completed`, `calls_made`

**Contact Source Breakdown**
- `GET /api/v1/analytics/contact-sources`
- Returns per-source: `count`, `converted` (customers)

### 17.4 Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      ANALYTICS MODULE                                │
│                                                                      │
│  Data Sources (all tables in tenant schema):                        │
│  contacts, companies, deals, activities,                            │
│  tickets, emails, voice_calls, voice_bot_calls                      │
│         │                                                            │
│         ▼                                                            │
│  Single aggregation query (dashboard stats)                         │
│  ┌──────────────────────────────────────────────────┐               │
│  │  SELECT                                          │               │
│  │    (SELECT COUNT(*) FROM contacts) AS ...,       │               │
│  │    (SELECT SUM(amount) FROM deals WHERE          │               │
│  │      status='open') AS pipeline_value::float8,  │               │
│  │    ...20+ subqueries...                          │               │
│  └──────────────────────────────────────────────────┘               │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────┐               │
│  │  Dashboard UI                                    │               │
│  │  ┌─────────────┐  ┌──────────────────────────┐  │               │
│  │  │  KPI Cards  │  │  Revenue Area Chart      │  │               │
│  │  │  (20+ stats)│  │  (generate_series padded)│  │               │
│  │  └─────────────┘  └──────────────────────────┘  │               │
│  │  ┌─────────────┐  ┌──────────────────────────┐  │               │
│  │  │  Recent     │  │  Recent Tickets (open,   │  │               │
│  │  │  Activity   │  │  sorted by priority)     │  │               │
│  │  │  Feed       │  │                          │  │               │
│  │  └─────────────┘  └──────────────────────────┘  │               │
│  └──────────────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 18. Module 12 — Sales & Invoicing (NEW v2)

A complete invoicing sub-system for billing clients.

### 18.1 Invoice Lifecycle

```
draft → sent → viewed → partial → paid
                                ↘ overdue (auto, when due_date passes)
          ↘ cancelled (manual)
```

### 18.2 Key Features

| Feature | Description |
|---|---|
| **Billing Contacts** | Client records with name, email, billing address, tax ID, currency |
| **Invoices** | Auto-numbered (INV-0001), multi-currency, line items, tax rates |
| **Payments** | Record payments by mode (Bank Transfer, JazzCash, Stripe, etc.) |
| **Templates** | Visual invoice templates (Classic, Modern, etc.) |
| **Builder** | Drag-and-drop invoice builder |
| **Reports** | Revenue by period, client, status |
| **Settings** | Invoice prefix, tax rates, bank accounts, company logo |

### 18.3 Routes

| Route | Page |
|---|---|
| `/sales/dashboard` | Revenue KPIs, outstanding invoices, recent payments |
| `/sales/invoices` | Invoice list |
| `/sales/invoices/new` | Create invoice |
| `/sales/invoices/:id` | Invoice detail + payments |
| `/sales/contacts` | Billing contacts |
| `/sales/payments` | Payment history |
| `/sales/reports` | Revenue reports |
| `/sales/settings` | Sales configuration |

---

## 19. Module 13 — Billing & Subscriptions

### 19.1 What is the Billing Module?

The Billing module manages **plan subscriptions and payment processing** for the CRM platform. It supports multiple payment providers and currencies to accommodate both international and local markets.

### 19.2 Available Plans

| Plan | Target | Key Limits |
|---|---|---|
| **Starter** | Small teams | Up to 5 users, 2,500 contacts, basic analytics |
| **Professional** | Growing businesses | Up to 25 users, 25,000 contacts, all modules |
| **Enterprise** | Large organisations | Unlimited users, unlimited contacts, custom setup |

### 19.3 Supported Payment Providers

| Provider | Currencies | Best For |
|---|---|---|
| **Stripe** | USD, GBP, EUR, AED | Global businesses |
| **Wise** | USD, GBP, EUR | International transfers |
| **JazzCash** | PKR | Pakistan mobile payments |
| **EasyPaisa** | PKR | Pakistan mobile payments |
| **Raast** | PKR | Pakistan instant bank transfer |
| **PayPal** | USD, EUR | International |

### 19.4 Billing Process Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                       BILLING MODULE                                 │
│                                                                      │
│  Customer selects plan + billing cycle + currency                   │
│         │                                                            │
│         ▼                                                            │
│  POST /api/v1/billing/checkout                                      │
│  {plan, billingCycle, currency, provider, billingDetails}           │
│         │                                                            │
│         ▼                                                            │
│  BillingService.createCheckout()                                    │
│         │                                                            │
│         ├──► Stripe  → creates Payment Intent → redirect to Stripe  │
│         ├──► Wise    → creates transfer request                     │
│         ├──► JazzCash→ creates JC payment page URL                  │
│         ├──► EasyPaisa→ creates EP payment URL                      │
│         └──► Raast   → creates bank transfer reference              │
│                                                                      │
│  Payment Confirmed (webhook or redirect)                            │
│         │                                                            │
│         ▼                                                            │
│  Update tenants.plan + tenants.status + billing_details             │
│         │                                                            │
│         ▼                                                            │
│  Feature gates enforced:                                            │
│  requireFeature('analytics') — only on Professional+               │
│  requireFeature('voice_bot')  — only on Professional+              │
└──────────────────────────────────────────────────────────────────────┘
```

### 19.5 Feature Flags by Plan

| Feature | Starter | Professional | Enterprise |
|---|:---:|:---:|:---:|
| Contacts & Companies | ✓ | ✓ | ✓ |
| Deals & Pipelines | ✓ | ✓ | ✓ |
| Activities | ✓ | ✓ | ✓ |
| Email (basic) | ✓ | ✓ | ✓ |
| Analytics | — | ✓ | ✓ |
| Voice Bot | — | ✓ | ✓ |
| Voice Calls | — | ✓ | ✓ |
| Advanced SLA | — | ✓ | ✓ |
| API Access | — | ✓ | ✓ |
| Custom Domain | — | — | ✓ |
| SSO / SAML | — | — | ✓ |

---

## 20. Module 14 — Settings & Team Management

### 20.1 What is the Settings Module?

Settings provides workspace configuration and team management tools for tenant administrators. It covers workspace identity, regional preferences, team invitation and role management, and security controls.

### 20.2 Workspace Settings

| Setting | Description |
|---|---|
| `name` | Workspace display name |
| `domain` / `custom_domain` | Custom domain for the workspace URL |
| `timezone` | Default timezone for date/time display |
| `dateFormat` | Date format (e.g. DD/MM/YYYY, MM-DD-YYYY) |
| `currency` | 3-letter ISO currency code (default USD) |

**Update via API:**
```http
PATCH /api/v1/settings/workspace
{
  "name": "Acme Corp CRM",
  "timezone": "Asia/Karachi",
  "dateFormat": "DD/MM/YYYY",
  "currency": "PKR"
}
```

### 20.3 Team Management

**Process Flow:**

```
┌──────────────────────────────────────────────────────────────────────┐
│                    TEAM MANAGEMENT                                   │
│                                                                      │
│  Invite Agent                                                        │
│  POST /api/v1/settings/team/invite                                  │
│  { email, name, role }                                              │
│         │                                                            │
│         ▼                                                            │
│  INSERT INTO users (status='INVITE_PENDING')                        │
│  → Send invitation email with login link                            │
│         │                                                            │
│         ▼                                                            │
│  Agent logs in for first time → prompted to set password            │
│         │                                                            │
│  Change Role                                                         │
│  PATCH /api/v1/settings/team/:userId                               │
│  { role: 'manager' }                                                │
│         │                                                            │
│  Remove Member                                                       │
│  DELETE /api/v1/settings/team/:userId                              │
│  (cannot remove yourself)                                           │
└──────────────────────────────────────────────────────────────────────┘
```

**Role Definitions for Team Members:**

| Role | Who should get it |
|---|---|
| `tenant_admin` | Workspace owner, billing contacts |
| `manager` | Team leads who need reports and queue management |
| `agent` | Frontline staff handling contacts, deals, and tickets |
| `viewer` | Stakeholders who need read-only access |

### 20.4 Security Settings

**Change Password**
```http
POST /api/v1/settings/security/change-password
{
  "currentPassword": "old-password",
  "newPassword": "new-secure-password"
}
```
- Minimum 8 characters required.
- Passwords hashed with bcrypt (cost factor 12).

**Password Reset (Self-Service)**
1. Click **Forgot password?** on the login page.
2. Enter your email and workspace slug.
3. Check email for reset link (valid for 1 hour).
4. Click the link and enter a new password.

**Password Reset Token Storage:**
- Tokens are stored as SHA-256 hashes only — never in plain text.
- One active token per user (new request invalidates old one).
- Tokens expire after 1 hour.
- Used tokens are marked `used = true` and cannot be reused.

---

## 21. Module 15 — API Keys & Integrations

### 21.1 What is the API Keys Module?

API keys allow external systems, integrations, and custom applications to authenticate with the CRM API without user-level JWT tokens. Each API key carries a specific set of permission scopes.

### 21.2 API Key Lifecycle

```
POST /api/v1/api-keys
{ name: "Integration Name", scopes: ["contacts:read", "tickets:write"] }
         │
         ▼
Server generates: crypto.randomBytes(32).toString('hex') → 64-char key
Stores: SHA-256 hash of key + scopes + tenantId
Returns: { key: "crm_live_xxx..." } — shown ONCE, never retrievable
         │
         ▼
Client uses key: Authorization: ApiKey crm_live_xxx...
         │
         ▼
Server: hash the key → lookup → check scopes → allow/deny
```

### 21.3 Connector Integrations

**Available Connectors:**
- **Twilio** — PSTN voice calls
- **Vonage** — PSTN voice calls (alternative)
- **SendGrid** — Transactional email
- **Vapi** — AI voice bot
- **Retell AI** — AI voice bot (alternative)
- **Bland.ai** — AI voice bot (alternative)
- **Stripe** — Payment processing
- **Wise** — International payments
- **JazzCash** — Pakistan payments
- **EasyPaisa** — Pakistan payments
- **Raast** — Pakistan bank transfers

---

## 22. Inter-Module Data Flow

### 22.1 Master Data Flow Diagram

```
                    ┌───────────────────────────────┐
                    │         CONTACTS               │
                    │  (central entity)              │
                    └──────────────┬────────────────┘
                                   │ contact_id
           ┌───────────────────────┼──────────────────────────┐
           │                       │                          │
           ▼                       ▼                          ▼
    ┌─────────────┐      ┌─────────────────┐       ┌──────────────────┐
    │   DEALS     │      │  ACTIVITIES     │       │    TICKETS       │
    │ (pipeline)  │      │  (timeline)     │       │  (help desk)     │
    └──────┬──────┘      └────────┬────────┘       └────────┬─────────┘
           │                      │                          │
           ▼                      │                          │
    ┌─────────────┐               │                          │
    │  ANALYTICS  │◄──────────────┴──────────────────────────┘
    │ (reports)   │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │  DASHBOARD  │
    │  (KPI strip │
    │  + charts)  │
    └─────────────┘

         ▲                        ▲                          ▲
         │                        │                          │
    ┌────┴────┐         ┌─────────┴──────┐        ┌─────────┴────────┐
    │  EMAIL  │         │  VOICE CALLS   │        │   VOICE BOT      │
    │(tracking│         │(call logs)     │        │(AI triage)       │
    └─────────┘         └────────────────┘        └──────────────────┘
```

### 22.2 Data Flow: Customer Issue End-to-End

```
  [1] Customer calls helpline
           │
           ▼
  [2] Voice Bot (Vapi) answers and extracts issue details
           │
           ▼
  [3] Webhook → voice_bot_calls record created
           │
           ▼
  [4] Auto-create Ticket:
        - subject from call summary
        - priority from urgency keywords
        - contact matched by phone number (or created)
        - channel = 'voice_bot'
        - transcript attached
           │
           ▼
  [5] Ticket → Queue → Agent Assigned
      SLA timer starts on accept
           │
           ▼
  [6] Agent adds Comments, sends Email to customer
           │
           ▼
  [7] Ticket Resolved
      → resolution_note saved
      → customer notified via email
           │
           ▼
  [8] Analytics updated:
      - tickets_30d count
      - open_tickets decreases
      - agent activities_completed increases (leaderboard)
```

### 22.3 Data Flow: New Customer → Won Deal

```
  [1] Lead imported from CSV or entered manually
      → Contact created (status='lead')
           │
           ▼
  [2] Agent qualifies lead → status updated to 'prospect'
      → Activity logged: type='call', outcome='qualified'
           │
           ▼
  [3] Deal created and linked to contact
      → Deal appears in pipeline (status='open')
      → Pipeline value increases
           │
           ▼
  [4] Emails sent to prospect (tracked via SendGrid)
      → Email opens/clicks visible in Contact 360° view
           │
           ▼
  [5] Deal moved through stages (Kanban drag & drop)
      → Stage change logged automatically
           │
           ▼
  [6] Deal marked WON (Trophy button)
      → deals.status='won', won_at=NOW()
      → Contact status updated to 'customer'
      → Revenue appears in Analytics charts
      → Agent appears on Leaderboard
```

---

## 23. On-Premises Installation Guide

### 23.1 Prerequisites

| Requirement | Minimum Version | Recommended |
|---|---|---|
| **Node.js** | 18.x LTS | 20.x LTS |
| **pnpm** | 8.x | 9.x |
| **PostgreSQL** | 14 | 15 or 16 |
| **OS** | Ubuntu 20.04 / CentOS 8 | Ubuntu 22.04 LTS |
| **RAM** | 2 GB | 4 GB+ |
| **CPU** | 2 vCPU | 4 vCPU |
| **Disk** | 20 GB | 50 GB+ SSD |
| **Network** | Outbound HTTPS | Inbound on ports 80/443 |

### 23.2 Step 1 — Install System Dependencies

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential

# Node.js 20.x via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
npm install -g pnpm

# PostgreSQL 15
sudo apt install -y postgresql-15 postgresql-client-15
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

```bash
# RHEL/CentOS
sudo dnf install -y curl git gcc-c++ make
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
npm install -g pnpm
sudo dnf install -y postgresql15-server
sudo postgresql-15-setup initdb
sudo systemctl start postgresql-15
sudo systemctl enable postgresql-15
```

### 23.3 Step 2 — Create Database and User

```sql
-- Connect as postgres superuser
sudo -u postgres psql

-- Create application user
CREATE USER crm_user WITH PASSWORD 'choose-strong-password-here';

-- Create database
CREATE DATABASE crm_db OWNER crm_user;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE crm_db TO crm_user;

-- Enable UUID extension (required)
\c crm_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\q
```

### 23.4 Step 3 — Clone and Install

```bash
# Clone repository
git clone https://github.com/your-org/crm-platform.git /opt/crm-platform
cd /opt/crm-platform

# Install all workspace dependencies
pnpm install

# Build all packages
pnpm build
```

### 23.5 Step 4 — Configure Environment Variables

```bash
# API environment
cp /opt/crm-platform/packages/api/.env.example /opt/crm-platform/packages/api/.env
nano /opt/crm-platform/packages/api/.env
```

Minimum required variables (see Section 19 for full reference):

```env
# Database
DATABASE_URL=postgresql://crm_user:your-password@localhost:5432/crm_db

# JWT
JWT_SECRET=generate-with-openssl-rand-base64-64

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Email (required for invitations and password reset)
SENDGRID_API_KEY=SG.your-sendgrid-key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
```

```bash
# Frontend environment
cp /opt/crm-platform/packages/frontend/.env.example /opt/crm-platform/packages/frontend/.env
nano /opt/crm-platform/packages/frontend/.env
```

```env
# Leave empty — API calls go through Nginx proxy
VITE_API_URL=
```

### 23.6 Step 5 — Run Database Migrations

```bash
cd /opt/crm-platform
pnpm --filter @crm/core migrate
```

Migrations are applied sequentially from `packages/core/src/database/migrations/`:
- `001_initial_schema.sql` — Core tables + RLS policies
- `002_voice.sql` — Voice calls tables
- `003_ticketing.sql` — Tickets, queues, SLA policies
- `004_emails.sql` — Email tracking
- `005_voice_bot.sql` — Voice bot calls and config
- `006_password_reset.sql` — Password reset tokens

### 23.7 Step 6 — Create First Tenant (Super Admin)

```bash
cd /opt/crm-platform
node packages/core/src/database/seed.js
```

Or manually via psql:
```sql
\c crm_db

-- Insert super-admin tenant
INSERT INTO tenants (name, slug, plan, status)
VALUES ('My Company', 'my-company', 'enterprise', 'active')
RETURNING id;

-- Insert super-admin user (replace UUIDs)
INSERT INTO users (tenant_id, email, name, role, password_hash)
VALUES (
  'tenant-uuid-from-above',
  'admin@yourcompany.com',
  'Administrator',
  'super_admin',
  -- bcrypt hash of your chosen password (cost 12)
  '$2a$12$...'
);
```

To generate a bcrypt hash:
```bash
node -e "const b=require('bcryptjs'); b.hash('YourPassword123!', 12).then(h=>console.log(h));"
```

### 23.8 Step 7 — Build Frontend

```bash
cd /opt/crm-platform/packages/frontend
pnpm build
# Output: packages/frontend/dist/
```

### 23.9 Step 8 — Configure Nginx Reverse Proxy

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/crm
```

```nginx
server {
    listen 80;
    server_name crm.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name crm.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/crm.crt;
    ssl_certificate_key /etc/ssl/private/crm.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Frontend (React SPA)
    root /opt/crm-platform/packages/frontend/dist;
    index index.html;

    # SPA fallback routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Email tracking pixel
    location /track/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }

    client_max_body_size 20M;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**SSL Certificate (Let's Encrypt):**
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.yourdomain.com
sudo systemctl reload nginx
```

### 23.10 Step 9 — Run the API with PM2

```bash
# Install PM2 process manager
npm install -g pm2

# Start the API
cd /opt/crm-platform/packages/api
pm2 start --name crm-api --interpreter node \
  -- node_modules/.bin/tsx src/server.ts

# Save process list (auto-restart on reboot)
pm2 save
pm2 startup  # follow the instructions printed
```

**PM2 ecosystem file** (`/opt/crm-platform/packages/api/ecosystem.config.cjs`):
```javascript
module.exports = {
  apps: [{
    name: 'crm-api',
    script: 'src/server.ts',
    interpreter: 'node',
    interpreterArgs: '--loader ts-node/esm',
    cwd: '/opt/crm-platform/packages/api',
    instances: 2,             // number of CPU cores
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: '/var/log/crm/api-error.log',
    out_file: '/var/log/crm/api-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '1G',
  }]
};
```

### 23.11 Step 10 — Verify Installation

```bash
# Check API health
curl http://localhost:3000/health

# Check frontend is served
curl -I https://crm.yourdomain.com

# Check database connectivity
psql postgresql://crm_user:password@localhost:5432/crm_db -c "SELECT version();"

# Check PM2 processes
pm2 status
pm2 logs crm-api --lines 50
```

### 23.12 Scheduled Maintenance Tasks

Set up a cron job for SLA escalation checks:

```bash
crontab -e
```

```cron
# Run SLA escalation check every 15 minutes
*/15 * * * * curl -s -X POST http://localhost:3000/api/v1/internal/sla-check \
  -H "X-Internal-Key: your-internal-secret" >> /var/log/crm/sla-cron.log 2>&1

# Clean up expired password reset tokens daily at 2am
0 2 * * * psql postgresql://crm_user:password@localhost:5432/crm_db \
  -c "DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = true;"
```

### 23.13 Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (redirects to HTTPS)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw deny 3000/tcp    # Block direct API access (only via Nginx)
sudo ufw deny 5432/tcp    # Block direct PostgreSQL access
sudo ufw enable
```

---

## 24. Cloud Installation Guide

### 24.1 Overview

The CRM platform can be deployed on any cloud provider (AWS, GCP, Azure, DigitalOcean) using either:
1. **Docker Compose** — Single-server deployment with all services containerised
2. **Managed Services** — Cloud-native approach with managed PostgreSQL, container hosting

### 24.2 Docker Compose Deployment

**Prerequisites:**
- Docker 24.x or higher
- Docker Compose v2.x
- Domain name with DNS control
- Cloud VM with at least 2 vCPU / 4 GB RAM

**Step 1 — Create Docker Compose file**

Create `/opt/crm/docker-compose.yml`:

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    container_name: crm_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: crm_db
      POSTGRES_USER: crm_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - crm_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crm_user -d crm_db"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    image: crm-platform/api:latest
    container_name: crm_api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://crm_user:${POSTGRES_PASSWORD}@postgres:5432/crm_db
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
      PORT: 3000
      HOST: 0.0.0.0
      SENDGRID_API_KEY: ${SENDGRID_API_KEY}
      SENDGRID_FROM_EMAIL: ${SENDGRID_FROM_EMAIL}
      SENDGRID_WEBHOOK_SECRET: ${SENDGRID_WEBHOOK_SECRET}
    ports:
      - "3000:3000"
    networks:
      - crm_net

  frontend:
    image: crm-platform/frontend:latest
    container_name: crm_frontend
    restart: unless-stopped
    ports:
      - "8080:80"
    networks:
      - crm_net

  nginx:
    image: nginx:alpine
    container_name: crm_nginx
    restart: unless-stopped
    depends_on:
      - api
      - frontend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/ssl/crm:ro
      - certbot_data:/etc/letsencrypt
    networks:
      - crm_net

volumes:
  postgres_data:
  certbot_data:

networks:
  crm_net:
    driver: bridge
```

**Step 2 — Create `.env` file**

```bash
nano /opt/crm/.env
```

```env
# Database
POSTGRES_PASSWORD=generate-strong-password-here

# JWT (generate: openssl rand -base64 64)
JWT_SECRET=your-very-long-random-secret-here

# Email
SENDGRID_API_KEY=SG.your-key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_WEBHOOK_SECRET=your-webhook-signing-secret

# Voice (optional)
TWILIO_ACCOUNT_SID=ACxxxxxx
TWILIO_AUTH_TOKEN=xxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# Billing (optional)
STRIPE_SECRET_KEY=sk_live_xxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxx

# Voice Bot (optional)
VAPI_API_KEY=your-vapi-key
RETELL_API_KEY=your-retell-key
```

**Step 3 — Build Docker Images**

Create `packages/api/Dockerfile`:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json ./packages/api/
COPY packages/core/package.json ./packages/core/
COPY packages/shared/package.json ./packages/shared/
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/api/dist ./dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

Create `packages/frontend/Dockerfile`:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/frontend/package.json ./packages/frontend/
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter frontend build

FROM nginx:alpine
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```bash
cd /opt/crm-platform
docker build -f packages/api/Dockerfile -t crm-platform/api:latest .
docker build -f packages/frontend/Dockerfile -t crm-platform/frontend:latest .
```

**Step 4 — Run Migrations**

```bash
docker compose run --rm api node dist/migrate.js
```

**Step 5 — Start All Services**

```bash
cd /opt/crm
docker compose up -d

# Check logs
docker compose logs -f api
docker compose logs -f postgres
```

### 24.3 Managed Cloud Services (AWS Example)

**Recommended Architecture:**

```
Internet
    │
    ▼
AWS CloudFront (CDN + SSL termination)
    │
    ├──► S3 Bucket (React SPA static files)
    │
    └──► Application Load Balancer
              │
              ├──► ECS Fargate (API containers)
              │         │
              │         ▼
              │    RDS PostgreSQL 15
              │    (Multi-AZ, automated backups)
              │
              └──► Auto-scaling group (2–10 tasks)
```

**Step 1 — RDS PostgreSQL**
```bash
aws rds create-db-instance \
  --db-instance-identifier crm-postgres \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --master-username crm_user \
  --master-user-password 'YourStrongPassword!' \
  --allocated-storage 50 \
  --storage-type gp3 \
  --multi-az \
  --backup-retention-period 7 \
  --deletion-protection \
  --db-name crm_db
```

**Step 2 — ECR (Container Registry)**
```bash
aws ecr create-repository --repository-name crm-api
aws ecr create-repository --repository-name crm-frontend

# Push images
aws ecr get-login-password | docker login --username AWS \
  --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

docker tag crm-platform/api:latest \
  123456789.dkr.ecr.us-east-1.amazonaws.com/crm-api:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/crm-api:latest
```

**Step 3 — ECS Task Definition**

Create `task-definition.json`:
```json
{
  "family": "crm-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::123456789:role/ecsTaskExecutionRole",
  "containerDefinitions": [{
    "name": "crm-api",
    "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/crm-api:latest",
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "environment": [
      { "name": "NODE_ENV", "value": "production" },
      { "name": "PORT", "value": "3000" }
    ],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:crm/database-url" },
      { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:crm/jwt-secret" },
      { "name": "SENDGRID_API_KEY", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:crm/sendgrid-key" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/crm-api",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]
}
```

**Step 4 — Frontend on S3 + CloudFront**
```bash
# Build frontend
pnpm --filter frontend build

# Upload to S3
aws s3 sync packages/frontend/dist/ s3://your-crm-bucket/ --delete

# Invalidate CloudFront cache after each deploy
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/*"
```

**CloudFront Distribution Settings:**
- Origin 1: S3 bucket (static assets)
- Origin 2: ALB (API requests matching `/api/*`)
- Behaviour 1: `/api/*` → forward to ALB
- Behaviour 2: `/*` → serve from S3 with SPA fallback

### 24.4 DigitalOcean App Platform (Simplified Cloud)

```yaml
# .do/app.yaml
name: crm-platform
region: sfo

databases:
  - name: crm-db
    engine: PG
    version: "15"
    size: db-s-1vcpu-2gb
    num_nodes: 1

services:
  - name: api
    dockerfile_path: packages/api/Dockerfile
    source_dir: /
    http_port: 3000
    instance_size_slug: professional-xs
    instance_count: 2
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        value: ${crm-db.DATABASE_URL}
      - key: JWT_SECRET
        scope: RUN_TIME
        type: SECRET
      - key: NODE_ENV
        scope: RUN_TIME
        value: production

static_sites:
  - name: frontend
    dockerfile_path: packages/frontend/Dockerfile
    source_dir: /
    output_dir: /usr/share/nginx/html
    routes:
      - path: /
    catchall_document: index.html
```

### 24.5 Health Checks and Monitoring

**API Health Endpoint:**
```
GET /health
Response: { "status": "ok", "timestamp": "2026-05-21T10:00:00Z", "db": "connected" }
```

**Recommended Monitoring Setup:**
- **Uptime Monitoring**: Uptime Robot or AWS Route53 Health Checks on `/health`
- **APM**: New Relic, Datadog, or AWS X-Ray for request tracing
- **Logs**: CloudWatch Logs (AWS), Papertrail, or Logtail
- **Alerts**: PagerDuty or OpsGenie for on-call escalation

**Database Backup Strategy:**
```bash
# Daily backup script (on-prem)
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/var/backups/crm

mkdir -p $BACKUP_DIR
pg_dump -U crm_user -h localhost crm_db | gzip > $BACKUP_DIR/crm_$DATE.sql.gz

# Retain 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

# Upload to S3 (optional)
aws s3 cp $BACKUP_DIR/crm_$DATE.sql.gz s3://your-backup-bucket/db/
```

---

## 25. Environment Variables Reference

### 25.1 Required Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/crm_db` |
| `JWT_SECRET` | Secret for signing JWT tokens (min 32 chars) | `openssl rand -base64 64` |
| `NODE_ENV` | Runtime environment | `production` |
| `PORT` | API server port | `3000` |

### 25.2 Email (Required for invitations and password reset)

| Variable | Description | Example |
|---|---|---|
| `SENDGRID_API_KEY` | SendGrid API key | `SG.xxxxxxxx` |
| `SENDGRID_FROM_EMAIL` | Sender email address | `noreply@yourdomain.com` |
| `SENDGRID_FROM_NAME` | Sender display name | `CRM Platform` |
| `SENDGRID_WEBHOOK_SECRET` | Webhook signing secret | from SendGrid dashboard |

### 25.3 Voice Providers (Optional)

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio virtual number |
| `VONAGE_API_KEY` | Vonage API key |
| `VONAGE_API_SECRET` | Vonage API secret |
| `VONAGE_VIRTUAL_NUMBER` | Vonage virtual number |

### 25.4 Voice Bot Providers (Optional)

| Variable | Description |
|---|---|
| `VAPI_API_KEY` | Vapi private API key |
| `RETELL_API_KEY` | Retell AI API key |
| `BLAND_API_KEY` | Bland.ai API key |

### 25.5 Payment Providers (Optional)

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `WISE_API_KEY` | Wise API key |
| `JAZZCASH_MERCHANT_ID` | JazzCash merchant ID |
| `JAZZCASH_PASSWORD` | JazzCash merchant password |
| `JAZZCASH_INTEGRITY_SALT` | JazzCash integrity salt |
| `EASYPAISA_STORE_ID` | EasyPaisa store ID |
| `EASYPAISA_HASH_KEY` | EasyPaisa hash key |
| `RAAST_CLIENT_ID` | Raast client ID |
| `RAAST_CLIENT_SECRET` | Raast client secret |

### 25.6 Frontend Variables

| Variable | Description | Default |
|---|---|---|
| `VITE_API_URL` | API base URL (leave empty when behind Nginx proxy) | `''` |
| `VITE_APP_NAME` | Application display name | `CRM Platform` |

---

## 26. Database Schema Reference

### 26.1 Core Tables

```sql
-- Tenants (workspaces)
tenants
  id UUID PRIMARY KEY
  name TEXT NOT NULL
  slug TEXT UNIQUE NOT NULL          -- URL-safe identifier
  custom_domain TEXT                 -- e.g. crm.acme.com
  plan TEXT DEFAULT 'starter'       -- starter | professional | enterprise
  status TEXT DEFAULT 'trialing'    -- trialing | active | suspended | cancelled
  settings JSONB DEFAULT '{}'       -- timezone, dateFormat, currency
  billing_details JSONB DEFAULT '{}'
  created_at TIMESTAMPTZ DEFAULT NOW()

-- Users (agents / admins)
users
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID REFERENCES tenants(id)
  email TEXT NOT NULL
  name TEXT NOT NULL
  role TEXT DEFAULT 'agent'         -- super_admin | tenant_admin | manager | agent | viewer
  password_hash TEXT NOT NULL
  avatar TEXT
  is_active BOOLEAN DEFAULT true
  last_login_at TIMESTAMPTZ
  created_at TIMESTAMPTZ DEFAULT NOW()
  UNIQUE(tenant_id, email)
  RLS: tenant_id = current_setting('app.tenant_id')

-- Contacts
contacts
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  first_name TEXT NOT NULL
  last_name TEXT
  email TEXT
  phone TEXT
  mobile TEXT
  company_id UUID REFERENCES companies(id)
  job_title TEXT
  owner_id UUID REFERENCES users(id)
  status TEXT DEFAULT 'lead'
  source TEXT DEFAULT 'manual'
  score INTEGER DEFAULT 0
  tags TEXT[] DEFAULT '{}'
  custom_fields JSONB DEFAULT '{}'
  last_contacted_at TIMESTAMPTZ
  created_at TIMESTAMPTZ DEFAULT NOW()
  updated_at TIMESTAMPTZ DEFAULT NOW()
  UNIQUE(tenant_id, email) WHERE email IS NOT NULL

-- Companies
companies
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  name TEXT NOT NULL
  domain TEXT
  industry TEXT
  size TEXT
  country TEXT
  owner_id UUID REFERENCES users(id)
  custom_fields JSONB DEFAULT '{}'
  tags TEXT[] DEFAULT '{}'
  created_at TIMESTAMPTZ DEFAULT NOW()

-- Deals
deals
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  name TEXT NOT NULL
  amount NUMERIC(15,2)
  currency TEXT DEFAULT 'USD'
  pipeline_id UUID REFERENCES pipelines(id)
  stage_id UUID REFERENCES stages(id)
  contact_id UUID REFERENCES contacts(id)
  company_id UUID REFERENCES companies(id)
  owner_id UUID REFERENCES users(id)
  status TEXT DEFAULT 'open'        -- open | won | lost
  close_date DATE
  won_at TIMESTAMPTZ
  lost_at TIMESTAMPTZ
  lost_reason TEXT
  created_at TIMESTAMPTZ DEFAULT NOW()

-- Pipelines
pipelines
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  name TEXT NOT NULL
  is_default BOOLEAN DEFAULT false
  created_at TIMESTAMPTZ DEFAULT NOW()

-- Stages
stages
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  pipeline_id UUID REFERENCES pipelines(id)
  name TEXT NOT NULL
  position INTEGER NOT NULL
  probability INTEGER DEFAULT 0     -- 0–100
  is_won_stage BOOLEAN DEFAULT false
  is_lost_stage BOOLEAN DEFAULT false

-- Activities
activities
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  type TEXT NOT NULL                -- call|email|meeting|task|note|...
  subject TEXT NOT NULL
  body TEXT
  status TEXT DEFAULT 'pending'     -- pending | completed | cancelled
  priority TEXT DEFAULT 'normal'    -- low | normal | high | urgent
  contact_id UUID REFERENCES contacts(id)
  company_id UUID REFERENCES companies(id)
  deal_id UUID REFERENCES deals(id)
  owner_id UUID REFERENCES users(id)
  scheduled_at TIMESTAMPTZ
  due_at TIMESTAMPTZ
  completed_at TIMESTAMPTZ
  duration INTEGER                  -- minutes
  outcome TEXT
  metadata JSONB DEFAULT '{}'
  created_at TIMESTAMPTZ DEFAULT NOW()

-- Tickets
tickets
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  ticket_number SERIAL             -- human-readable: TKT-001
  subject TEXT NOT NULL
  description TEXT
  status TEXT DEFAULT 'open'       -- open|assigned|accepted|in_progress|pending|resolved|closed
  priority TEXT DEFAULT 'medium'   -- urgent|high|medium|low
  channel TEXT DEFAULT 'manual'    -- manual|email|phone|chat|api|voice_bot
  queue_id UUID REFERENCES ticket_queues(id)
  sla_policy_id UUID REFERENCES sla_policies(id)
  contact_id UUID REFERENCES contacts(id)
  company_id UUID REFERENCES companies(id)
  assignee_id UUID REFERENCES users(id)
  reporter_email TEXT
  reporter_name TEXT
  reporter_phone TEXT
  tags TEXT[] DEFAULT '{}'
  custom_fields JSONB DEFAULT '{}'
  sla_due_at TIMESTAMPTZ           -- calculated from sla_policy + accepted_at
  escalation_level INTEGER DEFAULT 0
  resolution_note TEXT
  resolved_at TIMESTAMPTZ
  closed_at TIMESTAMPTZ
  created_at TIMESTAMPTZ DEFAULT NOW()
  updated_at TIMESTAMPTZ DEFAULT NOW()

-- Emails
emails
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  contact_id UUID REFERENCES contacts(id)
  subject TEXT
  body TEXT
  from_email TEXT
  to_email TEXT
  status TEXT DEFAULT 'sent'       -- sent|delivered|failed|spam
  provider TEXT DEFAULT 'sendgrid'
  provider_message_id TEXT
  opened_at TIMESTAMPTZ
  open_count INTEGER DEFAULT 0
  clicked_at TIMESTAMPTZ
  bounced_at TIMESTAMPTZ
  created_at TIMESTAMPTZ DEFAULT NOW()

-- Voice Calls
voice_calls
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  provider TEXT                    -- twilio | vonage
  direction TEXT                   -- inbound | outbound
  from_number TEXT
  to_number TEXT
  started_at TIMESTAMPTZ
  ended_at TIMESTAMPTZ
  duration_seconds INTEGER
  outcome TEXT                     -- answered | no_answer | busy | failed
  recording_url TEXT
  transcript TEXT
  agent_id UUID REFERENCES users(id)
  contact_id UUID REFERENCES contacts(id)

-- Voice Bot Calls
voice_bot_calls
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
  tenant_id UUID
  provider TEXT                    -- vapi | retell | bland
  provider_call_id TEXT
  from_number TEXT
  to_number TEXT
  duration_seconds INTEGER
  status TEXT
  transcript TEXT
  summary TEXT
  sentiment TEXT                   -- positive | neutral | negative | urgent
  priority TEXT                    -- urgent | high | medium | low
  ticket_id UUID REFERENCES tickets(id)
  contact_id UUID REFERENCES contacts(id)
  created_at TIMESTAMPTZ DEFAULT NOW()

-- Password Reset Tokens
password_reset_tokens
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
  token_hash TEXT NOT NULL         -- SHA-256 of the token
  expires_at TIMESTAMPTZ NOT NULL  -- 1 hour from creation
  used BOOLEAN DEFAULT false
  created_at TIMESTAMPTZ DEFAULT NOW()
```

---

## 27. API Reference Overview

### 27.1 Base URL

```
Production:  https://your-domain.com/api/v1
Development: http://localhost:3000/api/v1
```

### 27.2 Authentication

```http
# JWT (user session)
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# API Key (external integrations)
Authorization: ApiKey crm_live_64hexcharactershere...
```

### 27.3 Standard Response Format

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "pageSize": 25,
    "total": 150,
    "totalPages": 6
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Contact not found"
  }
}
```

### 27.4 Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| **AUTH** | | |
| POST | `/auth/login` | Sign in, receive JWT |
| POST | `/auth/refresh` | Refresh JWT token |
| POST | `/auth/logout` | Invalidate session |
| POST | `/auth/forgot-password` | Request password reset email |
| POST | `/auth/reset-password` | Apply password reset token |
| **CONTACTS** | | |
| GET | `/contacts` | List contacts (paginated, filterable) |
| POST | `/contacts` | Create a contact |
| POST | `/contacts/import` | Bulk import from CSV (max 5,000 rows) |
| GET | `/contacts/:id` | Get contact with company + owner |
| PATCH | `/contacts/:id` | Update contact fields |
| DELETE | `/contacts/:id` | Delete contact |
| GET | `/contacts/:id/timeline` | Activities + calls timeline |
| **COMPANIES** | | |
| GET | `/companies` | List companies |
| POST | `/companies` | Create company |
| GET | `/companies/:id` | Get company |
| PATCH | `/companies/:id` | Update company |
| DELETE | `/companies/:id` | Delete company |
| **DEALS** | | |
| GET | `/deals/pipelines` | List pipelines |
| POST | `/deals/pipelines` | Create pipeline |
| GET | `/deals/board/:pipelineId` | Kanban board with deals per stage |
| GET | `/deals` | List deals (filterable) |
| POST | `/deals` | Create deal |
| GET | `/deals/:id` | Get deal |
| PATCH | `/deals/:id` | Update deal |
| PATCH | `/deals/:id/stage` | Move deal to a different stage |
| POST | `/deals/:id/won` | Mark deal as won |
| POST | `/deals/:id/lost` | Mark deal as lost |
| **ACTIVITIES** | | |
| GET | `/activities` | List activities (filterable) |
| POST | `/activities` | Create activity |
| GET | `/activities/:id` | Get activity |
| PATCH | `/activities/:id` | Update activity |
| DELETE | `/activities/:id` | Delete activity |
| GET | `/activities/overdue` | Overdue tasks |
| **TICKETS** | | |
| GET | `/tickets` | List tickets (filterable) |
| POST | `/tickets` | Create ticket |
| GET | `/tickets/stats` | Ticket counts by status/priority |
| GET | `/tickets/queues` | List queues |
| POST | `/tickets/queues` | Create queue |
| GET | `/tickets/sla-policies` | List SLA policies |
| POST | `/tickets/sla-policies` | Create SLA policy |
| GET | `/tickets/:id` | Get ticket + comments + voice bot call |
| PATCH | `/tickets/:id` | Update ticket |
| POST | `/tickets/:id/assign` | Assign to agent |
| POST | `/tickets/:id/accept` | Accept (start SLA timer) |
| POST | `/tickets/:id/resolve` | Resolve with note |
| POST | `/tickets/:id/close` | Close ticket |
| POST | `/tickets/:id/comments` | Add comment/internal note |
| **EMAILS** | | |
| GET | `/emails` | List emails |
| POST | `/emails/send` | Send email via SendGrid |
| POST | `/emails/webhook/sendgrid` | SendGrid delivery events (public) |
| GET | `/emails/track/open/:id` | Email open tracking pixel (public) |
| **VOICE** | | |
| GET | `/voice/calls` | List call logs |
| POST | `/voice/call` | Initiate outbound call |
| GET | `/voice/calls/:id` | Get call details |
| **VOICE BOT** | | |
| GET | `/voice-bot/config` | Get bot configuration |
| PUT | `/voice-bot/config` | Update bot configuration |
| GET | `/voice-bot/calls` | List bot calls |
| GET | `/voice-bot/calls/:id` | Get call + transcript |
| POST | `/voice-bot/calls/:id/ticket` | Manually create ticket from call |
| GET | `/voice-bot/stats` | Bot call statistics |
| POST | `/voice-bot/test-call` | Initiate test call |
| GET | `/voice-bot/webhook-url` | Get webhook URL for provider |
| POST | `/voice-bot/webhook/vapi` | Vapi webhook (public) |
| POST | `/voice-bot/webhook/retell` | Retell webhook (public) |
| POST | `/voice-bot/webhook/bland` | Bland.ai webhook (public) |
| **ANALYTICS** | | |
| GET | `/analytics/dashboard` | All KPIs + recent activity + recent tickets |
| GET | `/analytics/revenue` | Revenue over time chart data |
| GET | `/analytics/funnel/:pipelineId` | Pipeline funnel by stage |
| GET | `/analytics/leaderboard` | Agent performance leaderboard |
| GET | `/analytics/contact-sources` | Contact source breakdown |
| **SETTINGS** | | |
| GET | `/settings` | Get workspace + plan info |
| GET | `/settings/workspace` | Get workspace settings |
| PATCH | `/settings/workspace` | Update workspace settings |
| GET | `/settings/team` | List team members |
| POST | `/settings/team/invite` | Invite new team member |
| PATCH | `/settings/team/:userId` | Change member's role |
| DELETE | `/settings/team/:userId` | Remove team member |
| POST | `/settings/security/change-password` | Change own password |
| **BILLING** | | |
| GET | `/billing/pricing` | Get plan pricing + provider availability |
| POST | `/billing/checkout` | Create checkout session |
| GET | `/billing/subscription` | Get current subscription status |
| POST | `/billing/webhook/stripe` | Stripe payment events (public) |
| **API KEYS** | | |
| GET | `/api-keys` | List API keys |
| POST | `/api-keys` | Create API key (key shown once) |
| DELETE | `/api-keys/:id` | Revoke API key |

---

## 28. Troubleshooting Guide

### 28.1 Login Issues

**Problem: "Invalid credentials" error**
- Check the workspace slug is correct (visible in the URL after login).
- Ensure the email and password are correct.
- Password is case-sensitive.
- If forgotten: use the **Forgot Password** link on the login page.

**Problem: API requests fail with CORS errors in browser console**
- Ensure `VITE_API_URL` is set to empty string (`''`) in `packages/frontend/.env`.
- All API calls must go through the Vite proxy (development) or Nginx proxy (production).
- Never set `VITE_API_URL=http://localhost:3000` — this causes cross-origin failures.

**Problem: JWT token expired**
- Tokens expire after 24 hours by default.
- The frontend should automatically attempt token refresh.
- If stuck: clear localStorage and log in again.

### 28.2 Dashboard Shows No Data

**Problem: All KPIs show 0**
- Check browser network tab for a 500 error on `/api/v1/analytics/dashboard`.
- The most common cause is a SQL error in the analytics query.
- Run the query manually against the database to check for errors.
- Verify all referenced table columns exist (especially `assignee_id` on tickets — not `assigned_to`).

**Problem: Revenue chart is empty**
- The revenue chart requires at least one won deal.
- Check that any won deals have `won_at` set (not null).
- The `generate_series` query pads empty months — but if `won_at` is null on won deals, they won't appear.

### 28.3 API Not Picking Up Code Changes (Development)

The development API is started with `tsx` (not `tsx watch`), so it **does not hot-reload**.

After any backend change:
```bash
# Kill the running API process
pkill -f "tsx.*server.ts"

# Wait a moment, then restart
cd /opt/crm-platform/packages/api
npx tsx src/server.ts &
```

### 28.4 PostgreSQL NUMERIC Returns as String

**Symptom:** Deal totals show string concatenation instead of addition (e.g. "10001000" instead of 2000).

**Root cause:** Node.js `pg` library returns `NUMERIC` columns as JavaScript strings to preserve precision.

**Fix:**
- In SQL: `SUM(amount)::float8` to cast to float
- In JavaScript: `parseFloat(d.amount) || 0` before arithmetic operations

### 28.5 Voice Bot Tickets Not Creating

**Problem: Calls received but no tickets created**
1. Check `auto_create_ticket` is `true` in voice bot config (`GET /api/v1/voice-bot/config`).
2. Verify the webhook URL is correctly configured in the provider dashboard.
3. Check API logs for webhook processing errors.
4. Verify the API key in the webhook URL is valid and has `tickets:write` scope.
5. Check the tenant ID in the webhook URL matches the intended workspace.

**Problem: Webhook signature verification failing**
- Ensure the correct webhook secret is configured in the provider dashboard.
- The secret in `VAPI_WEBHOOK_SECRET` / `RETELL_WEBHOOK_SECRET` must match the provider.

### 28.6 Email Delivery Issues

**Problem: Emails not being sent**
1. Verify `SENDGRID_API_KEY` is correct and not expired.
2. Check SendGrid dashboard for delivery errors.
3. Verify the sender domain is verified in SendGrid (domain authentication required).
4. Check the `SENDGRID_FROM_EMAIL` is from a verified sender identity.

**Problem: Open tracking not working**
1. Verify `SENDGRID_WEBHOOK_SECRET` is set.
2. Check the webhook URL in SendGrid is pointing to `https://your-api/api/v1/emails/webhook/sendgrid`.
3. Confirm "Opened" event is checked in the SendGrid webhook settings.
4. Check your domain/firewall allows inbound webhooks from SendGrid IP ranges.

### 28.7 Database Connection Errors

**Problem: "too many connections" error**
- PostgreSQL default `max_connections = 100`.
- Each API server process uses a connection pool.
- Increase: `ALTER SYSTEM SET max_connections = 200;` then restart PostgreSQL.
- Better: use PgBouncer connection pooler in front of PostgreSQL.

**Problem: RLS policy blocking queries**
- If `db.withTenant()` is not used, the tenant context is not set and all rows are hidden.
- Never query the database directly without the tenant context wrapper.
- `db.withSuperAdmin()` bypasses RLS — use only for system-level operations.

### 28.8 Performance Issues

**Slow contact list queries**
```sql
-- Add missing index
CREATE INDEX CONCURRENTLY idx_contacts_tenant_status
  ON contacts (tenant_id, status);

CREATE INDEX CONCURRENTLY idx_contacts_tenant_created
  ON contacts (tenant_id, created_at DESC);
```

**Slow ticket queries**
```sql
CREATE INDEX CONCURRENTLY idx_tickets_tenant_status_priority
  ON tickets (tenant_id, status, priority);

CREATE INDEX CONCURRENTLY idx_tickets_sla_due
  ON tickets (tenant_id, sla_due_at)
  WHERE status NOT IN ('resolved', 'closed');
```

---

## 29. Security Best Practices

### 29.1 JWT Secret Management
- Minimum 256 bits of entropy: `openssl rand -base64 64`
- Rotate the secret every 90 days (all existing sessions invalidated — users must re-login)
- Store in environment variables or a secrets manager (AWS Secrets Manager, HashiCorp Vault)
- Never commit secrets to version control

### 29.2 Database Security
- Use a dedicated database user with minimum required privileges
- Enable SSL for database connections: `?sslmode=require` in DATABASE_URL
- Regular backups (at least daily, retained for 30 days)
- Never expose PostgreSQL port (5432) to the internet
- Regularly audit `pg_stat_activity` for long-running queries

### 29.3 API Security
- All API responses include `X-Content-Type-Options: nosniff`
- Rate limiting: 100 requests/minute per IP on auth endpoints, 1000/minute on API endpoints
- Passwords: bcrypt with cost 12 (approximately 300ms per hash on modern hardware)
- Password reset tokens: SHA-256 hashed, 1-hour expiry, single-use
- API keys: SHA-256 hashed on storage, shown only once on creation
- Webhook verification: HMAC-SHA256 signature validation on all inbound webhooks

### 29.4 Frontend Security
- React SPA with Content Security Policy headers (configure in Nginx)
- All forms use CSRF-safe same-site requests (no cookie auth by default)
- Sensitive data never stored in localStorage (JWT stored in memory / httpOnly cookie recommended for production)

### 29.5 Network Security
- Always serve over HTTPS in production
- Block direct access to API port (3000) — only Nginx should proxy to it
- Enable Nginx `limit_req_zone` for rate limiting at the proxy layer
- Use Fail2Ban to block repeated failed login attempts

### 29.6 Recommended Nginx Security Headers

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
```

---

## 30. Upgrade & Maintenance

### 30.1 Upgrade Procedure

```bash
# 1. Create a database backup before any upgrade
pg_dump -U crm_user crm_db | gzip > /var/backups/crm/pre-upgrade-$(date +%Y%m%d).sql.gz

# 2. Pull latest code
cd /opt/crm-platform
git pull origin main

# 3. Install new dependencies
pnpm install

# 4. Run any new migrations
pnpm --filter @crm/core migrate

# 5. Rebuild the frontend
pnpm --filter frontend build

# 6. Restart the API gracefully (PM2)
pm2 reload crm-api

# 7. Verify health
curl http://localhost:3000/health
pm2 status
```

### 30.2 Rolling Back

```bash
# Roll back to a previous git tag
git stash
git checkout tags/v1.2.0

# Restore database backup if migration was destructive
gunzip -c /var/backups/crm/pre-upgrade-20260521.sql.gz | psql -U crm_user crm_db

# Rebuild and restart
pnpm install && pnpm --filter frontend build
pm2 reload crm-api
```

### 30.3 Scheduled Maintenance Window

Recommended maintenance windows:
- **Daily**: SLA escalation check every 15 minutes (automated cron)
- **Daily at 2am**: Token cleanup, log rotation
- **Weekly at 3am Sunday**: Database VACUUM ANALYZE, index maintenance
- **Monthly**: Review and rotate API keys, check SSL certificate expiry

```bash
# Weekly database maintenance
psql -U crm_user crm_db << EOF
VACUUM ANALYZE contacts;
VACUUM ANALYZE deals;
VACUUM ANALYZE tickets;
VACUUM ANALYZE activities;
VACUUM ANALYZE voice_bot_calls;
REINDEX INDEX CONCURRENTLY idx_contacts_tenant_status;
EOF
```

### 30.4 Log Rotation (Linux)

```bash
# /etc/logrotate.d/crm
/var/log/crm/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

---

*End of CRM Platform Operational Manual v1.0*

*For support and updates, contact your system administrator or refer to the project repository.*
