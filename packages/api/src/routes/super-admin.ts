import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, TenantService } from '@crm/core';
import type { Plan } from '@crm/shared';
import { requireRole } from '../middlewares/auth.middleware';

// Full module catalog — single source of truth shared with the frontend
export const MODULE_CATALOG = [
  { key: 'crm',          label: 'Core CRM',           description: 'Contacts, companies, deals, activities and analytics. Always included.',           always: true  },
  { key: 'ticketing',    label: 'Ticketing',           description: 'Support tickets, SLA management, escalations, queues and CSAT surveys.',           always: false },
  { key: 'voice',        label: 'Voice Calls',         description: 'Inbound and outbound call logging, recordings and agent call management.',          always: false },
  { key: 'voicebot',     label: 'Voice Bot (AI)',      description: 'AI-powered SIP/IVR voice bot for automated customer interactions.',                 always: false },
  { key: 'emails',       label: 'Email Inbox',         description: 'Shared team email inbox with assignment, threading and SLA tracking.',              always: false },
  { key: 'integrations', label: 'Integrations',        description: 'SMS gateways, webhooks, Zapier/Make connectors and third-party API bridges.',       always: false },
  { key: 'analytics',    label: 'Advanced Analytics',  description: 'Cross-module reports, heatmaps, funnels and department performance dashboards.',    always: false },
] as const;
export type ModuleKey = typeof MODULE_CATALOG[number]['key'];
export const ALL_MODULE_KEYS = MODULE_CATALOG.map(m => m.key) as ModuleKey[];

const CreateTenantSchema = z.object({
  name:         z.string().min(2),
  slug:         z.string().min(2).regex(/^[a-z0-9-]+$/),
  plan:         z.enum(['free', 'starter', 'professional', 'enterprise']).default('starter'),
  adminEmail:   z.string().email(),
  adminName:    z.string().min(1),
  customDomain: z.string().optional(),
  // Modules this tenant is licensed for (crm always included).
  // Super admin selects these at creation time based on what the customer has paid for.
  modules:      z.array(z.enum(ALL_MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).default(['crm']),
});

export function superAdminRoutes(db: DatabaseClient, tenantService: TenantService) {
  return async function (fastify: FastifyInstance) {
    // All super-admin routes require super_admin role
    fastify.addHook('preHandler', requireRole('super_admin'));

    // List all tenants
    fastify.get('/tenants', async (req, reply) => {
      const QuerySchema = z.object({
        page:     z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
        search:   z.string().max(100).optional(),
        plan:     z.enum(['free', 'starter', 'professional', 'enterprise']).optional(),
        status:   z.enum(['active', 'trial', 'suspended', 'cancelled']).optional(),
      });
      const q = QuerySchema.parse(req.query);
      const offset = (q.page - 1) * q.pageSize;

      // Build parameterised conditions — never interpolate user input into SQL
      const conditions: string[] = ['1=1'];
      const params: any[]        = [];

      if (q.search) {
        params.push(`%${q.search}%`);
        conditions.push(`(name ILIKE $${params.length} OR slug ILIKE $${params.length})`);
      }
      if (q.plan) {
        params.push(q.plan);
        conditions.push(`plan = $${params.length}`);
      }
      if (q.status) {
        params.push(q.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const [{ count }] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT COUNT(*) FROM tenants WHERE ${where}`,
          params,
        );
        return result.rows;
      });

      const tenants = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT t.*,
            (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count,
            (SELECT COUNT(*) FROM contacts WHERE tenant_id = t.id) as contact_count,
            (SELECT COUNT(*) FROM deals WHERE tenant_id = t.id AND status = 'open') as open_deals
           FROM tenants t WHERE ${where.replace(/\bname\b/g, 't.name').replace(/\bslug\b/g, 't.slug').replace(/\bplan\b/g, 't.plan').replace(/\bstatus\b/g, 't.status')}
           ORDER BY t.created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, q.pageSize, offset],
        );
        return result.rows;
      });

      return reply.send({
        success: true,
        data: tenants,
        meta: { total: parseInt(count), page: q.page, pageSize: q.pageSize },
      });
    });

    // Get tenant details + usage
    fastify.get('/tenants/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query('SELECT * FROM tenants WHERE id = $1', [id]);
        return result.rows;
      });
      if (!tenant) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } });

      const usage = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT metric, value, period FROM usage_metrics
           WHERE tenant_id = $1 AND period = $2`,
          [id, new Date().toISOString().slice(0, 7)],
        );
        return result.rows;
      });

      return reply.send({ success: true, data: { ...tenant, usage } });
    });

    // Full module catalog — so the frontend can render it without hard-coding
    fastify.get('/modules', async (_req, reply) => {
      return reply.send({ success: true, data: MODULE_CATALOG });
    });

    // Create tenant (when a new customer signs up)
    fastify.post('/tenants', async (req, reply) => {
      const body = CreateTenantSchema.parse(req.body);

      const tenant = await tenantService.create({
        name: body.name,
        slug: body.slug,
        plan: body.plan as Plan,
        adminEmail: body.adminEmail,
        adminName: body.adminName,
      });

      // Apply licensed modules (always include 'crm')
      const licensedModules = Array.from(new Set(['crm', ...body.modules]));
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants SET active_modules = $1 WHERE id = $2`,
          [licensedModules, tenant.id],
        );
        if (body.customDomain) {
          await client.query('UPDATE tenants SET custom_domain = $1 WHERE id = $2', [body.customDomain, tenant.id]);
        }
      });

      // Invalidate cache so the new active_modules are visible immediately
      await tenantService.invalidateCacheById(tenant.id);

      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT * FROM tenants WHERE id = $1', [tenant.id]);
        return r.rows;
      });

      return reply.code(201).send({ success: true, data: updated });
    });

    // Upgrade / downgrade plan
    fastify.patch('/tenants/:id/plan', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { plan } = req.body as { plan: Plan };
      await tenantService.updatePlan(id, plan);
      return reply.send({ success: true, message: `Plan updated to ${plan}` });
    });

    // Update licensed modules for a tenant (super admin sets the ceiling)
    // e.g. PATCH /super-admin/tenants/:id/modules { "modules": ["crm","voice","ticketing"] }
    fastify.patch('/tenants/:id/modules', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        modules: z.array(z.string()).min(1),
      }).parse(req.body);

      // Always ensure 'crm' is included
      const licensedModules = Array.from(new Set(['crm', ...body.modules]));

      await db.withSuperAdmin(async (client) => {
        // Update licensed modules
        await client.query(
          `UPDATE tenants SET active_modules = $1, updated_at = NOW() WHERE id = $2`,
          [licensedModules, id],
        );
        // Prune any now-unlicensed modules from the tenant admin's enabled_modules setting
        // so tenants can't retain access to modules that were revoked
        const [row] = (await client.query(`SELECT settings FROM tenants WHERE id = $1`, [id])).rows;
        const settings = row?.settings ?? {};
        if (settings.enabled_modules) {
          settings.enabled_modules = (settings.enabled_modules as string[]).filter(
            (m: string) => licensedModules.includes(m),
          );
          await client.query(
            `UPDATE tenants SET settings = $1 WHERE id = $2`,
            [JSON.stringify(settings), id],
          );
        }
      });

      // Invalidate tenant cache
      await tenantService.invalidateCacheById(id);
      return reply.send({ success: true, data: { licensedModules } });
    });

    // Suspend tenant
    fastify.post('/tenants/:id/suspend', async (req, reply) => {
      const { id } = req.params as { id: string };
      await tenantService.suspend(id);
      return reply.send({ success: true });
    });

    // Reactivate tenant
    fastify.post('/tenants/:id/activate', async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(`UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1`, [id]);
      });
      return reply.send({ success: true });
    });

    // Platform-wide metrics
    fastify.get('/metrics', async (req, reply) => {
      const [metrics] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(`
          SELECT
            COUNT(*) as total_tenants,
            COUNT(*) FILTER (WHERE status = 'active') as active_tenants,
            COUNT(*) FILTER (WHERE status = 'trial') as trial_tenants,
            COUNT(*) FILTER (WHERE plan = 'free') as free_plan,
            COUNT(*) FILTER (WHERE plan = 'starter') as starter_plan,
            COUNT(*) FILTER (WHERE plan = 'professional') as professional_plan,
            COUNT(*) FILTER (WHERE plan = 'enterprise') as enterprise_plan,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_tenants_30d
          FROM tenants`);
        return result.rows;
      });

      return reply.send({ success: true, data: metrics });
    });
  };
}
