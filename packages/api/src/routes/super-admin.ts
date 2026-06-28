import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { DatabaseClient, TenantService } from '@crm/core';
import type { Plan } from '@crm/shared';
import { requireRole } from '../middlewares/auth.middleware';
import { defaultPermissions } from './roles';
import { ensureDefaultPipeline } from '../lib/default-pipeline';
import { sendSystemEmail, type SystemEmailResult } from '../lib/system-email';

// The four standard roles auto-seeded into every new workspace. Their default
// permissions come from defaultPermissions(); the tenant admin tailors them later.
const SYSTEM_ROLES_SEED = [
  { base_role: 'tenant_admin', name: 'Admin',   color: '#dc2626' },
  { base_role: 'manager',      name: 'Manager', color: '#d97706' },
  { base_role: 'agent',        name: 'Agent',   color: '#2563eb' },
  { base_role: 'viewer',       name: 'Viewer',  color: '#6b7280' },
];

// Full module catalog — the SINGLE SOURCE OF TRUTH shared with the frontend.
//
// Each module lists its `features` (the functional areas inside it). At workspace
// creation the super admin allocates modules + the specific features agreed with the
// customer. To offer a NEW module in future, add it here with its features — it then
// flows automatically into the creation selection, with no other code changes.
export const MODULE_CATALOG = [
  { key: 'crm', label: 'Core CRM', always: true, included_in_plans: ['free','starter','professional','enterprise'],
    description: 'The core customer record: contacts, companies, deals and activities.',
    features: [
      { key: 'crm.contacts',   label: 'Contacts' },
      { key: 'crm.companies',  label: 'Companies' },
      { key: 'crm.deals',      label: 'Deals & Pipeline' },
      { key: 'crm.activities', label: 'Activities & Tasks' },
    ] },
  { key: 'sales', label: 'Sales & Invoicing', always: false, included_in_plans: ['professional','enterprise'],
    description: 'Quote-to-cash: invoicing, payments and sales reporting.',
    features: [
      { key: 'sales.invoices',  label: 'Invoices' },
      { key: 'sales.contacts',  label: 'Billing Contacts' },
      { key: 'sales.payments',  label: 'Payments' },
      { key: 'sales.reports',   label: 'Sales Reports' },
      { key: 'sales.templates', label: 'Invoice Templates' },
      { key: 'sales.settings',  label: 'Sales Settings' },
    ] },
  { key: 'emails', label: 'Email Inbox', always: false, included_in_plans: ['starter','professional','enterprise'],
    description: 'Shared team email inbox with assignment, threading and SLA tracking.',
    features: [
      { key: 'emails.inbox',   label: 'Shared Inbox' },
      { key: 'emails.compose', label: 'Compose & Reply' },
    ] },
  { key: 'integrations', label: 'Integrations', always: false, included_in_plans: ['professional','enterprise'],
    description: 'SMS gateways, webhooks, Zapier/Make connectors and third-party API bridges.',
    features: [
      { key: 'integrations.connectors', label: 'Connectors & Apps' },
      { key: 'integrations.webhooks',   label: 'Webhooks & API' },
    ] },
  { key: 'analytics', label: 'Advanced Analytics', always: false, included_in_plans: ['professional','enterprise'],
    description: 'Cross-module reports, heatmaps, funnels and department performance dashboards.',
    features: [
      { key: 'analytics.reports', label: 'Reports & Dashboards' },
      { key: 'analytics.export',  label: 'Data Export' },
    ] },
] as const;
export type ModuleKey = typeof MODULE_CATALOG[number]['key'];
export const ALL_MODULE_KEYS = MODULE_CATALOG.map(m => m.key) as ModuleKey[];
// Flat list of every valid feature key — used to validate entitlement payloads.
export const ALL_FEATURE_KEYS = MODULE_CATALOG.flatMap(m => m.features.map(f => f.key)) as string[];

const RolePayloadSchema = z.object({
  base_role:   z.string(),
  name:        z.string(),
  color:       z.string().optional(),
  permissions: z.record(z.boolean()),
});

const CreateTenantSchema = z.object({
  name:          z.string().min(2),
  slug:          z.string().min(2).regex(/^[a-z0-9-]+$/),
  plan:          z.enum(['free', 'starter', 'professional', 'enterprise']).default('starter'),
  adminEmail:    z.string().email(),
  adminName:     z.string().min(1),
  // Optional — if omitted a secure temporary password is generated and returned once.
  adminPassword: z.string().min(8).optional(),
  customDomain:  z.string().optional(),
  modules:       z.array(z.enum(ALL_MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).default(['crm']),
  // The agreed feature-areas within the licensed modules (e.g. ['crm.contacts','sales.invoices']).
  entitledFeatures: z.array(z.string()).default([]),
  roles:         z.array(RolePayloadSchema).optional(),
});

// Generate a readable but strong temporary password e.g. "Wм-7Kp2q-Rt9x".
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${block()}-${block()}-${block()}`;
}

// Use the shared system mailer. The old local copy returned bare booleans which
// meant call sites could only say "email didn't go" — no way to tell the
// super-admin whether the SendGrid key was missing, the sender wasn't verified,
// SMTP auth failed, etc. The shared lib now returns SystemEmailResult with a
// userMessage we can surface verbatim.

export function superAdminRoutes(db: DatabaseClient, tenantService: TenantService) {
  return async function (fastify: FastifyInstance) {
    // All super-admin routes require super_admin role
    fastify.addHook('preHandler', requireRole('super_admin'));

    // List all tenants
    fastify.get('/tenants', async (req, reply) => {
      const QuerySchema = z.object({
        page:     z.coerce.number().int().min(1).default(1),
        // Bumped from 100 → 500 because the frontend dropdowns (Settings filter,
        // sub-admin create, reports) all ask for pageSize=200 to load the full
        // workspace list at once. With the old cap the requests 400'd and the
        // dropdowns silently rendered empty.
        pageSize: z.coerce.number().int().min(1).max(500).default(25),
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

      // Validate & normalise the entitled features against the catalog, then derive
      // which top-level modules are licensed (a module is licensed if ≥1 of its
      // features was selected). 'crm' is always included.
      const entitledFeatures = body.entitledFeatures.filter((f) => ALL_FEATURE_KEYS.includes(f));
      const modulesFromFeatures = MODULE_CATALOG
        .filter((m) => m.features.some((f) => entitledFeatures.includes(f.key)))
        .map((m) => m.key as string);
      const licensedModules = Array.from(new Set(['crm', ...body.modules, ...modulesFromFeatures]));

      const tenant = await tenantService.create({
        name: body.name,
        slug: body.slug,
        plan: body.plan as Plan,
        adminEmail: body.adminEmail,
        adminName: body.adminName,
      });

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants SET active_modules = $1, entitled_features = $2 WHERE id = $3`,
          [licensedModules, JSON.stringify(entitledFeatures), tenant.id],
        );
        if (body.customDomain) {
          await client.query('UPDATE tenants SET custom_domain = $1 WHERE id = $2', [body.customDomain, tenant.id]);
        }
      });

      // Auto-seed the standard system roles with sensible default permissions.
      // The super admin only licenses modules/features — deciding who (Manager/Agent/
      // Viewer) may do what inside them is the tenant admin's job, done later in Roles.
      // If an explicit roles payload is supplied (legacy), it overrides the defaults.
      const rolesToSeed = body.roles?.length
        ? body.roles
        : SYSTEM_ROLES_SEED.map((r) => ({ ...r, permissions: defaultPermissions(r.base_role) }));
      await db.withSuperAdmin(async (client) => {
        for (const r of rolesToSeed) {
          await client.query(
            `INSERT INTO roles (tenant_id, name, color, is_system, base_role, permissions)
             VALUES ($1, $2, $3, true, $4, $5)
             ON CONFLICT (tenant_id, base_role) WHERE is_system = true
             DO UPDATE SET permissions = EXCLUDED.permissions, name = EXCLUDED.name`,
            [tenant.id, r.name, r.color ?? '#6366f1', r.base_role, JSON.stringify(r.permissions)],
          );
        }
      });

      // Seed a default sales pipeline so the Deals feature (and sales-ticket →
      // deal conversion) works from day one. Without this, convert-to-deal fails.
      await db.withSuperAdmin(async (client) => {
        await ensureDefaultPipeline(client, tenant.id);
      });

      // Provision the first tenant admin so the new customer can log in immediately.
      // If no password was supplied, generate a temporary one and return it once.
      const tempPassword = body.adminPassword ?? generateTempPassword();
      const bcrypt = (await import('bcryptjs')).default;
      const adminHash = await bcrypt.hash(tempPassword, 12);
      const [adminUser] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO users (tenant_id, name, email, role, password_hash, is_active)
           VALUES ($1, $2, $3, 'tenant_admin', $4, true)
           RETURNING id, name, email, role`,
          [tenant.id, body.adminName, body.adminEmail, adminHash],
        );
        await client.query(
          `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
           VALUES ($1, $2, 'created', $3, $4) ON CONFLICT DO NOTHING`,
          [tenant.id, r.rows[0]?.id, (req as any).user?.userId, 'Tenant admin created at workspace setup'],
        ).catch(() => {}); // log table optional
        return r.rows;
      });

      // Invalidate cache so the new active_modules are visible immediately
      await tenantService.invalidateCacheById(tenant.id);

      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT * FROM tenants WHERE id = $1', [tenant.id]);
        return r.rows;
      });

      // Email the temporary password to the new admin — non-blocking, but the
      // failure reason is surfaced back to the super-admin so they can act on it
      // (e.g. "SENDGRID_SENDER → verify amanaCX@vividsns.com in SendGrid first").
      const wasAutoGenerated = !body.adminPassword;
      let emailResult: SystemEmailResult = { sent: false };
      if (wasAutoGenerated) {
        const loginUrl = `${process.env.APP_URL ?? 'http://localhost:5173'}/login`;
        emailResult = await sendSystemEmail({
          to: body.adminEmail,
          toName: body.adminName,
          subject: `Your ${body.name} workspace is ready`,
          bodyHtml: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
              <div style="text-align:center;margin-bottom:28px;">
                <div style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#4D8B3C);border-radius:16px;padding:14px 18px;">
                  <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px;">Vivid CRM</span>
                </div>
              </div>
              <div style="background:#fff;border-radius:10px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
                <h2 style="margin:0 0 8px;color:#111827;font-size:22px;">Your workspace is ready 🎉</h2>
                <p style="color:#6b7280;margin:0 0 20px;line-height:1.6;">Hi ${body.adminName}, your <strong>${body.name}</strong> workspace has been set up on Vivid CRM. Here are your login details:</p>
                <table style="border-collapse:collapse;margin:0 0 24px;width:100%;">
                  <tr><td style="padding:6px 12px 6px 0;color:#6b7280;width:160px;">Workspace</td><td style="font-weight:600;color:#111827;">${body.name}</td></tr>
                  <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Email</td><td style="color:#111827;">${body.adminEmail}</td></tr>
                  <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Temporary Password</td><td><span style="font-family:monospace;font-size:1.05em;background:#fef3c7;padding:3px 10px;border-radius:4px;color:#92400e;">${tempPassword}</span></td></tr>
                </table>
                <div style="text-align:center;margin-bottom:24px;">
                  <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#1a8cbf);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:8px;box-shadow:0 4px 14px rgba(41,171,226,0.35);">
                    Log In to ${body.name}
                  </a>
                </div>
                <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center;">Or visit: <a href="${loginUrl}" style="color:#29ABE2;">${loginUrl}</a></p>
                <p style="color:#ef4444;font-size:12px;margin:16px 0 0;text-align:center;">Please change your password immediately after logging in.</p>
              </div>
              <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:20px;">© ${new Date().getFullYear()} Vivid Solutions &amp; Services.</p>
            </div>
          `,
          bodyText: `Hi ${body.adminName},\n\nYour workspace "${body.name}" is ready.\n\nEmail: ${body.adminEmail}\nTemporary Password: ${tempPassword}\n\nLog in here: ${loginUrl}\n\nPlease change your password immediately after logging in.`,
        });
      }

      // Log the technical detail server-side; only the user-friendly message
      // travels back to the browser.
      if (wasAutoGenerated && !emailResult.sent) {
        fastify.log.warn({ emailResult, to: body.adminEmail }, 'workspace welcome email failed');
      }

      return reply.code(201).send({
        success: true,
        data: {
          ...updated,
          admin: adminUser,
          // Only echo the temp password back to the screen when (a) we generated it AND
          // (b) the welcome email could not be delivered. Otherwise the credential lives
          // in the inbox of the new admin, not in the super admin's browser history.
          tempPassword: wasAutoGenerated && !emailResult.sent ? tempPassword : undefined,
          emailSent: emailResult.sent,
          emailErrorCode: emailResult.errorCode ?? null,
          emailErrorMessage: emailResult.userMessage ?? null,
          adminEmail: body.adminEmail,
        },
      });
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

    // Reset the tenant admin password — generates a new temp password, updates the user,
    // emails it to the admin, and returns it in the response for the super admin to relay.
    fastify.post('/tenants/:id/reset-admin-password', async (req, reply) => {
      const { id } = req.params as { id: string };

      const [adminUser] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, email FROM users WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true ORDER BY created_at LIMIT 1`,
          [id],
        );
        return r.rows;
      });

      if (!adminUser) {
        return reply.status(404).send({ success: false, error: 'No active tenant admin found for this workspace' });
      }

      const newPassword = generateTempPassword();
      const bcrypt = (await import('bcryptjs')).default;
      const newHash = await bcrypt.hash(newPassword, 12);

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
          [newHash, adminUser.id],
        );
        await client.query(
          `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
           VALUES ($1, $2, 'reset', $3, $4) ON CONFLICT DO NOTHING`,
          [id, adminUser.id, (req as any).user?.userId, 'Password reset by super admin'],
        ).catch(() => {});
      });

      const emailResult = await sendSystemEmail({
        to: adminUser.email,
        toName: adminUser.name,
        subject: 'Your admin password has been reset',
        bodyHtml: `
          <p>Hi ${adminUser.name},</p>
          <p>Your admin password has been reset by the platform administrator. Please log in with the new temporary password below and change it immediately.</p>
          <p style="margin:16px 0;">
            <strong>New Temporary Password: </strong>
            <span style="font-family:monospace;font-size:1.1em;background:#fef3c7;padding:2px 8px;border-radius:4px;">${newPassword}</span>
          </p>
          <p>If you did not request this, contact your platform provider immediately.</p>
        `,
        bodyText: `Hi ${adminUser.name},\n\nYour admin password has been reset.\n\nNew Temporary Password: ${newPassword}\n\nPlease log in and change it immediately.`,
      });
      if (!emailResult.sent) fastify.log.warn({ emailResult, to: adminUser.email }, 'reset-admin-password email failed');

      return reply.send({
        success: true,
        data: {
          tempPassword: newPassword,
          emailSent: emailResult.sent,
          emailErrorCode: emailResult.errorCode ?? null,
          emailErrorMessage: emailResult.userMessage ?? null,
          adminEmail: adminUser.email,
        },
      });
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
      const { name, email, platform_role_id, tenant_id } = z.object({
        name:             z.string().min(1),
        email:            z.string().email(),
        platform_role_id: z.string().uuid().optional(),
        tenant_id:        z.string().uuid(),
      }).parse(req.body);

      const existing = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
        return r.rows[0];
      });
      if (existing) return reply.code(409).send({ success: false, error: { code: 'EMAIL_EXISTS', message: 'A user with this email already exists' } });

      const [user] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO users (tenant_id, name, email, role, platform_role_id, is_active)
           VALUES ($1, $2, $3, 'platform_admin', $4, true)
           RETURNING id, name, email, role, is_active, created_at`,
          [tenant_id, name, email, platform_role_id ?? null],
        );
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: user });
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

      // All 5 queries run in parallel inside a single connection — no sequential round-trips
      const result = await db.withSuperAdmin(async (client) => {
        const [tenantR, mrrR, userR, recentR, growthR, moduleR] = await Promise.all([
          client.query(`
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
            FROM tenants`),
          client.query(`SELECT plan, COUNT(*) AS cnt FROM tenants WHERE status = 'active' GROUP BY plan`),
          client.query(`
            SELECT
              COUNT(*)                                                          AS total_users,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_users_30d
            FROM users WHERE role != 'super_admin'`),
          client.query(`SELECT id, name, slug, plan, status, active_modules, created_at FROM tenants ORDER BY created_at DESC LIMIT 6`),
          client.query(`
            SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month, COUNT(*) AS count
            FROM tenants WHERE created_at > NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', created_at) ORDER BY DATE_TRUNC('month', created_at)`),
          client.query(`
            SELECT m.module, COUNT(*) AS cnt FROM tenants, UNNEST(active_modules) AS m(module)
            WHERE status = 'active' GROUP BY m.module ORDER BY cnt DESC`),
        ]);

        const mrr = mrrR.rows.reduce((sum: number, row: any) => sum + (PLAN_MRR[row.plan] ?? 0) * parseInt(row.cnt), 0);

        return {
          ...tenantR.rows[0],
          mrr,
          ...userR.rows[0],
          recentTenants:  recentR.rows,
          monthlyGrowth:  growthR.rows,
          moduleAdoption: moduleR.rows,
        };
      });

      return reply.send({ success: true, data: result });
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

    // PATCH /super-admin/platform-invoices/:id — full edit OR status-only change.
    // Line items + amount only editable while status='draft' (sent invoices are immutable).
    fastify.patch('/platform-invoices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        status:       z.enum(['draft','sent','paid','overdue','cancelled']).optional(),
        notes:        z.string().optional(),
        due_date:     z.string().optional(),
        period_start: z.string().optional(),
        period_end:   z.string().optional(),
        currency:     z.string().optional(),
        items:        z.array(z.object({
          description: z.string(),
          quantity:    z.number().default(1),
          unit_price:  z.number(),
        })).min(1).optional(),
      }).parse(req.body);

      // If items are being edited, only allow on draft and recompute amount.
      if (body.items) {
        const [current] = await db.withSuperAdmin(async (c) => {
          const r = await c.query('SELECT status FROM platform_invoices WHERE id = $1', [id]);
          return r.rows;
        });
        if (!current) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
        if (current.status !== 'draft') {
          return reply.code(400).send({ success: false, error: { code: 'INVOICE_LOCKED', message: 'Line items can only be edited on draft invoices.' } });
        }
      }
      const amount = body.items
        ? body.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
        : null;

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE platform_invoices SET
             status       = COALESCE($2, status),
             notes        = COALESCE($3, notes),
             due_date     = COALESCE($4, due_date),
             period_start = COALESCE($5, period_start),
             period_end   = COALESCE($6, period_end),
             currency     = COALESCE($7, currency),
             items        = COALESCE($8::jsonb, items),
             amount       = COALESCE($9, amount),
             paid_at      = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
             updated_at   = NOW()
           WHERE id = $1 RETURNING *`,
          [
            id,
            body.status ?? null,
            body.notes ?? null,
            body.due_date ?? null,
            body.period_start ?? null,
            body.period_end ?? null,
            body.currency ?? null,
            body.items ? JSON.stringify(body.items) : null,
            amount,
          ],
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

    // PATCH /super-admin/tenants/:id — edit workspace name / slug / sector / status
    fastify.patch('/tenants/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const EditSchema = z.object({
        name:   z.string().min(2).optional(),
        sector: z.string().optional(),
        status: z.enum(['active','trial','suspended','cancelled']).optional(),
      });
      const body = EditSchema.parse(req.body);
      const sets: string[] = [];
      const vals: any[] = [];
      if (body.name   !== undefined) { vals.push(body.name);   sets.push(`name = $${vals.length}`); }
      if (body.sector !== undefined) { vals.push(body.sector); sets.push(`sector = $${vals.length}`); }
      // tenants table has BOTH status (text) and is_active (bool) — keep them in sync,
      // otherwise the listing (reads status) and auth checks (read is_active) drift apart.
      if (body.status !== undefined) {
        vals.push(body.status);                sets.push(`status = $${vals.length}`);
        vals.push(body.status === 'active');   sets.push(`is_active = $${vals.length}`);
      }
      if (!sets.length) return reply.code(400).send({ success: false, error: { code: 'NO_FIELDS', message: 'Nothing to update' } });
      vals.push(id);
      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
        return r.rows;
      });
      if (!updated) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } });
      await tenantService.invalidateCacheById(id);
      return reply.send({ success: true, data: updated });
    });

    // DELETE /super-admin/tenants/:id — delete workspace
    fastify.delete('/tenants/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query('DELETE FROM tenants WHERE id = $1', [id]);
      });
      await tenantService.invalidateCacheById(id);
      return reply.send({ success: true });
    });

    // GET /super-admin/tenants/:id/users — list all users in a tenant
    fastify.get('/tenants/:id/users', async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await db.withSuperAdmin(async (client) => {
        // users table has is_active (bool), no status column — synthesize for the UI
        const r = await client.query(
          `SELECT id, name, email, role,
                  CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
                  is_active, created_at, last_login_at
             FROM users WHERE tenant_id = $1 ORDER BY role, name`,
          [id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // POST /super-admin/tenants/:id/users — create a user (tenant_admin) in a workspace
    fastify.post('/tenants/:id/users', async (req, reply) => {
      const { id } = req.params as { id: string };
      const CreateUserSchema = z.object({
        name:     z.string().min(1),
        email:    z.string().email(),
        role:     z.string().default('admin'),
        password: z.string().min(8),
      });
      const body = CreateUserSchema.parse(req.body);
      const bcrypt = (await import('bcryptjs')).default;
      const hash = await bcrypt.hash(body.password, 12);
      const [user] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO users (tenant_id, name, email, role, password_hash, is_active)
           VALUES ($1, $2, $3, $4, $5, true) RETURNING id, name, email, role, is_active, created_at`,
          [id, body.name, body.email, body.role, hash],
        );
        // Log password creation
        await client.query(
          `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
           VALUES ($1, $2, 'created', $3, $4)
           ON CONFLICT DO NOTHING`,
          [id, r.rows[0]?.id, (req as any).user?.userId, `Password set at account creation`],
        ).catch(() => {}); // table may not exist yet — fail silently
        return r.rows;
      });
      return reply.code(201).send({ success: true, data: user });
    });

    // PATCH /super-admin/users/:uid — edit user (name, email, role, password)
    fastify.patch('/users/:uid', async (req, reply) => {
      const { uid } = req.params as { uid: string };
      const EditUserSchema = z.object({
        name:     z.string().min(1).optional(),
        email:    z.string().email().optional(),
        role:     z.string().optional(),
        password: z.string().min(8).optional(),
        status:   z.enum(['active','inactive']).optional(),
      });
      const body = EditUserSchema.parse(req.body);
      const sets: string[] = [];
      const vals: any[] = [];
      if (body.name   !== undefined) { vals.push(body.name);   sets.push(`name = $${vals.length}`); }
      if (body.email  !== undefined) { vals.push(body.email);  sets.push(`email = $${vals.length}`); }
      if (body.role   !== undefined) { vals.push(body.role);   sets.push(`role = $${vals.length}`); }
      if (body.status !== undefined) { vals.push(body.status === 'active'); sets.push(`is_active = $${vals.length}`); }
      if (body.password !== undefined) {
        const bcrypt = (await import('bcryptjs')).default;
        const hash = await bcrypt.hash(body.password, 12);
        vals.push(hash);
        sets.push(`password_hash = $${vals.length}`);
      }
      if (!sets.length) return reply.code(400).send({ success: false, error: { code: 'NO_FIELDS', message: 'Nothing to update' } });
      vals.push(uid);
      const [updated] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, name, email, role, is_active`,
          vals,
        );
        if (body.password && r.rows[0]) {
          const u = r.rows[0];
          await client.query(
            `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
             SELECT tenant_id, id, 'reset', $2, 'Password reset by Super Admin'
             FROM users WHERE id = $1`,
            [uid, (req as any).user?.userId],
          ).catch(() => {});
        }
        return r.rows;
      });
      if (!updated) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return reply.send({ success: true, data: updated });
    });

    // POST /super-admin/users/:uid/regenerate-password — auto-generate temp pw + email it.
    // Works for ANY role (agent, manager, tenant_admin, sub-admin). Falls back to
    // showing the pw on screen if no system email is configured.
    fastify.post('/users/:uid/regenerate-password', async (req, reply) => {
      const { uid } = req.params as { uid: string };
      const [u] = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT id, tenant_id, name, email FROM users WHERE id = $1', [uid]);
        return r.rows;
      });
      if (!u) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

      const newPassword = generateTempPassword();
      const bcrypt = (await import('bcryptjs')).default;
      const newHash = await bcrypt.hash(newPassword, 12);

      await db.withSuperAdmin(async (c) => {
        await c.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, uid]);
        await c.query(
          `INSERT INTO super_admin_password_log (tenant_id, user_id, action, changed_by, notes)
           VALUES ($1, $2, 'regenerated', $3, $4) ON CONFLICT DO NOTHING`,
          [u.tenant_id, uid, (req as any).user?.userId, 'Password regenerated by super admin'],
        ).catch(() => {});
      });

      const emailResult = await sendSystemEmail({
        to: u.email,
        toName: u.name,
        subject: 'Your password has been reset',
        bodyHtml: `
          <p>Hi ${u.name},</p>
          <p>Your password has been reset by the platform administrator. Please log in with the new temporary password below and change it immediately.</p>
          <p style="margin:16px 0;">
            <strong>New Temporary Password: </strong>
            <span style="font-family:monospace;font-size:1.1em;background:#fef3c7;padding:2px 8px;border-radius:4px;">${newPassword}</span>
          </p>
          <p>If you did not request this, contact your platform provider immediately.</p>`,
        bodyText: `Hi ${u.name},\n\nYour password has been reset.\n\nNew Temporary Password: ${newPassword}\n\nPlease log in and change it immediately.`,
      });
      if (!emailResult.sent) fastify.log.warn({ emailResult, to: u.email }, 'regenerate-password email failed');

      return reply.send({
        success: true,
        // Only echo the temp password back to the screen when email failed — otherwise
        // the admin would see a credential they shouldn't need to copy.
        data: {
          tempPassword: emailResult.sent ? null : newPassword,
          emailSent: emailResult.sent,
          emailErrorCode: emailResult.errorCode ?? null,
          emailErrorMessage: emailResult.userMessage ?? null,
          email: u.email,
        },
      });
    });

    // POST /super-admin/users/:uid/send-reset-email — send a self-service reset link
    // (does NOT change the password). Quiet-fails when email isn't configured.
    fastify.post('/users/:uid/send-reset-email', async (req, reply) => {
      const { uid } = req.params as { uid: string };
      const [u] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT u.id, u.name, u.email, t.slug FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
          [uid],
        );
        return r.rows;
      });
      if (!u) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

      // Generate a single-use reset token (24h validity). password_reset_tokens table
      // is created by migration 034 — if it doesn't exist yet we still send the email
      // pointing at /forgot-password where the user can request a fresh link.
      const token = crypto.randomBytes(32).toString('hex');
      await db.withSuperAdmin(async (c) => {
        await c.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
          [uid, crypto.createHash('sha256').update(token).digest('hex')],
        ).catch(() => {}); // table optional
      });

      const base = process.env.APP_BASE_URL ?? 'https://app.vextria.ai';
      const link = `${base}/reset-password?token=${token}&slug=${encodeURIComponent(u.slug)}`;
      const emailResult = await sendSystemEmail({
        to: u.email,
        toName: u.name,
        subject: 'Reset your password',
        bodyHtml: `<p>Hi ${u.name},</p><p>A password reset was requested for your account. Click the link below to choose a new password — the link expires in 24 hours.</p><p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Reset password</a></p><p>If you did not request this, you can safely ignore this email.</p>`,
        bodyText: `Hi ${u.name},\n\nA password reset was requested. Open the link below within 24 hours to set a new password:\n\n${link}\n\nIf you did not request this, ignore this email.`,
      });
      if (!emailResult.sent) fastify.log.warn({ emailResult, to: u.email }, 'send-reset-email failed');

      return reply.send({
        success: true,
        data: {
          emailSent: emailResult.sent,
          emailErrorCode: emailResult.errorCode ?? null,
          emailErrorMessage: emailResult.userMessage ?? null,
          email: u.email,
        },
      });
    });

    // DELETE /super-admin/users/:uid — delete any user
    fastify.delete('/users/:uid', async (req, reply) => {
      const { uid } = req.params as { uid: string };
      await db.withSuperAdmin(async (client) => {
        await client.query('DELETE FROM users WHERE id = $1', [uid]);
      });
      return reply.send({ success: true });
    });

    // GET /super-admin/password-log?tenant_id= — password change history
    fastify.get('/password-log', async (req, reply) => {
      const { tenant_id } = req.query as { tenant_id?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        // Create table if it doesn't exist yet
        await client.query(`
          CREATE TABLE IF NOT EXISTS super_admin_password_log (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
            user_id     UUID,
            action      TEXT NOT NULL DEFAULT 'reset',
            changed_by  UUID,
            notes       TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        // super_admin sees ONLY tenant_admin password actions across workspaces —
        // the workspace's own users (managers, agents) are the tenant_admin's
        // concern and show up inside that workspace's own log, not the platform one.
        const where: string[] = [`u.role = 'tenant_admin'`];
        const params: any[] = [];
        if (tenant_id) { params.push(tenant_id); where.push(`l.tenant_id = $${params.length}`); }
        const r = await client.query(`
          SELECT
            l.id, l.action, l.notes, l.created_at,
            u.name  AS user_name,  u.email AS user_email, u.role AS user_role,
            t.name  AS tenant_name, t.slug AS tenant_slug,
            a.name  AS admin_name
          FROM super_admin_password_log l
          LEFT JOIN users   u ON u.id = l.user_id
          LEFT JOIN users   a ON a.id = l.changed_by
          LEFT JOIN tenants t ON t.id = l.tenant_id
          WHERE ${where.join(' AND ')}
          ORDER BY l.created_at DESC
          LIMIT 500
        `, params);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/workspaces — workspace / tenant details report
    fastify.get('/reports/workspaces', async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            t.id, t.name, t.slug, t.plan, t.status, t.sector, t.active_modules,
            t.created_at,
            COUNT(DISTINCT u.id)::int           AS user_count,
            COUNT(DISTINCT u.id) FILTER (WHERE u.is_active = true)::int AS active_users,
            COUNT(DISTINCT c.id)::int           AS contact_count,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'open')::int AS open_deals,
            MAX(u.last_login_at)                AS last_activity,
            t.last_backup_at,
            COALESCE(t.storage_bytes, 0)        AS storage_bytes
          FROM tenants t
          LEFT JOIN users    u ON u.tenant_id = t.id
          LEFT JOIN contacts c ON c.tenant_id = t.id
          LEFT JOIN deals    d ON d.tenant_id = t.id
          WHERE ($1::date IS NULL OR t.created_at >= $1::date)
            AND ($2::date IS NULL OR t.created_at <= $2::date + interval '1 day')
          GROUP BY t.id
          ORDER BY t.created_at DESC
        `, [from || null, to || null]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/backups — backup status report + per-tenant DB usage.
    // Storage is estimated by summing the row count of every multi-tenant table per
    // tenant_id and multiplying by an average row size from pg_relation_size /
    // pg_class.reltuples. Cheap to compute on small datasets; for very large
    // workspaces consider a nightly materialised view.
    fastify.get('/reports/backups', async (_req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          WITH tables AS (
            SELECT n.nspname AS schema, c.relname AS tbl, c.oid,
                   pg_relation_size(c.oid)::numeric AS rel_size,
                   GREATEST(c.reltuples, 1)::numeric AS approx_rows
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r'
               AND EXISTS (
                 SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = n.nspname AND col.table_name = c.relname
                    AND col.column_name = 'tenant_id'
               )
          ),
          -- For each (table, tenant) get the row count and prorate the rel_size by
          -- (rows-for-tenant / total-rows-in-table). Done dynamically via a
          -- per-table union built in SQL since we can't loop in straight SQL.
          tenant_rows AS (
            SELECT 'tickets'    AS tbl, tenant_id, COUNT(*)::numeric AS n FROM tickets    GROUP BY tenant_id UNION ALL
            SELECT 'contacts'   AS tbl, tenant_id, COUNT(*)::numeric AS n FROM contacts   GROUP BY tenant_id UNION ALL
            SELECT 'deals'      AS tbl, tenant_id, COUNT(*)::numeric AS n FROM deals      GROUP BY tenant_id UNION ALL
            SELECT 'activities' AS tbl, tenant_id, COUNT(*)::numeric AS n FROM activities GROUP BY tenant_id UNION ALL
            SELECT 'emails'     AS tbl, tenant_id, COUNT(*)::numeric AS n FROM emails     GROUP BY tenant_id UNION ALL
            SELECT 'voice_bot_calls' AS tbl, tenant_id, COUNT(*)::numeric AS n FROM voice_bot_calls GROUP BY tenant_id UNION ALL
            SELECT 'ticket_audit_log' AS tbl, tenant_id, COUNT(*)::numeric AS n FROM ticket_audit_log GROUP BY tenant_id
          ),
          usage AS (
            SELECT tr.tenant_id,
                   SUM( tbl.rel_size * (tr.n / NULLIF((SELECT SUM(n) FROM tenant_rows WHERE tbl = tr.tbl), 0)) )::bigint AS estimated_bytes,
                   SUM(tr.n)::bigint AS row_count
              FROM tenant_rows tr JOIN tables tbl ON tbl.tbl = tr.tbl
             GROUP BY tr.tenant_id
          )
          SELECT
            t.id, t.name, t.slug, t.status,
            t.last_backup_at,
            CASE
              WHEN t.last_backup_at IS NULL THEN 'never'
              WHEN NOW() - t.last_backup_at > interval '5 days' THEN 'overdue'
              ELSE 'ok'
            END AS backup_status,
            EXTRACT(EPOCH FROM (NOW() - t.last_backup_at)) / 86400 AS days_since_backup,
            COALESCE(u.estimated_bytes, 0) AS db_bytes,
            COALESCE(u.row_count, 0)       AS db_rows
          FROM tenants t
          LEFT JOIN usage u ON u.tenant_id = t.id
          ORDER BY t.last_backup_at ASC NULLS FIRST
        `);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/invoices — invoice report with date range + optional tenant filter
    fastify.get('/reports/invoices', async (req, reply) => {
      const { from, to, tenant_id } = req.query as { from?: string; to?: string; tenant_id?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            pi.id, pi.invoice_number, pi.status, pi.amount, pi.amount_paid,
            pi.currency, pi.due_date, pi.period_start, pi.period_end,
            pi.created_at, pi.tenant_id,
            t.name AS tenant_name, t.slug AS tenant_slug,
            CASE
              WHEN pi.due_date IS NULL THEN 'no_due_date'
              WHEN pi.due_date < NOW() AND pi.status NOT IN ('paid') THEN 'overdue'
              ELSE 'not_due'
            END AS due_status,
            CASE
              WHEN COALESCE(pi.amount_paid, 0) = 0 THEN 'unpaid'
              WHEN pi.amount_paid >= pi.amount THEN 'paid'
              ELSE 'partial'
            END AS payment_status
          FROM platform_invoices pi
          LEFT JOIN tenants t ON t.id = pi.tenant_id
          WHERE ($1::date IS NULL OR pi.created_at >= $1::date)
            AND ($2::date IS NULL OR pi.created_at <= $2::date + interval '1 day')
            AND ($3::uuid IS NULL OR pi.tenant_id = $3::uuid)
          ORDER BY pi.created_at DESC
        `, [from || null, to || null, tenant_id || null]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/payments — payment report with date range
    fastify.get('/reports/payments', async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            pp.id, pp.amount, pp.currency, pp.payment_date,
            pp.method AS payment_method,
            pp.reference, pp.notes, pp.created_at,
            pi.invoice_number, t.name AS tenant_name, t.slug AS tenant_slug
          FROM platform_payments pp
          LEFT JOIN platform_invoices pi ON pi.id = pp.invoice_id
          LEFT JOIN tenants t ON t.id = pi.tenant_id
          WHERE ($1::date IS NULL OR pp.payment_date >= $1::date)
            AND ($2::date IS NULL OR pp.payment_date <= $2::date + interval '1 day')
          ORDER BY pp.payment_date DESC
        `, [from || null, to || null]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/customer-contacts — the SaaS owner's view of "contacts" is
    // NOT the bank's customers (those live inside each workspace) — it's the people
    // we sold to: the tenant_admin we provisioned plus any POC the super-admin
    // recorded against a workspace (saved in contacts.custom_fields.poc_name etc.).
    //
    // Two row shapes returned, unified into one list:
    //   { kind: 'tenant_admin', ... }  — one per workspace, from users WHERE role='tenant_admin'
    //   { kind: 'poc',          ... }  — one per workspace where a POC was recorded
    fastify.get('/customer-contacts', async (req, reply) => {
      const { search } = req.query as Record<string, string>;
      const rows = await db.withSuperAdmin(async (client) => {
        const params: any[] = [];
        let admWhere = `u.role = 'tenant_admin' AND u.is_active = true`;
        let pocWhere = `c.custom_fields ? 'poc_name' AND (c.custom_fields->>'poc_name') <> ''`;
        if (search) {
          params.push(`%${search}%`);
          const p = `$${params.length}`;
          admWhere += ` AND (u.name ILIKE ${p} OR u.email ILIKE ${p} OR t.name ILIKE ${p})`;
          pocWhere += ` AND (c.custom_fields->>'poc_name' ILIKE ${p} OR c.custom_fields->>'poc_email' ILIKE ${p} OR t.name ILIKE ${p})`;
        }
        const r = await client.query(`
          SELECT 'tenant_admin'::text AS kind,
                 u.id, u.name, u.email, u.phone,
                 t.id   AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, t.sector,
                 NULL::text AS remarks, u.created_at
            FROM users u JOIN tenants t ON t.id = u.tenant_id
           WHERE ${admWhere}
          UNION ALL
          SELECT 'poc'::text AS kind,
                 c.id,
                 c.custom_fields->>'poc_name'  AS name,
                 c.custom_fields->>'poc_email' AS email,
                 c.custom_fields->>'poc_phone' AS phone,
                 t.id   AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, t.sector,
                 c.custom_fields->>'remarks' AS remarks, c.created_at
            FROM contacts c JOIN tenants t ON t.id = c.tenant_id
           WHERE ${pocWhere}
          ORDER BY tenant_name, kind, name
        `, params);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/customer-companies — list of OUR clients (= each workspace).
    // The operational /api/v1/companies endpoint returns workspaces' own B2B records;
    // super-admin sees one row per tenant instead.
    fastify.get('/customer-companies', async (req, reply) => {
      const { search } = req.query as Record<string, string>;
      const rows = await db.withSuperAdmin(async (client) => {
        const params: any[] = [];
        let where = '1=1';
        if (search) { params.push(`%${search}%`); where = `(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length})`; }
        const r = await client.query(`
          SELECT t.id, t.name, t.slug, t.sector, t.plan, t.status, t.created_at,
                 t.custom_domain AS website,
                 (SELECT u.name  FROM users u WHERE u.tenant_id=t.id AND u.role='tenant_admin' AND u.is_active=true ORDER BY u.created_at LIMIT 1) AS tenant_admin_name,
                 (SELECT u.email FROM users u WHERE u.tenant_id=t.id AND u.role='tenant_admin' AND u.is_active=true ORDER BY u.created_at LIMIT 1) AS tenant_admin_email
            FROM tenants t
           WHERE ${where}
           ORDER BY t.name
        `, params);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/customer-companies/:tenantId/people — the "People to contact"
    // panel inside a company card. ONLY the tenant_admin user and the recorded POC
    // (owner of the client) are shown. Agents/managers of that workspace are
    // intentionally hidden — they aren't the SaaS owner's contact path.
    fastify.get('/customer-companies/:tenantId/people', async (req, reply) => {
      const { tenantId } = req.params as { tenantId: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT 'tenant_admin'::text AS kind,
                 u.id, u.name, u.email, u.phone,
                 NULL::text AS title, u.last_login_at AS last_seen
            FROM users u
           WHERE u.tenant_id = $1 AND u.role = 'tenant_admin' AND u.is_active = true
          UNION ALL
          SELECT 'owner'::text AS kind,
                 c.id,
                 c.custom_fields->>'poc_name'  AS name,
                 c.custom_fields->>'poc_email' AS email,
                 c.custom_fields->>'poc_phone' AS phone,
                 'Point of Contact / Owner' AS title,
                 NULL::timestamptz AS last_seen
            FROM contacts c
           WHERE c.tenant_id = $1 AND c.custom_fields ? 'poc_name'
                 AND (c.custom_fields->>'poc_name') <> ''
          ORDER BY kind, name
        `, [tenantId]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/emails — platform-level emails view.
    // Only surfaces emails sent BY or TO a tenant_admin account, across all workspaces.
    // The agent/manager inbox traffic belongs in the tenant_admin's own emails tab.
    fastify.get('/emails', async (req, reply) => {
      const { tenant_id, limit = '100' } = req.query as Record<string, string>;
      const rows = await db.withSuperAdmin(async (client) => {
        const where: string[] = [];
        const params: any[] = [];
        if (tenant_id) { params.push(tenant_id); where.push(`e.tenant_id = $${params.length}`); }
        params.push(parseInt(limit, 10));
        const r = await client.query(`
          SELECT e.id, e.tenant_id, e.subject, e.from_email, e.to_email,
                 e.status, e.sent_at, e.created_at,
                 sender.name AS sent_by_name, sender.role AS sent_by_role,
                 recipient.role AS recipient_role,
                 t.name AS tenant_name, t.slug AS tenant_slug
          FROM emails e
          LEFT JOIN users sender    ON sender.id = e.sent_by
          LEFT JOIN users recipient ON recipient.tenant_id = e.tenant_id AND recipient.email = e.to_email
          LEFT JOIN tenants t       ON t.id = e.tenant_id
          WHERE (sender.role = 'tenant_admin' OR recipient.role = 'tenant_admin')
            ${where.length ? 'AND ' + where.join(' AND ') : ''}
          ORDER BY e.created_at DESC
          LIMIT $${params.length}
        `, params);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /super-admin/reports/audit — cross-tenant audit log.
    // SCOPE: shows ONLY actions by tenant_admin users. The workspace's own internal
    // activity (agents working tickets etc.) belongs in the tenant_admin's own audit
    // log, not the platform-level view. Filter is applied via actor role.
    fastify.get('/reports/audit', async (req, reply) => {
      const { limit = '200', entity, action } = req.query as Record<string, string>;
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`
          SELECT
            tal.id, tal.action,
            'ticket'::text AS entity_type,
            tal.ticket_id  AS entity_id,
            tal.old_value, tal.new_value, tal.created_at,
            COALESCE(u.name, tal.actor_name) AS actor_name,
            u.email AS actor_email,
            u.role  AS actor_role,
            t.name  AS tenant_name, t.slug AS tenant_slug
          FROM ticket_audit_log tal
          LEFT JOIN users   u ON u.id = tal.actor_id
          LEFT JOIN tenants t ON t.id = tal.tenant_id
          WHERE u.role = 'tenant_admin'
            AND ($1::text IS NULL OR $1 = 'ticket')
            AND ($2::text IS NULL OR tal.action = $2)
          ORDER BY tal.created_at DESC
          LIMIT $3
        `, [entity || null, action || null, parseInt(limit, 10)]);
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });
  };
}
