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

export const MODULE_DEFS = [
  { key: 'dashboard',    label: 'Dashboard',     icon: '📊', levels: ['none', 'view'] },
  { key: 'contacts',     label: 'Contacts',      icon: '👥', levels: ['none', 'view', 'full'] },
  { key: 'companies',    label: 'Companies',     icon: '🏢', levels: ['none', 'view', 'full'] },
  { key: 'deals',        label: 'Deals',         icon: '💼', levels: ['none', 'view', 'full'] },
  { key: 'activities',   label: 'Activities',    icon: '📅', levels: ['none', 'view', 'full'] },
  { key: 'tickets',      label: 'Tickets',       icon: '🎫', levels: ['none', 'view', 'full'] },
  { key: 'emails',       label: 'Emails',        icon: '📧', levels: ['none', 'view', 'full'] },
  { key: 'analytics',    label: 'Analytics',     icon: '📈', levels: ['none', 'view'] },
  { key: 'voice',        label: 'Voice Calls',   icon: '📞', levels: ['none', 'view', 'full'] },
  { key: 'voicebot',     label: 'Voice Bot',     icon: '🤖', levels: ['none', 'view', 'full'] },
  { key: 'integrations', label: 'Integrations',  icon: '🔌', levels: ['none', 'view', 'full'] },
  { key: 'settings',     label: 'Settings',      icon: '⚙️',  levels: ['none', 'view'] },
  { key: 'billing',      label: 'Billing',       icon: '💳', levels: ['none', 'view'] },
];

export function defaultPermissions(baseRole: string): Record<string, string> {
  switch (baseRole) {
    case 'tenant_admin':
      return Object.fromEntries(MODULE_DEFS.map((m) => [m.key, m.levels[m.levels.length - 1]]));
    case 'manager':
      return {
        dashboard: 'view', contacts: 'full', companies: 'full', deals: 'full',
        activities: 'full', tickets: 'full', emails: 'full', analytics: 'view',
        voice: 'full', voicebot: 'view', integrations: 'view', settings: 'none', billing: 'none',
      };
    case 'viewer':
      return Object.fromEntries(MODULE_DEFS.map((m) => [m.key, 'view' in m.levels ? 'view' : 'none']));
    case 'agent':
    default:
      return {
        dashboard: 'view', contacts: 'full', companies: 'view', deals: 'view',
        activities: 'full', tickets: 'full', emails: 'full', analytics: 'none',
        voice: 'view', voicebot: 'none', integrations: 'none', settings: 'none', billing: 'none',
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

      // Hardcoded system roles (not stored per-tenant in DB)
      const SYSTEM_ROLES = [
        { id: 'tenant_admin', name: 'Admin',   description: 'Full workspace access', color: '#dc2626', is_system: true, base_role: 'tenant_admin', permissions: defaultPermissions('tenant_admin') },
        { id: 'manager',      name: 'Manager', description: 'Team management & records', color: '#d97706', is_system: true, base_role: 'manager',      permissions: defaultPermissions('manager') },
        { id: 'agent',        name: 'Agent',   description: 'Day-to-day CRM operations', color: '#2563eb', is_system: true, base_role: 'agent',         permissions: defaultPermissions('agent') },
        { id: 'viewer',       name: 'Viewer',  description: 'Read-only access',       color: '#6b7280', is_system: true, base_role: 'viewer',        permissions: defaultPermissions('viewer') },
      ].map((r) => ({ ...r, created_at: null, user_count: builtinCounts[r.base_role] ?? 0 }));

      const customData = rows.map((row: any) => ({ ...row, user_count: customCounts[row.id] ?? 0 }));
      return reply.send({ success: true, data: [...SYSTEM_ROLES, ...customData] });
    });

    // GET /api/v1/roles/modules — module definitions
    // Frontend RoleModal expects { key, label, icon, actions: [{ key, label, type }] },
    // not the internal { levels: [] } shape. Transform on the way out so the
    // Edit Role modal renders instead of crashing on m.actions.map() (blank screen bug).
    fastify.get('/modules', async (_req, reply) => {
      const out = MODULE_DEFS.map((m) => {
        const actions: Array<{ key: string; label: string; type: 'read' | 'write' | 'danger' }> = [];
        // 'view' level → read action (always present unless level set is just ['none'])
        if (m.levels.includes('view')) {
          actions.push({ key: `${m.key}:read`, label: 'View', type: 'read' });
        }
        // 'full' level → write action (create/edit/manage)
        if (m.levels.includes('full')) {
          actions.push({ key: `${m.key}:write`, label: 'Create / Edit', type: 'write' });
          // Delete is implicit in 'full' for record-bearing modules — gate by key to
          // avoid showing 'Delete dashboard' which is nonsensical.
          if (['contacts','companies','deals','activities','tickets','emails'].includes(m.key)) {
            actions.push({ key: `${m.key}:delete`, label: 'Delete', type: 'danger' });
          }
        }
        return { key: m.key, label: m.label, icon: m.icon, actions };
      });
      return reply.send({ success: true, data: out });
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

      // Check ownership and system flag
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
