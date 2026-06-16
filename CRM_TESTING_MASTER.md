# CRM Platform — Master Testing Checklist
**Version:** 1.0 | **Date:** 2026-06-09 | **Platform:** Multi-Tenant SaaS CRM

---

## Overview & Testing Scope

This document covers end-to-end quality assurance for the CRM platform across four critical dimensions:

| # | Dimension | What We Validate |
|---|-----------|-----------------|
| 1 | **Authentication** | Sector-wise and user-wise login, token lifecycle, tenant isolation |
| 2 | **User & Role Provisioning** | Department-wise user creation, role assignment, module selection per tenant |
| 3 | **Access Segregation** | Each user sees only their tenant, department, modules, and roles — nothing else |
| 4 | **Module Functionality** | Every role in every department can do exactly what they're supposed to — no more, no less |

---

## Test Matrix: Sectors, Departments & Roles

### Sectors Under Test

| Sector | Departments | Contact Label | Ticket Label |
|--------|------------|---------------|--------------|
| **Banking** | Retail Banking, Loans, Cards, Customer Support, Compliance | Account Holder | Case |
| **Telecom** | Mobile Services, Broadband, Enterprise, Technical Support, Billing | Subscriber | Trouble Ticket |
| **Logistics** | Customer Service, Operations, Customs & Compliance, Warehousing, Last Mile | Client | Shipment |
| **Insurance** | New Business, Claims, Renewals, Customer Support, Underwriting | Policyholder | Claim |
| **eCommerce** | Customer Support, Returns & Refunds, Payments, Logistics, Seller Support | Customer | Order |

### Roles Under Test

| Role | Level | Intended Scope |
|------|-------|---------------|
| `tenant_admin` | 40 | Full workspace — all modules, all settings, all users |
| `manager` | 30 | Team management, records, webhook setup; no billing |
| `agent` | 20 | Day-to-day ops: contacts, deals, activities, tickets, emails |
| `viewer` | 10 | Read-only: dashboards and reports only |

### Cross-Dimensional Test Matrix

```
For each sector:
  For each department:
    For each role:
      → Authentication works
      → Correct modules visible
      → Correct permissions enforced
      → Other tenants/departments/roles NOT visible
      → Module functionality works per permission level
```

---

## Part 1 — Authentication Testing

### 1.1 Basic Login Flow (All Sectors)

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| A-01 | Valid login — Banking tenant admin | POST /auth/login with valid email+password for Banking tenant | 200 OK, JWT contains `tenantId`, `role: tenant_admin`, `plan`, `sector: banking` | |
| A-02 | Valid login — Telecom agent | POST /auth/login for Telecom tenant, agent role | 200 OK, JWT role = `agent`, tenant = Telecom tenant ID | |
| A-03 | Valid login — Logistics manager | POST /auth/login for Logistics tenant, manager role | 200 OK, JWT role = `manager` | |
| A-04 | Valid login — Insurance viewer | POST /auth/login for Insurance tenant, viewer role | 200 OK, JWT role = `viewer` | |
| A-05 | Valid login — eCommerce agent | POST /auth/login for eCommerce tenant, agent role | 200 OK | |
| A-06 | Wrong password | POST /auth/login with invalid password | 401 Unauthorized, no token returned | |
| A-07 | Non-existent email | POST /auth/login with email not in DB | 401 Unauthorized | |
| A-08 | Deactivated user | Login with `is_active = false` user | 401 Unauthorized, message: account deactivated | |
| A-09 | Suspended tenant | Login to a tenant with `status = suspended` | 401/403 — tenant suspended message | |
| A-10 | Cross-tenant login attempt | User from Banking tenant tries to log into Telecom subdomain | 401 — user not found in this tenant | |

### 1.2 JWT Token Integrity

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| A-11 | Token contains correct claims | Decode JWT after login | Contains: `sub`, `tenantId`, `role`, `plan`, `iat`, `exp`, `jti` | |
| A-12 | Token expiry (8h) | Use token after 8 hours | 401 — token expired | |
| A-13 | Token revocation on logout | POST /auth/logout then reuse token | 401 — token revoked (jti in Redis blocklist) | |
| A-14 | Tampered token | Modify JWT payload, keep old signature | 401 — signature verification failed | |
| A-15 | No token provided | API call without Authorization header | 401 Unauthorized | |
| A-16 | Wrong tenant in token | Manually craft JWT with different tenantId | RLS blocks all queries — returns empty or 403 | |

### 1.3 Sector-Specific Registration

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| A-17 | Banking sector registration | POST /auth/register, sector=banking | Tenant created with 5 departments, banking custom fields seeded | |
| A-18 | Telecom sector registration | POST /auth/register, sector=telecom | Tenant has Telecom departments and custom fields | |
| A-19 | Duplicate slug rejected | Register with same org slug twice | 409 Conflict | |
| A-20 | Trial tenant created | New registration | Tenant status=trial, trial_ends_at set to now+14 days | |
| A-21 | Admin user created on register | Complete registration | First user has role=tenant_admin, is_active=true | |

### 1.4 Password Reset Flow

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| A-22 | Forgot password — valid email | POST /auth/forgot-password | 200 OK, reset token generated (valid 1h) | |
| A-23 | Reset with valid token | POST /auth/reset-password with valid token | Password changed, token invalidated | |
| A-24 | Reset with expired token | Use token >1h old | 400 — token expired | |
| A-25 | Reset cross-tenant | Token from Tenant A used against Tenant B | 400/401 — invalid | |

---

## Part 2 — User Creation, Role Allocation & Module Selection

### 2.1 User Creation (Tenant Admin)

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| U-01 | Admin creates user in own tenant | POST /api/v1/users (as tenant_admin) | User created with correct tenant_id, role, department | |
| U-02 | Agent cannot create users | POST /api/v1/users (as agent) | 403 Forbidden | |
| U-03 | Viewer cannot create users | POST /api/v1/users (as viewer) | 403 Forbidden | |
| U-04 | Manager cannot create users | POST /api/v1/users (as manager) | 403 Forbidden | |
| U-05 | Create user in another tenant | Admin crafts request with foreign tenantId | RLS blocks — user created in own tenant only | |
| U-06 | User assigned to department | Create user with `department: 'Loans'` (banking) | User record has department = 'Loans' | |
| U-07 | User assigned custom role | Create user with custom role UUID | User has correct role, permissions matrix applied | |
| U-08 | Duplicate email in same tenant | Create two users with same email in tenant | 409 Conflict | |
| U-09 | Same email different tenant | Email exists in Tenant A; create in Tenant B | Allowed — different tenants | |
| U-10 | Seat limit enforcement | Try to exceed plan's max_users limit | 402/403 — seat limit reached | |

### 2.2 Department-Based User Segregation Setup

#### Banking Sector — Department Users

| Department | User | Role | Modules to Assign |
|------------|------|------|-------------------|
| Retail Banking | retail_agent@bank.com | agent | CRM (contacts, deals, activities) |
| Loans | loans_manager@bank.com | manager | CRM + Ticketing |
| Cards | cards_agent@bank.com | agent | CRM |
| Customer Support | support_agent@bank.com | agent | Ticketing |
| Compliance | compliance_viewer@bank.com | viewer | Analytics + Ticketing (view) |

#### Telecom Sector — Department Users

| Department | User | Role | Modules to Assign |
|------------|------|------|-------------------|
| Mobile Services | mobile_agent@telecom.com | agent | CRM + Ticketing |
| Broadband | broadband_manager@telecom.com | manager | CRM + Ticketing + Analytics |
| Technical Support | tech_agent@telecom.com | agent | Ticketing + Voice |
| Billing | billing_manager@telecom.com | manager | CRM + Sales |

### 2.3 Role Assignment Tests

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| R-01 | Assign system role to user | PATCH /api/v1/users/:id, role=agent | User role updated | |
| R-02 | Assign custom role to user | PATCH /api/v1/users/:id, role=<custom_uuid> | User gets custom role permissions | |
| R-03 | Assign role from another tenant | Use custom role UUID from Tenant B for Tenant A user | 403/400 — role not found in tenant | |
| R-04 | Create custom role | POST /api/v1/roles with permissions matrix | Role created with correct JSONB permissions | |
| R-05 | Custom role permissions respected | Agent with custom role (contacts:view only) tries contacts:write | 403 — insufficient permission | |
| R-06 | Delete system role | DELETE /api/v1/roles/<system_role_id> | 400 — cannot delete system role | |
| R-07 | View roles as agent | GET /api/v1/roles (agent) | Returns roles for own tenant only | |

### 2.4 Module Activation Tests

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| M-01 | Activate Voice module | Admin toggles Voice on in Settings | module visible in nav; voice routes accessible | |
| M-02 | Deactivate module | Admin toggles Ticketing off | Ticketing nav item hidden; /api/v1/tickets returns 403 | |
| M-03 | Module on free plan limit | Try to activate Voice on free plan | 402 — module not available on this plan | |
| M-04 | Module selection persists | Activate module, re-login | Module still active | |
| M-05 | GET /api/v1/modules returns correct modules | Call as agent | Only tenant's active modules returned | |

---

## Part 3 — Access Segregation Testing

### 3.1 Multi-Tenant Isolation (Cross-Tenant Tests)

> **Critical Security Tests** — Any failure here is a P0 bug.

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| T-01 | Tenant A cannot read Tenant B contacts | Login as Tenant A user; GET /api/v1/contacts | Returns only Tenant A contacts (RLS enforced) | |
| T-02 | Tenant A cannot read Tenant B tickets | GET /api/v1/tickets with Tenant A JWT | Only Tenant A tickets returned | |
| T-03 | Tenant A cannot read Tenant B users | GET /api/v1/users with Tenant A JWT | Only Tenant A users returned | |
| T-04 | Cross-tenant ID guessing | GET /api/v1/contacts/:id using Tenant B's contact UUID from Tenant A | 404 — not found (RLS hides it) | |
| T-05 | Tenant A cannot update Tenant B record | PATCH /api/v1/contacts/:tenantB_contact_id with Tenant A JWT | 404 — not found | |
| T-06 | Tenant A cannot delete Tenant B record | DELETE /api/v1/contacts/:tenantB_id with Tenant A JWT | 404 — not found | |
| T-07 | Roles are tenant-scoped | GET /api/v1/roles — Tenant A sees Tenant B's custom role UUID | Role not returned — tenant_id filter applies | |
| T-08 | Tenant subdomain isolation | Send Tenant A JWT to Tenant B subdomain | 403 — tenant mismatch | |
| T-09 | Tenant suspension blocks all API | Suspend Tenant A; Tenant A user calls any API | 403 — tenant suspended | |
| T-10 | Super admin can see all tenants | GET /super-admin/tenants as super_admin | All tenants returned | |
| T-11 | Regular admin cannot reach super-admin routes | GET /super-admin/tenants as tenant_admin | 403 Forbidden | |

### 3.2 Department Segregation Tests

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| D-01 | Sales dept user cannot see Support tickets | Login as sales agent; GET /api/v1/tickets | If ticketing not in their module access: 403. If module active but queue-scoped: only sales-relevant queues | |
| D-02 | Support agent cannot access Deals | Login as support_agent (ticketing role only); GET /api/v1/deals | 403 — no deals module access | |
| D-03 | Compliance viewer cannot write contacts | Login as compliance_viewer; POST /api/v1/contacts | 403 — viewer has no write access | |
| D-04 | Loans manager cannot access Cards department tickets | Ticket from Cards dept assigned to Cards queue; Loans manager GET /api/v1/tickets | Should only see tickets in assigned queues or own department | |
| D-05 | Technical Support agent cannot view billing invoices | Login as tech_agent; GET /api/v1/billing/invoices | 403 — billing not in their module access | |
| D-06 | Billing manager cannot access Voice calls | Login as billing_manager (no Voice module); GET /api/v1/voice/calls | 403 — voice module not accessible | |
| D-07 | Complaints dept user cannot see Sales invoices | Login as complaints_agent; GET /api/v1/sales/invoices | 403 | |
| D-08 | Department field not leakable | Agent queries contacts filtered by another department's owner | Returns empty or own contacts only | |

### 3.3 Role-Based Access Segregation

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| RB-01 | Viewer cannot write — contacts | Login as viewer; POST /api/v1/contacts | 403 | |
| RB-02 | Viewer cannot write — deals | Login as viewer; POST /api/v1/deals | 403 | |
| RB-03 | Viewer cannot write — tickets | Login as viewer; POST /api/v1/tickets | 403 | |
| RB-04 | Agent cannot access settings | Login as agent; GET /api/v1/settings/tenant | 403 — settings requires manager or above | |
| RB-05 | Agent cannot manage roles | Login as agent; POST /api/v1/roles | 403 | |
| RB-06 | Agent cannot manage users | Login as agent; PATCH /api/v1/users/:id | 403 | |
| RB-07 | Manager cannot access billing | Login as manager; GET /api/v1/billing/invoices | 403 — billing requires tenant_admin | |
| RB-08 | Manager can create contacts | Login as manager; POST /api/v1/contacts | 201 Created | |
| RB-09 | Manager can assign tickets | Login as manager; PATCH /api/v1/tickets/:id (assignee only) | 200 OK | |
| RB-10 | Admin can do everything in tenant | Login as tenant_admin; call all endpoints | All return 200/201 | |

### 3.4 Frontend Visibility Tests (UI Segregation)

| TC# | Test Case | Steps | Expected Result | Pass/Fail |
|-----|-----------|-------|-----------------|-----------|
| FE-01 | Viewer sees no Create buttons | Login as viewer; open Contacts page | No "Add Contact" button rendered | |
| FE-02 | Agent sees no Settings nav item | Login as agent; check sidebar | Settings not in sidebar | |
| FE-03 | Agent sees no Billing nav item | Login as agent; check sidebar | Billing not visible | |
| FE-04 | Agent sees no Roles nav item | Login as agent | Roles page not in nav | |
| FE-05 | Support agent: no Deals in nav | Support-only role (ticketing module); login and check sidebar | Deals not visible | |
| FE-06 | Sales agent: no Tickets in nav | Sales-only role; check sidebar | Ticketing not visible | |
| FE-07 | Module not active: nav hidden | Deactivate Voice module; login as any user | Voice section absent from nav | |
| FE-08 | Tenant name shown correctly | Login to Banking tenant; check top nav | Shows correct tenant name, not another tenant | |
| FE-09 | Super Admin panel hidden | Login as tenant_admin | No Super Admin link visible | |
| FE-10 | Direct URL access blocked | As agent, navigate directly to /roles | Redirect to dashboard or 403 page | |

---

## Part 4 — Module Functionality Testing (Role × Department × Module)

### 4.1 CRM Module — Contacts

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| CR-01 | Retail Banking Agent | agent | List contacts | Returns contacts owned by tenant, paginated | |
| CR-02 | Retail Banking Agent | agent | Create contact (Account Holder) | 201, contact has banking custom fields | |
| CR-03 | Retail Banking Agent | agent | Edit contact | 200 OK | |
| CR-04 | Retail Banking Agent | agent | Delete contact | 200 (archive) | |
| CR-05 | Compliance Viewer | viewer | List contacts | 200 — read only | |
| CR-06 | Compliance Viewer | viewer | Create contact | 403 | |
| CR-07 | Loans Manager | manager | View all contacts | 200 — all tenant contacts | |
| CR-08 | Support Agent (no CRM module) | agent | GET /api/v1/contacts | 403 — module not enabled for role | |
| CR-09 | Any user | any | GET contact from another tenant | 404 (RLS) | |
| CR-10 | Banking Agent | agent | Custom fields visible | banking-specific fields (account_number, kyc_status, etc.) visible in form | |

### 4.2 CRM Module — Deals

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| DE-01 | Sales Manager | manager | Create deal | 201 Created | |
| DE-02 | Sales Agent | agent | Move deal stage | 200 OK | |
| DE-03 | Viewer | viewer | View deal pipeline | 200 — read only | |
| DE-04 | Viewer | viewer | Change deal stage | 403 | |
| DE-05 | Support Agent (no deals) | agent | GET /api/v1/deals | 403 | |
| DE-06 | Agent | agent | Mark deal won | 200 OK | |
| DE-07 | Viewer | viewer | Mark deal lost | 403 | |
| DE-08 | Manager | manager | View deal history (audit) | 200 — full history trail | |

### 4.3 Ticketing Module — Complaint/Support Department

> **Key segregation test:** sales dept users must NOT see this module at all.

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| TK-01 | Support Agent | agent | Create ticket | 201 — ticket_number auto-generated | |
| TK-02 | Support Agent | agent | Accept ticket | 200 — SLA timer starts | |
| TK-03 | Support Agent | agent | Resolve ticket | 200 — resolved_at set | |
| TK-04 | Support Manager | manager | Assign ticket to agent | 200 OK | |
| TK-05 | Support Viewer | viewer | View ticket list | 200 — read only | |
| TK-06 | Support Viewer | viewer | Post comment on ticket | 403 | |
| TK-07 | Sales Agent (no ticketing) | agent | GET /api/v1/tickets | 403 — module not enabled | |
| TK-08 | Loans Manager (no ticketing) | manager | GET /api/v1/tickets | 403 | |
| TK-09 | Support Agent | agent | Add internal comment | 200 — is_internal=true, hidden from customer | |
| TK-10 | Support Agent | agent | View SLA dashboard | 200 — SLA metrics visible | |
| TK-11 | Banking — Cards queue ticket | Loans agent | View Cards queue ticket | Should not see other department's queue (if queue-scoped) | |
| TK-12 | Compliance Viewer | viewer | Export ticket analytics | 200 — analytics view allowed | |

### 4.4 Voice Module

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| VC-01 | Voice-enabled Agent | agent | GET /api/v1/voice/calls | 200 — call log returned | |
| VC-02 | Voice-enabled Agent | agent | Initiate outbound call | 200 — call triggered via provider | |
| VC-03 | Agent (Voice module OFF) | agent | GET /api/v1/voice/calls | 403 — module not active | |
| VC-04 | Manager | manager | View voice analytics | 200 | |
| VC-05 | Admin | tenant_admin | Configure voice bot | 200 — PATCH /api/v1/voice-bot/config | |
| VC-06 | Agent | agent | Configure voice bot | 403 — admin only | |
| VC-07 | Viewer | viewer | View call logs | 200 — read only | |
| VC-08 | Viewer | viewer | Initiate call | 403 | |

### 4.5 Sales / Invoicing Module

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| SL-01 | Sales Admin | tenant_admin | Create sales invoice | 201 OK | |
| SL-02 | Sales Manager | manager | View invoices | 200 OK | |
| SL-03 | Sales Agent | agent | Create invoice | 201 OK (if agent has write permission) | |
| SL-04 | Support Agent (no sales) | agent | GET /api/v1/sales/invoices | 403 | |
| SL-05 | Viewer | viewer | View sales dashboard | 200 — read only | |
| SL-06 | Viewer | viewer | Create invoice | 403 | |

### 4.6 Analytics Module

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| AN-01 | Manager | manager | View revenue analytics | 200 — full analytics | |
| AN-02 | Agent | agent | View analytics dashboard | 200 (if analytics in their module access) | |
| AN-03 | Viewer | viewer | View leaderboard | 200 | |
| AN-04 | Agent (no analytics module) | agent | GET /api/v1/analytics/dashboard | 403 | |
| AN-05 | Any user | any | View another tenant's analytics | 404/403 (RLS) | |

### 4.7 Settings & Administration

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| ST-01 | Tenant Admin | tenant_admin | Update tenant settings | 200 — timezone, locale updated | |
| ST-02 | Manager | manager | Update tenant settings | 403 — admin only | |
| ST-03 | Agent | agent | Update tenant settings | 403 | |
| ST-04 | Any user | any | Update own user preferences | 200 OK | |
| ST-05 | Admin | tenant_admin | Create webhook | 201 OK | |
| ST-06 | Manager | manager | Create webhook | 200 OK (manager can manage webhooks) | |
| ST-07 | Agent | agent | Create webhook | 403 | |

### 4.8 Billing Module

| TC# | User | Role | Action | Expected | Pass/Fail |
|-----|------|------|--------|----------|-----------|
| BL-01 | Tenant Admin | tenant_admin | View subscription | 200 OK | |
| BL-02 | Tenant Admin | tenant_admin | Upgrade plan | 200 OK | |
| BL-03 | Manager | manager | View subscription | 403 — billing admin only | |
| BL-04 | Agent | agent | GET /api/v1/billing/subscriptions | 403 | |
| BL-05 | Viewer | viewer | GET /api/v1/billing/invoices | 403 | |

---

## Part 5 — Advanced Segregation Scenarios

### 5.1 Full Cross-Department Isolation Matrix

The following table must be validated for EACH SECTOR:
- **✓** = User CAN perform action
- **✗** = User CANNOT (403/404)
- **R** = Read only

| Module | Sales Agent | Support Agent | Compliance Viewer | Admin |
|--------|------------|---------------|-------------------|-------|
| CRM — Contacts | ✓ | ✓ | R | ✓ |
| CRM — Deals | ✓ | ✗ | ✗ | ✓ |
| Ticketing | ✗ | ✓ | R | ✓ |
| Voice | depends | depends | ✗ | ✓ |
| Analytics | ✓ | ✓ | R | ✓ |
| Sales/Invoicing | ✓ | ✗ | ✗ | ✓ |
| Settings | ✗ | ✗ | ✗ | ✓ |
| Billing | ✗ | ✗ | ✗ | ✓ |
| Roles | ✗ | ✗ | ✗ | ✓ |
| Users | ✗ | ✗ | ✗ | ✓ |

### 5.2 Token Injection / Bypass Attempts

| TC# | Attack Scenario | Expected Defense |
|-----|----------------|-----------------|
| SEC-01 | Send X-Tenant-ID header with foreign tenantId using own valid JWT | JWT claim wins — own tenantId used, header ignored |
| SEC-02 | Modify JWT `role` claim to `tenant_admin`, keep old signature | 401 — signature invalid |
| SEC-03 | Use another user's valid JWT | RLS applies that user's tenantId; cannot see own tenant's data |
| SEC-04 | Replay revoked token (after logout) | 401 — jti in Redis blocklist |
| SEC-05 | Enumerate contact UUIDs from another tenant | All return 404 — RLS hides them |
| SEC-06 | Call /super-admin routes with tenant_admin JWT | 403 — role insufficient |
| SEC-07 | Bypass RLS with raw SQL via GraphQL | GraphQL resolvers use same db.withTenant() context |
| SEC-08 | API key with contacts:read tries deals:write | 403 — scope not granted |

### 5.3 Concurrent Multi-Tenant Test

| TC# | Test Case | Expected Result |
|-----|-----------|-----------------|
| MT-01 | Two agents from different tenants create contacts simultaneously | No cross-contamination in either tenant's contact list |
| MT-02 | Admin from Tenant A and Admin from Tenant B modify roles simultaneously | Each change isolated to own tenant |
| MT-03 | Tenant A suspended while Tenant A user is mid-session | Next API call returns 403 — tenant suspended |

---

## Part 6 — Sector-Specific Custom Field Validation

### 6.1 Banking Sector Custom Fields

| TC# | Field | Test | Expected |
|-----|-------|------|----------|
| SF-01 | `account_number` | Create contact without account_number (required) | 400 — validation error |
| SF-02 | `kyc_status` | Set kyc_status = 'Verified' | Contact saved with kyc_status in custom_fields JSONB |
| SF-03 | `account_type` | Set to invalid value | 400 — must be one of: Savings, Current, etc. |
| SF-04 | Banking fields not visible | Login to Telecom tenant; view contact form | No banking fields present |

### 6.2 Telecom Sector Custom Fields

| TC# | Field | Test | Expected |
|-----|-------|------|----------|
| SF-05 | `mobile_number` | Create subscriber without mobile_number | 400 — required |
| SF-06 | `account_number` | Set account_number | Saved in custom_fields |
| SF-07 | Telecom fields not in Banking | Banking tenant; view contact form | No telecom fields |

---

## Test Execution Guide

### Environment Setup

```bash
# Start CRM Platform
cd /Users/mba/Desktop/crm-platform
docker-compose up -d

# Verify services
./status.sh

# API base URL
API=http://localhost:3000

# Frontend
http://localhost:5173
```

### Creating Test Tenants

```bash
# Tenant 1: Banking
curl -X POST $API/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "sector": "banking",
    "organizationName": "First National Bank",
    "slug": "fnb-test",
    "adminEmail": "admin@fnb-test.com",
    "adminName": "FNB Admin",
    "adminPassword": "Test@1234"
  }'

# Tenant 2: Telecom
curl -X POST $API/auth/register \
  -d '{
    "sector": "telecom",
    "organizationName": "ConnectTel",
    "slug": "connecttel-test",
    "adminEmail": "admin@connecttel-test.com",
    "adminName": "ConnectTel Admin",
    "adminPassword": "Test@1234"
  }'

# Tenant 3: Logistics
curl -X POST $API/auth/register \
  -d '{
    "sector": "logistics",
    "organizationName": "SwiftLog",
    "slug": "swiftlog-test",
    "adminEmail": "admin@swiftlog-test.com",
    "adminName": "SwiftLog Admin",
    "adminPassword": "Test@1234"
  }'
```

### Creating Department Users (after login as admin)

```bash
# Login as admin
TOKEN=$(curl -s -X POST $API/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fnb-test.com","password":"Test@1234"}' \
  | jq -r '.token')

# Create Retail Banking Agent
curl -X POST $API/api/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice Retail",
    "email": "alice@fnb-test.com",
    "password": "Test@1234",
    "role": "agent",
    "department": "Retail Banking"
  }'

# Create Compliance Viewer
curl -X POST $API/api/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Bob Compliance",
    "email": "bob@fnb-test.com",
    "password": "Test@1234",
    "role": "viewer",
    "department": "Compliance"
  }'
```

### Quick Test Sequence (per sector)

```
1. Register tenant → note tenantId
2. Login as admin → save ADMIN_TOKEN
3. Create dept users (agent, manager, viewer per dept)
4. Run auth tests (A-01 through A-25)
5. Run user/role tests (U-01 through R-07)
6. Run isolation tests (T-01 through D-08)
7. Run role-based tests (RB-01 through FE-10)
8. Run module functionality tests (CR-01 through BL-05)
9. Run security/bypass tests (SEC-01 through MT-03)
```

---

## Multi-Agent Testing Assignments

The following agent personas will be used in co-work testing sessions:

### Agent Roster

| Agent Name | Tenant | Sector | Department | Role | Email |
|-----------|--------|--------|------------|------|-------|
| **BankAdmin** | First National Bank | Banking | — | tenant_admin | admin@fnb-test.com |
| **RetailAgent** | First National Bank | Banking | Retail Banking | agent | alice@fnb-test.com |
| **LoansManager** | First National Bank | Banking | Loans | manager | loans@fnb-test.com |
| **ComplianceViewer** | First National Bank | Banking | Compliance | viewer | compliance@fnb-test.com |
| **TelecomAdmin** | ConnectTel | Telecom | — | tenant_admin | admin@connecttel-test.com |
| **TechAgent** | ConnectTel | Telecom | Technical Support | agent | tech@connecttel-test.com |
| **BillingManager** | ConnectTel | Telecom | Billing | manager | billing@connecttel-test.com |
| **LogisticsAdmin** | SwiftLog | Logistics | — | tenant_admin | admin@swiftlog-test.com |
| **OpsAgent** | SwiftLog | Logistics | Operations | agent | ops@swiftlog-test.com |

### Agent Testing Responsibilities

| Agent | Primary Test Areas |
|-------|-------------------|
| **BankAdmin** | Parts 1-2 (setup), T-10/11 (super-admin), ST-01, BL-01 |
| **RetailAgent** | CR-01 to CR-10, DE-01 to DE-08, RB-08 |
| **LoansManager** | TK-08 (no tickets), DE-01, RB-09, ST-02 |
| **ComplianceViewer** | CR-05/06, TK-12, AN-03, RB-01 to RB-03 |
| **TelecomAdmin** | T-01 to T-09 (cross-tenant), M-01 to M-05 |
| **TechAgent** | VC-01/02/03, TK-01 to TK-03, SL-04 (cross-module) |
| **BillingManager** | SL-01 to SL-06, VC-06 (cross-module), BL-02/03 |
| **LogisticsAdmin** | SEC-01 to SEC-08 (security), MT-01 to MT-03 |
| **OpsAgent** | D-01 to D-08 (dept segregation), FE-01 to FE-10 (UI) |

---

## Pass/Fail Criteria

### Critical (P0 — must fix before any release)
- Any cross-tenant data leak (T-01 through T-09)
- Any RLS bypass (SEC-01 through SEC-08)
- Users able to escalate own role (RB tests)
- Suspended tenant user can still access API

### High (P1 — fix before production)
- Department module segregation failures (D-01 through D-08)
- Role permission enforcement failures (RB-01 through RB-10)
- Custom field validation failures (SF-01 through SF-07)

### Medium (P2 — fix in next sprint)
- UI visibility issues (FE-01 through FE-10)
- Analytics/reporting access errors
- Seat limit not enforced

### Low (P3 — backlog)
- Password reset edge cases
- Concurrent request race conditions

---

## Test Result Log

| Date | Tester | TC# | Status | Notes |
|------|--------|-----|--------|-------|
| | | | | |

---

*This document was generated for the AI Operations CRM Platform. Update as new modules and sectors are added.*
