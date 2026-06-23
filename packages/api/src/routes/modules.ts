/**
 * GET /api/v1/modules
 *
 * Returns the sidebar nav for the authenticated user, tailored to their role.
 *
 *  - Tenant Admin → ONLY admin/structural items (Org chart, Departments, Users,
 *    Roles, Modules, Integrations, Billing, Workspace Settings). No operational
 *    items (no tickets, no contacts, no voice calls). They oversee structure,
 *    not day-to-day work.
 *
 *  - Manager (HOD) → operational items for their department + Team Reports
 *    + their subtree on Organization. No platform admin.
 *
 *  - Line Manager → same as Manager minus the manager-only analytics widgets.
 *
 *  - Agent → ONLY their own assignments ("My X" view labels in the UI). No
 *    department-wide visibility.
 *
 *  - Viewer → same nav as Agent (write controls hidden by the frontend).
 */

import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@crm/core';

type Role = 'super_admin' | 'tenant_admin' | 'manager' | 'line_manager' | 'agent' | 'viewer';

/**
 * Per-path explicit allow-list. If a path appears here, ONLY the listed roles
 * see it in the sidebar. If a path is NOT in this map, it defaults to
 * VISIBLE for everyone EXCEPT tenant_admin (operational items hidden from admin).
 */
const PATH_ALLOWED_ROLES: Record<string, Role[]> = {
  // ── Universal (every authenticated role) ─────────────────────────────
  '/dashboard':           ['tenant_admin', 'manager', 'line_manager', 'agent', 'viewer'],
  '/personal-settings':   ['tenant_admin', 'manager', 'line_manager', 'agent', 'viewer'],

  // ── Tenant-admin-only (structural / setup) ───────────────────────────
  '/organization':        ['tenant_admin', 'manager', 'line_manager'],   // tenant_admin full tree; mgrs own subtree
  '/departments':         ['tenant_admin'],
  '/users':               ['tenant_admin'],
  '/roles':               ['tenant_admin'],
  '/modules':             ['tenant_admin'],
  '/integrations':        ['tenant_admin'],
  '/billing':             ['tenant_admin'],
  '/settings':            ['tenant_admin'],
  '/voice-bot':           ['tenant_admin'],   // bot config

  // ── Manager-tier only (cross-team analytics) ─────────────────────────
  '/team-reports':        ['manager', 'line_manager'],
  '/sales/dashboard':     ['manager'],
  '/sales/reports':       ['manager'],
  '/sales/templates':     ['manager'],
  '/sales/builder':       ['manager'],
  '/sales/settings':      ['tenant_admin'],
  '/analytics':           ['manager'],
  '/voice/analytics':     ['manager'],
  '/tickets/queues':      ['tenant_admin'],
  '/tickets/sla':         ['tenant_admin'],

  // ── Operational (Manager / Line Manager / Agent / Viewer — NOT tenant_admin) ──
  '/contacts':            ['manager', 'line_manager', 'agent', 'viewer'],
  '/companies':           ['manager', 'line_manager', 'agent', 'viewer'],
  '/deals':               ['manager', 'line_manager', 'agent', 'viewer'],
  '/opportunities':       ['manager', 'line_manager', 'agent', 'viewer'],
  '/activities':          ['manager', 'line_manager', 'agent', 'viewer'],
  '/tickets':             ['manager', 'line_manager', 'agent', 'viewer'],
  '/voice-bot/calls':     ['manager', 'line_manager', 'agent', 'viewer'],
  '/voice-bot/tickets':   ['manager', 'line_manager', 'agent', 'viewer'],
  '/voice':               ['manager', 'line_manager', 'agent', 'viewer'],
  '/voice/calls':         ['manager', 'line_manager', 'agent', 'viewer'],
  '/emails':              ['manager', 'line_manager', 'agent', 'viewer'],

  // ── Sales Invoicing (Manager / Line Manager only — agents don't touch billing) ──
  '/sales/invoices':      ['manager', 'line_manager'],
  '/sales/contacts':      ['manager', 'line_manager'],
  '/sales/payments':      ['manager', 'line_manager'],

  // Super-admin is platform-level — already gated in server.ts (blocked from /api/v1/*)
  '/super-admin':         ['super_admin'],
};

/**
 * Synthetic nav groups injected per role. These items don't come from a
 * platform module — they're admin/personal pages owned at the app level.
 *
 * Tenant Admin gets a fully custom "Admin" sidebar instead of inheriting
 * the operational modules.
 */
function buildAdminModule(): { id: string; label: string; icon: string; navItems: any[] } {
  return {
    id: 'admin',
    label: 'Admin',
    icon: 'Shield',
    navItems: [
      { path: '/dashboard',     label: 'Dashboard',     icon: 'LayoutDashboard' },
      { path: '/organization',  label: 'Organization',  icon: 'Users' },
      { path: '/departments',   label: 'Departments',   icon: 'Layers' },
      { path: '/users',         label: 'Users & Team',  icon: 'Users' },
      { path: '/roles',         label: 'Roles',         icon: 'Shield' },
      { path: '/modules',       label: 'Modules',       icon: 'Layers' },
      { path: '/integrations',  label: 'Integrations',  icon: 'Zap' },
      { path: '/billing',       label: 'Billing & Plan', icon: 'CreditCard' },
      { path: '/settings',      label: 'Workspace Settings', icon: 'Settings' },
      { path: '/personal-settings', label: 'My Profile', icon: 'Settings' },
    ],
  };
}

function buildPersonalGroup(): { id: string; label: string; icon: string; navItems: any[] } {
  return {
    id: 'personal',
    label: 'Personal',
    icon: 'Settings',
    navItems: [
      { path: '/personal-settings', label: 'My Profile', icon: 'Settings' },
    ],
  };
}

export function modulesRoute(moduleRegistry: ModuleRegistry) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', async (req, reply) => {
      const tenant = req.tenant;
      const role = ((req.user as any)?.role as Role) ?? 'agent';

      // ── Tenant Admin gets the bespoke Admin sidebar — no operational tabs ──
      if (role === 'tenant_admin') {
        return reply.send({ success: true, data: [buildAdminModule()] });
      }

      // ── Super Admin / Manager / Line Manager / Agent / Viewer: dynamic module list ──
      // Super admin sees the same operational sidebar as a manager (CRM / Voice / Sales
      // sections from their own tenant's active_modules) PLUS the gold super_admin
      // footer links that App.tsx renders. This matches Munir's reference UI.
      const activeModuleIds: string[] =
        (tenant as any).active_modules ?? tenant.activeModules ?? ['crm'];

      const modules = moduleRegistry.getActiveModulesForTenant(activeModuleIds);

      const filtered = modules
        .map(mod => ({
          ...mod,
          navItems: (mod.navItems ?? []).filter((item: any) => {
            const allowed = PATH_ALLOWED_ROLES[item.path];
            if (!allowed) return true; // unknown paths default visible
            if (role === 'super_admin') return true; // super_admin sees every operational item
            return allowed.includes(role);
          }),
        }))
        .filter(mod => mod.navItems.length > 0);

      // Inject Personal group so they have somewhere to manage profile
      const out = [...filtered];
      const hasPersonal = out.some(m => m.navItems.some((i: any) => i.path === '/personal-settings'));
      if (!hasPersonal) out.push(buildPersonalGroup());

      // Add Organization + Team Reports for managers / line_managers as a top group
      if (role === 'manager' || role === 'line_manager') {
        out.unshift({
          id: 'team',
          label: role === 'manager' ? 'My Department' : 'My Team',
          icon: 'Users',
          navItems: [
            { path: '/dashboard',    label: 'Dashboard',    icon: 'LayoutDashboard' },
            { path: '/organization', label: 'Team Hierarchy', icon: 'Users' },
            ...(role === 'manager'
              ? [{ path: '/team-reports', label: 'Team Reports', icon: 'BarChart3' }]
              : []),
          ],
        });
        // Strip dashboard from other modules to avoid duplicate link
        for (const m of out) {
          if (m.id !== 'team') {
            m.navItems = m.navItems.filter((i: any) => i.path !== '/dashboard');
          }
        }
      }

      return reply.send({ success: true, data: out });
    });
  };
}
