/**
 * Sales Platform Module
 *
 * Provides invoicing, billing contacts, payment tracking, and sales reporting.
 */
import type { FastifyInstance } from 'fastify';
import type { PlatformModule, ModuleContext } from '@crm/shared';
import { logger } from '@crm/core/config/logger';

export class SalesPlatformModule implements PlatformModule {
  readonly id = 'sales';
  readonly label = 'Sales';
  readonly icon = 'FileText';
  readonly requiredPlan = 'starter' as const;

  readonly navItems = [
    // permissionKey — see CRM module for rationale.
    { path: '/sales/dashboard',  label: 'Sales Dashboard', icon: 'LayoutDashboard', permissionKey: 'dashboard:read' },
    { path: '/sales/invoices',   label: 'Invoices',        icon: 'FileText',        permissionKey: 'billing:read' },
    { path: '/sales/contacts',   label: 'Bill Contacts',   icon: 'Users',           permissionKey: 'contacts:read' },
    { path: '/sales/payments',   label: 'Payments',        icon: 'CreditCard',      permissionKey: 'billing:read' },
    { path: '/sales/reports',    label: 'Reports',         icon: 'BarChart2',       permissionKey: 'analytics:read' },
    { path: '/sales/templates',  label: 'Templates',       icon: 'List',            permissionKey: 'billing:manage' },
    { path: '/sales/builder',    label: 'Builder',         icon: 'Layers',          permissionKey: 'billing:manage' },
    { path: '/sales/settings',   label: 'Sales Settings',  icon: 'Settings',        permissionKey: 'settings:edit' },
  ];

  async onLoad(_ctx: ModuleContext): Promise<void> {
    logger.info('Sales Platform Module loaded');
  }

  async onUnload(): Promise<void> {
    logger.info('Sales Platform Module unloaded');
  }

  async registerRoutes(_fastify: FastifyInstance, prefix: string): Promise<void> {
    logger.info(`Sales routes registered under ${prefix}`);
  }
}
