/**
 * CRM Platform Module
 *
 * The core CRM "Hub" — equivalent to HubSpot's CRM Hub.
 * Bundles: Contacts, Companies, Deals, Activities, and the CRM Dashboard.
 *
 * This module is always active (included in every tenant's activeModules by default).
 */

import type { FastifyInstance } from 'fastify';
import type { PlatformModule, ModuleContext } from '@crm/shared';
import { logger } from '@crm/core/config/logger';

export class CRMPlatformModule implements PlatformModule {
  readonly id = 'crm';
  readonly label = 'CRM';
  readonly icon = 'LayoutDashboard';
  readonly requiredPlan = 'free' as const;

  readonly navItems = [
    // permissionKey gates each nav item against the user's role-derived
    // permissions (see modules.ts filter). Without these, an agent whose
    // 'deals:read'/'analytics:read'=false would still see the tiles.
    { path: '/dashboard',  label: 'Dashboard',  icon: 'LayoutDashboard', permissionKey: 'dashboard:read' },
    { path: '/contacts',   label: 'Contacts',   icon: 'Users',           permissionKey: 'contacts:read' },
    { path: '/companies',  label: 'Companies',  icon: 'Building2',       permissionKey: 'companies:read' },
    { path: '/deals',      label: 'Deals',      icon: 'TrendingUp',      permissionKey: 'deals:read' },
    { path: '/activities', label: 'Activities', icon: 'CheckSquare',     permissionKey: 'activities:read' },
    { path: '/emails',     label: 'Emails',     icon: 'Mail',            permissionKey: 'emails:read' },
    { path: '/analytics',  label: 'Analytics',  icon: 'BarChart3',       permissionKey: 'analytics:read' },
  ];

  async onLoad(_ctx: ModuleContext): Promise<void> {
    logger.info('CRM Platform Module loaded');
  }

  async onUnload(): Promise<void> {
    logger.info('CRM Platform Module unloaded');
  }

  async registerRoutes(fastify: FastifyInstance, prefix: string): Promise<void> {
    // Routes are registered individually in server.ts under /api/v1/*.
    // This hook is available for module-owned route registration if needed.
    logger.info(`CRM routes registered under ${prefix}`);
  }
}
