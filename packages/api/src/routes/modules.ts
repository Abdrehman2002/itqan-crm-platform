/**
 * GET /api/v1/modules
 *
 * Returns the list of active platform modules for the authenticated tenant,
 * each with their nav items. The frontend uses this to build the sidebar
 * dynamically — no hardcoding required.
 *
 * Role-aware filtering: each navItem is filtered based on the calling user's
 * role so an agent doesn't see Builder/Reports/Settings in their sidebar.
 */

import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@crm/core';

// Role hierarchy used for path-based filtering (mirrors auth.middleware.ts)
const ROLE_LEVEL: Record<string, number> = {
  super_admin:  50,
  tenant_admin: 40,
  manager:      30,
  line_manager: 25,
  agent:        20,
  viewer:       10,
};

// Minimum role required to SEE each nav path in the sidebar.
// Anything not listed here is available to everyone (agent and above).
const PATH_MIN_ROLE: Record<string, number> = {
  // Admin-only configuration
  '/settings':           ROLE_LEVEL.tenant_admin,
  '/roles':              ROLE_LEVEL.tenant_admin,
  '/sales/settings':     ROLE_LEVEL.tenant_admin,
  '/tickets/queues':     ROLE_LEVEL.tenant_admin,
  '/tickets/sla':        ROLE_LEVEL.tenant_admin,
  '/integrations':       ROLE_LEVEL.tenant_admin,
  '/billing':            ROLE_LEVEL.tenant_admin,
  '/voice-bot':          ROLE_LEVEL.tenant_admin,    // bot config
  '/super-admin':        ROLE_LEVEL.super_admin,

  // Manager-level dashboards and templates
  '/sales/dashboard':    ROLE_LEVEL.manager,
  '/sales/reports':      ROLE_LEVEL.manager,
  '/sales/templates':    ROLE_LEVEL.manager,
  '/sales/builder':      ROLE_LEVEL.manager,
  '/analytics':          ROLE_LEVEL.manager,
  '/voice/analytics':    ROLE_LEVEL.manager,
  '/team-reports':       ROLE_LEVEL.manager,
  '/organization':       ROLE_LEVEL.line_manager,    // line_manager+ can see own subtree
};

export function modulesRoute(moduleRegistry: ModuleRegistry) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', async (req, reply) => {
      const tenant = req.tenant;
      const userRole = (req.user as any)?.role as string ?? 'agent';
      const userLevel = ROLE_LEVEL[userRole] ?? 0;

      // Determine which modules this tenant has active.
      // active_modules is a DB column (text[]); default to ['crm'] if not set.
      const activeModuleIds: string[] =
        (tenant as any).active_modules ?? tenant.activeModules ?? ['crm'];

      const modules = moduleRegistry.getActiveModulesForTenant(activeModuleIds);

      // Filter navItems within each module by user role.
      const filtered = modules
        .map(mod => ({
          ...mod,
          navItems: (mod.navItems ?? []).filter((item: any) => {
            const minRole = PATH_MIN_ROLE[item.path];
            // No restriction declared → visible to everyone (agent+)
            if (minRole === undefined) return true;
            return userLevel >= minRole;
          }),
        }))
        // Drop modules whose entire navItems list got filtered away
        .filter(mod => mod.navItems.length > 0);

      return reply.send({ success: true, data: filtered });
    });
  };
}
