export type UserRole = 'super_admin' | 'tenant_admin' | 'manager' | 'agent' | 'readonly';

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
}
