/**
 * Role-based access control hooks for the frontend.
 *
 * Usage:
 *   const canWrite = useCanWrite();            // contacts/deals write operations
 *   const isAdmin  = useIsAdmin();             // tenant_admin or super_admin
 *   const isSuperAdmin = useIsSuperAdmin();    // super_admin only
 *   const can = useCan();                      // flexible: can('manage_team')
 */

import { useAuthStore } from '../store/auth.store';

type Role = 'super_admin' | 'tenant_admin' | 'manager' | 'agent' | 'viewer';

const ROLE_RANK: Record<Role, number> = {
  super_admin:  50,
  tenant_admin: 40,
  manager:      30,
  agent:        20,
  viewer:       10,
};

function getRank(role: string | undefined): number {
  return ROLE_RANK[(role as Role) ?? 'viewer'] ?? 0;
}

/** Returns true if the current user has at least the given role. */
export function useHasRole(...roles: Role[]): boolean {
  const { user } = useAuthStore();
  return roles.some((r) => user?.role === r);
}

/** tenant_admin or super_admin */
export function useIsAdmin(): boolean {
  const { user } = useAuthStore();
  return getRank(user?.role) >= ROLE_RANK.tenant_admin;
}

/** super_admin only */
export function useIsSuperAdmin(): boolean {
  const { user } = useAuthStore();
  return user?.role === 'super_admin';
}

/**
 * tenant_admin only (NOT super_admin). Administrative-only role: manages users,
 * roles, settings and integrations but has NO visibility of operational data
 * (CRM, sales, tickets, analytics, billing).
 */
export function useIsTenantAdmin(): boolean {
  const { user } = useAuthStore();
  return user?.role === 'tenant_admin';
}

/** manager, tenant_admin, or super_admin */
export function useIsManager(): boolean {
  const { user } = useAuthStore();
  return getRank(user?.role) >= ROLE_RANK.manager;
}

/**
 * Granular permission check.
 * add_more_permissions here as the product grows.
 */
export function useCan() {
  const { user } = useAuthStore();
  const rank = getRank(user?.role);

  return {
    /** Create / edit / delete contacts, deals, companies, activities */
    writeRecords: rank >= ROLE_RANK.agent,
    /** Delete contacts / deals (agent+ but managers can restrict) */
    deleteRecords: rank >= ROLE_RANK.manager,
    /** Invite / remove team members */
    manageTeam: rank >= ROLE_RANK.tenant_admin,
    /** Change workspace settings, connectors, billing */
    manageWorkspace: rank >= ROLE_RANK.tenant_admin,
    /** Create / revoke API keys and webhooks */
    manageIntegrations: rank >= ROLE_RANK.manager,
    /** View analytics and reports */
    viewAnalytics: rank >= ROLE_RANK.agent,
    /** Manage all workspaces on the platform */
    superAdminAccess: user?.role === 'super_admin',
    /** Raw role for conditional rendering */
    role: user?.role as Role | undefined,
  };
}
