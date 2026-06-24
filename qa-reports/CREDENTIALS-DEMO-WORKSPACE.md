# Demo Credentials — All Roles

**Created:** 2026-06-24
**Workspace:** `Demo Workspace` (slug: `demo-workspace`)
**Plan:** Professional
**Modules:** CRM, Sales, Ticketing
**Status:** All 8 logins verified ✓

---

## 🔑 Quick Reference (copy-paste ready)

| Role | Email | Password | Workspace slug |
|---|---|---|---|
| **Super Admin** | `superadmin@vextria.com` | `demo123` | _(leave blank)_ |
| **Tenant Admin** | `admin@demo.local` | `demo12345` | `demo-workspace` |
| **Sales Manager** | `sales.manager@demo.local` | `demo12345` | `demo-workspace` |
| **Support Manager** | `support.manager@demo.local` | `demo12345` | `demo-workspace` |
| **Line Manager** | `line.manager@demo.local` | `demo12345` | `demo-workspace` |
| **Sales Agent** | `sales.agent@demo.local` | `demo12345` | `demo-workspace` |
| **Support Agent** | `support.agent@demo.local` | `demo12345` | `demo-workspace` |
| **Viewer** | `viewer@demo.local` | `demo12345` | `demo-workspace` |

> Workspace slug field is on the login page. Super_admin login is slug-less (their account isn't tied to any one workspace).

---

## 👥 The hierarchy (who reports to whom)

```
                    Tenant Admin
                  admin@demo.local
                  (administrative only — no operational data)
                        |
        +———————————————+———————————————+
        |                               |
   Sales Manager                  Support Manager
   sales.manager                  support.manager
        |
        +———————+———————+———————+
        |       |       |       |
   Line Mgr  Sales   Viewer    (no support agent under sales)
   line.mgr  Agent   viewer
                                Support Manager
                                       |
                                 Support Agent
                                 support.agent
```

This mirrors Munir's separation-of-duties model:
- **Super admin** = Vivid Solutions (platform owner)
- **Tenant admin** = Demo Workspace IT person — manages users/roles/settings, NO operational data
- **Manager** = Department head, sees own subtree (themselves + reports)
- **Line manager** = Sub-team head, sees own subtree
- **Agent** = Operational, sees only their own records
- **Viewer** = Read-only operational

---

## 🧪 What to test with each role

### Super Admin → `superadmin@vextria.com` / `demo123`
After login, you'll land on `/super-admin`. Test:
- **Dashboard tab** — KPIs, plan distribution, module adoption, recently created list
- **Tenants tab** — see the list (including "Demo Workspace"). Test search, filter, pagination
- **+ New Workspace** — open the 2-step wizard, see the feature tree, success screen with temp pw in `xxxx-xxxx-xxxx` format
- **Per-tenant Actions** — change plan, toggle modules, edit name, manage roles, reset password, view users, suspend, activate, delete
- **Billing tab** — create platform invoice, mark paid, record payment
- **Sub-Admin Roles tab** — create custom platform role with color + permissions
- **Sub-Admins tab** — invite a sub-admin and pin to specific tenants
- **Reports tab** — all 5 sub-tabs (Tenant Details, Backup, All Invoices, Tenant Invoices, Audit) should render data
- **Settings tab** — tenant dropdown + password change log

### Tenant Admin → `admin@demo.local` / `demo12345` / `demo-workspace`
Tests separation of duties. Sidebar should show ONLY admin items:
- Users / Roles / Settings / Integrations
- **NO** Contacts / Deals / Tickets / Activities (those are operational)
- If you try `/contacts` directly in URL → redirects to `/settings`
- Test inviting users (you'll see the manager you need to assign agents under)

### Sales Manager → `sales.manager@demo.local` / `demo12345` / `demo-workspace`
Sees full operational sidebar. Manages **Sales** department:
- See your subtree: yourself + line manager + sales agent + viewer
- Create contacts/deals/activities — visible to your team
- Team Reports tab shows your team's metrics
- Cannot see Support Agent's records (different subtree)

### Support Manager → `support.manager@demo.local` / `demo12345` / `demo-workspace`
Same as Sales Manager but for **Support** department:
- Sees only support agent in their subtree
- Tickets dashboard shows complaint tickets
- Cannot see sales pipeline

### Line Manager → `line.manager@demo.local` / `demo12345` / `demo-workspace`
Under Sales Manager. Same operational nav but smaller subtree:
- Sees only themselves (no direct reports yet — assign agents to them if needed)
- Slightly fewer permissions than full manager

### Sales Agent → `sales.agent@demo.local` / `demo12345` / `demo-workspace`
Operational role:
- Create contact, deal, sales activity — own records only
- Create sales ticket → accept → **auto-creates deal** (sales→deal conversion)
- Cannot see Support Agent's records
- Cannot see other Sales Agent's records (if you invite more)

### Support Agent → `support.agent@demo.local` / `demo12345` / `demo-workspace`
Operational support role:
- Create complaint ticket → accept → resolve → close
- Sees own tickets only
- No deals, no pipeline (their dept_type is support)

### Viewer → `viewer@demo.local` / `demo12345` / `demo-workspace`
Read-only:
- Sees same nav as agent
- Cannot create / edit / delete anything
- Useful for compliance / auditors

---

## 🔄 If a password gets changed

If you change a user's password via the UI and forget the new one, run this against Supabase to reset it back to `demo12345`:

```sql
UPDATE users
SET password_hash = '$2a$10$DaR25JEE6/V3vZtA9evDheY/1Fyeu4HX.QkmO8y8ztcUKNfEEkzq.'
WHERE email = 'the.user@demo.local';
```

For super_admin (reset to `demo123`):

```sql
UPDATE users
SET password_hash = '$2a$10$hTkMfSAj7u4Bva9uLi/WwuEiZwaZcBCyABZa7yIc5hKAYwWJonCMG'
WHERE email = 'superadmin@vextria.com';
```

---

## 🧹 To delete the demo workspace later

As super_admin:

```bash
curl -X DELETE http://129.121.115.99:3000/super-admin/tenants/0bff53e7-f5ab-4703-bd28-910c118d4f3c \
  -H "Authorization: Bearer <SUPER_ADMIN_JWT>"
```

Or in the UI: Super Admin → Tenants → find "Demo Workspace" → Actions → Delete (two-step confirm).

This will cascade-delete all 7 users + any contacts/deals/tickets they created + audit log entries.

---

## 📊 Verification log (when this doc was created)

```
✓ superadmin@vextria.com  →  role=super_admin  (slug-less)
✓ admin@demo.local         →  role=tenant_admin
✓ sales.manager@demo.local →  role=manager
✓ support.manager@demo.local →  role=manager
✓ line.manager@demo.local  →  role=line_manager
✓ sales.agent@demo.local   →  role=agent
✓ support.agent@demo.local →  role=agent
✓ viewer@demo.local        →  role=viewer

8/8 logins verified live
```

---

## 🔗 Quick links

- Live frontend: <https://itqan-crm-platform-api.vercel.app>
- Live API: `http://129.121.115.99:3000`
- Supabase: project `sydkawiuxmunbjhsozic`
- Repo: <https://github.com/Abdrehman2002/itqan-crm-platform>
- Demo Workspace tenant ID: `0bff53e7-f5ab-4703-bd28-910c118d4f3c`
