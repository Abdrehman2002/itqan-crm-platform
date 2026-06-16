import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../database/client';
import type { RedisClient } from '../config/redis';
import type { Tenant, TenantSettings, Plan } from '@crm/shared';
import { PLAN_LIMITS, PLAN_FEATURES } from '@crm/shared';
import { logger } from '../config/logger';

const TENANT_CACHE_TTL = 300; // 5 minutes

export class TenantService {
  constructor(
    private db: DatabaseClient,
    private redis: RedisClient,
  ) {}

  async create(input: {
    name: string;
    slug: string;
    plan?: Plan;
    adminEmail: string;
    adminName: string;
  }): Promise<Tenant> {
    const plan = input.plan ?? 'trial';
    const settings: TenantSettings = {
      timezone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
      features: PLAN_FEATURES[plan as Plan] ?? PLAN_FEATURES.free,
      limits: PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.free,
    };

    const [tenant] = await this.db.withSuperAdmin(async (client) => {
      const result = await client.query<Tenant>(
        `INSERT INTO tenants (name, slug, plan, status, trial_ends_at, settings)
         VALUES ($1, $2, $3, 'trial', NOW() + INTERVAL '14 days', $4)
         RETURNING *`,
        [input.name, input.slug, plan, JSON.stringify(settings)],
      );
      return result.rows;
    });

    logger.info('Tenant created', { tenantId: tenant.id, slug: input.slug });
    return tenant;
  }

  async findById(id: string): Promise<Tenant | null> {
    const cacheKey = `tenant:${id}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Tenant;

    const [tenant] = await this.db.withSuperAdmin(async (client) => {
      const result = await client.query<Tenant>(
        'SELECT * FROM tenants WHERE id = $1',
        [id],
      );
      return result.rows;
    });

    if (tenant) {
      await this.redis.setex(cacheKey, TENANT_CACHE_TTL, JSON.stringify(tenant));
    }
    return tenant ?? null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const cacheKey = `tenant:slug:${slug}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Tenant;

    const [tenant] = await this.db.withSuperAdmin(async (client) => {
      const result = await client.query<Tenant>(
        'SELECT * FROM tenants WHERE slug = $1',
        [slug],
      );
      return result.rows;
    });

    if (tenant) {
      await this.redis.setex(cacheKey, TENANT_CACHE_TTL, JSON.stringify(tenant));
    }
    return tenant ?? null;
  }

  async findByDomain(domain: string): Promise<Tenant | null> {
    const cacheKey = `tenant:domain:${domain}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Tenant;

    const [tenant] = await this.db.withSuperAdmin(async (client) => {
      const result = await client.query<Tenant>(
        'SELECT * FROM tenants WHERE custom_domain = $1',
        [domain],
      );
      return result.rows;
    });

    if (tenant) {
      await this.redis.setex(cacheKey, TENANT_CACHE_TTL, JSON.stringify(tenant));
    }
    return tenant ?? null;
  }

  async updatePlan(tenantId: string, plan: Plan): Promise<void> {
    const settings = {
      features: PLAN_FEATURES[plan],
      limits: PLAN_LIMITS[plan],
    };

    await this.db.withSuperAdmin(async (client) => {
      await client.query(
        `UPDATE tenants SET plan = $1, settings = settings || $2::jsonb, updated_at = NOW()
         WHERE id = $3`,
        [plan, JSON.stringify(settings), tenantId],
      );
    });

    await this.invalidateCache(tenantId);
    logger.info('Tenant plan updated', { tenantId, plan });
  }

  async suspend(tenantId: string): Promise<void> {
    await this.db.withSuperAdmin(async (client) => {
      await client.query(
        `UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
        [tenantId],
      );
    });
    await this.invalidateCache(tenantId);
  }

  async checkLimit(tenantId: string, metric: string): Promise<{ allowed: boolean; current: number; limit: number }> {
    const tenant = await this.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const limits = tenant.settings.limits as Record<string, number>;
    const limit = limits[metric] ?? 0;
    if (limit === -1) return { allowed: true, current: 0, limit: -1 }; // unlimited

    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `usage:${tenantId}:${metric}:${period}`;
    const cached = await this.redis.get(cacheKey);
    const current = cached ? parseInt(cached) : await this.getUsageFromDb(tenantId, metric, period);

    return { allowed: current < limit, current, limit };
  }

  async incrementUsage(tenantId: string, metric: string, by = 1): Promise<void> {
    const period = new Date().toISOString().slice(0, 7);
    const cacheKey = `usage:${tenantId}:${metric}:${period}`;
    await this.redis.incrby(cacheKey, by);
    await this.redis.expire(cacheKey, 86_400 * 32); // 32 days

    // Async write to DB (fire and forget)
    this.db.query(
      `INSERT INTO usage_metrics (tenant_id, metric, value, period)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, metric, period)
       DO UPDATE SET value = usage_metrics.value + $3, updated_at = NOW()`,
      [tenantId, metric, by, period],
    ).catch((err) => logger.error('Failed to persist usage metric', { error: err.message }));
  }

  private async getUsageFromDb(tenantId: string, metric: string, period: string): Promise<number> {
    const [row] = await this.db.query<{ value: number }>(
      `SELECT value FROM usage_metrics WHERE tenant_id = $1 AND metric = $2 AND period = $3`,
      [tenantId, metric, period],
    );
    return row?.value ?? 0;
  }

  /** Public alias for invalidating a single tenant's cache by ID. */
  async invalidateCacheById(tenantId: string): Promise<void> {
    return this.invalidateCache(tenantId);
  }

  private async invalidateCache(tenantId: string): Promise<void> {
    const tenant = await this.findById(tenantId);
    if (!tenant) return;
    await Promise.all([
      this.redis.del(`tenant:${tenantId}`),
      this.redis.del(`tenant:slug:${tenant.slug}`),
      tenant.customDomain ? this.redis.del(`tenant:domain:${tenant.customDomain}`) : Promise.resolve(),
    ]);
  }
}
