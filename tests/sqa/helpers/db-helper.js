/**
 * Vivid CRM — SQA Test Suite
 * DB Helper — direct PostgreSQL access for test setup/teardown
 * Used to: set passwords for invited users, verify RLS, clean test data
 */
import pg from 'pg';

const DB_URL = process.env.TEST_DB_URL || process.env.DATABASE_URL || 'postgresql://mba@localhost:5432/crm_platform';

export class DbHelper {
  constructor() {
    this.pool = new pg.Pool({ connectionString: DB_URL, max: 5 });
  }

  async query(sql, params = []) {
    const client = await this.pool.connect();
    try {
      return (await client.query(sql, params)).rows;
    } finally {
      client.release();
    }
  }

  /** Set a known password hash for a user (bypasses invite flow for testing) */
  async setPassword(tenantId, email, bcryptHash) {
    return this.query(
      `UPDATE users SET password_hash = $1, is_active = true WHERE tenant_id = $2 AND email = $3 RETURNING id`,
      [bcryptHash, tenantId, email]
    );
  }

  /** Get tenant ID by slug */
  async getTenantId(slug) {
    const rows = await this.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    return rows[0]?.id ?? null;
  }

  /** Get user by email in tenant */
  async getUser(tenantId, email) {
    const rows = await this.query(
      `SELECT id, email, role, department, permissions FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email]
    );
    return rows[0] ?? null;
  }

  /** Count records visible with a given tenant context (RLS test) */
  async countWithTenant(tenantId, table) {
    await this.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const rows = await this.query(`SELECT COUNT(*) FROM ${table}`);
    return parseInt(rows[0].count, 10);
  }

  /** Check if a tenant exists */
  async tenantExists(slug) {
    const rows = await this.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    return rows.length > 0;
  }

  async end() {
    await this.pool.end();
  }
}

// Standard test password (meets enterprise policy: 10+ chars, upper, lower, digit, special)
export const TEST_PASSWORD      = 'Test@CRM2026!';
// Pre-computed bcrypt hash for TEST_PASSWORD at cost 12 (generated once to avoid 300ms delay per user)
// Generate fresh with: node -e "const b=require('bcryptjs');b.hash('Test@CRM2026!',12).then(console.log)"
export const TEST_PASSWORD_HASH_PLACEHOLDER = 'GENERATE_AT_RUNTIME';
