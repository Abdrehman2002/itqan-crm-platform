# 🔑 All Login Credentials — Vextria + Demo Workspace

**Last verified:** 2026-06-24
**Live frontend:** <https://itqan-crm-platform-api.vercel.app>

---

## ⭐ Super Admin (platform owner — no workspace needed)

| Email | Password |
|---|---|
| `superadmin@vextria.com` | `demo123` |

Login: leave the workspace slug field BLANK. Lands on `/super-admin` (7-tab platform UI).

---

## 🏢 Vextria Workspace — full org chart (18 users, real data)

**Workspace slug:** `vextria` · **Plan:** Professional · **Modules:** CRM, Sales, Ticketing, Voice

### Tenant Admins (administrative — no operational data)

| Name | Email | Password |
|---|---|---|
| Abdur Rehman | `abdurrehman1711@gmail.com` | _(your own — not reset)_ |
| Munir Raza | `munir.razaa@gmail.com` | _(Munir's own — not reset)_ |

### Managers (department heads)

| Name | Email | Password | Department |
|---|---|---|---|
| Imran Qureshi | `sales.manager@vextria.com` | `demo12345` | Sales |
| Hassan Sheikh | `hassan.mgr@vextria.com` | `demo12345` | Support |
| Tariq Aziz | `complaints.manager@vextria.com` | `demo12345` | Complaints |

### Line Managers (sub-team heads)

| Name | Email | Password | Department |
|---|---|---|---|
| Sadia Mahmood | `sales.lead@vextria.com` | `demo12345` | Sales |
| Asad Iqbal | `support.lead@vextria.com` | `demo12345` | Support |
| Nida Rashid | `complaints.lead@vextria.com` | `demo12345` | Complaints |

### Agents (operational)

| Name | Email | Password | Department |
|---|---|---|---|
| Ali Hassan | `ali.agent@vextria.com` | `demo12345` | Sales |
| Omar Bhatti | `omar.agent@vextria.com` | `demo12345` | Sales |
| Zoya Tariq | `zoya.agent@vextria.com` | `demo12345` | Sales |
| Maria Yousuf | `maria.agent@vextria.com` | `demo12345` | Support |
| Sara Khan | `sara.agent@vextria.com` | `demo12345` | Support |
| Usman Ali | `usman.agent@vextria.com` | `demo12345` | Support |
| Bilal Ahmed | `bilal.agent@vextria.com` | `demo12345` | Complaints |
| Fatima Noor | `fatima.agent@vextria.com` | `demo12345` | Complaints |
| Hira Khan | `hira.agent@vextria.com` | `demo12345` | Complaints |

---

## 🧪 Demo Workspace — single user per role (7 users, clean test fixture)

**Workspace slug:** `demo-workspace` · **Plan:** Professional · **Modules:** CRM, Sales, Ticketing · **Status:** trial

| Role | Email | Password |
|---|---|---|
| Tenant Admin | `admin@demo.local` | `demo12345` |
| Sales Manager | `sales.manager@demo.local` | `demo12345` |
| Support Manager | `support.manager@demo.local` | `demo12345` |
| Line Manager (under Sales) | `line.manager@demo.local` | `demo12345` |
| Sales Agent (under Sales Mgr) | `sales.agent@demo.local` | `demo12345` |
| Support Agent (under Support Mgr) | `support.agent@demo.local` | `demo12345` |
| Viewer (under Sales Mgr) | `viewer@demo.local` | `demo12345` |

---

## 📋 How to use

1. Open <https://itqan-crm-platform-api.vercel.app> in **incognito** (no cache).
2. Pick a row from above.
3. **Email** → paste exactly as shown
4. **Password** → `demo12345` for everything except super_admin (`demo123`) and the two Gmail tenant_admins
5. **Workspace slug** → `vextria` or `demo-workspace`, depending on which row you picked. Leave blank for super_admin only.
6. Click **Sign in**.

---

## 🔄 If you change a password and want to reset it

Against Supabase (paste this in SQL editor, change the email):

**Reset to `demo12345`:**
```sql
UPDATE users
SET password_hash = '$2a$10$DaR25JEE6/V3vZtA9evDheY/1Fyeu4HX.QkmO8y8ztcUKNfEEkzq.'
WHERE email = 'the.user@email.com';
```

**Reset to `demo123` (super_admin):**
```sql
UPDATE users
SET password_hash = '$2a$10$hTkMfSAj7u4Bva9uLi/WwuEiZwaZcBCyABZa7yIc5hKAYwWJonCMG'
WHERE email = 'superadmin@vextria.com';
```

---

## 🆔 IDs for reference

- Vextria tenant ID: `bea2915f-ac96-4d02-b61e-bc731ce66e04`
- Demo Workspace tenant ID: `0bff53e7-f5ab-4703-bd28-910c118d4f3c`
