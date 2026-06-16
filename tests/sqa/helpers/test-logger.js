/**
 * Vivid CRM — SQA Test Suite
 * Test Logger — collects results, writes JSON + console output
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_FILE = path.resolve(__dirname, '../reports/SQA_TEST_REPORT.json');

const PASS  = '\x1b[32m✓ PASS\x1b[0m';
const FAIL  = '\x1b[31m✗ FAIL\x1b[0m';
const WARN  = '\x1b[33m⚠ WARN\x1b[0m';
const INFO  = '\x1b[36mℹ INFO\x1b[0m';

export class TestLogger {
  constructor(agentName) {
    this.agentName = agentName;
    this.results = [];
    this.startTime = Date.now();
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  🤖 AGENT: ${agentName}`);
    console.log(`${'═'.repeat(70)}`);
  }

  pass(tcId, description, detail = '') {
    this.results.push({ tcId, description, status: 'PASS', detail, agent: this.agentName, ts: new Date().toISOString() });
    console.log(`  ${PASS}  [${tcId}] ${description}${detail ? ' — ' + detail : ''}`);
  }

  fail(tcId, description, detail = '') {
    this.results.push({ tcId, description, status: 'FAIL', detail, agent: this.agentName, ts: new Date().toISOString() });
    console.log(`  ${FAIL}  [${tcId}] ${description}${detail ? ' — ' + detail : ''}`);
  }

  warn(tcId, description, detail = '') {
    this.results.push({ tcId, description, status: 'WARN', detail, agent: this.agentName, ts: new Date().toISOString() });
    console.log(`  ${WARN}  [${tcId}] ${description}${detail ? ' — ' + detail : ''}`);
  }

  info(msg) {
    console.log(`  ${INFO}  ${msg}`);
  }

  section(title) {
    console.log(`\n  ── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  }

  assert(tcId, description, condition, passDetail = '', failDetail = '') {
    if (condition) this.pass(tcId, description, passDetail);
    else           this.fail(tcId, description, failDetail);
    return condition;
  }

  summary() {
    const pass = this.results.filter(r => r.status === 'PASS').length;
    const fail = this.results.filter(r => r.status === 'FAIL').length;
    const warn = this.results.filter(r => r.status === 'WARN').length;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`\n  SUMMARY: ${pass} passed | ${fail} failed | ${warn} warnings | ${elapsed}s`);
    if (fail > 0) {
      console.log(`  FAILED TESTS:`);
      this.results.filter(r => r.status === 'FAIL').forEach(r =>
        console.log(`    ✗ [${r.tcId}] ${r.description} — ${r.detail}`)
      );
    }
    return { pass, fail, warn, total: this.results.length };
  }

  save() {
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')); } catch {}
    const updated = [...existing.filter(r => r.agent !== this.agentName), ...this.results];
    fs.writeFileSync(REPORT_FILE, JSON.stringify(updated, null, 2));
  }
}
