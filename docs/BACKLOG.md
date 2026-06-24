# BACKLOG
_Future ideas only — NOT yet implemented. Move items to the Change Log once built._

---

## SLA Module — Remaining Upgrades

- **Holiday Calendar** — Allow managers to define public holidays per workspace. SLA clock pauses on those days automatically. Standard in Zendesk/Freshdesk. Priority: High.

- **First Reply Time Metric** — Track time-to-first-agent-response as a separate KPI from overall resolution SLA. Gives a cleaner picture of initial responsiveness. Priority: Medium.

- **Smart Policy Matching (beyond priority)** — Assign SLA policies based on channel (email/phone/chat), department, or ticket tags — not just priority. Matches Freshdesk/Jira SM capability. Priority: Medium.

---

## Merge Pending

- **Abdurrehman's `abdrehman-merge` branch** contains complementary work: auth bug fixes, SQL injection security patch, mobile app, org chart, and department/queue migrations. These need to be merged into `main`. Hold until Munir confirms. Priority: High.

---

- **Idea:** Embed the actual Vivid Solutions logo image on the pitch-deck title/closing slides
  (currently brand colours + wordmark only).
  - **Value:** Stronger brand identity on the customer-facing deck.
  - **Priority:** Medium
  - **Status:** Not Started

- **Idea:** Fix the operational Dashboard (`/api/v1/analytics/ops-dashboard`) — it hangs because
  analytics materialized views (`mv_daily_deal_stats`, etc.) don't exist in some databases.
  - **Value:** The main dashboard renders for all roles; usable in demos/screenshots.
  - **Priority:** High
  - **Status:** Not Started

- **Idea:** Add a formal `department_id` foreign key on `users` (with backfill) instead of linking
  departments by text name/type.
  - **Value:** Robust department membership; richer department features; avoids name-match fragility.
  - **Priority:** Medium
  - **Status:** Not Started

- **Idea:** Email deliverability — SendGrid domain authentication (SPF/DKIM) so onboarding mail lands
  in inbox, not spam.
  - **Value:** Customers reliably receive credentials/notifications.
  - **Priority:** High
  - **Status:** Not Started

- **Idea:** Optional company-wide operational manager role (single person who sees all operations),
  enabled purely by reporting-line config.
  - **Value:** Flexibility for orgs that want one cross-department view.
  - **Priority:** Low
  - **Status:** Not Started

- **Idea:** Fill or remove the empty module scaffolds `modules/companies` and `modules/email`
  (currently empty `src/` folders; functionality lives in `packages/`).
  - **Value:** Cleaner repo; no confusion about where code lives.
  - **Priority:** Low
  - **Status:** Not Started
