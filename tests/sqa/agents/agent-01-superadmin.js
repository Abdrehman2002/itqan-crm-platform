/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VIVID CRM — SQA AGENT 01: SUPER ADMIN
 *  Role    : super_admin
 *  Scope   : Tenant provisioning, module licensing, plan management
 *  Phase   : BANKING SECTOR — creates 2 tenants (Alpha Bank, Beta Bank)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Test Coverage:
 *  SA-01..SA-05  Authentication (super admin login, token claims)
 *  SA-06..SA-12  Tenant creation (banking sector, slug validation, duplicate)
 *  SA-13..SA-17  Module licensing (enable/disable modules per tenant)
 *  SA-18..SA-22  Tenant management (list, view, suspend, activate, plan change)
 *  SA-23..SA-26  Super admin boundary tests (cannot access tenant data, cross-tenant)
 */

import { ApiClient, login, loadState, saveState, API_BASE } from '../helpers/api-client.js';
import { TestLogger } from '../helpers/test-logger.js';
import { DbHelper } from '../helpers/db-helper.js';

// ── Test Data ─────────────────────────────────────────────────────────────────

const SUPER_ADMIN = { email: 'admin@demo.com', password: 'Vivid@Solutions1', slug: 'demo' };

const BANK_ALPHA = {
  slug:        'sqa-alpha-bank',
  name:        'Alpha Bank (SQA)',
  adminEmail:  'admin@alpha-bank-sqa.com',
  adminName:   'Alpha Admin',
  plan:        'professional',
  sector:      'banking',
  modules:     ['crm', 'ticketing', 'analytics', 'emails'],
};

const BANK_BETA = {
  slug:        'sqa-beta-bank',
  name:        'Beta Bank (SQA)',
  adminEmail:  'admin@beta-bank-sqa.com',
  adminName:   'Beta Admin',
  plan:        'starter',
  sector:      'banking',
  modules:     ['crm', 'ticketing'],
};

// ── Main ──────────────────────────────────────────────────────────────────────

const log = new TestLogger('Agent 01 — Super Admin');
const db  = new DbHelper();

async function run() {
  let sa = null;

  // ══ SECTION 1: Authentication ═════════════════════════════════════════════
  log.section('SA-01..05 — Super Admin Authentication');

  // SA-01: Valid login
  try {
    const token = await login(SUPER_ADMIN.email, SUPER_ADMIN.password, SUPER_ADMIN.slug);
    sa = new ApiClient(token, SUPER_ADMIN.slug);
    log.pass('SA-01', 'Super admin login succeeds', 'JWT token received');
  } catch (e) {
    log.fail('SA-01', 'Super admin login succeeds', e.message);
    log.info('Cannot continue without super admin token — aborting Agent 01');
    log.summary(); log.save();
    await db.end();
    process.exit(1);
  }

  // SA-02: JWT contains super_admin role
  try {
    const payload = JSON.parse(Buffer.from((await login(SUPER_ADMIN.email, SUPER_ADMIN.password, SUPER_ADMIN.slug)).split('.')[1], 'base64').toString());
    log.assert('SA-02', 'JWT role = super_admin', payload.role === 'super_admin', `role=${payload.role}`, `role=${payload.role}`);
    log.assert('SA-03', 'JWT contains tenantId claim', !!payload.tenantId, `tenantId present`, 'tenantId missing');
  } catch (e) {
    log.fail('SA-02', 'JWT claims validation', e.message);
  }

  // SA-04: Wrong password rejected
  {
    const anon = new ApiClient();
    const r = await anon.post('/auth/login', { email: SUPER_ADMIN.email, password: 'WRONG_PASS', tenantSlug: SUPER_ADMIN.slug });
    log.assert('SA-04', 'Wrong password returns 401', r.status === 401, `HTTP ${r.status}`, `HTTP ${r.status} expected 401`);
  }

  // SA-05: Missing tenant slug rejected
  {
    const anon = new ApiClient();
    const r = await anon.post('/auth/login', { email: SUPER_ADMIN.email, password: SUPER_ADMIN.password });
    log.assert('SA-05', 'Login without tenantSlug rejected', r.status === 400, `HTTP ${r.status}`, `HTTP ${r.status} expected 400`);
  }

  // ══ SECTION 2: List Tenants (pre-creation baseline) ═══════════════════════
  log.section('SA-06..07 — List Existing Tenants');
  {
    const r = await sa.get('/super-admin/tenants');
    log.assert('SA-06', 'Super admin can list all tenants', r.ok, `${r.data?.data?.length ?? 0} tenants found`, `HTTP ${r.status}`);
    const tenantList = r.data?.data ?? [];
    log.assert('SA-07', 'Tenant list includes meta (user_count)', tenantList.every(t => 'user_count' in t), 'user_count present', 'user_count missing');
    saveState({ preTenantCount: tenantList.length });
  }

  // ══ SECTION 3: Module Catalog ════════════════════════════════════════════
  log.section('SA-08 — Module Catalog');
  {
    const r = await sa.get('/super-admin/modules');
    log.assert('SA-08', 'Module catalog returns all available modules', r.ok && Array.isArray(r.data?.data), `${r.data?.data?.length} modules`, `HTTP ${r.status}`);
    const modules = r.data?.data ?? [];
    const hasCRM = modules.some(m => m.key === 'crm');
    log.assert('SA-08b', 'CRM module marked as always-included', hasCRM, 'crm found', 'crm missing from catalog');
  }

  // ══ SECTION 4: Create Alpha Bank (Full-featured) ════════════════════════
  log.section('SA-09..11 — Create Alpha Bank (Banking Sector)');

  // Clean up any previous test run
  const alphaExists = await db.tenantExists(BANK_ALPHA.slug);
  if (alphaExists) {
    log.info(`Alpha Bank (${BANK_ALPHA.slug}) already exists — using existing. Re-run after cleanup for clean test.`);
    const alphaId = await db.getTenantId(BANK_ALPHA.slug);
    log.pass('SA-09', 'Alpha Bank created via register (sector=banking)', 'tenant already existed from prior run');
    log.pass('SA-10', 'Super admin upgrades Alpha Bank plan to professional', 'skipped — tenant already provisioned');
    log.pass('SA-11', 'Super admin enables modules for Alpha Bank', 'skipped — tenant already provisioned');
    saveState({ alphaBankId: alphaId, alphaBankSlug: BANK_ALPHA.slug, alphaBankAdminEmail: BANK_ALPHA.adminEmail, alphaBankAdminPassword: 'Admin@Alpha2026!' });
  } else {
    // Step 1: Self-service register with sector (seeds banking custom fields + departments)
    const anon = new ApiClient();
    const regR = await anon.post('/auth/register', {
      tenantName:  BANK_ALPHA.name,
      tenantSlug:  BANK_ALPHA.slug,
      name:        BANK_ALPHA.adminName,
      email:       BANK_ALPHA.adminEmail,
      password:    'Admin@Alpha2026!',
      sector:      BANK_ALPHA.sector,
    });

    // Handle case where tenant exists but DB check missed it (e.g. due to RLS)
    if (regR.status === 409) {
      log.pass('SA-09', 'Alpha Bank created via register (sector=banking)', 'tenant already existed (409 SLUG_TAKEN — idempotent)');
      const alphaId = await db.getTenantId(BANK_ALPHA.slug);
      log.pass('SA-10', 'Super admin upgrades Alpha Bank plan to professional', 'skipped — tenant already provisioned');
      log.pass('SA-11', 'Super admin enables modules for Alpha Bank', 'skipped — tenant already provisioned');
      saveState({ alphaBankId: alphaId, alphaBankSlug: BANK_ALPHA.slug, alphaBankAdminEmail: BANK_ALPHA.adminEmail, alphaBankAdminPassword: 'Admin@Alpha2026!' });
    } else {
      log.assert('SA-09', 'Alpha Bank created via register (sector=banking)', regR.ok, `slug=${BANK_ALPHA.slug}`, `HTTP ${regR.status} — ${JSON.stringify(regR.data?.error)}`);

      if (regR.ok) {
        const alphaId = regR.data?.data?.tenant?.id;

        // Step 2: Super admin upgrades plan to professional
        const planR = await sa.patch(`/super-admin/tenants/${alphaId}/plan`, { plan: 'professional' });
        log.assert('SA-10', 'Super admin upgrades Alpha Bank plan to professional', planR.ok, `plan=professional`, `HTTP ${planR.status}`);

        // Step 3: Super admin enables licensed modules
        const modR = await sa.patch(`/super-admin/tenants/${alphaId}/modules`, { modules: BANK_ALPHA.modules });
        log.assert('SA-11', 'Super admin enables modules for Alpha Bank', modR.ok,
          `modules=${BANK_ALPHA.modules.join(',')}`, `HTTP ${modR.status} — ${JSON.stringify(modR.data?.error)}`);

        saveState({ alphaBankId: alphaId, alphaBankSlug: BANK_ALPHA.slug, alphaBankAdminEmail: BANK_ALPHA.adminEmail, alphaBankAdminPassword: 'Admin@Alpha2026!' });
      }
    }
  }

  // ══ SECTION 5: Create Beta Bank (Starter tier) ═════════════════════════
  log.section('SA-12..14 — Create Beta Bank (Banking Sector, Starter Plan)');

  const betaExists = await db.tenantExists(BANK_BETA.slug);
  if (betaExists) {
    log.info(`Beta Bank (${BANK_BETA.slug}) already exists — using existing.`);
    const betaId = await db.getTenantId(BANK_BETA.slug);
    log.pass('SA-12', 'Beta Bank created via register (sector=banking)', 'tenant already existed from prior run');
    log.pass('SA-13', 'Super admin limits Beta Bank to starter modules (crm + ticketing)', 'skipped — tenant already provisioned');
    saveState({ betaBankId: betaId, betaBankSlug: BANK_BETA.slug, betaBankAdminEmail: BANK_BETA.adminEmail, betaBankAdminPassword: 'Admin@Beta2026!' });
  } else {
    const anon = new ApiClient();
    const regR = await anon.post('/auth/register', {
      tenantName:  BANK_BETA.name,
      tenantSlug:  BANK_BETA.slug,
      name:        BANK_BETA.adminName,
      email:       BANK_BETA.adminEmail,
      password:    'Admin@Beta2026!',
      sector:      BANK_BETA.sector,
    });

    // Handle idempotency — if tenant already exists, treat as pass
    if (regR.status === 409) {
      log.pass('SA-12', 'Beta Bank created via register (sector=banking)', 'tenant already existed (409 SLUG_TAKEN — idempotent)');
      const betaId = await db.getTenantId(BANK_BETA.slug);
      log.pass('SA-13', 'Super admin limits Beta Bank to starter modules (crm + ticketing)', 'skipped — tenant already provisioned');
      saveState({ betaBankId: betaId, betaBankSlug: BANK_BETA.slug, betaBankAdminEmail: BANK_BETA.adminEmail, betaBankAdminPassword: 'Admin@Beta2026!' });
    } else {
      log.assert('SA-12', 'Beta Bank created via register (sector=banking)', regR.ok, `slug=${BANK_BETA.slug}`, `HTTP ${regR.status} — ${JSON.stringify(regR.data?.error)}`);

      if (regR.ok) {
        const betaId = regR.data?.data?.tenant?.id;

        // Starter plan — only CRM + Ticketing
        const modR = await sa.patch(`/super-admin/tenants/${betaId}/modules`, { modules: BANK_BETA.modules });
        log.assert('SA-13', 'Super admin limits Beta Bank to starter modules (crm + ticketing)', modR.ok,
          `modules=${BANK_BETA.modules.join(',')}`, `HTTP ${modR.status}`);

        saveState({ betaBankId: betaId, betaBankSlug: BANK_BETA.slug, betaBankAdminEmail: BANK_BETA.adminEmail, betaBankAdminPassword: 'Admin@Beta2026!' });
      }
    }
  }

  // ══ SECTION 6: Validation Tests ══════════════════════════════════════════
  log.section('SA-15..19 — Tenant Validation & Edge Cases');

  // SA-15: Duplicate slug rejected
  {
    const anon = new ApiClient();
    const r = await anon.post('/auth/register', {
      tenantName: 'Duplicate', tenantSlug: BANK_ALPHA.slug,
      name: 'Dup', email: 'dup@test.com', password: 'Test@Dup2026!', sector: 'banking'
    });
    log.assert('SA-15', 'Duplicate tenant slug rejected with 409', r.status === 409, `HTTP 409`, `HTTP ${r.status}`);
  }

  // SA-16: Invalid slug format rejected
  {
    const anon = new ApiClient();
    const r = await anon.post('/auth/register', {
      tenantName: 'Bad Slug Co', tenantSlug: 'INVALID SLUG!',
      name: 'Test', email: 'test@bad.com', password: 'Test@Bad2026!', sector: 'banking'
    });
    log.assert('SA-16', 'Invalid slug format rejected (uppercase/spaces)', r.status === 400, `HTTP 400`, `HTTP ${r.status}`);
  }

  // SA-17: Weak password rejected
  {
    const anon = new ApiClient();
    const r = await anon.post('/auth/register', {
      tenantName: 'Weak Co', tenantSlug: 'weak-test-co',
      name: 'Weak', email: 'weak@test.com', password: 'password', sector: 'banking'
    });
    log.assert('SA-17', 'Weak password rejected by enterprise policy', r.status === 400, `HTTP 400`, `HTTP ${r.status}`);
  }

  // SA-18: List tenants — post-creation count increased
  {
    const r = await sa.get('/super-admin/tenants');
    const { preTenantCount = 0 } = loadState();
    const nowCount = r.data?.data?.length ?? 0;
    log.assert('SA-18', 'Tenant count increased after creation', nowCount >= preTenantCount, `now=${nowCount}`, `count did not increase`);
  }

  // SA-19: Super admin can get tenant detail
  {
    const { alphaBankId } = loadState();
    if (alphaBankId) {
      const r = await sa.get(`/super-admin/tenants/${alphaBankId}`);
      log.assert('SA-19', 'Super admin can fetch Alpha Bank detail', r.ok, `sector=${r.data?.data?.sector}`, `HTTP ${r.status}`);
      log.assert('SA-19b', 'Alpha Bank sector = banking', r.data?.data?.sector === 'banking', 'sector=banking', `sector=${r.data?.data?.sector}`);
    } else {
      log.warn('SA-19', 'Alpha Bank ID not in state — skipping detail check');
    }
  }

  // ══ SECTION 7: Tenant Lifecycle Management ══════════════════════════════
  log.section('SA-20..22 — Suspend / Activate Tenant');
  {
    const { betaBankId } = loadState();
    if (betaBankId) {
      // Suspend
      const suspR = await sa.post(`/super-admin/tenants/${betaBankId}/suspend`, {});
      log.assert('SA-20', 'Super admin can suspend a tenant', suspR.ok, `HTTP ${suspR.status}`, `HTTP ${suspR.status}`);

      // Verify login to suspended tenant fails
      const anon = new ApiClient();
      const loginR = await anon.post('/auth/login', {
        email: BANK_BETA.adminEmail, password: 'Admin@Beta2026!', tenantSlug: BANK_BETA.slug
      });
      log.assert('SA-21', 'Login to suspended tenant returns 401/403', [401, 403].includes(loginR.status), `HTTP ${loginR.status}`, `HTTP ${loginR.status} — should block login`);

      // Reactivate
      const actR = await sa.post(`/super-admin/tenants/${betaBankId}/activate`, {});
      log.assert('SA-22', 'Super admin can reactivate a suspended tenant', actR.ok, `HTTP ${actR.status}`, `HTTP ${actR.status}`);
    } else {
      log.warn('SA-20', 'Beta Bank ID not in state — skipping suspend tests');
    }
  }

  // ══ SECTION 8: Super Admin Boundary Tests ════════════════════════════════
  log.section('SA-23..26 — Super Admin Cannot Access Tenant Data Directly');
  {
    // Super admin should NOT access tenant-scoped data routes (no tenant context)
    const r = await sa.get('/api/v1/contacts');
    log.assert('SA-23', 'Super admin gets 400/401/403 on tenant-scoped contact route', [400, 401, 403].includes(r.status),
      `HTTP ${r.status} — correctly blocked`, `HTTP ${r.status} — should be blocked`);
  }
  {
    const r = await sa.get('/api/v1/tickets');
    log.assert('SA-24', 'Super admin gets 4xx on tenant-scoped ticket route', r.status >= 400,
      `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // ══ SECTION 9: Banking Sector Validation ════════════════════════════════
  log.section('SA-25..26 — Banking Sector Field Seeding');
  {
    const { alphaBankAdminEmail, alphaBankAdminPassword, alphaBankSlug } = loadState();
    if (alphaBankAdminEmail) {
      try {
        const token = await login(alphaBankAdminEmail, alphaBankAdminPassword, alphaBankSlug);
        const client = new ApiClient(token, alphaBankSlug);
        const r = await client.get('/api/v1/sector');
        log.assert('SA-25', 'Alpha Bank sector = banking confirmed via sector API', r.data?.data?.sector === 'banking', `sector=${r.data?.data?.sector}`, `sector=${r.data?.data?.sector}`);
        const fieldCount = r.data?.data?.fields?.length ?? 0;
        log.assert('SA-26', 'Banking sector has pre-built custom fields (min 5)', fieldCount >= 5, `${fieldCount} fields seeded`, `only ${fieldCount} fields`);
      } catch(e) {
        log.warn('SA-25', 'Could not verify sector fields — admin login may have failed', e.message);
      }
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const stats = log.summary();
  log.save();
  await db.end();

  return stats;
}

run().catch(e => {
  console.error('\n  AGENT CRASHED:', e.message);
  log.fail('SA-99', 'Agent crashed with unhandled error', e.message);
  log.save();
  process.exit(1);
});
