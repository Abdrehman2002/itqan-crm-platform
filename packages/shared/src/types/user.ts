// UserRole — kept aligned with the backend ROLE_HIERARCHY. 'readonly' is a
// legacy alias for the customer/originator role and mapped to 'viewer' in the
// backend; both are listed so old rows still typecheck. 'line_manager' is a
// team-scoped supervisor sitting between manager and agent (BUG-P + audit fix).
export type UserRole =
  | 'super_admin'
  | 'tenant_admin'
  | 'manager'
  | 'line_manager'
  | 'policy_admin'
  | 'agent'
  | 'viewer'
  | 'readonly';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  avatar?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  preferences: UserPreferences;
  createdAt: Date;
  /** Department scoping: 'sales' | 'support' | 'complaints' | null */
  department?: string | null;
  /**
   * Governance: department names this user (policy_admin role) is authorised to
   * write SLA policies for. Matches against sla_policies.ticket_type.
   */
  governed_departments?: string[];
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  notifications: NotificationPreferences;
  defaultPipeline?: string;
}

export interface NotificationPreferences {
  email: boolean;
  inApp: boolean;
  voiceCallMissed: boolean;
  dealWon: boolean;
  taskDue: boolean;
}

export interface AuthToken {
  sub: string;          // userId
  tenantId: string;
  role: UserRole;
  plan: string;
  iat: number;
  exp: number;
  department?: string | null;
  sector?: string;
  /** Module-level permission map from users.permissions column (e.g. { deals: "view", tickets: "full" }) */
  permissions?: Record<string, string>;
  /** Governance domains the user (policy_admin) is authorised to write SLA policies for. */
  governed_departments?: string[];
}
