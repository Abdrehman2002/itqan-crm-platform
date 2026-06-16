/**
 * GET /api/v1/modules
 *
 * Returns the list of active platform modules for the authenticated tenant,
 * each with their nav items. The frontend uses this to build the sidebar
 * dynamically — no hardcoding required.
 */

import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@crm/core';

export function modulesRoute(moduleRegistry: ModuleRegistry) {
  return async function (fastify: FastifyInstance) {
    fastify.get('/', async (req, reply) => {
      const tenant = req.tenant;

      // Determine which modules this tenant has active.
      // active_modules is a DB column (text[]); default to ['crm'] if not set.
      const activeModuleIds: string[] =
        (tenant as any).active_modules ?? tenant.activeModules ?? ['crm'];

      const modules = moduleRegistry.getActiveModulesForTenant(activeModuleIds);

      return reply.send({ success: true, data: modules });
    });
  };
}
