/**
 * Custom Roles API
 * GET    /api/v1/roles          — list all roles (system + custom) for tenant
 * POST   /api/v1/roles          — create custom role
 * PATCH  /api/v1/roles/:id      — update role name/description/permissions
 * DELETE /api/v1/roles/:id      — delete custom role (not system)
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';

type ActionType = 'read' | 'write' | 'danger';
interface ModuleAction { key: string; label: string; type: ActionType; }

export const MODULE_DEFS = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊', actions: [
    { key: 'dashboard:read',   label: 'View dashboard & KPI widgets',       type: 'read'  as ActionType },
  ] as ModuleAction[] },
  { key: 'contacts', label: 'Contacts', icon: '👥', actions: [
    { key: 'contacts:read',   label: 'View contacts',                       type: 'read'   as ActionType },
    { key: 'contacts:create', label: 'Create contacts',                     type: 'write'  as ActionType },
    { key: 'contacts:edit',   label: 'Edit contacts',                       type: 'write'  as ActionType },
    { key: 'contacts:delete', label: 'Delete contacts',                     type: 'danger' as ActionType },
  ] as ModuleAction[] },
  { key: 'companies', label: 'Companies', icon: '🏢', actions: [
    { key: 'companies:read',   label: 'View companies',                     type: 'read'   as ActionType },
    { key: 'companies:create', label: 'Create companies',                   type: 'write'  as ActionType },
    { key: 'companies:edit',   label: 'Edit companies',                     type: 'write'  as ActionType },
    { key: 'companies:delete', label: 'Delete companies',                   type: 'danger' as ActionType },
  ] as ModuleAction[] },
  { key: 'deals', label: 'Deals', icon: '💼', actions: [
    { key: 'deals:read',   label: 'View deals & pipelines',                 type: 'read'   as ActionType },
    { key: 'deals:create', label: 'Create deals',                           type: 'write'  as ActionType },
    { key: 'deals:move',   label: 'Move deals between stages',              type: 'write'  as ActionType },
    { key: 'deals:close',  label: 'Close & mark deals won/lost',            type: 'write'  as ActionType },
    { key: 'deals:delete', label: 'Delete deals',                           type: 'danger' as ActionType },
  ] as ModuleAction[] },
  { key: 'activities', label: 'Activities', icon: '📅', actions: [
    { key: 'activities:read',     label: 'View activities & tasks',         type: 'read'   as ActionType },
    { key: 'activities:create',   label: 'Create activities',               type: 'write'  as ActionType },
    { key: 'activities:edit',     label: 'Edit activities',                 type: 'write'  as ActionType },
    { key: 'activities:complete', label: 'Mark activities complete',        type: 'write'  as ActionType },
    { key: 'activities:delete',   label: 'Delete activities',               type: 'danger' as ActionType },
  ] as ModuleAction[] },
  { key: 'tickets', label: 'Tickets', icon: '🎫', actions: [
    { key: 'tickets:read',    label: 'View tickets & comments',             type: 'read'   as ActionType },
    { key: 'tickets:create',  label: 'Create tickets',                      type: 'write'  as ActionType },
    { key: 'tickets:assign',  label: 'Assign tickets to agents',            type: 'write'  as ActionType },
    { key: 'tickets:resolve', label: 'Resolve & close tickets',             type: 'write'  as ActionType },
    { key: 'tickets:delete',  label: 'Delete tickets',                      type: 'danger' as ActionType },
  ] as ModuleAction[] },
  { key: 'emails', label: 'Emails', icon: '📧', actions: [
    { key: 'emails:read',    label: 'View inbox & email threads',           type: 'read'   as ActionType },
    { key: 'emails:compose', label: 'Compose & send new emails',            type: 'write'  as ActionType },
    { key: 'emails:reply',   label: 'Reply to emails',                      type: 'write'  as ActionType },
    { key: 'emails:delete',  label: 'Delete emails',                        type: 'danger' as ActionType },
  ] as ModuleAction[] },
  { key: 'analytics', label: 'Analytics', icon: '📈', actions: [
    { key: 'analytics:read',   label: 'View reports & dashboards',          type: 'read'  as ActionType },
    { key: 'analytics:export', label: 'Export reports & data',              type: 'write' as ActionType },
  ] as ModuleAction[] },
  { key: 'voice', label: 'Voice Calls', icon: '📞', actions: [
    { key: 'voice:read',       label: 'View call logs',                     type: 'read'  as ActionType },
    { key: 'voice:call',       label: 'Make & receive calls',               type: 'write' as ActionType },
    { key: 'voice:recordings', label: 'Access call recordings',             type: 'read'  as ActionType },
  ] as ModuleAction[] },
  { key: 'voicebot', label: 'Voice Bot', icon: '🤖', actions: [
    { key: 'voicebot:read',      label: 'View bot activity & transcripts',  type: 'read'  as ActionType },
    { key: 'voicebot:configure', label: 'Configure IVR flows & bot settings', type: 'write' as ActionType },
  ] as ModuleAction[] },
  { key: 'integrations', label: 'Integrations', icon: '🔌', actions: [
    { key: 'integrations:read',      label: 'View connected integrations',  type: 'read'  as ActionType },
    { key: 'integrations:configure', label: 'Configure webhooks & apps',    type: 'write' as ActionType },
  ] as ModuleAction[] },
  { key: 'settings', label: 'Settings', icon: '⚙️', actions: [
    { key: 'settings:read', label: 'View workspace settings',               type: 'read'  as ActionType },
    { key: 'settings:edit', label: 'Modify workspace settings',             type: 'write' as ActionType },
  ] as ModuleAction[] },
  { key: 'billing', label: 'Billing', icon: '💳', actions: [
    { key: 'billing:read',   label: 'View billing info & invoices',         type: 'read'  as ActionType },
    { key: 'billing:manage', label: 'Manage billing & subscriptions',       type: 'write' as ActionType },
  ] as ModuleAction[] },
];

// Migrate old { module: 'none'|'view'|'full' } format to granular boolean map
export function migrateLegacyPermissions(legacy: Record<string, string>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const mod of MODULE_DEFS) {
    const level = legacy[mod.key] ?? 'none';
    for (const action of mod.actions) {
      result[action.key] = action.type === 'read' ? level !== 'none' : level === 'full' || level === 'write';
    }
  }
  return result;
}

export function isLegacyPermissions(perms: Record<string, unknown>): boolean {
  return Object.values(perms).some((v) => v === 'none' || v === 'view' || v === 'full');
}

export function defaultPermissions(baseRole: string): Record<string, boolean> {
  const none = Object.fromEntries(MODULE_DEFS.flatMap((m) => m.actions.map((a) => [a.key, false])));
  const all  = Object.fromEntries(MODULE_DEFS.flatMap((m) => m.actions.map((a) => [a.key, true])));

  switch (baseRole) {
    case 'tenant_admin': return all;

    case 'manager': return {
      ...none,
      'dashboard:read': true,
      'contacts:read': true,  'contacts:create': true,  'contacts:edit': true,  'contacts:delete': false,
      'companies:read': true, 'companies:create': true, 'companies:edit': true, 'companies:delete': false,
      'deals:read': true,     'deals:create': true,     'deals:move': true,     'deals:close': true,  'deals:delete': false,
      'activities:read': true,'activities:create': true,'activities:edit': true,'activities:complete': true,'activities:delete': false,
      'tickets:read': true,   'tickets:create': true,   'tickets:assign': true, 'tickets:resolve': true,   'tickets:delete': false,
      'emails:read': true,    'emails:compose': true,   'emails:reply': true,   'emails:delete': false,
      'analytics:read': true, 'analytics:export': true,
      'voice:read': true,     'voice:call': true,        'voice:recordings': true,
      'voicebot:read': true,  'voicebot:configure': false,
      'integrations:read': true, 'integrations:configure': false,
      'settings:read': true,  'settings:edit': false,
      'billing:read': false,  'billing:manage': false,
    };

    case 'agent': return {
      ...none,
      'dashboard:read': true,
      'contacts:read': true,  'contacts:create': true,  'contacts:edit': true,  'contacts:delete': false,
      'companies:read': true, 'companies:create': false,'companies:edit': false,'companies:delete': false,
      'deals:read': true,     'deals:create': false,    'deals:move': true,     'deals:close': false, 'deals:delete': false,
      'activities:read': true,'activities:create': true,'activities:edit': true,'activities:complete': true,'activities:delete': false,
      'tickets:read': true,   'tickets:create': true,   'tickets:assign': false,'tickets:resolve': true,   'tickets:delete': false,
      'emails:read': true,    'emails:compose': true,   'emails:reply': true,   'emails:delete': false,
      'analytics:read': false,'analytics:export': false,
      'voice:read': true,     'voice:call': true,        'voice:recordings': false,
      'voicebot:read': false, 'voicebot:configure': false,
      'integrations:read': false,'integrations:configure': false,
      'settings:read': false, 'settings:edit': false,
      'billing:read': false,  'billing:manage': false,
    };

    case 'viewer':
    default: return {
      ...none,
      'dashboard:read': true,
      'contacts:read': true,
      'companies:read': true,
      'deals:read': true,
      'activities:read': true,
      'tickets:read': true,
      'emails:read': true,
      'analytics:read': true,
    };
  }
}

const ROLE_HIERARCHY: Record<string, number> = {
  super_admin: 50, platform_admin: 45, tenant_admin: 40,
  manager: 30, agent: 20, viewer: 10,
};

export function rolesRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // GET /api/v1/roles — list all roles for tenant (system built-ins + custom DB rows)
    fastify.get('/', async (req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT id, name, description, color, is_system, base_role, permissions, created_at
           FROM roles WHERE tenant_id = $1 ORDER BY is_system DESC, created_at ASC`,
          [req.tenant.id],
        );
        return r.rows;
      });

      // Count users by both built-in role string and custom_role_id
      const userCounts = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT role, custom_role_id, COUNT(*) as count
           FROM users WHERE tenant_id = $1 GROUP BY role, custom_role_id`,
          [req.tenant.id],
        );
        return r.rows;
      });

      const customCounts: Record<string, number> = {};
      const builtinCounts: Record<string, number> = {};
      for (const row of userCounts) {
        if (row.custom_role_id) customCounts[row.custom_role_id] = (customCounts[row.custom_role_id] ?? 0) + parseInt(row.count);
        else builtinCounts[row.role] = (builtinCounts[row.role] ?? 0) + parseInt(row.count);
      }

      // Check if tenant has saved custom permissions for system roles
      // Migrate legacy format (none/view/full) to granular booleans on read
      const systemOverrides: Record<string, Record<string, boolean>> = {};
      for (const row of rows.filter((r: any) => r.is_system)) {
        const perms = row.permissions ?? {};
        systemOverrides[row.base_role] = isLegacyPermissions(perms)
          ? migrateLegacyPermissions(perms)
          : perms;
      }

      const SYSTEM_ROLES = [
        { id: 'tenant_admin', name: 'Admin',   description: 'Full workspace access',      color: '#dc2626', is_system: true, base_role: 'tenant_admin', permissions: systemOverrides['tenant_admin'] ?? defaultPermissions('tenant_admin') },
        { id: 'manager',      name: 'Manager', description: 'Team management & records',  color: '#d97706', is_system: true, base_role: 'manager',      permissions: systemOverrides['manager']      ?? defaultPermissions('manager') },
        { id: 'agent',        name: 'Agent',   description: 'Day-to-day CRM operations',  color: '#2563eb', is_system: true, base_role: 'agent',         permissions: systemOverrides['agent']        ?? defaultPermissions('agent') },
        { id: 'viewer',       name: 'Viewer',  description: 'Read-only access',           color: '#6b7280', is_system: true, base_role: 'viewer',        permissions: systemOverrides['viewer']       ?? defaultPermissions('viewer') },
      ].map((r) => ({ ...r, created_at: null, user_count: builtinCounts[r.base_role] ?? 0 }));

      // Exclude system role DB rows from custom list; migrate legacy permissions
      const customData = rows
        .filter((r: any) => !r.is_system)
        .map((row: any) => {
          const perms = row.permissions ?? {};
          return {
            ...row,
            permissions: isLegacyPermissions(perms) ? migrateLegacyPermissions(perms) : perms,
            user_count: customCounts[row.id] ?? 0,
          };
        });
      return reply.send({ success: true, data: [...SYSTEM_ROLES, ...customData] });
    });

    // GET /api/v1/roles/modules — module definitions
    fastify.get('/modules', async (_req, reply) => {
      return reply.send({ success: true, data: MODULE_DEFS });
    });

    // GET /api/v1/roles/defaults/:baseRole — default permissions for a base role
    fastify.get('/defaults/:baseRole', async (req, reply) => {
      const { baseRole } = req.params as { baseRole: string };
      return reply.send({ success: true, data: defaultPermissions(baseRole) });
    });

    // POST /api/v1/roles — create custom role
    fastify.post('/', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { name, description, color, base_role, permissions } = req.body as {
        name: string; description?: string; color?: string;
        base_role: string; permissions?: Record<string, string>;
      };

      if (!name?.trim()) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'Role name is required' } });
      }
      if (!ROLE_HIERARCHY[base_role] || base_role === 'super_admin' || base_role === 'platform_admin') {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_BASE_ROLE', message: 'Invalid base role' } });
      }

      const perms = permissions ?? defaultPermissions(base_role);

      const [role] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `INSERT INTO roles (tenant_id, name, description, color, is_system, base_role, permissions)
           VALUES ($1, $2, $3, $4, false, $5, $6)
           RETURNING id, name, description, color, is_system, base_role, permissions`,
          [req.tenant.id, name.trim(), description ?? null, color ?? '#6366f1', base_role, JSON.stringify(perms)],
        );
        return r.rows;
      });

      return reply.code(201).send({ success: true, data: { ...role, user_count: 0 } });
    });

    // PATCH /api/v1/roles/:id — update role
    fastify.patch('/:id', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { name, description, color, permissions } = req.body as {
        name?: string; description?: string; color?: string; permissions?: Record<string, string>;
      };

      // Handle system role IDs (not UUIDs — upsert permissions into DB)
      const SYSTEM_ROLE_META: Record<string, { name: string; color: string }> = {
        tenant_admin: { name: 'Admin',   color: '#dc2626' },
        manager:      { name: 'Manager', color: '#d97706' },
        agent:        { name: 'Agent',   color: '#2563eb' },
        viewer:       { name: 'Viewer',  color: '#6b7280' },
      };
      if (id in SYSTEM_ROLE_META) {
        if (name || description) {
          return reply.code(400).send({ success: false, error: { code: 'SYSTEM_ROLE', message: 'Cannot rename system roles. You can only edit their permissions.' } });
        }
        if (!permissions) return reply.send({ success: true, data: null });

        const meta = SYSTEM_ROLE_META[id];
        // Check if an override row already exists for this system role
        const existingOverride = await db.withSuperAdmin(async (client) => {
          const r = await client.query(
            `SELECT id FROM roles WHERE tenant_id = $1 AND base_role = $2 AND is_system = true`,
            [req.tenant.id, id],
          );
          return r.rows[0] ?? null;
        });

        if (existingOverride) {
          await db.withSuperAdmin(async (client) => {
            await client.query(
              `UPDATE roles SET permissions = $1, updated_at = NOW() WHERE id = $2`,
              [JSON.stringify(permissions), existingOverride.id],
            );
          });
        } else {
          await db.withSuperAdmin(async (client) => {
            await client.query(
              `INSERT INTO roles (tenant_id, name, description, color, is_system, base_role, permissions)
               VALUES ($1, $2, $3, $4, true, $5, $6)`,
              [req.tenant.id, meta.name, null, meta.color, id, JSON.stringify(permissions)],
            );
          });
        }

        // Propagate to all users on this built-in role (no custom_role_id)
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE users SET permissions = $1 WHERE tenant_id = $2 AND role = $3 AND custom_role_id IS NULL`,
            [JSON.stringify(permissions), req.tenant.id, id],
          );
        });

        return reply.send({ success: true, data: { id, name: meta.name, color: meta.color, is_system: true, base_role: id, permissions } });
      }

      // Custom role — check ownership
      const [existing] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT * FROM roles WHERE id = $1 AND tenant_id = $2', [id, req.tenant.id]);
        return r.rows;
      });
      if (!existing) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Role not found' } });

      const updates: string[] = [];
      const vals: any[] = [];
      let i = 1;

      if (name !== undefined) { updates.push(`name = $${i++}`); vals.push(name.trim()); }
      if (description !== undefined) { updates.push(`description = $${i++}`); vals.push(description); }
      if (color !== undefined) { updates.push(`color = $${i++}`); vals.push(color); }
      if (permissions !== undefined) { updates.push(`permissions = $${i++}`); vals.push(JSON.stringify(permissions)); }

      // System roles: only permissions can be changed, not name/description
      if (existing.is_system && (name || description)) {
        return reply.code(400).send({ success: false, error: { code: 'SYSTEM_ROLE', message: 'Cannot rename system roles. You can only edit their permissions.' } });
      }

      if (updates.length === 0) return reply.send({ success: true, data: existing });

      updates.push(`updated_at = NOW()`);
      vals.push(id);

      const [role] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `UPDATE roles SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
          vals,
        );
        return r.rows;
      });

      // If permissions changed, update all users with this role
      if (permissions) {
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE users SET permissions = $1 WHERE custom_role_id = $2`,
            [JSON.stringify(permissions), id],
          );
        });
      }

      return reply.send({ success: true, data: role });
    });

    // DELETE /api/v1/roles/:id — delete custom role
    fastify.delete('/:id', { preHandler: requireRole('super_admin', 'tenant_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };

      const [existing] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT * FROM roles WHERE id = $1 AND tenant_id = $2', [id, req.tenant.id]);
        return r.rows;
      });
      if (!existing) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Role not found' } });
      if (existing.is_system) return reply.code(400).send({ success: false, error: { code: 'SYSTEM_ROLE', message: 'System roles cannot be deleted' } });

      // Check if any users have this role
      const [{ count }] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT COUNT(*) as count FROM users WHERE custom_role_id = $1', [id]);
        return r.rows;
      });
      if (parseInt(count) > 0) {
        return reply.code(400).send({ success: false, error: { code: 'ROLE_IN_USE', message: `This role is assigned to ${count} user(s). Reassign them before deleting.` } });
      }

      await db.withSuperAdmin(async (client) => {
        await client.query('DELETE FROM roles WHERE id = $1', [id]);
      });

      return reply.code(204).send();
    });
  };
}
