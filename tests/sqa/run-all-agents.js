#!/usr/bin/env node
/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║          VIVID CRM — SQA MASTER TEST RUNNER                             ║
 * ║          Banking Sector — Multi-Tenant Functional QA Suite              ║
 * ║                                                                         ║
 * ║  Methodology: IEEE 829 / ISO/IEC 25010 aligned                         ║
 * ║  Agents:                                                                ║
 * ║    01 — Super Admin    : tenant provisioning, module licensing          ║
 * ║    02 — Tenant Admin   : user hierarchy, dept assignment, RBAC setup    ║
 * ║    03 — RBAC Visibility: data segregation, cross-tenant isolation       ║
 * ║    04 — Module Tests   : contacts, deals, tickets, invoicing, analytics ║
 * ║    05 — Security/UX    : auth attacks, injection, response quality      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node run-all-agents.js              # Run all agents sequentially
 *   node run-all-agents.js --agent 01  # Run only Agent 01
 *   node run-all-agents.js --from 03   # Resume from Agent 03
 *   node run-all-agents.js --clean     # Clear state and start fresh
 *
 * Prerequisites:
 *   1. API running:       cd packages/api && pnpm dev
 *   2. Frontend running:  cd packages/frontend && pnpm dev  (for UX tests)
 *   3. PostgreSQL + Redis: docker-compose up -d db redis
 *   4. Migrations run:    pnpm migrate
 *   5. Seed super admin:  pnpm seed  (creates admin@demo.com)
 *   6. Install deps:      npm install pg bcryptjs
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'test-state.json');
const REPORT_FILE = path.join(__dirname, 'reports', 'SQA_TEST_REPORT.json');

const args = process.argv.slice(2);
const agentFilter = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : null;
const fromAgent   = args.includes('--from')  ? args[args.indexOf('--from')  + 1] : null;
const doClean     = args.includes('--clean');

if (doClean) {
  if (fs.existsSync(STATE_FILE))  fs.unlinkSync(STATE_FILE);
  if (fs.existsSync(REPORT_FILE)) fs.unlinkSync(REPORT_FILE);
  console.log('✓ State and report cleared');
}

// ── Agent registry ────────────────────────────────────────────────────────────
const AGENTS = [
  { id: '01', name: 'Super Admin — Tenant Provisioning',       file: 'agents/agent-01-superadmin.js'    },
  { id: '02', name: 'Tenant Admin — User Hierarchy',           file: 'agents/agent-02-tenant-admin.js'  },
  { id: '03', name: 'RBAC Visibility — Data Segregation',      file: 'agents/agent-03-rbac-visibility.js' },
  { id: '04', name: 'Module Functionality — Full CRUD',        file: 'agents/agent-04-modules.js'       },
  { id: '05', name: 'Security & UX — Attack Surface',         file: 'agents/agent-05-security.js'      },
];

// ── Pre-flight checks ─────────────────────────────────────────────────────────
async function preFlightCheck() {
  console.log('\n┌────────────────────────────────────────────────────────────────┐');
  console.log('│  VIVID CRM — SQA PRE-FLIGHT CHECKS                           │');
  console.log('└────────────────────────────────────────────────────────────────┘\n');

  let allOk = true;

  // Check API
  try {
    const r = await fetch('http://localhost:3000/health');
    console.log(`  ✓ API server reachable (HTTP ${r.status})`);
  } catch {
    console.log('  ✗ API server NOT reachable at http://localhost:3000');
    console.log('    → Start with: cd packages/api && pnpm dev');
    allOk = false;
  }

  // Check DB (via pg)
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://crm:crm_dev_password@localhost:5432/crm_platform', connectionTimeoutMillis: 2000 });
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    await pool.end();
    console.log('  ✓ PostgreSQL reachable');
  } catch (e) {
    console.log(`  ✗ PostgreSQL NOT reachable: ${e.message}`);
    console.log('    → Start with: docker-compose up -d db');
    allOk = false;
  }

  if (!allOk) {
    console.log('\n  ⚠ Fix the above issues before running the test suite.\n');
    process.exit(1);
  }

  console.log('\n  All services ready. Starting test agents...\n');
}

// ── Run one agent as a child process ─────────────────────────────────────────
function runAgent(agent) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n${'▓'.repeat(70)}`);
    console.log(`  ▶ STARTING: Agent ${agent.id} — ${agent.name}`);
    console.log(`${'▓'.repeat(70)}`);

    const child = spawn('node', ['--experimental-vm-modules', path.join(__dirname, agent.file)], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', (code) => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const status = code === 0 ? '✓ COMPLETED' : '✗ FAILED (exit ' + code + ')';
      console.log(`\n  ${status} — Agent ${agent.id} in ${elapsed}s`);
      resolve({ agentId: agent.id, code, elapsed });
    });
  });
}

// ── Generate final report ─────────────────────────────────────────────────────
function generateReport() {
  console.log('\n' + '═'.repeat(70));
  console.log('  FINAL SQA REPORT — VIVID CRM (BANKING SECTOR)');
  console.log('═'.repeat(70));

  let results = [];
  try { results = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')); } catch {}

  if (results.length === 0) {
    console.log('  No test results found.');
    return;
  }

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  const total = results.length;
  const pct = ((pass / total) * 100).toFixed(1);

  console.log(`\n  OVERALL: ${pass}/${total} passed (${pct}%)`);
  console.log(`  PASS: ${pass}  |  FAIL: ${fail}  |  WARN: ${warn}`);

  // Group by agent
  const byAgent = {};
  results.forEach(r => {
    if (!byAgent[r.agent]) byAgent[r.agent] = { pass: 0, fail: 0, warn: 0 };
    byAgent[r.agent][r.status.toLowerCase()]++;
  });

  console.log('\n  BY AGENT:');
  Object.entries(byAgent).forEach(([agent, s]) => {
    const agentPass = s.pass + s.fail + s.warn > 0 ? ((s.pass / (s.pass + s.fail + s.warn)) * 100).toFixed(0) : 0;
    console.log(`    ${agent.padEnd(40)} PASS=${s.pass} FAIL=${s.fail} WARN=${s.warn} (${agentPass}%)`);
  });

  if (fail > 0) {
    console.log('\n  FAILED TEST CASES:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`    ✗ [${r.tcId}] ${r.description}`);
      console.log(`      Detail: ${r.detail}`);
      console.log(`      Agent: ${r.agent}`);
    });
  }

  console.log(`\n  Full report saved to: ${REPORT_FILE}`);

  // Write HTML summary
  const htmlPath = path.join(__dirname, 'reports', 'SQA_REPORT.html');
  const html = generateHtmlReport(results, { pass, fail, warn, total, pct });
  fs.writeFileSync(htmlPath, html);
  console.log(`  HTML report saved to: ${htmlPath}`);

  console.log('\n' + '═'.repeat(70));
}

function generateHtmlReport(results, summary) {
  const failRows = results.filter(r => r.status === 'FAIL').map(r =>
    `<tr class="fail"><td>${r.tcId}</td><td>${r.agent}</td><td>${r.description}</td><td>${r.detail}</td><td>${r.ts}</td></tr>`
  ).join('');
  const allRows = results.map(r =>
    `<tr class="${r.status.toLowerCase()}"><td>${r.tcId}</td><td>${r.agent}</td><td>${r.description}</td><td>${r.status}</td><td>${r.detail||''}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Vivid CRM — SQA Report</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;background:#f9fafb;color:#111}
  .header{background:linear-gradient(135deg,#1e3a5f,#0ea5e9);color:#fff;padding:32px 40px}
  .header h1{margin:0;font-size:1.8rem}
  .header p{margin:8px 0 0;opacity:.8}
  .summary{display:flex;gap:16px;padding:24px 40px;background:#fff;border-bottom:1px solid #e5e7eb}
  .card{background:#f0f9ff;border-radius:8px;padding:16px 24px;text-align:center;min-width:100px}
  .card.fail{background:#fef2f2}.card.warn{background:#fffbeb}.card.pass{background:#f0fdf4}
  .card .num{font-size:2rem;font-weight:700}
  .card .label{font-size:.8rem;color:#6b7280;margin-top:4px}
  .section{padding:24px 40px}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{background:#1e3a5f;color:#fff;padding:8px 12px;text-align:left}
  td{padding:8px 12px;border-bottom:1px solid #e5e7eb}
  tr.pass td:first-child::before{content:'✓ ';color:#16a34a}
  tr.fail{background:#fef2f2}tr.fail td:first-child::before{content:'✗ ';color:#dc2626}
  tr.warn{background:#fffbeb}tr.warn td:first-child::before{content:'⚠ ';color:#d97706}
</style></head><body>
<div class="header">
  <h1>🏦 Vivid CRM — SQA Test Report</h1>
  <p>Banking Sector · Multi-Tenant · Generated ${new Date().toISOString()}</p>
</div>
<div class="summary">
  <div class="card pass"><div class="num">${summary.pass}</div><div class="label">PASSED</div></div>
  <div class="card fail"><div class="num">${summary.fail}</div><div class="label">FAILED</div></div>
  <div class="card warn"><div class="num">${summary.warn}</div><div class="label">WARNINGS</div></div>
  <div class="card"><div class="num">${summary.total}</div><div class="label">TOTAL</div></div>
  <div class="card"><div class="num">${summary.pct}%</div><div class="label">PASS RATE</div></div>
</div>
${summary.fail > 0 ? `
<div class="section">
  <h2>⚠ Failed Tests (${summary.fail})</h2>
  <table><thead><tr><th>ID</th><th>Agent</th><th>Description</th><th>Detail</th><th>Time</th></tr></thead>
  <tbody>${failRows}</tbody></table>
</div>` : ''}
<div class="section">
  <h2>All Test Results</h2>
  <table><thead><tr><th>TC ID</th><th>Agent</th><th>Description</th><th>Status</th><th>Detail</th></tr></thead>
  <tbody>${allRows}</tbody></table>
</div>
</body></html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();

  console.log('\n' + '╔' + '═'.repeat(68) + '╗');
  console.log('║  VIVID CRM — SQA MASTER TEST RUNNER                           ║');
  console.log('║  Banking Sector · Multi-Tenant Functional Test Suite          ║');
  console.log('╚' + '═'.repeat(68) + '╝');

  await preFlightCheck();

  const agentsToRun = AGENTS.filter(a => {
    if (agentFilter) return a.id === agentFilter;
    if (fromAgent)   return parseInt(a.id) >= parseInt(fromAgent);
    return true;
  });

  const agentResults = [];
  for (const agent of agentsToRun) {
    const result = await runAgent(agent);
    agentResults.push(result);
    // Brief pause between agents
    await new Promise(r => setTimeout(r, 500));
  }

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  All agents completed in ${totalElapsed}s`);

  generateReport();
}

main().catch(e => {
  console.error('\n  MASTER RUNNER CRASHED:', e.message);
  process.exit(1);
});
