# Operations Guide — Vextria CRM

**Audience:** anyone using the platform — agents, line managers, managers, tenant admins, super admins.
**Last updated:** 2026-06-25

This guide walks through every feature in plain language. For each feature you get: who can use it, what it does, how to use it step-by-step, an example, and the rules / limits.

---

## 1. Roles & what each one sees

| Role | What they manage | What they see |
|---|---|---|
| **Super admin** | All workspaces, billing, sub-admins, platform reports | Everything (read-only across tenants for support) |
| **Tenant admin** | Users, roles, settings, integrations | **Nothing operational** — admin-only |
| **Manager** (HOD) | Their department's policies, queues, reports | Self + entire department subtree |
| **Line manager** | Their direct reports | Self + direct reports' records |
| **Agent** | Their own work | Own tickets, contacts, deals only |
| **Viewer** | (read-only operational) | Same as agent but cannot create/edit/delete |

**Separation of duties:** Tenant admin is administrative-only. Their sidebar has Users / Roles / Settings / Integrations and nothing else. If they navigate to /tickets directly, they're redirected to /settings.

---

## 2. SLA Policies — `/tickets/sla`

**Who can use it:** Manager or above.
**What it does:** Defines how fast tickets must be answered + resolved, what reminders fire, and when escalations kick in.

### Step-by-step

1. **Tickets** sidebar → **SLA Policies** tab → **+ New Policy**
2. Fill in:
   - **Name** — e.g. "Sales — High priority"
   - **Priority** — Urgent / High / Medium / Low
   - **First response hours** — how fast someone must acknowledge
   - **Resolution hours** — how fast it must be fully done
   - **Reminder %** — single legacy reminder (e.g. 80 = fire when 80% of the budget is used)
   - **L1 escalation %** — first breach (defaults to 100)
   - **L2 escalation %** — hard breach (defaults to 150)
3. Configure **Business hours** (next section).
4. Configure **Pause on pending** (section after).
5. Configure **Multi-step reminders** (a JSON array of steps, each with id / pct / level / label / notifyTarget).
6. **Save**.

The system automatically picks the most-specific active policy for each new ticket, using priority + optional channel / department / tag conditions.

### Example
A "Sales — High priority" policy: 1h first response, 24h resolution, business hours Mon–Fri 09:00–18:00, pause-on-pending enabled, and 3 reminder steps at 50% / 80% / 100%.

### Rules / limits
- A policy must have at least one priority.
- Resolution hours must be > 0.
- Reminder percent must be 1–99.
- Disabled policies stay in DB but don't match new tickets.

---

## 3. Business Hours

**Who can use it:** Manager (configured per SLA policy).
**What it does:** The SLA clock only ticks during enabled hours. Off-hours, weekends, and holidays don't count.

### Step-by-step

1. In the SLA policy editor, toggle **Business hours only = ON**.
2. For each day of the week, set **Enabled** + **Start** + **End** times.
3. Save.

### Example
Mon–Fri 09:00–18:00 enabled, Sat–Sun disabled. A ticket created Friday 17:30 with a 4h SLA → due Monday 12:30 (counts 0.5h Fri + 3.5h Mon).

### Rules / limits
- Times in 24-hour format (HH:MM).
- Times are interpreted in the **tenant timezone** (set in Workspace Settings; defaults to UTC).
- If left empty + business_hours_only = ON, the system falls back to Mon–Fri 09:00–18:00 so the clock never silently breaks.

---

## 4. Pause on Pending

**Who can use it:** Manager (configured per SLA policy).
**What it does:** When a ticket is in `pending` status (waiting on customer reply), the SLA clock freezes. When the customer responds and the agent moves the ticket off `pending`, the clock resumes from where it stopped.

### Step-by-step

1. In the SLA policy editor, toggle **Pause on pending = ON**.
2. Save.
3. When agent changes ticket status to `pending`, the clock auto-pauses.
4. When agent changes status off `pending`, the clock auto-resumes.

### Example
SLA 24h, pause-on-pending = ON. Ticket accepted Monday 09:00. Agent moves to `pending` Tuesday 10:00 (25 hours into the budget — wait, business hours aware: 8h actually elapsed). Customer responds Wednesday 10:00 (24h paused). Agent moves to `in_progress`. The clock now has 16h remaining + the pause didn't count.

### Rules / limits
- Pause is **immediate** the moment status changes.
- The accumulated pause is stored in `tickets.sla_paused_total_ms` for audit.
- If the policy doesn't have pause_on_pending enabled, status changes have no effect on the clock.

---

## 5. Holiday Calendar

**Who can use it:** Manager.
**What it does:** Tenant-level list of public holidays (e.g. national days). The SLA clock skips those whole days when computing deadlines, just like weekends.

### Step-by-step

1. **Tickets → SLA Policies → Holidays** tab (or in API: `POST /api/v1/tickets/sla-holidays`).
2. **+ Add Holiday** → date (YYYY-MM-DD) + name (e.g. "Independence Day").
3. **Save**.

### Example
Holiday set: 2026-08-14 "Independence Day". A ticket accepted Wed 2026-08-13 17:00 with 4h SLA and Mon–Fri business hours → due Mon 2026-08-17 11:00 (skips Thu = holiday, Fri = business day, weekend, Mon = business day).

### Rules / limits
- One holiday per date per tenant (unique constraint).
- Applies to ALL policies in the tenant — there's no per-policy holiday list.
- Adding / removing a holiday does NOT retroactively re-compute existing ticket deadlines.

---

## 6. Multi-Step Reminders

**Who can use it:** Manager (configured per SLA policy).
**What it does:** Fire multiple reminder/escalation notifications at different % thresholds, each notifying a different audience.

### Step-by-step

1. In the SLA policy editor, scroll to **Reminder schedule**.
2. **+ Add Step** for each notification you want to fire. Each step has:
   - **id** — unique string within the policy (e.g. `r1`)
   - **pct** — when to fire (e.g. 50 = at 50% of the SLA budget)
   - **level** — `reminder` | `l1` | `l2` (just a label/icon)
   - **label** — text shown in the notification title
   - **notifyTarget** — `assignee` | `managers` | `admins` | `all`
3. Save.

### Example
Steps: `[{id:r1, pct:50, level:reminder, label:"Half-way", notifyTarget:assignee}, {id:r2, pct:80, level:reminder, label:"At risk", notifyTarget:managers}, {id:r3, pct:100, level:l1, label:"Breached", notifyTarget:all}]`. Worker checks every 5 minutes — each step fires exactly once.

### Rules / limits
- Each step fires exactly once per ticket (tracked in `tickets.sla_reminders_sent` map).
- If the schedule is empty, the system falls back to the single legacy `reminder_pct`.
- L1 + L2 escalations from the policy `l1_escalation_pct` / `l2_escalation_pct` columns ALWAYS run regardless of the schedule.

---

## 7. Customer 360 — Multi-field ticket search

**Who can use it:** Anyone with `tickets:read`.
**What it does:** Search a ticket by ticket #, customer name, mobile, NIC (Pakistan ID), email, or phone.

### Step-by-step

1. **Tickets** page → search box at the top.
2. Type any of: ticket number (TKT-00012), customer first/last name, mobile, NIC, email.
3. The list filters live.
4. **Click the reporter name** → opens Contact 360 (full contact profile with timeline).

### Example
Customer calls and says "I'm Ahmad Khan, my NIC is 35202-1234567-8". Agent types `35202` in search → ticket appears. Click "Ahmad Khan" → see his entire history with this workspace.

### Rules / limits
- Visibility scoping still applies — you only see records your role lets you see.
- Search is case-insensitive partial match.

---

## 8. Cross-Department Originator View

**Who can use it:** Any agent who originated a ticket that got forwarded.
**What it does:** When you create a ticket and it gets forwarded to another department, you still see it in your list (marked **"👁 View only"**) but cannot edit it. The receiving dept owns it.

### Step-by-step

1. Sales agent creates a complaint ticket (it should be Support).
2. Manager forwards it to Complaints dept → Complaint agent accepts.
3. Sales agent's **Tickets** list still shows the ticket with an amber **"👁 View only"** badge.
4. Sales agent can read everything but cannot change status, assign, or comment as the customer.
5. They CAN add internal notes (see next section).

### Rules / limits
- Originator readonly is enforced by a backend guard (`ORIGINATOR_READONLY` 403).
- Once resolved, the originator can leave comments / view CSAT.

---

## 9. Any-Agent Internal Notes

**Who can use it:** Any authenticated user in the tenant.
**What it does:** Add an internal note to any ticket, even ones you don't own. Useful for cross-team context handoff.

### Step-by-step

1. Open any ticket detail.
2. Scroll to **Internal Notes** section.
3. Type your note → **Save**.
4. Note appears in the comment thread with `internal` badge.

### API call: `POST /api/v1/tickets/:id/notes` with `{note: "..."}`.

### Rules / limits
- Notes are internal — never shown to the customer / reporter email.
- Write is open to any authenticated user; read still scoped to the ticket's audience.

---

## 10. CSAT (Customer Satisfaction) Survey

**Who can use it:** Agent (triggered automatically on resolve), customer (responds).
**What it does:** On ticket resolve, the customer gets an email with a star-rating link. Their response shows on the ticket detail and feeds into agent reports.

### Step-by-step (agent side — happens automatically)

1. Agent resolves a ticket: **/tickets/:id → Resolve**.
2. System generates a unique survey token + sends an email with the link.
3. Customer clicks → public `/csat/:token` page → rates 1–5 stars + optional comment → submit.
4. Ticket detail panel now shows a **CSAT card** with the rating + comment.

### Reports
- Manager: **/reports → CSAT scores by agent** (avg rating per agent over last 30 days).
- Agent: **/reports → My CSAT scores** (every response on their tickets).

### Rules / limits
- One survey per ticket. Token-based, no auth required.
- Re-resolving (e.g. after a re-open) generates a new token.
- Customer can submit only once. Second attempt returns 409 ALREADY_RESPONDED.

---

## 11. Reports Hub — `/reports`

**Who can use it:** Agent / line_manager / manager (each sees role-appropriate reports).
**What it does:** 10 pre-built reports. Each downloadable as CSV. All scoped by your visibility (agent sees own, manager sees subtree).

### Available reports

**Manager / Line manager:**
- SLA compliance by agent
- Tickets resolved by department
- CSAT scores by agent
- Avg first response time by priority
- Avg resolution time by ticket type
- Top breached SLAs this week

**Agent:**
- My tickets resolved today
- My current open queue
- My SLA-at-risk tickets (>80% elapsed)
- My CSAT scores

### Step-by-step

1. Sidebar → **Analytics** (expand) → **Reports**.
2. Click any report tile.
3. JSON view renders inline. Click **Download CSV** for spreadsheet.

### API
- `GET /api/v1/reports` — list available reports for your role.
- `GET /api/v1/reports/:key` — JSON.
- `GET /api/v1/reports/:key?format=csv` — CSV download.

---

## 12. Ops Dashboard KPI strip — `/dashboard`

**Who can use it:** Every operational role.
**What it does:** Top-of-page summary: CSAT %, SLA %, avg resolution, avg first response — last 30 days, scoped to your visibility.

### Where the numbers come from
- **CSAT avg** — average star rating across responded surveys for your tickets.
- **SLA %** — percentage of resolved tickets where escalation_level = 0 (no breach).
- **Avg resolution** — average hours between `accepted_at` and `resolved_at`.
- **Avg first response** — average minutes between `created_at` and `first_response_at`.

---

## 13. Smart SLA Policy Matching

**Who configures it:** Manager (when creating/editing SLA policies).
**What it does:** Instead of just matching by priority, policies can target specific channels / departments / tags. The system picks the most-specific match for each ticket.

### Step-by-step

1. SLA policy editor → **Match conditions** section.
2. Optionally restrict by: **Channels** (e.g. voice + whatsapp), **Departments** (e.g. sales), **Tags** (e.g. vip).
3. Save.
4. When a new ticket arrives, the system scores every active policy:
   - +100 if priority matches
   - +10 each for matching channel / department / tag
   - +1 if it's a catch-all (no conditions)
5. Highest score wins. Ties broken by creation date.

### Example
- Policy A: priority=high, channels=[voice] → fits a voice-channel high ticket = score 110.
- Policy B: priority=high (no conditions) → catch-all = score 101.
- Voice-channel high ticket → A wins. Email-channel high ticket → B wins.

### Rules / limits
- Inactive policies are excluded from matching.
- If you explicitly pass `slaPolicyId` when creating a ticket, that wins regardless.

---

## 14. Entitlements (what your workspace is licensed for)

**Who configures it:** Super admin (at workspace creation).
**What it does:** Determines which modules / features the tenant can access. Drives the sidebar nav and API permissions.

### Modules and features
- **CRM** — contacts, companies, deals, activities
- **Sales** — invoices, billing contacts, payments, sales reports, templates, sales settings
- **Emails** — inbox + templates
- **Integrations** — connectors, webhooks, API keys
- **Analytics** — dashboards, reports

The tenant admin can toggle modules ON/OFF within their entitlement, but never above it.

---

## 15. Role Permissions (tenant admin's customization)

**Who configures it:** Tenant admin → Roles page.
**What it does:** Within their entitlement, the tenant admin grants/restricts module access per role.

### Step-by-step

1. **Settings → Roles** → pick a role (or create custom).
2. For each module, set access: **none / view / full**.
3. Save.

### Rules
- Tenant admin cannot grant a module the workspace isn't entitled to.
- System roles (Admin, Manager, Agent, Viewer) auto-seed on workspace create with sensible defaults.

---

## Where to file bugs

If anything in this guide doesn't match what the system actually does, send a screenshot + the exact step that failed to your tenant admin → they'll escalate to super admin → super admin opens a GitHub issue against the platform repo.
