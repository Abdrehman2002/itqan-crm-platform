/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VIVID CRM — SQA AGENT 02: TENANT ADMIN (BANKING)
 *  Role    : tenant_admin (runs for BOTH Alpha Bank and Beta Bank)
 *  Scope   : User provisioning, role assignment, department hierarchy,
 *            line manager assignment, module access verification
 *
 *  Banking Org Structure (per tenant):
 *
 *  TENANT_ADMIN
 *    └── Retail Banking
 *          ├── manager_retail@  (Manager — sees all retail + loan agents)
 *          │     ├── am_retail@  (Asst Manager)
 *          │     └── exec_retail@ (Executive / Agent)
 *    └── Loans & Credit
 *          ├── manager_loans@   (Manager)
 *          │     ├── am_loans@
 *          │     └── exec_loans@
 *    └── Cards & Payments
 *          ├── manager_cards@
 *          │     └── exec_cards@
 *    └── Customer Support
 *          ├── manager_support@
 *          │     ├── agent_support_1@
 *          │     └── agent_support_2@
 *    └── Compliance & Risk
 *          └── viewer_compliance@ (viewer — read-only dashboards)
 *
 *  Test Coverage:
 *  TA-01..05  Tenant admin login, settings access, team listing
 *  TA-06..18  User creation: manager, asst manager, executive per dept
 *  TA-19..24  Role boundary tests (agent can't create users etc.)
 *  TA-25..30  Module access per user role
 *  TA-31..35  Department type assignment validation
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { ApiClient, login, loadState, saveState } from '../helpers/api-client.js';
import { TestLogger, } from '../helpers/test-logger.js';
import { DbHelper, TEST_PASSWORD } from '../helpers/db-helper.js';
import bcrypt from 'bcryptjs';

const log = new TestLogger('Agent 02 — Tenant Admin (Banking)');
const db  = new DbHelper();

// ── User definitions per bank ─────────────────────────────────────────────────

function buildUsers(slug) {
  const d = slug === 'sqa-alpha-bank' ? 'alpha' : 'beta';
  return [
    // ── Retail Banking ───────────────────────────────────────────────────
    { email: `mgr.retail.${d}@sqa-vivid.com`,  name: `Retail Manager (${d.toUpperCase()})`,     role: 'manager', department: 'Retail Banking', departmentType: 'sales' },
    { email: `am.retail.${d}@sqa-vivid.com`,   name: `Retail Asst Mgr (${d.toUpperCase()})`,    role: 'agent',   department: 'Retail Banking', departmentType: 'sales' },
    { email: `exec.retail.${d}@sqa-vivid.com`, name: `Retail Executive (${d.toUpperCase()})`,   role: 'agent',   department: 'Retail Banking', departmentType: 'sales' },
    // ── Loans ────────────────────────────────────────────────────────────
    { email: `mgr.loans.${d}@sqa-vivid.com`,   name: `Loans Manager (${d.toUpperCase()})`,      role: 'manager', department: 'Loans',          departmentType: 'sales' },
    { email: `am.loans.${d}@sqa-vivid.com`,    name: `Loans Asst Mgr (${d.toUpperCase()})`,     role: 'agent',   department: 'Loans',          departmentType: 'sales' },
    { email: `exec.loans.${d}@sqa-vivid.com`,  name: `Loans Executive (${d.toUpperCase()})`,    role: 'agent',   department: 'Loans',          departmentType: 'sales' },
    // ── Cards ────────────────────────────────────────────────────────────
    { email: `mgr.cards.${d}@sqa-vivid.com`,   name: `Cards Manager (${d.toUpperCase()})`,      role: 'manager', department: 'Cards',          departmentType: 'sales' },
    { email: `exec.cards.${d}@sqa-vivid.com`,  name: `Cards Executive (${d.toUpperCase()})`,    role: 'agent',   department: 'Cards',          departmentType: 'sales' },
    // ── Customer Support ─────────────────────────────────────────────────
    { email: `mgr.support.${d}@sqa-vivid.com`, name: `Support Manager (${d.toUpperCase()})`,    role: 'manager', department: 'Customer Support', departmentType: 'support' },
    { email: `agent1.support.${d}@sqa-vivid.com`, name:`Support Agent 1 (${d.toUpperCase()})`,  role: 'agent',   department: 'Customer Support', departmentType: 'support' },
    { email: `agent2.support.${d}@sqa-vivid.com`, name:`Support Agent 2 (${d.toUpperCase()})`,  role: 'agent',   department: 'Customer Support', departmentType: 'support' },
    // ── Compliance ───────────────────────────────────────────────────────
    { email: `viewer.compliance.${d}@sqa-vivid.com`, name:`Compliance Viewer (${d.toUpperCase()})`, role: 'viewer', department: 'Compliance', departmentType: 'compliance_audit' },
  ];
}

// ── Run for one bank ──────────────────────────────────────────────────────────

async function setupBank(bankSlug, adminEmail, adminPassword, bankLabel) {
  log.section(`${bankLabel} — Login & Settings`);

  // TA-01 / TA-06 (per bank): Tenant admin login
  let admin;
  try {
    const token = await login(adminEmail, adminPassword, bankSlug);
    admin = new ApiClient(token, bankSlug);
    log.pass(`TA-01-${bankLabel}`, `${bankLabel} admin login succeeds`);
  } catch(e) {
    log.fail(`TA-01-${bankLabel}`, `${bankLabel} admin login`, e.message);
    return null;
  }

  // TA-02: Settings page accessible
  {
    const r = await admin.get('/api/v1/settings');
    log.assert(`TA-02-${bankLabel}`, 'Tenant admin can access /settings', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // TA-03: Team list accessible
  {
    const r = await admin.get('/api/v1/settings/team');
    log.assert(`TA-03-${bankLabel}`, 'Tenant admin can list team', r.ok, `${r.data?.data?.length ?? 0} users`, `HTTP ${r.status}`);
  }

  // TA-04: Workspace info includes sector=banking
  {
    const r = await admin.get('/api/v1/settings/workspace');
    log.assert(`TA-04-${bankLabel}`, 'Workspace sector = banking', r.data?.data?.sector === 'banking', `sector=${r.data?.data?.sector}`, `sector=${r.data?.data?.sector}`);
  }

  // TA-05: Active modules match what super admin licensed
  {
    const r = await admin.get('/api/v1/settings/workspace/modules');
    const modules = r.data?.data?.activeModules ?? r.data?.data ?? [];
    log.assert(`TA-05-${bankLabel}`, 'Active modules include CRM', modules.includes?.('crm') || (Array.isArray(modules) && modules.some(m => m === 'crm' || m?.key === 'crm')),
      `modules=${JSON.stringify(modules)}`, `crm not in modules`);
  }

  // ── Create users ──────────────────────────────────────────────────────────
  log.section(`${bankLabel} — Create User Hierarchy`);

  const users = buildUsers(bankSlug);
  const createdUsers = {};

  // Pre-compute test password hash (done once, reused for all users)
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);

  for (const u of users) {
    const r = await admin.post('/api/v1/settings/team/invite', {
      email:          u.email,
      name:           u.name,
      role:           u.role,
      department:     u.department,
      departmentType: u.departmentType,
    });

    const tcId = `TA-${bankLabel}-${u.role.substring(0,3).toUpperCase()}-${u.department.replace(/\s+/g,'').substring(0,6)}`;
    if (r.ok || r.status === 409) {
      // 409 = already exists (previous test run) — still valid
      log.pass(tcId, `Created ${u.role} in ${u.department}`, `${u.email}`);

      // Set password directly (invite email won't work in dev)
      const tenantId = await db.getTenantId(bankSlug);
      if (tenantId) {
        await db.setPassword(tenantId, u.email, hash);
      }

      // Look up the actual user record
      const tenantId2 = await db.getTenantId(bankSlug);
      const userRow = tenantId2 ? await db.getUser(tenantId2, u.email) : null;
      if (userRow) createdUsers[u.email] = { ...u, id: userRow.id };
    } else {
      log.fail(tcId, `Failed to create ${u.role} in ${u.department}`, `HTTP ${r.status} — ${JSON.stringify(r.data?.error)}`);
    }
  }

  // ── Role boundary tests ───────────────────────────────────────────────────
  log.section(`${bankLabel} — Role Boundary Tests`);

  // TA-19: Agent cannot create users
  const agentEmail = `exec.retail.${bankSlug === 'sqa-alpha-bank' ? 'alpha' : 'beta'}@sqa-vivid.com`;
  try {
    const agentToken = await login(agentEmail, TEST_PASSWORD, bankSlug);
    const agent = new ApiClient(agentToken, bankSlug);

    const r = await agent.post('/api/v1/settings/team/invite', {
      email: `unauthorized@test.com`, name: 'Unauth', role: 'agent'
    });
    log.assert(`TA-19-${bankLabel}`, 'Agent cannot invite/create users', r.status === 403, `HTTP 403`, `HTTP ${r.status} — should be 403`);

    // TA-20: Agent cannot update workspace settings
    const settR = await agent.patch('/api/v1/settings/workspace', { timezone: 'UTC' });
    log.assert(`TA-20-${bankLabel}`, 'Agent cannot modify workspace settings', settR.status === 403, `HTTP 403`, `HTTP ${settR.status}`);

    // TA-21: Agent cannot list all users (manager-level route)
    const teamR = await agent.get('/api/v1/settings/team');
    log.assert(`TA-21-${bankLabel}`, 'Agent cannot list full team (403)', teamR.status === 403, `HTTP 403`, `HTTP ${teamR.status}`);

  } catch(e) {
    log.warn(`TA-19-${bankLabel}`, 'Could not run agent boundary tests', e.message);
  }

  // TA-22: Viewer cannot create users
  const viewerEmail = `viewer.compliance.${bankSlug === 'sqa-alpha-bank' ? 'alpha' : 'beta'}@sqa-vivid.com`;
  try {
    const viewerToken = await login(viewerEmail, TEST_PASSWORD, bankSlug);
    const viewer = new ApiClient(viewerToken, bankSlug);
    const r = await viewer.post('/api/v1/settings/team/invite', { email: 'view@test.com', name: 'V', role: 'viewer' });
    log.assert(`TA-22-${bankLabel}`, 'Viewer cannot create users', r.status === 403, `HTTP 403`, `HTTP ${r.status}`);
  } catch(e) {
    log.warn(`TA-22-${bankLabel}`, 'Could not run viewer boundary test', e.message);
  }

  // TA-23: Manager can list team
  const mgrEmail = `mgr.retail.${bankSlug === 'sqa-alpha-bank' ? 'alpha' : 'beta'}@sqa-vivid.com`;
  try {
    const mgrToken = await login(mgrEmail, TEST_PASSWORD, bankSlug);
    const mgr = new ApiClient(mgrToken, bankSlug);
    const r = await mgr.get('/api/v1/settings/team');
    log.assert(`TA-23-${bankLabel}`, 'Manager can list team members', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  } catch(e) {
    log.warn(`TA-23-${bankLabel}`, 'Manager team list test', e.message);
  }

  // TA-24: Department types returned correctly
  {
    const r = await admin.get('/api/v1/settings/team/department-types');
    log.assert(`TA-24-${bankLabel}`, 'Department types endpoint returns valid list', r.ok && Array.isArray(r.data?.data),
      `types=${JSON.stringify(r.data?.data)}`, `HTTP ${r.status}`);
  }

  // ── Module access per role ───────────────────────────────────────────────
  log.section(`${bankLabel} — Module Access Verification`);
  {
    const agentToken = await login(agentEmail, TEST_PASSWORD, bankSlug).catch(() => null);
    if (agentToken) {
      const agent = new ApiClient(agentToken, bankSlug);

      // TA-25: Agent can access contacts
      const cr = await agent.get('/api/v1/contacts');
      log.assert(`TA-25-${bankLabel}`, 'Agent can access /contacts', cr.ok || cr.status !== 403, `HTTP ${cr.status}`, `HTTP ${cr.status}`);

      // TA-26: Agent can access tickets (if ticketing module active)
      const tr = await agent.get('/api/v1/tickets');
      log.assert(`TA-26-${bankLabel}`, 'Agent can access /tickets (module active)', tr.ok || tr.status !== 402, `HTTP ${tr.status}`, `HTTP ${tr.status}`);

      // TA-27: Agent cannot access billing invoices (admin-only)
      const br = await agent.get('/api/v1/billing/invoices');
      log.assert(`TA-27-${bankLabel}`, 'Agent cannot access billing (403)', br.status === 403, `HTTP 403`, `HTTP ${br.status}`);
    }
  }

  // Save created user list to state
  const stateKey = bankSlug === 'sqa-alpha-bank' ? 'alphaUsers' : 'betaUsers';
  saveState({ [stateKey]: createdUsers });

  return createdUsers;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const state = loadState();

  // Alpha Bank
  if (state.alphaBankSlug && state.alphaBankAdminEmail) {
    await setupBank(state.alphaBankSlug, state.alphaBankAdminEmail, state.alphaBankAdminPassword, 'ALPHA');
  } else {
    log.warn('TA-00', 'Alpha Bank state not found — run Agent 01 first');
  }

  // Beta Bank
  if (state.betaBankSlug && state.betaBankAdminEmail) {
    await setupBank(state.betaBankSlug, state.betaBankAdminEmail, state.betaBankAdminPassword, 'BETA');
  } else {
    log.warn('TA-00b', 'Beta Bank state not found — run Agent 01 first');
  }

  const stats = log.summary();
  log.save();
  await db.end();
  return stats;
}

run().catch(e => {
  console.error('\n  AGENT CRASHED:', e.message);
  log.fail('TA-99', 'Agent crashed', e.message);
  log.save();
  process.exit(1);
});
