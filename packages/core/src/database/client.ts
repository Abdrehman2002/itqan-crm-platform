import { Pool, PoolClient } from 'pg';
import { logger } from '../config/logger';

export class DatabaseClient {
  private pool: Pool;

  constructor(connectionString: string) {
    // Managed Postgres (e.g. Supabase) requires TLS, but its pooler presents a
    // certificate that isn't in the default CA chain. Encrypt without strict
    // verification for Supabase; plain/local Postgres connects without SSL.
    const useSsl = /supabase\.(co|com)/.test(connectionString) || process.env.DATABASE_SSL === 'require';
    this.pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message });
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
    logger.info('Database connected');
  }

  // Returns a connection scoped to the given tenant.
  //
  // RLS policies on tenant-scoped tables read `app.tenant_id` and only return
  // rows where tenant_id matches. That works when the DB role respects RLS.
  // In production with the Supabase pooler the connecting role often has
  // BYPASSRLS, which makes RLS a no-op — that's where we saw 17 + 7 + 1
  // cross-workspace user rows leaking through `/api/v1/settings/team`.
  //
  // Two-part defence:
  //   1. SET LOCAL app.bypass_rls = 'off' here so any policy that has an
  //      OR-bypass branch (see migration 035) collapses to the tenant_id check.
  //   2. Application code MUST also pass an explicit `WHERE x.tenant_id = $1`
  //      in every query — the BYPASSRLS attribute on the role is a deployment
  //      configuration we don't control from here, so the application can't
  //      assume RLS will catch a missing filter.
  async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(`SET LOCAL app.bypass_rls = 'off'`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // For super-admin queries that bypass tenant isolation
  async withSuperAdmin<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.bypass_rls = 'on'`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
