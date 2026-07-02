/**
 * GET /api/v1/modules
 *
 * Returns the active platform modules for the authenticated tenant with nav items
 * filtered to only those the calling user's role has permission to access.
 */

import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@crm/core';

// Nav path → the licensed feature that unlocks it. A nav item is hidden when the
// tenant isn't entitled to its feature. Paths not listed here are always shown
// (overview pages like /sales/dashboard, or surfaces not gated by licensing).
const NAV_FEATURE_MAP: Record<string, string> = {
  '/contacts':        'crm.contacts',
  '/companies':       'crm.companies',
  '/deals':           'crm.deals',
  '/activities':      'crm.activities',
  '/sales/invoices':  'sales.invoices',
  '/sales/contacts':  'sales.contacts',
  '/sales/payments':  'sales.payments',
  '/sales/reports':   'sales.reports',
  '/sales/templates': 'sales.templates',
  '/sales/builder':   'sales.templates',
  '/sales/settings':  'sales.settings',
};

// Remove nav items whose licensed feature the tenant doesn't have, then drop any
// module left with no nav items. Legacy tenants (no recorded entitlement) see all.
function filterByEntitlement<T extends { navItems: any[] }>(modules: T[], entitled: string[]): T[] {
  if (!Array.isArray(entitled) || entitled.length === 0) return modules;
  return modules
    .map((mod) => ({
      ...mod,
      navItems: mod.navItems.filter((item: any) => {
        const feature = NAV_FEATURE_MAP[item.path];
        return !feature || entitled.includes(feature);
      }),
    }))
    .filter((mod) => mod.navItems.length > 0);
}

export function modulesRoute(moduleRegistry: ModuleRegistry) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', async (req, reply) => {
      const tenant = req.tenant;
      const user   = req.user as any;

      const activeModuleIds: string[] =
        (tenant as any).active_modules ?? tenant.activeModules ?? ['crm'];

      const entitledFeatures: string[] = (tenant as any).entitled_features ?? [];

      const allModules = filterByEntitlement(
        moduleRegistry.getActiveModulesForTenant(activeModuleIds),
        entitledFeatures,
      );

      const role = user?.role ?? 'agent';

      // Super admin: exclude ticketing module and voice bot nav items
      if (role === 'super_admin') {
        const superAdminModules = allModules
          .filter((mod) => mod.id !== 'ticketing')
          .map((mod) => {
            if (mod.id !== 'voice') return mod;
            return {
              ...mod,
              navItems: mod.navItems.filter((item: any) => item.permissionKey !== 'voicebot:read'),
            };
          });
        return reply.send({ success: true, data: superAdminModules });
      }

      // Tenant admin always sees every nav item for their tenant's modules
      if (role === 'tenant_admin') {
        return reply.send({ success: true, data: allModules });
      }

      // For all other roles filter nav items by the permissions embedded in the JWT.
      // Two formats exist:
      //   New: { 'contacts:read': true }   — from defaultPermissions()
      //   Old: { contacts: 'full'|'view'|'none' } — from legacy custom roles
      const perms: Record<string, unknown> = user?.permissions ?? {};

      function hasPermission(permKey: string): boolean {
        // New format check
        if (perms[permKey] === true) return true;
        // Old format: strip the action suffix, check module-level value
        const module = permKey.split(':')[0];
        const val = perms[module];
        return val === 'full' || val === 'view';
      }

      // Department-scope for line-of-business roles (agent, line_manager, viewer).
      // Managers and above see everything their tenant is entitled to; a customer
      // support agent should NOT see the Sales module in their sidebar (Sales
      // invoicing/payments is a different line of business), and vice versa.
      // Nadia/Sara/Zara webhooks route by department_type, so this is the same
      // scoping the ticket queues already use.
      const dept: string | null = user?.department_type ?? null;
      const scopedRoles = new Set(['agent', 'line_manager', 'viewer']);
      const excludedModulesByDept: Record<string, string[]> = {
        // Support + complaint agents: no sales invoicing, no CRM deals pipeline.
        support:   ['sales', 'deals'],
        complaint: ['sales', 'deals'],
        // Sales agents: no complaint-specific analytics module (if it exists).
        sales:     [],
      };
      const excludedIds = (scopedRoles.has(role) && dept && excludedModulesByDept[dept])
        ? new Set(excludedModulesByDept[dept])
        : new Set<string>();

      const filtered = allModules
        .filter((mod) => !excludedIds.has(mod.id))
        .map((mod) => ({
          ...mod,
          navItems: mod.navItems.filter((item: any) =>
            !item.permissionKey || hasPermission(item.permissionKey),
          ),
        }))
        .filter((mod) => mod.navItems.length > 0);

      return reply.send({ success: true, data: filtered });
    });
  };
}
