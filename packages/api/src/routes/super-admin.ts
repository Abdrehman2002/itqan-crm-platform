import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient, TenantService } from '@crm/core';
import type { Plan } from '@crm/shared';
import { requireRole } from '../middlewares/auth.middleware';
import { EmailService } from '../services/email.service';

// Full module catalog — single source of truth shared with the frontend
export const MODULE_CATALOG = [
  { key: 'crm',          label: 'Core CRM',           description: 'Contacts, companies, deals, activities and analytics. Always included.',           always: true,  included_in_plans: ['free','starter','professional','enterprise'] },
  { key: 'ticketing',    label: 'Ticketing',           description: 'Support tickets, SLA management, escalations, queues and CSAT surveys.',           always: false, included_in_plans: ['starter','professional','enterprise'] },
  { key: 'voice',        label: 'Voice Calls',         description: 'Inbound and outbound call logging, recordings and agent call management.',          always: false, included_in_plans: ['professional','enterprise'] },
  { key: 'voicebot',     label: 'Voice Bot (AI)',      description: 'AI-powered SIP/IVR voice bot for automated customer interactions.',                 always: false, included_in_plans: ['enterprise'] },
  { key: 'emails',       label: 'Email Inbox',         description: 'Shared team email inbox with assignment, threading and SLA tracking.',              always: false, included_in_plans: ['starter','professional','enterprise'] },
  { key: 'integrations', label: 'Integrations',        description: 'SMS gateways, webhooks, Zapier/Make connectors and third-party API bridges.',       always: false, included_in_plans: ['professional','enterprise'] },
  { key: 'analytics',    label: 'Advanced Analytics',  description: 'Cross-module reports, heatmaps, funnels and department performance dashboards.',    always: false, included_in_plans: ['professional','enterprise'] },
] as const;
export type ModuleKey = typeof MODULE_CATALOG[number]['key'];
export const ALL_MODULE_KEYS = MODULE_CATALOG.map(m => m.key) as ModuleKey[];

const RolePayloadSchema = z.object({
  base_role:   z.string(),
  name:        z.string(),
  color:       z.string().optional(),
  permissions: z.record(z.boolean()),
});

const CreateTenantSchema = z.object({
  name:         z.string().min(2),
  slug:         z.string().min(2).regex(/^[a-z0-9-]+$/),
  plan:         z.enum(['free', 'starter', 'professional', 'enterprise']).default('starter'),
  adminEmail:   z.string().email(),
  adminName:    z.string().min(1),
  customDomain: z.string().optional(),
  modules:      z.array(z.enum(ALL_MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).default(['crm']),
  roles:        z.array(RolePayloadSchema).optional(),
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

      // Seed role permissions if provided
      if (body.roles?.length) {
        await db.withSuperAdmin(async (client) => {
          for (const r of body.roles!) {
            await client.query(
              `INSERT INTO roles (tenant_id, name, color, is_system, base_role, permissions)
               VALUES ($1, $2, $3, true, $4, $5)
               ON CONFLICT (tenant_id, base_role) WHERE is_system = true
               DO UPDATE SET permissions = EXCLUDED.permissions, name = EXCLUDED.name`,
              [tenant.id, r.name, r.color ?? '#6366f1', r.base_role, JSON.stringify(r.permissions)],
            );
          }
        });
      }

      // Invalidate cache so the new active_modules are visible immediately
      await tenantService.invalidateCacheById(tenant.id);

      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT * FROM tenants WHERE id = $1', [tenant.id]);
        return r.rows;
      });

      return reply.code(201).send({ success: true, data: updated });
    });

    // ── Edit Workspace (full tenant update) ─────────────────────────────
    // Patch any combination of name, slug, sector, status, plan. Plan still has
    // its own dedicated endpoint for entitlement-side effects, but admins also
    // want a one-shot "Edit Workspace" form.
    fastify.patch('/tenants/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        name:   z.string().min(1).max(120).optional(),
        slug:   z.string().min(2).max(40).regex(/^[a-z0-9-]+$/).optional(),
        sector: z.string().min(1).optional(),
        status: z.enum(['active','suspended','trial']).optional(),
      }).parse(req.body);

      const sets: string[] = ['updated_at = NOW()'];
      const vals: unknown[] = [id];
      let idx = 2;
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) { sets.push(`${k} = $${idx++}`); vals.push(v); }
      }
      if (sets.length === 1) return reply.code(400).send({ success: false, error: { code: 'NO_CHANGES', message: 'No fields to update' } });

      const [t] = await db.withSuperAdmin(async (c) => (await c.query(
        `UPDATE tenants SET ${sets.join(',')} WHERE id = $1 RETURNING id, name, slug, sector, status, plan`,
        vals,
      )).rows);
      if (!t) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } });
      return reply.send({ success: true, data: t });
    });

    // ── Reset password for ANY user in ANY tenant ───────────────────────
    // Lets super admin set a new password for a tenant_admin or sub_admin who
    // forgot theirs or never received their email invite. User can log in
    // immediately with the new password.
    fastify.post('/users/:id/reset-password', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { password } = z.object({ password: z.string().min(8).max(200) }).parse(req.body);
      const hash = await (await import('bcryptjs')).default.hash(password, 12);

      const [u] = await db.withSuperAdmin(async (c) => (await c.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW()
         WHERE id = $2 RETURNING id, email, name, role`,
        [hash, id],
      )).rows);
      if (!u) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return reply.send({ success: true, data: u, message: `Password reset for ${u.email}` });
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

    // GET /super-admin/tenants/:id/roles — fetch this tenant's system role permissions
    fastify.get('/tenants/:id/roles', async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, color, is_system, base_role, permissions
           FROM roles WHERE tenant_id = $1 AND is_system = true ORDER BY base_role`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/tenants/:id/roles — upsert system role permissions for a tenant
    fastify.post('/tenants/:id/roles', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { roles } = z.object({ roles: z.array(RolePayloadSchema) }).parse(req.body);
      await db.withSuperAdmin(async (client) => {
        for (const r of roles) {
          await client.query(
            `INSERT INTO roles (tenant_id, name, color, is_system, base_role, permissions)
             VALUES ($1, $2, $3, true, $4, $5)
             ON CONFLICT (tenant_id, base_role) WHERE is_system = true
             DO UPDATE SET permissions = EXCLUDED.permissions, name = EXCLUDED.name`,
            [id, r.name, r.color ?? '#6366f1', r.base_role, JSON.stringify(r.permissions)],
          );
        }
      });
      return reply.send({ success: true });
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

    // ── Platform Roles (for sub-admins) ──────────────────────────────────────

    // GET /super-admin/platform-roles
    fastify.get('/platform-roles', async (_req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, description, color, permissions, created_at FROM platform_roles ORDER BY created_at`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/platform-roles
    fastify.post('/platform-roles', async (req, reply) => {
      const { name, description, color, permissions } = z.object({
        name:        z.string().min(1),
        description: z.string().optional(),
        color:       z.string().optional(),
        permissions: z.record(z.boolean()),
      }).parse(req.body);
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO platform_roles (name, description, color, permissions)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [name, description ?? null, color ?? '#6366f1', JSON.stringify(permissions)],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // PATCH /super-admin/platform-roles/:id
    fastify.patch('/platform-roles/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { name, description, color, permissions } = z.object({
        name:        z.string().min(1).optional(),
        description: z.string().optional(),
        color:       z.string().optional(),
        permissions: z.record(z.boolean()).optional(),
      }).parse(req.body);
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE platform_roles SET
             name        = COALESCE($2, name),
             description = COALESCE($3, description),
             color       = COALESCE($4, color),
             permissions = COALESCE($5, permissions),
             updated_at  = NOW()
           WHERE id = $1 RETURNING *`,
          [id, name ?? null, description ?? null, color ?? null, permissions ? JSON.stringify(permissions) : null],
        );
        return r.rows;
      });
      if (!row) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Platform role not found' } });
      return reply.send({ success: true, data: row });
    });

    // DELETE /super-admin/platform-roles/:id
    fastify.delete('/platform-roles/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        // Unlink sub-admins before deleting
        await client.query(`UPDATE users SET platform_role_id = NULL WHERE platform_role_id = $1`, [id]);
        await client.query(`DELETE FROM platform_roles WHERE id = $1`, [id]);
      });
      return reply.send({ success: true });
    });

    // ── Sub-Admin Users ───────────────────────────────────────────────────────

    // GET /super-admin/sub-admins
    fastify.get('/sub-admins', async (_req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
                  pr.id AS platform_role_id, pr.name AS platform_role_name, pr.color AS platform_role_color
           FROM users u
           LEFT JOIN platform_roles pr ON u.platform_role_id = pr.id
           WHERE u.role = 'platform_admin'
           ORDER BY u.created_at`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/sub-admins — invite a new sub-admin
    fastify.post('/sub-admins', async (req, reply) => {
      const { name, email, platform_role_id, tenant_id, password } = z.object({
        name:             z.string().min(1),
        email:            z.string().email(),
        platform_role_id: z.string().uuid().optional(),
        tenant_id:        z.string().uuid(),
        // Optional: set login password immediately. Without it, sub-admin
        // would need an email-invite flow (not yet wired for platform users).
        password:         z.string().min(8).max(200).optional(),
      }).parse(req.body);

      const existing = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
        return r.rows[0];
      });
      if (existing) return reply.code(409).send({ success: false, error: { code: 'EMAIL_EXISTS', message: 'A user with this email already exists' } });

      const passwordHash = password
        ? await (await import('bcryptjs')).default.hash(password, 12)
        : 'INVITE_PENDING';

      const [user] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO users (tenant_id, name, email, role, platform_role_id, password_hash, is_active)
           VALUES ($1, $2, $3, 'platform_admin', $4, $5, true)
           RETURNING id, name, email, role, is_active, created_at`,
          [tenant_id, name, email, platform_role_id ?? null, passwordHash],
        );
        return r.rows;
      });
      return reply.code(201).send({
        success: true,
        data: user,
        immediateLogin: !!password,
        message: password ? `${name} can log in now with their email + the password you set.` : `Sub-admin created. Set their password via /super-admin/users/${user.id}/reset-password.`,
      });
    });

    // PATCH /super-admin/sub-admins/:id — update role assignment or active status
    fastify.patch('/sub-admins/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        platform_role_id: z.string().uuid().nullable().optional(),
        is_active:        z.boolean().optional(),
      }).parse(req.body);
      const [user] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE users SET
             platform_role_id = CASE WHEN $2::boolean THEN $3::uuid ELSE platform_role_id END,
             is_active        = COALESCE($4, is_active),
             updated_at       = NOW()
           WHERE id = $1 AND role = 'platform_admin'
           RETURNING id, name, email, role, platform_role_id, is_active`,
          [id, 'platform_role_id' in body, body.platform_role_id ?? null, body.is_active ?? null],
        );
        return r.rows;
      });
      if (!user) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Sub-admin not found' } });
      return reply.send({ success: true, data: user });
    });

    // DELETE /super-admin/sub-admins/:id
    fastify.delete('/sub-admins/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(`DELETE FROM users WHERE id = $1 AND role = 'platform_admin'`, [id]);
      });
      return reply.send({ success: true });
    });

    // ── Entitlement Sync ─────────────────────────────────────────────────────

    // GET /super-admin/sync-entitlements/preview
    // Returns: modules to add per tenant (plan-based) + roles with missing permission keys
    fastify.get('/sync-entitlements/preview', async (_req, reply) => {
      const { defaultPermissions, MODULE_DEFS } = await import('./roles');
      const allPermissionKeys = MODULE_DEFS.flatMap((m) => m.actions.map((a) => a.key));

      const tenants = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, plan, active_modules FROM tenants WHERE status != 'cancelled'`,
        );
        return r.rows;
      });

      const moduleChanges: Array<{ tenant_id: string; tenant_name: string; add_modules: string[] }> = [];
      const roleChanges: Array<{ tenant_id: string; tenant_name: string; roles_affected: number; sample_keys: string[] }> = [];

      for (const tenant of tenants) {
        // Which modules does this plan qualify for that the tenant doesn't have yet?
        const current: string[] = tenant.active_modules ?? [];
        const entitled = MODULE_CATALOG
          .filter((m) => (m.included_in_plans as readonly string[]).includes(tenant.plan))
          .map((m) => m.key);
        const toAdd = entitled.filter((k) => !current.includes(k));
        if (toAdd.length > 0) {
          moduleChanges.push({ tenant_id: tenant.id, tenant_name: tenant.name, add_modules: toAdd });
        }

        // Which roles have missing permission keys?
        const roles = await db.withSuperAdmin(async (client) => {
          const r = await client.query(
            `SELECT id, name, base_role, permissions FROM roles WHERE tenant_id = $1`,
            [tenant.id],
          );
          return r.rows;
        });

        const missingKeysSet = new Set<string>();
        let affectedCount = 0;
        for (const role of roles) {
          const perms: Record<string, boolean> = role.permissions ?? {};
          const missing = allPermissionKeys.filter((k) => !(k in perms));
          if (missing.length > 0) {
            affectedCount++;
            missing.forEach((k) => missingKeysSet.add(k));
          }
        }
        if (affectedCount > 0) {
          roleChanges.push({
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            roles_affected: affectedCount,
            sample_keys: Array.from(missingKeysSet).slice(0, 5),
          });
        }
      }

      return reply.send({ success: true, data: { moduleChanges, roleChanges } });
    });

    // POST /super-admin/sync-entitlements/apply
    fastify.post('/sync-entitlements/apply', async (req, reply) => {
      const { apply_modules, apply_permissions } = z.object({
        apply_modules:     z.boolean().default(true),
        apply_permissions: z.boolean().default(true),
      }).parse(req.body);

      const { defaultPermissions, MODULE_DEFS } = await import('./roles');
      const allPermissionKeys = MODULE_DEFS.flatMap((m) => m.actions.map((a) => a.key));

      const tenants = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, plan, active_modules FROM tenants WHERE status != 'cancelled'`,
        );
        return r.rows;
      });

      let modulesUpdated = 0;
      let rolesUpdated   = 0;
      const tenantsPendingReview: string[] = [];

      for (const tenant of tenants) {
        // ── Module sync ──────────────────────────────────────────────────────
        if (apply_modules) {
          const current: string[] = tenant.active_modules ?? [];
          const entitled = MODULE_CATALOG
            .filter((m) => (m.included_in_plans as readonly string[]).includes(tenant.plan))
            .map((m) => m.key);
          const toAdd = entitled.filter((k) => !current.includes(k));
          if (toAdd.length > 0) {
            const merged = Array.from(new Set([...current, ...toAdd]));
            await db.withSuperAdmin(async (client) => {
              await client.query(
                `UPDATE tenants SET active_modules = $1, updated_at = NOW() WHERE id = $2`,
                [merged, tenant.id],
              );
            });
            modulesUpdated++;
          }
        }

        // ── Permission key sync ──────────────────────────────────────────────
        if (apply_permissions) {
          const roles = await db.withSuperAdmin(async (client) => {
            const r = await client.query(
              `SELECT id, base_role, permissions FROM roles WHERE tenant_id = $1`,
              [tenant.id],
            );
            return r.rows;
          });

          let tenantHadMissing = false;
          for (const role of roles) {
            const perms: Record<string, boolean> = { ...(role.permissions ?? {}) };
            const defaults = defaultPermissions(role.base_role ?? 'viewer');
            const missing  = allPermissionKeys.filter((k) => !(k in perms));
            if (missing.length > 0) {
              missing.forEach((k) => { perms[k] = defaults[k] ?? false; });
              await db.withSuperAdmin(async (client) => {
                await client.query(
                  `UPDATE roles SET permissions = $1, updated_at = NOW() WHERE id = $2`,
                  [JSON.stringify(perms), role.id],
                );
              });
              rolesUpdated++;
              tenantHadMissing = true;
            }
          }

          // Flag tenant for role review
          if (tenantHadMissing) {
            tenantsPendingReview.push(tenant.id);
            await db.withSuperAdmin(async (client) => {
              await client.query(
                `UPDATE tenants
                 SET settings = jsonb_set(COALESCE(settings,'{}'), '{pending_role_review}', 'true')
                 WHERE id = $1`,
                [tenant.id],
              );
            });
          }
        }
      }

      return reply.send({
        success: true,
        data: { modulesUpdated, rolesUpdated, tenantsNotified: tenantsPendingReview.length },
      });
    });

    // Platform-wide metrics (dashboard)
    fastify.get('/metrics', async (_req, reply) => {
      const PLAN_MRR: Record<string, number> = {
        free: 0, starter: 49, professional: 149, enterprise: 499,
      };

      const [tenantStats] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            COUNT(*)                                                          AS total_tenants,
            COUNT(*) FILTER (WHERE status = 'active')                        AS active_tenants,
            COUNT(*) FILTER (WHERE status = 'trial')                         AS trial_tenants,
            COUNT(*) FILTER (WHERE status = 'suspended')                     AS suspended_tenants,
            COUNT(*) FILTER (WHERE plan = 'free')                            AS free_plan,
            COUNT(*) FILTER (WHERE plan = 'starter')                         AS starter_plan,
            COUNT(*) FILTER (WHERE plan = 'professional')                    AS professional_plan,
            COUNT(*) FILTER (WHERE plan = 'enterprise')                      AS enterprise_plan,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_tenants_30d,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')  AS new_tenants_7d
          FROM tenants`);
        return r.rows;
      });

      // MRR estimate from active tenants by plan
      const mrr = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT plan, COUNT(*) AS cnt
          FROM tenants WHERE status = 'active'
          GROUP BY plan`);
        return r.rows.reduce((sum: number, row: any) => {
          return sum + (PLAN_MRR[row.plan] ?? 0) * parseInt(row.cnt);
        }, 0);
      });

      // Total users across all tenants
      const [userStats] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            COUNT(*)                                                          AS total_users,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_users_30d
          FROM users WHERE role != 'super_admin'`);
        return r.rows;
      });

      // Recent 6 tenants
      const recentTenants = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT id, name, slug, plan, status, active_modules, created_at
          FROM tenants ORDER BY created_at DESC LIMIT 6`);
        return r.rows;
      });

      // Growth: new tenants per month for last 6 months
      const monthlyGrowth = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
            COUNT(*) AS count
          FROM tenants
          WHERE created_at > NOW() - INTERVAL '6 months'
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY DATE_TRUNC('month', created_at)`);
        return r.rows;
      });

      // Module adoption: how many tenants have each module
      const moduleAdoption = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT m.module, COUNT(*) AS cnt
          FROM tenants, UNNEST(active_modules) AS m(module)
          WHERE status = 'active'
          GROUP BY m.module ORDER BY cnt DESC`);
        return r.rows;
      });

      return reply.send({
        success: true,
        data: {
          ...tenantStats,
          mrr,
          ...userStats,
          recentTenants,
          monthlyGrowth,
          moduleAdoption,
        },
      });
    });

    // ── Platform Invoices (super admin → tenant billing) ──────────────────────

    // GET /super-admin/platform-invoices
    fastify.get('/platform-invoices', async (req, reply) => {
      const { tenant_id, status, page = 1, pageSize = 20 } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT pi.*, t.name AS tenant_name, t.plan AS tenant_plan,
                  COALESCE(SUM(pp.amount),0) AS amount_paid
           FROM platform_invoices pi
           JOIN tenants t ON pi.tenant_id = t.id
           LEFT JOIN platform_payments pp ON pp.invoice_id = pi.id
           WHERE ($1::uuid IS NULL OR pi.tenant_id = $1)
             AND ($2::text IS NULL OR pi.status = $2)
           GROUP BY pi.id, t.name, t.plan
           ORDER BY pi.created_at DESC
           LIMIT $3 OFFSET $4`,
          [tenant_id ?? null, status ?? null, Number(pageSize), offset],
        );
        return r.rows;
      });

      const [{ count }] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT COUNT(*) FROM platform_invoices
           WHERE ($1::uuid IS NULL OR tenant_id = $1)
             AND ($2::text IS NULL OR status = $2)`,
          [tenant_id ?? null, status ?? null],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: rows, meta: { total: Number(count), page: Number(page), pageSize: Number(pageSize) } });
    });

    // POST /super-admin/platform-invoices
    fastify.post('/platform-invoices', async (req, reply) => {
      const body = z.object({
        tenant_id:    z.string().uuid(),
        period_start: z.string(),
        period_end:   z.string(),
        due_date:     z.string(),
        currency:     z.string().default('GBP'),
        items:        z.array(z.object({
          description: z.string(),
          quantity:    z.number().default(1),
          unit_price:  z.number(),
        })).min(1),
        notes: z.string().optional(),
      }).parse(req.body);

      const amount = body.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

      // Generate sequential invoice number e.g. INV-2026-0042
      const [{ nextval }] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(`SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number,'-',3) AS INT)),0)+1 AS nextval FROM platform_invoices`);
        return r.rows;
      });
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(nextval).padStart(4,'0')}`;

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO platform_invoices (tenant_id, invoice_number, period_start, period_end, due_date, currency, amount, items, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [body.tenant_id, invoiceNumber, body.period_start, body.period_end, body.due_date,
           body.currency, amount, JSON.stringify(body.items), body.notes ?? null],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // PATCH /super-admin/platform-invoices/:id — update status or send
    fastify.patch('/platform-invoices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        status: z.enum(['draft','sent','paid','overdue','cancelled']).optional(),
        notes:  z.string().optional(),
        due_date: z.string().optional(),
      }).parse(req.body);

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE platform_invoices SET
             status   = COALESCE($2, status),
             notes    = COALESCE($3, notes),
             due_date = COALESCE($4, due_date),
             paid_at  = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
             updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [id, body.status ?? null, body.notes ?? null, body.due_date ?? null],
        );
        return r.rows;
      });
      if (!row) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
      return reply.send({ success: true, data: row });
    });

    // DELETE /super-admin/platform-invoices/:id (draft only)
    fastify.delete('/platform-invoices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(`DELETE FROM platform_invoices WHERE id = $1 AND status = 'draft'`, [id]);
      });
      return reply.send({ success: true });
    });

    // POST /super-admin/platform-invoices/:id/send — email invoice to all
    // tenant_admin users of the target tenant + flip status draft → sent.
    fastify.post('/platform-invoices/:id/send', async (req, reply) => {
      const { id } = req.params as { id: string };
      const [inv] = await db.withSuperAdmin(async (c) => (await c.query(
        `SELECT pi.*, t.name AS tenant_name
         FROM platform_invoices pi
         JOIN tenants t ON t.id = pi.tenant_id
         WHERE pi.id = $1`, [id])).rows);
      if (!inv) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });

      const admins = await db.withSuperAdmin(async (c) => (await c.query(
        `SELECT email, name FROM users
         WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true`,
        [inv.tenant_id])).rows);
      if (admins.length === 0) {
        return reply.code(400).send({ success: false, error: { code: 'NO_RECIPIENTS', message: 'No active tenant admins to email this invoice to' } });
      }

      // Render a minimal HTML invoice body — items array is already JSON
      const itemsHtml = (inv.items as any[]).map((i: any) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${i.description ?? '—'}</td><td style="padding:6px 12px;text-align:right;border-bottom:1px solid #eee">${i.quantity ?? 1}</td><td style="padding:6px 12px;text-align:right;border-bottom:1px solid #eee">${inv.currency} ${i.amount ?? 0}</td></tr>`
      ).join('');
      const html = `
        <h2>Invoice ${inv.invoice_number}</h2>
        <p>Billing period: ${inv.period_start} → ${inv.period_end}</p>
        <p>Due: ${inv.due_date}</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:8px 12px;text-align:left">Item</th>
            <th style="padding:8px 12px;text-align:right">Qty</th>
            <th style="padding:8px 12px;text-align:right">Amount</th>
          </tr></thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot><tr>
            <td colspan="2" style="padding:12px;text-align:right;font-weight:600">Total</td>
            <td style="padding:12px;text-align:right;font-weight:700">${inv.currency} ${inv.amount}</td>
          </tr></tfoot>
        </table>
        ${inv.notes ? `<p style="color:#666"><em>${inv.notes}</em></p>` : ''}
      `;

      // Fan-out send. EmailService is constructed per-tenant; for platform-level
      // mail we use the recipient tenant's email config (their own SMTP). Best-effort.
      const emailSvc = new EmailService(db);
      let sentCount = 0;
      for (const a of admins) {
        try {
          await emailSvc.send(inv.tenant_id, {
            to:       a.email,
            toName:   a.name ?? undefined,
            subject:  `Invoice ${inv.invoice_number} — ${inv.currency} ${inv.amount} due ${inv.due_date}`,
            bodyHtml: html,
            bodyText: `Invoice ${inv.invoice_number}\nTotal: ${inv.currency} ${inv.amount}\nDue: ${inv.due_date}`,
          });
          sentCount++;
        } catch { /* per-recipient failure shouldn't abort the batch */ }
      }

      // Flip status draft → sent on first successful send
      if (sentCount > 0 && inv.status === 'draft') {
        await db.withSuperAdmin(async (c) =>
          c.query(`UPDATE platform_invoices SET status='sent', updated_at=NOW() WHERE id=$1`, [id]));
      }

      return reply.send({
        success: true,
        data: { sent_to: sentCount, total_recipients: admins.length },
        message: `Invoice emailed to ${sentCount} of ${admins.length} tenant admin(s)`,
      });
    });

    // POST /super-admin/platform-invoices/:id/payments — record a payment
    fastify.post('/platform-invoices/:id/payments', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        amount:       z.number().positive(),
        payment_date: z.string(),
        method:       z.enum(['bank_transfer','card','cheque','cash','other']).optional(),
        reference:    z.string().optional(),
        notes:        z.string().optional(),
      }).parse(req.body);

      const [invoice] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(`SELECT * FROM platform_invoices WHERE id = $1`, [id]);
        return r.rows;
      });
      if (!invoice) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });

      const [payment] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO platform_payments (invoice_id, tenant_id, amount, currency, payment_date, method, reference, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [id, invoice.tenant_id, body.amount, invoice.currency, body.payment_date,
           body.method ?? null, body.reference ?? null, body.notes ?? null],
        );
        return r.rows;
      });

      // Auto-mark invoice paid if total payments cover the amount
      const [{ total_paid }] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(`SELECT COALESCE(SUM(amount),0) AS total_paid FROM platform_payments WHERE invoice_id=$1`, [id]);
        return r.rows;
      });
      if (Number(total_paid) >= Number(invoice.amount)) {
        await db.withSuperAdmin(async (c) => {
          await c.query(`UPDATE platform_invoices SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE id=$1`, [id]);
        });
      }

      return reply.code(201).send({ success: true, data: payment });
    });

    // GET /super-admin/platform-invoices/:id/payments
    fastify.get('/platform-invoices/:id/payments', async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT * FROM platform_payments WHERE invoice_id = $1 ORDER BY payment_date DESC`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });
  };
}
