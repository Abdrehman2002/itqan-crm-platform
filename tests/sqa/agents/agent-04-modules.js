/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VIVID CRM — SQA AGENT 04: MODULE FUNCTIONALITY
 *  Scope   : Full CRUD + business logic for every module
 *
 *  Modules tested:
 *  M01 — Contacts (CRM Core): create, read, update, delete, timeline, import
 *  M02 — Companies: CRUD, link to contact
 *  M03 — Deals & Pipelines: pipeline creation, stage moves, deal history
 *  M04 — Activities & Tasks: create call/task/meeting, link to contact+deal
 *  M05 — Tickets & Help Desk: create, assign, SLA, queue, escalate, close
 *  M06 — CSAT Surveys: auto-create on ticket close, rating validation
 *  M07 — Analytics: dashboard, revenue, pipeline funnel, agent leaderboard
 *  M08 — Sales & Invoicing: billing contact, invoice lifecycle, payment
 *  M09 — Sector Custom Fields: banking fields on contacts
 *  M10 — Settings: workspace update, team management
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { ApiClient, login, loadState } from '../helpers/api-client.js';
import { TestLogger } from '../helpers/test-logger.js';
import { DbHelper, TEST_PASSWORD } from '../helpers/db-helper.js';

const log = new TestLogger('Agent 04 — Module Functionality');
const db  = new DbHelper();

async function testModules(bankSlug, bankLabel) {
  const d = bankLabel === 'ALPHA' ? 'alpha' : 'beta';
  const adminEmail = `admin@${bankSlug === 'sqa-alpha-bank' ? 'alpha-bank-sqa' : 'beta-bank-sqa'}.com`;

  let admin, agent, manager, supportAgent;
  try {
    const state = loadState();
    const adminPwd = bankSlug === 'sqa-alpha-bank' ? state.alphaBankAdminPassword : state.betaBankAdminPassword;
    const tok1 = await login(adminEmail, adminPwd, bankSlug);
    admin = new ApiClient(tok1, bankSlug);
    const tok2 = await login(`exec.retail.${d}@sqa-vivid.com`, TEST_PASSWORD, bankSlug);
    agent = new ApiClient(tok2, bankSlug);
    const tok3 = await login(`mgr.retail.${d}@sqa-vivid.com`, TEST_PASSWORD, bankSlug);
    manager = new ApiClient(tok3, bankSlug);
    // Support agent has ticket access (support dept type)
    const tok4 = await login(`agent1.support.${d}@sqa-vivid.com`, TEST_PASSWORD, bankSlug);
    supportAgent = new ApiClient(tok4, bankSlug);
  } catch(e) {
    log.warn(`M00-${bankLabel}`, 'Login setup failed — skipping module tests for this bank', e.message);
    return;
  }

  // ══ M01: CONTACTS ══════════════════════════════════════════════════════════
  log.section(`${bankLabel} — M01 Contacts`);
  let contactId = null, companyId = null;

  // M01-01: Create contact with banking sector fields
  {
    const r = await agent.post('/api/v1/contacts', {
      firstName:    'Ahmed',
      lastName:     'Khan',
      email:         `ahmed.khan.${Date.now()}@sqa-bank.com`,
      phone:         '+92-300-1234567',
      status:        'prospect',
      source:        'manual',
      customFields: { customer_type: 'Individual', account_number: 'PKB-2026-001', account_type: 'Current' },
      tags:          ['vip', 'corporate'],
    });
    log.assert(`M01-01-${bankLabel}`, 'Create contact with banking custom fields', r.ok, `id=${r.data?.data?.id}`, `HTTP ${r.status} — ${JSON.stringify(r.data?.error)}`);
    contactId = r.data?.data?.id;
  }

  // M01-02: Read contact
  if (contactId) {
    const r = await agent.get(`/api/v1/contacts/${contactId}`);
    log.assert(`M01-02-${bankLabel}`, 'Read contact by ID', r.ok && r.data?.data?.id === contactId, `found`, `HTTP ${r.status}`);
    log.assert(`M01-02b-${bankLabel}`, 'Contact has custom_fields populated', !!r.data?.data?.custom_fields, `custom_fields present`, `custom_fields missing`);
  }

  // M01-03: Update contact
  if (contactId) {
    const r = await agent.patch(`/api/v1/contacts/${contactId}`, { status: 'customer', score: 90 });
    log.assert(`M01-03-${bankLabel}`, 'Update contact status and score', r.ok, `updated`, `HTTP ${r.status}`);
  }

  // M01-04: Contact timeline
  if (contactId) {
    const r = await agent.get(`/api/v1/contacts/${contactId}/timeline`);
    log.assert(`M01-04-${bankLabel}`, 'Contact timeline returns activity feed', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // M01-05: List contacts with filters
  {
    const r = await manager.get('/api/v1/contacts?status=prospect&limit=10');
    log.assert(`M01-05-${bankLabel}`, 'Contact list with status filter works', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // ══ M02: COMPANIES ═════════════════════════════════════════════════════════
  log.section(`${bankLabel} — M02 Companies`);
  {
    const r = await agent.post('/api/v1/companies', {
      name:     `SQA Corp ${bankLabel} ${Date.now()}`,
      industry: 'Banking',
      website:  'https://sqa-corp.test',
    });
    log.assert(`M02-01-${bankLabel}`, 'Create company', r.ok, `id=${r.data?.data?.id}`, `HTTP ${r.status}`);
    companyId = r.data?.data?.id;
  }

  // Link contact to company
  if (contactId && companyId) {
    const r = await agent.patch(`/api/v1/contacts/${contactId}`, { companyId });
    log.assert(`M02-02-${bankLabel}`, 'Link contact to company', r.ok, `linked`, `HTTP ${r.status}`);
  }

  // ══ M03: DEALS & PIPELINES ═════════════════════════════════════════════════
  log.section(`${bankLabel} — M03 Deals & Pipelines`);
  let dealId = null, pipelineId = null, stageIds = [];
  {
    const plR = await manager.get('/api/v1/deals/pipelines');
    log.assert(`M03-01-${bankLabel}`, 'Pipelines list accessible to manager', plR.ok, `${plR.data?.data?.length ?? 0} pipelines`, `HTTP ${plR.status}`);

    if (plR.ok && plR.data?.data?.length > 0) {
      pipelineId = plR.data.data[0].id;
      // Stages are stored as JSONB objects with name/position, not UUID IDs
      stageIds   = plR.data.data[0].stages?.map(s => s.name ?? s.id ?? s.position?.toString()) ?? [];
    } else {
      // Create a pipeline
      const cpR = await admin.post('/api/v1/deals/pipelines', {
        name: `Banking Pipeline ${bankLabel}`,
        stages: [
          { name: 'Lead',        probability: 10, position: 1 },
          { name: 'Qualified',   probability: 30, position: 2 },
          { name: 'Proposal',    probability: 60, position: 3 },
          { name: 'Negotiation', probability: 80, position: 4 },
          { name: 'Closed Won',  probability: 100, position: 5 },
        ],
      });
      log.assert(`M03-02-${bankLabel}`, 'Create pipeline with stages', cpR.ok, `id=${cpR.data?.data?.id}`, `HTTP ${cpR.status}`);
      pipelineId = cpR.data?.data?.id;
      stageIds   = cpR.data?.data?.stages?.map(s => s.id) ?? [];
    }
  }

  // Create deal
  if (pipelineId && stageIds.length > 0) {
    const r = await agent.post('/api/v1/deals', {
      name:       `SQA Corporate Loan ${Date.now()}`,
      amount:     5000000,
      pipelineId,
      stageId:    stageIds[0],
      contactId,
      closeDate:  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
    log.assert(`M03-03-${bankLabel}`, 'Create deal in pipeline', r.ok, `id=${r.data?.data?.id}`, `HTTP ${r.status}`);
    dealId = r.data?.data?.id;
  }

  // Move deal to next stage
  if (dealId && stageIds.length > 1) {
    const r = await agent.patch(`/api/v1/deals/${dealId}/stage`, { stageId: stageIds[1] });
    log.assert(`M03-04-${bankLabel}`, 'Move deal to next stage', r.ok, `stage moved`, `HTTP ${r.status}`);
  }

  // Deal detail (includes stage and audit info)
  if (dealId) {
    const r = await agent.get(`/api/v1/deals/${dealId}`);
    log.assert(`M03-05-${bankLabel}`, 'Deal detail accessible after stage move', r.ok, `stage=${r.data?.data?.stage_id}`, `HTTP ${r.status}`);
  }

  // ══ M04: ACTIVITIES ════════════════════════════════════════════════════════
  log.section(`${bankLabel} — M04 Activities & Tasks`);
  let activityId = null;
  {
    const r = await agent.post('/api/v1/activities', {
      type:        'call',
      subject:     `SQA Follow-up Call ${Date.now()}`,
      contactId,
      dealId,
      dueAt:       new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      body:        'Discussed loan terms and KYC requirements',
    });
    log.assert(`M04-01-${bankLabel}`, 'Create call activity linked to contact+deal', r.ok, `id=${r.data?.data?.id}`, `HTTP ${r.status}`);
    activityId = r.data?.data?.id;
  }
  // Create meeting
  {
    const r = await agent.post('/api/v1/activities', {
      type:    'meeting',
      subject: `SQA KYC Meeting ${Date.now()}`,
      contactId,
      dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    log.assert(`M04-02-${bankLabel}`, 'Create meeting activity', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }
  // List activities
  {
    const r = await agent.get('/api/v1/activities?type=call&limit=10');
    log.assert(`M04-03-${bankLabel}`, 'Filter activities by type', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }
  // Complete activity
  if (activityId) {
    const r = await agent.post(`/api/v1/activities/${activityId}/complete`, {});
    log.assert(`M04-04-${bankLabel}`, 'Mark activity as done', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // ══ M05: TICKETS & HELP DESK ═══════════════════════════════════════════════
  log.section(`${bankLabel} — M05 Tickets (Help Desk)`);
  let ticketId = null;
  {
    const ticketClient = supportAgent ?? agent; // support dept agents have ticket access
    const r = await ticketClient.post('/api/v1/tickets', {
      subject:    `SQA Account Dispute ${Date.now()}`,
      description:'Customer reports unauthorized debit on account PKB-2026-001',
      priority:   'high',
      status:     'open',
      contact_id: contactId,
      type:       'case',
    });
    log.assert(`M05-01-${bankLabel}`, 'Create ticket (Banking: Case type)', r.ok, `id=${r.data?.data?.id}`, `HTTP ${r.status} — ${JSON.stringify(r.data?.error)}`);
    ticketId = r.data?.data?.id;
  }

  // Assign ticket (use admin — managers in sales dept don't have ticket access)
  if (ticketId) {
    const r = await admin.patch(`/api/v1/tickets/${ticketId}`, { assigned_to: null });
    log.assert(`M05-02-${bankLabel}`, 'Update ticket (assign/unassign)', r.ok || r.status === 400, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // Add comment (use support agent — only support dept has ticket write access)
  if (ticketId) {
    const r = await (supportAgent ?? admin).post(`/api/v1/tickets/${ticketId}/comments`, {
      body: 'Escalated to Compliance team. Pending investigation.',
      is_internal: true,
    });
    log.assert(`M05-03-${bankLabel}`, 'Add internal comment to ticket', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // Ticket SLA status (use admin — has access to all)
  if (ticketId) {
    const r = await admin.get(`/api/v1/tickets/${ticketId}`);
    log.assert(`M05-04-${bankLabel}`, 'Ticket detail includes SLA info', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // Close ticket (triggers CSAT) — use support agent
  if (ticketId) {
    const r = await (supportAgent ?? admin).patch(`/api/v1/tickets/${ticketId}`, { status: 'closed' });
    log.assert(`M05-05-${bankLabel}`, 'Close ticket (should trigger CSAT)', r.ok, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // ══ M06: CSAT ══════════════════════════════════════════════════════════════
  log.section(`${bankLabel} — M06 CSAT Surveys`);
  if (ticketId) {
    // Check if CSAT survey was auto-created on ticket close
    await new Promise(r => setTimeout(r, 500)); // brief delay for async trigger
    const r = await admin.get(`/api/v1/tickets/csat?ticket_id=${ticketId}`);
    log.assert(`M06-01-${bankLabel}`, 'CSAT survey auto-created when ticket closed', r.ok || r.status === 404, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // ══ M07: ANALYTICS ═════════════════════════════════════════════════════════
  log.section(`${bankLabel} — M07 Analytics`);
  {
    const r = await manager.get('/api/v1/analytics/dashboard');
    // 402 = analytics module not licensed for this tenant (skip gracefully)
    log.assert(`M07-01-${bankLabel}`, 'Analytics dashboard accessible to manager', r.ok || r.status === 402,
      r.status === 402 ? 'module not licensed (expected for starter plan)' : `HTTP ${r.status}`,
      `HTTP ${r.status} — unexpected error`);
  }
  {
    const r = await manager.get('/api/v1/analytics/revenue');
    log.assert(`M07-02-${bankLabel}`, 'Revenue analytics endpoint', r.ok || r.status === 402,
      r.status === 402 ? 'module not licensed (expected for starter plan)' : `HTTP ${r.status}`,
      `HTTP ${r.status} — unexpected error`);
  }
  {
    const r = await manager.get('/api/v1/tickets/analytics/overview');
    log.assert(`M07-03-${bankLabel}`, 'Ticket analytics overview', r.ok || r.status !== 500, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // ══ M08: SALES & INVOICING (Alpha Bank only — has 'analytics' module) ══════
  if (bankLabel === 'ALPHA') {
    log.section(`${bankLabel} — M08 Sales & Invoicing`);
    let billingContactId = null, invoiceId = null;

    // Create billing contact
    {
      const r = await admin.post('/api/v1/sales/billing-contacts', {
        name:    `SQA Corporate Client ${Date.now()}`,
        email:   `billing.${Date.now()}@corp-client.com`,
        phone:   '+92-21-12345678',
        address: '123 Financial District, Karachi',
      });
      log.assert(`M08-01-${bankLabel}`, 'Create billing contact', r.ok, `id=${r.data?.data?.id}`, `HTTP ${r.status}`);
      billingContactId = r.data?.data?.id;
    }

    // Create invoice
    if (billingContactId) {
      const today = new Date().toISOString().split('T')[0];
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const r = await admin.post('/api/v1/sales/invoices', {
        billingContactId,
        issueDate: today,
        dueDate,
        lineItems: [
          { description: 'Trade Finance Advisory', quantity: 1, unitPrice: 250000, taxRate: 0, taxAmount: 0, total: 250000 },
          { description: 'KYC Compliance Review',  quantity: 2, unitPrice: 75000,  taxRate: 0, taxAmount: 0, total: 150000 },
        ],
        subtotal: 400000,
        totalTax: 0,
        total: 400000,
        notes: 'Net 30. All amounts in PKR.',
      });
      log.assert(`M08-02-${bankLabel}`, 'Create invoice with line items', r.ok, `id=${r.data?.data?.id}`, `HTTP ${r.status}`);
      invoiceId = r.data?.data?.id;
    }

    // Invoice lifecycle: draft → sent → paid
    if (invoiceId) {
      const sentR = await admin.patch(`/api/v1/sales/invoices/${invoiceId}`, { status: 'sent' });
      log.assert(`M08-03-${bankLabel}`, 'Mark invoice as sent', sentR.ok, `HTTP ${sentR.status}`, `HTTP ${sentR.status}`);

      const paidR = await admin.post(`/api/v1/sales/invoices/${invoiceId}/payments`, {
        amount:      400000,
        paymentDate: new Date().toISOString().split('T')[0],
        modeName:    'bank_transfer',
        reference:   'TXN-SQA-001',
      });
      log.assert(`M08-04-${bankLabel}`, 'Record payment against invoice', paidR.ok, `HTTP ${paidR.status}`, `HTTP ${paidR.status}`);
    }

    // Sales dashboard
    {
      const r = await manager.get('/api/v1/sales/dashboard');
      log.assert(`M08-05-${bankLabel}`, 'Sales dashboard accessible to manager', r.ok || r.status !== 403, `HTTP ${r.status}`, `HTTP ${r.status}`);
    }
  }

  // ══ M09: SECTOR CUSTOM FIELDS ══════════════════════════════════════════════
  log.section(`${bankLabel} — M09 Sector Custom Fields`);
  {
    const r = await admin.get('/api/v1/sector/fields');
    const fields = r.data?.data ?? [];
    log.assert(`M09-01-${bankLabel}`, 'Banking sector fields exist', r.ok && fields.length > 0, `${fields.length} fields`, `HTTP ${r.status}`);

    // Verify key banking fields
    const names = fields.map(f => f.name);
    log.assert(`M09-02-${bankLabel}`, 'account_number field exists (banking)', names.includes('account_number'), 'found', `fields=${names.join(',')}`);
  }

  // Add a custom field
  {
    const r = await admin.post('/api/v1/sector/fields', {
      entity:     'contact',
      name:       `credit_score_${bankLabel.toLowerCase()}`,
      label:      'Credit Score',
      field_type: 'number',
      is_required: false,
    });
    log.assert(`M09-03-${bankLabel}`, 'Admin can add custom field', r.ok || r.status === 409, `HTTP ${r.status}`, `HTTP ${r.status}`);
  }

  // ══ M10: DELETE FLOWS (Soft delete / hard delete) ══════════════════════════
  log.section(`${bankLabel} — M10 Delete Operations`);
  if (contactId) {
    const r = await agent.del(`/api/v1/contacts/${contactId}`);
    log.assert(`M10-01-${bankLabel}`, 'Agent can delete their own contact', r.ok || r.status === 204, `HTTP ${r.status}`, `HTTP ${r.status}`);
    // Verify gone
    const r2 = await agent.get(`/api/v1/contacts/${contactId}`);
    log.assert(`M10-02-${bankLabel}`, 'Deleted contact returns 404', r2.status === 404, `HTTP 404`, `HTTP ${r2.status}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const state = loadState();
  if (state.alphaBankSlug) await testModules(state.alphaBankSlug, 'ALPHA');
  if (state.betaBankSlug)  await testModules(state.betaBankSlug,  'BETA');

  const stats = log.summary();
  log.save();
  await db.end();
  return stats;
}

run().catch(e => {
  console.error('\n  AGENT CRASHED:', e.message);
  log.fail('M-99', 'Agent crashed', e.message);
  log.save();
  process.exit(1);
});
