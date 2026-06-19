import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';
import { EmailService } from '../services/email.service';
import { MODULE_CATALOG } from './super-admin';

// ── Module permission definitions ─────────────────────────────────────────
// Each module can have access level: 'none' | 'view' | 'full'
// 'none' = module hidden, 'view' = read-only, 'full' = create/edit/delete

export const MODULE_DEFS = [
  { key: 'dashboard',    label: 'Dashboard',     levels: ['none', 'view'] },
  { key: 'contacts',     label: 'Contacts',      levels: ['none', 'view', 'full'] },
  { key: 'companies',    label: 'Companies',     levels: ['none', 'view', 'full'] },
  { key: 'deals',        label: 'Deals',         levels: ['none', 'view', 'full'] },
  { key: 'activities',   label: 'Activities',    levels: ['none', 'view', 'full'] },
  { key: 'tickets',      label: 'Tickets',       levels: ['none', 'view', 'full'] },
  { key: 'emails',       label: 'Emails',        levels: ['none', 'view', 'full'] },
  { key: 'analytics',    label: 'Analytics',     levels: ['none', 'view'] },
  { key: 'voice',        label: 'Voice Calls',   levels: ['none', 'view', 'full'] },
  { key: 'voicebot',     label: 'Voice Bot',     levels: ['none', 'view', 'full'] },
  { key: 'integrations', label: 'Integrations',  levels: ['none', 'view', 'full'] },
  { key: 'settings',     label: 'Settings',      levels: ['none', 'view'] },
  { key: 'billing',      label: 'Billing',       levels: ['none', 'view'] },
];

// Default permissions per role
export function defaultPermissions(role: string): Record<string, string> {
  switch (role) {
    case 'tenant_admin':
      return Object.fromEntries(MODULE_DEFS.map((m) => [m.key, m.levels[m.levels.length - 1]]));
    case 'manager':
      return {
        dashboard: 'view', contacts: 'full', companies: 'full', deals: 'full',
        activities: 'full', tickets: 'full', emails: 'full', analytics: 'view',
        voice: 'full', voicebot: 'view', integrations: 'view', settings: 'none', billing: 'none',
      };
    case 'agent':
    default:
      return {
        dashboard: 'view', contacts: 'full', companies: 'view', deals: 'view',
        activities: 'full', tickets: 'full', emails: 'full', analytics: 'none',
        voice: 'view', voicebot: 'none', integrations: 'none', settings: 'none', billing: 'none',
      };
  }
}

// ── Gap 8 fix: Department type enum (replaces fragile keyword matching) ───────
//
// Instead of substring-matching free-text department names, we use a
// structured `department_type` value stored alongside the department name.
// The invite & team-edit APIs accept an optional `departmentType` that maps
// directly to one of the six predefined override sets.  When no explicit type
// is supplied, we fall back to fuzzy keyword matching only as a last resort
// (e.g. for legacy rows that have no type stored yet).
//
// The six canonical types:
export const DEPT_TYPES = [
  'support',             // Customer support / service desk / helpdesk / complaint
  'sales',               // Sales / retail / commercial / revenue
  'compliance_audit',    // Compliance / audit / legal / risk
  'finance_billing',     // Finance / billing / payments / accounts
  'technical_operations',// Technical / IT / infrastructure / broadband
  'operations',          // Logistics / warehouse / dispatch / last-mile
] as const;
export type DeptType = typeof DEPT_TYPES[number];

// Permissions overlay per department type
const DEPT_OVERRIDES: Record<DeptType, Record<string, string>> = {
  support: {
    deals: 'none', voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
  sales: {
    tickets: 'none', voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
  compliance_audit: {
    contacts: 'view', companies: 'view', deals: 'view', activities: 'view',
    tickets: 'view', emails: 'view', voice: 'view', analytics: 'view',
    voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
  finance_billing: {
    deals: 'view', tickets: 'none', voicebot: 'none', integrations: 'none', settings: 'none',
  },
  technical_operations: {
    deals: 'none', voicebot: 'view', integrations: 'view', billing: 'none', settings: 'none',
  },
  operations: {
    deals: 'view', tickets: 'view', voicebot: 'none', integrations: 'none', billing: 'none', settings: 'none',
  },
};

// Legacy keyword → department type mapping (used as fallback only for old rows)
const KEYWORD_TO_DEPT_TYPE: Array<{ keywords: string[]; type: DeptType }> = [
  { keywords: ['support', 'complaint', 'ticket', 'service desk', 'helpdesk'], type: 'support' },
  { keywords: ['sales', 'retail', 'new business', 'commercial', 'revenue'],   type: 'sales' },
  { keywords: ['compliance', 'audit', 'legal', 'risk'],                        type: 'compliance_audit' },
  { keywords: ['finance', 'billing', 'payment', 'accounts'],                   type: 'finance_billing' },
  { keywords: ['technical', 'tech support', 'it ', 'infrastructure', 'engineering', 'broadband'], type: 'technical_operations' },
  { keywords: ['operation', 'logistics', 'warehouse', 'last mile', 'customs', 'dispatch'],        type: 'operations' },
];

// Resolve the structured type from an explicit value, then fall back to keyword scan.
// Returns null if neither matches.
export function resolveDeptType(
  departmentType: string | null | undefined,
  departmentName: string | null | undefined,
): DeptType | null {
  // 1. Explicit structured type (preferred)
  if (departmentType && DEPT_TYPES.includes(departmentType as DeptType)) {
    return departmentType as DeptType;
  }
  // 2. Legacy keyword fallback — scan the department name (last resort)
  if (departmentName) {
    const lower = departmentName.toLowerCase();
    for (const { keywords, type } of KEYWORD_TO_DEPT_TYPE) {
      // Exact word-boundary match using \b to prevent "IT Support" matching both rules
      if (keywords.some((kw) => new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`).test(lower))) {
        return type;
      }
    }
  }
  return null;
}

// Returns permissions appropriate for the given department type + role.
// Admins and managers always receive their full role defaults.
export function departmentPermissions(
  department: string | null | undefined,
  role: string,
  departmentType?: string | null,
): Record<string, string> {
  const base = defaultPermissions(role);
  if (!department || role === 'tenant_admin' || role === 'manager') return base;

  const deptType = resolveDeptType(departmentType, department);
  if (!deptType) return base;

  return { ...base, ...DEPT_OVERRIDES[deptType] };
}

// Export for use in shared/frontend dropdowns
export const DEPT_TYPE_LABELS: Record<DeptType, string> = {
  support:              'Support / Service Desk',
  sales:                'Sales / Commercial',
  compliance_audit:     'Compliance / Audit / Legal',
  finance_billing:      'Finance / Billing',
  technical_operations: 'Technical / IT / Operations',
  operations:           'Operations / Logistics',
};

const WorkspaceSchema = z.object({
  name:       z.string().min(1).optional(),
  domain:     z.string().optional(),
  timezone:   z.string().optional(),
  dateFormat: z.string().optional(),
  currency:   z.string().length(3).optional(),
});

export function settingsRoutes(db: DatabaseClient) {
  const emailSvc = new EmailService(db);

  return async function (fastify: FastifyInstance) {

    // Root — returns workspace + plan info
    fastify.get('/', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          'SELECT id, name, slug, plan, status, settings, billing_details FROM tenants WHERE id = $1',
          [req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: tenant });
    });

    // Get workspace settings
    fastify.get('/workspace', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          'SELECT id, name, slug, custom_domain, plan, status, sector, settings, billing_details FROM tenants WHERE id = $1',
          [req.tenant.id],
        );
        return result.rows;
      });
      return reply.send({ success: true, data: tenant });
    });

    // Update workspace settings
    fastify.patch('/workspace', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = WorkspaceSchema.parse(req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (body.name)       { sets.push(`name = $${i++}`);                          vals.push(body.name); }
      if (body.domain)     { sets.push(`custom_domain = $${i++}`);                 vals.push(body.domain); }
      if (body.timezone)   { sets.push(`settings = jsonb_set(COALESCE(settings,'{}'), '{timezone}', $${i++}::jsonb)`); vals.push(JSON.stringify(body.timezone)); }
      if (body.dateFormat) { sets.push(`settings = jsonb_set(COALESCE(settings,'{}'), '{dateFormat}', $${i++}::jsonb)`); vals.push(JSON.stringify(body.dateFormat)); }
      if (body.currency)   { sets.push(`settings = jsonb_set(COALESCE(settings,'{}'), '{currency}', $${i++}::jsonb)`); vals.push(JSON.stringify(body.currency)); }
      if (!sets.length) return reply.send({ success: true });

      vals.push(req.tenant.id);
      await db.withSuperAdmin(async (client) => {
        await client.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${i}`, vals);
      });
      return reply.send({ success: true });
    });

    /**
     * GET/PATCH /settings/routing
     * Ticket routing configuration:
     *   - per_agent_ticket_limit: max pending tickets per agent (0 = unlimited)
     *   - routing_method: random_capacity | round_robin | manual
     * CSAT configuration:
     *   - csat_expiry_days: survey link expiry (default 7)
     */
    fastify.get('/routing', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT settings FROM tenants WHERE id = $1`, [req.tenant.id]);
        return r.rows;
      });
      const settings = row?.settings ?? {};
      return reply.send({
        success: true,
        data: {
          routing: {
            per_agent_ticket_limit: settings?.routing?.per_agent_ticket_limit ?? 0,
            routing_method:         settings?.routing?.routing_method ?? 'random_capacity',
          },
          csat: {
            expiry_days: settings?.csat_expiry_days ?? 7,
          },
        },
      });
    });

    fastify.patch('/routing', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = z.object({
        per_agent_ticket_limit: z.number().int().min(0).max(500).optional(), // 0 = unlimited
        routing_method:         z.enum(['random_capacity','round_robin','manual']).optional(),
        csat_expiry_days:       z.number().int().min(1).max(90).optional(),
      }).parse(req.body);

      await db.withSuperAdmin(async (client) => {
        if (body.per_agent_ticket_limit !== undefined || body.routing_method !== undefined) {
          const current = (await client.query(`SELECT settings FROM tenants WHERE id = $1`, [req.tenant.id])).rows[0]?.settings ?? {};
          const routing = { ...(current?.routing ?? {}) };
          if (body.per_agent_ticket_limit !== undefined) routing.per_agent_ticket_limit = body.per_agent_ticket_limit;
          if (body.routing_method !== undefined)         routing.routing_method         = body.routing_method;
          await client.query(
            `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'), '{routing}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(routing), req.tenant.id],
          );
        }
        if (body.csat_expiry_days !== undefined) {
          await client.query(
            `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'), '{csat_expiry_days}', $1::jsonb) WHERE id = $2`,
            [body.csat_expiry_days, req.tenant.id],
          );
        }
      });
      return reply.send({ success: true, message: 'Routing configuration updated' });
    });

    // List team members (super_admin excluded — internal platform role)
    // Returns presence (is_online / is_recently_active) + hierarchy info (manager_id, manager_name).
    // Manager/line_manager only see users in their own department + tenant_admins.
    fastify.get('/team', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager', 'line_manager') }, async (req, reply) => {
      const role = (req.user as any).role as string;
      const userId = (req.user as any).sub as string;
      const deptFilter = (req.user as any).department_type as string | null;

      const params: unknown[] = [req.tenant.id];
      let where = `tenant_id = $1 AND role != 'super_admin'`;
      if ((role === 'manager' || role === 'line_manager') && deptFilter) {
        params.push(deptFilter);
        where += ` AND (department_type = $${params.length} OR role = 'tenant_admin')`;
      }

      const members = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT u.id, u.email, u.name, u.role, u.department, u.department_type,
                  u.permissions, u.is_active, u.manager_id, u.max_direct_reports, u.avatar,
                  u.created_at, u.last_login_at, u.last_active_at,
                  (u.last_active_at IS NOT NULL AND u.last_active_at > NOW() - INTERVAL '90 seconds') AS is_online,
                  (u.last_active_at IS NOT NULL AND u.last_active_at > NOW() - INTERVAL '10 minutes') AS is_recently_active,
                  m.name AS manager_name
           FROM users u
           LEFT JOIN users m ON m.id = u.manager_id
           WHERE ${where}
           ORDER BY u.role, u.name`,
          params,
        );
        return r.rows;
      });

      // Agents only see themselves
      if (role === 'agent') {
        return reply.send({ success: true, data: members.filter(u => u.id === userId) });
      }
      return reply.send({ success: true, data: members });
    });

    // Get module definitions (for permissions matrix UI)
    fastify.get('/team/modules', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (_req, reply) => {
      return reply.send({ success: true, data: MODULE_DEFS });
    });

    // ── Module management (tenant admin self-service within licensed set) ─────
    //
    // Two-tier model:
    //   active_modules (DB column)       = modules LICENSED by super admin (the ceiling)
    //   settings.enabled_modules (JSON)  = modules tenant admin has turned ON
    //                                      (subset of active_modules; defaults to all licensed)
    //
    // Tenant admin can only toggle modules that the super admin has licensed.
    // Attempting to enable an unlicensed module is rejected with 403.

    fastify.get('/workspace/modules', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT active_modules, settings FROM tenants WHERE id = $1`, [req.tenant.id]);
        return r.rows;
      });
      const licensedModules: string[] = row?.active_modules ?? ['crm'];
      // If tenant admin hasn't explicitly configured enabled_modules, default to all licensed
      const enabledModules: string[] = row?.settings?.enabled_modules ?? licensedModules;

      const result = MODULE_CATALOG.map(m => ({
        key:         m.key,
        label:       m.label,
        description: m.description,
        always:      m.always,
        licensed:    licensedModules.includes(m.key),  // set by super admin
        enabled:     m.always || (licensedModules.includes(m.key) && enabledModules.includes(m.key)),
      }));

      return reply.send({ success: true, data: result });
    });

    fastify.patch('/workspace/modules', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const body = z.object({
        // Map of module key → enable/disable boolean
        modules: z.record(z.string(), z.boolean()),
      }).parse(req.body);

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT active_modules, settings FROM tenants WHERE id = $1`, [req.tenant.id]);
        return r.rows;
      });
      const licensedModules: string[] = row?.active_modules ?? ['crm'];
      // Start from current enabled state (or default to all licensed)
      const currentEnabled: string[] = row?.settings?.enabled_modules ?? [...licensedModules];
      let updatedEnabled = [...currentEnabled];

      for (const [mod, enable] of Object.entries(body.modules)) {
        // Never allow enabling modules that aren't licensed by super admin
        if (enable && !licensedModules.includes(mod)) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'MODULE_NOT_LICENSED',
              message: `Module '${mod}' is not licensed for this workspace. Contact your platform administrator.`,
            },
          });
        }
        if (enable) {
          if (!updatedEnabled.includes(mod)) updatedEnabled.push(mod);
        } else {
          updatedEnabled = updatedEnabled.filter(m => m !== mod);
        }
      }
      // 'crm' is always enabled
      if (!updatedEnabled.includes('crm')) updatedEnabled.unshift('crm');

      const settings = row?.settings ?? {};
      settings.enabled_modules = updatedEnabled;

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(settings), req.tenant.id],
        );
      });

      return reply.send({ success: true, data: { enabledModules: updatedEnabled, licensedModules } });
    });

    // ── Helper: enforce licensed modules on a user permissions map ───────
    // Modules that aren't in the tenant's active_modules are forced to 'none'
    // so no user can gain access to an unlicensed module regardless of what
    // permissions were submitted.
    const applyModuleLicensing = async (
      tenantId: string,
      permissions: Record<string, string>,
    ): Promise<Record<string, string>> => {
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(`SELECT active_modules FROM tenants WHERE id = $1`, [tenantId]);
        return r.rows;
      });
      const licensed: string[] = row?.active_modules ?? ['crm'];
      // Map of module key → top-level permission key(s) in the permissions object
      // This tells us which permissions control each module so we can enforce 'none'
      const MODULE_PERMISSION_KEYS: Record<string, string[]> = {
        voice:        ['voice'],
        voicebot:     ['voicebot'],
        ticketing:    ['tickets'],
        emails:       ['emails'],
        integrations: ['integrations'],
        analytics:    ['analytics'],
      };
      const updated = { ...permissions };
      for (const [moduleKey, permKeys] of Object.entries(MODULE_PERMISSION_KEYS)) {
        if (!licensed.includes(moduleKey)) {
          for (const pk of permKeys) {
            if (updated[pk] !== undefined) updated[pk] = 'none';
          }
        }
      }
      return updated;
    };

    // Return available department types for the invite / edit UI (Gap 8)
    fastify.get('/team/department-types', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (_req, reply) => {
      return reply.send({
        success: true,
        data: DEPT_TYPES.map(t => ({ value: t, label: DEPT_TYPE_LABELS[t] })),
      });
    });

    // Invite team member
    fastify.post('/team/invite', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const InviteSchema = z.object({
        email:           z.string().email(),
        name:            z.string().max(100).optional(),
        // Tenant admins can only assign roles up to their own level; super_admin is never assignable here.
        // line_manager added in migration 014 — a department-scoped sub-manager between manager and agent.
        role:            z.enum(['tenant_admin', 'manager', 'line_manager', 'agent', 'viewer']).default('agent'),
        custom_role_id:  z.string().uuid().optional(),
        permissions:     z.record(z.string()).optional(),
        department:      z.string().max(100).optional(),
        // Gap 8: explicit dept type — prevents fragile keyword matching on ambiguous dept names
        departmentType:  z.enum(DEPT_TYPES).optional(),
        // Hierarchy: agent reports to line_manager; line_manager reports to manager.
        managerId:       z.string().uuid().optional(),
        // Capacity: how many direct reports this user can have (only meaningful for manager/line_manager)
        maxDirectReports: z.number().int().min(0).max(100).optional(),
      });
      const parsed = InviteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } });
      }
      const { email, name, role, custom_role_id, permissions: customPermissions, department, departmentType, managerId, maxDirectReports } = parsed.data;

      const displayName  = name?.trim() || email.split('@')[0];
      const assignedRole = role ?? 'agent';
      // Explicit permissions override department defaults; department defaults override role defaults
      const rawPerms = customPermissions ?? departmentPermissions(department, assignedRole, departmentType);
      // Enforce: any module not licensed by super admin is forced to 'none'
      const perms = await applyModuleLicensing(req.tenant.id, rawPerms);

      // ── Hierarchy validation ────────────────────────────────────────────
      // 1. Manager role can ONLY exist once per department (enforced by uq_one_manager_per_dept).
      // 2. line_manager and agent must have a managerId pointing to someone above them in their dept.
      // 3. Capacity check: don't exceed the parent manager's max_direct_reports.
      if (assignedRole === 'line_manager' || assignedRole === 'agent') {
        if (!managerId) {
          return reply.code(400).send({ success: false, error: { code: 'MANAGER_REQUIRED',
            message: `${assignedRole} must report to a ${assignedRole === 'agent' ? 'line_manager or manager' : 'manager'} (provide managerId)` } });
        }
        const [parent] = await db.withTenant(req.tenant.id, async (client) => {
          const r = await client.query(
            `SELECT id, role, department_type, max_direct_reports,
                    (SELECT COUNT(*) FROM users WHERE manager_id = u.id AND is_active = true) AS direct_reports
             FROM users u WHERE id = $1 AND tenant_id = $2`,
            [managerId, req.tenant.id],
          );
          return r.rows;
        });
        if (!parent) {
          return reply.code(400).send({ success: false, error: { code: 'MANAGER_NOT_FOUND', message: 'Parent manager does not exist in this tenant' } });
        }
        // Department must match parent's department
        if (departmentType && parent.department_type && departmentType !== parent.department_type) {
          return reply.code(400).send({ success: false, error: { code: 'DEPT_MISMATCH',
            message: `Cannot assign to a manager from a different department (parent is ${parent.department_type})` } });
        }
        // Capacity check
        if (parent.max_direct_reports != null && Number(parent.direct_reports) >= Number(parent.max_direct_reports)) {
          return reply.code(409).send({ success: false, error: { code: 'CAPACITY_EXCEEDED',
            message: `Parent manager is at capacity (${parent.max_direct_reports} direct reports)` } });
        }
        // Role hierarchy check
        if (assignedRole === 'line_manager' && parent.role !== 'manager') {
          return reply.code(400).send({ success: false, error: { code: 'INVALID_PARENT', message: 'line_manager must report to a manager' } });
        }
        if (assignedRole === 'agent' && !['manager', 'line_manager'].includes(parent.role)) {
          return reply.code(400).send({ success: false, error: { code: 'INVALID_PARENT', message: 'agent must report to a manager or line_manager' } });
        }
      }

      // 1. Create (or update) user account with role + permissions + department + hierarchy
      let user: any;
      try {
        [user] = await db.withTenant(req.tenant.id, async (client) => {
          const result = await client.query(
            `INSERT INTO users (tenant_id, email, name, role, password_hash, permissions, custom_role_id, department, department_type, manager_id, max_direct_reports)
             VALUES ($1, $2, $3, $4, 'INVITE_PENDING', $5, $6, $7, $8, $9, $10)
             ON CONFLICT (tenant_id, email) DO UPDATE
               SET role = EXCLUDED.role, name = EXCLUDED.name,
                   permissions = EXCLUDED.permissions, custom_role_id = EXCLUDED.custom_role_id,
                   department = EXCLUDED.department, department_type = EXCLUDED.department_type,
                   manager_id = EXCLUDED.manager_id, max_direct_reports = EXCLUDED.max_direct_reports
             RETURNING id, email, name, role, permissions, custom_role_id, department, department_type, manager_id, max_direct_reports`,
            [req.tenant.id, email, displayName, assignedRole, JSON.stringify(perms), custom_role_id ?? null, department ?? null, departmentType ?? null, managerId ?? null, maxDirectReports ?? null],
          );
          return result.rows;
        });
      } catch (err: any) {
        // Unique index uq_one_manager_per_dept catches a second active manager in the same department.
        if (err?.code === '23505' && /uq_one_manager_per_dept/.test(err.constraint ?? err.detail ?? '')) {
          return reply.code(409).send({ success: false, error: { code: 'MANAGER_EXISTS',
            message: `A manager already exists for the ${departmentType} department. Only one manager per department is allowed.` } });
        }
        throw err;
      }

      // 2. Generate a password-setup token (reuses the reset-password flow)
      const rawToken  = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET token_hash = $2, expires_at = $3, used = false`,
          [user.id, tokenHash, expiresAt],
        );
      });

      // 3. Build invite link
      const appUrl    = process.env.APP_URL ?? 'http://localhost:5173';
      const inviteUrl = `${appUrl}/reset-password?token=${rawToken}&tenant=${req.tenant.slug}`;

      // 4. Send invite email (best-effort — don't fail the request if email isn't configured)
      const [tenantRow] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT name, slug FROM tenants WHERE id = $1', [req.tenant.id]);
        return r.rows;
      });
      const workspaceName = tenantRow?.name ?? 'your workspace';

      // Look up inviter name from users table
      const [inviterRow] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT name FROM users WHERE id = $1', [req.user.sub]);
        return r.rows;
      });
      const inviterName = inviterRow?.name ?? 'Your admin';

      try {
        await emailSvc.send(req.tenant.id, {
          to:        email,
          toName:    displayName,
          subject:   `You've been invited to ${workspaceName} CRM`,
          bodyHtml: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
              <div style="text-align:center;margin-bottom:28px;">
                <div style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#4D8B3C);border-radius:16px;padding:14px 18px;">
                  <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px;">Vivid CRM</span>
                </div>
              </div>
              <div style="background:#fff;border-radius:10px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
                <h2 style="margin:0 0 8px;color:#111827;font-size:22px;">You're invited! 🎉</h2>
                <p style="color:#6b7280;margin:0 0 20px;line-height:1.6;">
                  <strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on Vivid CRM as <strong>${role ?? 'agent'}</strong>.
                </p>
                <p style="color:#6b7280;margin:0 0 28px;line-height:1.6;">
                  Click the button below to set your password and get started. This link is valid for <strong>7 days</strong>.
                </p>
                <div style="text-align:center;margin-bottom:28px;">
                  <a href="${inviteUrl}"
                     style="display:inline-block;background:linear-gradient(135deg,#29ABE2,#1a8cbf);color:#fff;
                            text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;
                            border-radius:8px;box-shadow:0 4px 14px rgba(41,171,226,0.35);">
                    Accept Invitation &amp; Set Password
                  </a>
                </div>
                <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center;">
                  Or copy this link: <a href="${inviteUrl}" style="color:#29ABE2;">${inviteUrl}</a>
                </p>
              </div>
              <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:20px;">
                © ${new Date().getFullYear()} Vivid Solutions &amp; Services. If you didn't expect this invitation, you can ignore this email.
              </p>
            </div>
          `,
          bodyText: `You've been invited to join ${workspaceName} on Vivid CRM as ${role ?? 'agent'}.\n\nSet your password here: ${inviteUrl}\n\nThis link expires in 7 days.`,
        });
      } catch {
        // Email failure should not block the invite — user is created, admin can resend
      }

      return reply.code(201).send({ success: true, data: user });
    });

    // Remove team member
    fastify.delete('/team/:userId', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { userId } = req.params as { userId: string };
      if (userId === req.user.sub) {
        return reply.code(400).send({ success: false, error: { code: 'CANNOT_REMOVE_SELF', message: 'Cannot remove your own account' } });
      }
      await db.withTenant(req.tenant.id, async (client) => {
        // Explicit tenant_id guard as defence-in-depth alongside RLS
        await client.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [userId, req.tenant.id]);
      });
      return reply.code(204).send();
    });

    // Update team member role and/or permissions
    fastify.patch('/team/:userId', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const PatchSchema = z.object({
        // Restrict to tenant-level roles only — super_admin cannot be self-assigned
        role:           z.enum(['tenant_admin', 'manager', 'agent', 'viewer']).optional(),
        department:     z.string().max(100).nullable().optional(),
        departmentType: z.enum(DEPT_TYPES).nullable().optional(), // Gap 8
        permissions:    z.record(z.string()).optional(),
      });
      const parsed = PatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } });
      }
      const { role, department, departmentType, permissions: customPermissions } = parsed.data;

      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        // Build dynamic update
        const updates: string[] = [];
        const vals: any[] = [];
        let i = 1;

        // Fetch current user state to derive permissions when only department changes
        const [current] = (await client.query('SELECT role, department, department_type FROM users WHERE id = $1', [userId])).rows;
        const effectiveRole     = role ?? current?.role ?? 'agent';
        const effectiveDept     = department !== undefined ? department : current?.department;
        const effectiveDeptType = departmentType !== undefined ? departmentType : current?.department_type;

        if (role !== undefined) {
          updates.push(`role = $${i++}`);
          vals.push(role);
        }
        if (department !== undefined) {
          updates.push(`department = $${i++}`);
          vals.push(department);
        }
        if (departmentType !== undefined) {
          updates.push(`department_type = $${i++}`);
          vals.push(departmentType);
        }
        // Recalculate permissions when role or department changes, unless caller supplies explicit permissions
        if (!customPermissions && (role !== undefined || department !== undefined || departmentType !== undefined)) {
          const rawPerms = departmentPermissions(effectiveDept, effectiveRole, effectiveDeptType);
          const enforcedPerms = await applyModuleLicensing(req.tenant.id, rawPerms);
          updates.push(`permissions = $${i++}`);
          vals.push(JSON.stringify(enforcedPerms));
        }
        if (customPermissions !== undefined) {
          const enforcedPerms = await applyModuleLicensing(req.tenant.id, customPermissions);
          updates.push(`permissions = $${i++}`);
          vals.push(JSON.stringify(enforcedPerms));
        }

        if (updates.length === 0) return [null];

        vals.push(userId);
        const result = await client.query(
          `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${i} RETURNING id, name, email, role, department, department_type, permissions`,
          vals,
        );
        return result.rows;
      });

      if (!user) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return reply.send({ success: true, data: user });
    });


    // ── Milestone Templates ───────────────────────────────────────────────
    // GET  /settings/milestone-templates
    // PUT  /settings/milestone-templates/:ticketType
    fastify.get('/milestone-templates', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager') }, async (req, reply) => {
      const templates = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT * FROM ticket_milestone_templates WHERE tenant_id = $1 ORDER BY ticket_type`,
          [req.tenant.id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: templates });
    });

    fastify.put('/milestone-templates/:ticketType', { preHandler: requireRole('super_admin','tenant_admin') }, async (req, reply) => {
      const { ticketType } = req.params as { ticketType: string };
      const { name, steps } = req.body as { name?: string; steps: Array<{ id: string; label: string; description?: string; order: number }> };

      const [tmpl] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO ticket_milestone_templates (tenant_id, ticket_type, name, steps)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (tenant_id, ticket_type) DO UPDATE
             SET name = EXCLUDED.name, steps = EXCLUDED.steps, updated_at = NOW()
           RETURNING *`,
          [req.tenant.id, ticketType, name ?? ticketType, JSON.stringify(steps)],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: tmpl });
    });

    fastify.delete('/milestone-templates/:ticketType', { preHandler: requireRole('super_admin','tenant_admin') }, async (req, reply) => {
      const { ticketType } = req.params as { ticketType: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `DELETE FROM ticket_milestone_templates WHERE tenant_id = $1 AND ticket_type = $2`,
          [req.tenant.id, ticketType],
        );
      });
      return reply.code(204).send();
    });

    // ── Queue routing config ──────────────────────────────────────────────
    fastify.patch('/team/queues/:queueId/routing', { preHandler: requireRole('super_admin','tenant_admin') }, async (req, reply) => {
      const { queueId } = req.params as { queueId: string };
      const { routingMethod, routingCriteria } = req.body as { routingMethod: string; routingCriteria?: Record<string, unknown> };

      await db.withTenant(req.tenant.id, async (client) => {
        await client.query(
          `UPDATE ticket_queues SET routing_method = $1, routing_criteria = $2::jsonb WHERE id = $3`,
          [routingMethod, JSON.stringify(routingCriteria ?? {}), queueId],
        );
      });
      return reply.send({ success: true });
    });

    // Change password
    fastify.post('/security/change-password', async (req, reply) => {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
      if (!newPassword || newPassword.length < 8) {
        return reply.code(400).send({ success: false, error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' } });
      }
      const bcrypt = await import('bcryptjs');
      const [user] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
        return result.rows;
      });
      if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
        return reply.code(400).send({ success: false, error: { code: 'WRONG_PASSWORD', message: 'Current password is incorrect' } });
      }
      const hash = await bcrypt.hash(newPassword, 12);
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.sub]);
      });
      return reply.send({ success: true });
    });

    // ── ORG TREE ───────────────────────────────────────────────────────────
    // GET /settings/team/tree
    // Returns the full org hierarchy as a nested tree.
    // tenant_admin sees everything. manager sees their own subtree.
    // line_manager sees their own subtree. agent sees just themselves.
    // Each node includes a computed `is_online` flag (heartbeat < 90s ago).
    fastify.get('/team/tree', { preHandler: requireRole('super_admin', 'tenant_admin', 'manager', 'line_manager') }, async (req, reply) => {
      const role = (req.user as any).role as string;
      const userId = (req.user as any).sub as string;

      const rows = await db.withTenant(req.tenant.id, async (client) => {
        const r = await client.query(
          `SELECT id, email, name, role, department, department_type,
                  manager_id, max_direct_reports, is_active, avatar,
                  (last_active_at IS NOT NULL AND last_active_at > NOW() - INTERVAL '90 seconds') AS is_online,
                  last_active_at
           FROM users
           WHERE tenant_id = $1
           ORDER BY
             CASE role
               WHEN 'tenant_admin' THEN 1
               WHEN 'manager' THEN 2
               WHEN 'line_manager' THEN 3
               WHEN 'agent' THEN 4
               WHEN 'viewer' THEN 5
               ELSE 9
             END,
             name`,
          [req.tenant.id],
        );
        return r.rows;
      });

      // Build children map
      const byParent: Record<string, any[]> = {};
      const byId: Record<string, any> = {};
      for (const u of rows) {
        byId[u.id] = { ...u, children: [] };
        const k = u.manager_id ?? '__root__';
        (byParent[k] ??= []).push(u.id);
      }
      // Build subtrees recursively
      const buildSubtree = (uid: string): any => {
        const node = byId[uid];
        if (!node) return null;
        const kids = byParent[uid] ?? [];
        node.children = kids.map(buildSubtree).filter(Boolean);
        return node;
      };

      let treeRoots: any[] = [];
      if (role === 'tenant_admin' || role === 'super_admin') {
        // Roots = anyone with no manager (tenant_admin / managers / unattached)
        treeRoots = (byParent['__root__'] ?? []).map(buildSubtree).filter(Boolean);
      } else if (role === 'manager' || role === 'line_manager') {
        // See own subtree only
        const me = byId[userId];
        if (me) treeRoots = [buildSubtree(userId)];
      }

      return reply.send({
        success: true,
        data: {
          roots: treeRoots,
          // Useful for the org-chart sidebar: list of active managers/line_managers with capacity info
          managers: rows
            .filter(u => ['manager','line_manager'].includes(u.role) && u.is_active)
            .map(u => ({
              id: u.id,
              name: u.name,
              role: u.role,
              department_type: u.department_type,
              max_direct_reports: u.max_direct_reports,
              direct_reports: rows.filter(r => r.manager_id === u.id && r.is_active).length,
              is_online: u.is_online,
            })),
        },
      });
    });

  };
}
