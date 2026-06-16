export type Plan = 'free' | 'starter' | 'professional' | 'enterprise';

export interface Tenant {
  id: string;
  name: string;
  slug: string;               // subdomain: slug.yourcrm.com
  customDomain?: string;      // custom domain support
  plan: Plan;
  status: 'active' | 'suspended' | 'trial' | 'cancelled';
  trialEndsAt?: Date;
  settings: TenantSettings;
  /**
   * Active platform module IDs for this tenant.
   * Stored as a text[] column in DB. Defaults to ['crm'].
   * Maps to active_modules in the database.
   */
  activeModules?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  timezone: string;
  locale: string;
  currency: string;
  logo?: string;
  primaryColor?: string;
  features: FeatureFlags;
  limits: PlanLimits;
  voiceProvider?: 'twilio' | 'vonage' | 'plivo' | 'custom';
  voiceConfig?: Record<string, string>;
  /**
   * List of active platform module IDs for this tenant.
   * Defaults to ['crm'] — the core CRM module is always included.
   * Add 'voice', 'ticketing', etc. to enable additional modules.
   */
  activeModules?: string[];
}

export interface FeatureFlags {
  voiceBot: boolean;
  emailIntegration: boolean;
  analytics: boolean;
  customFields: boolean;
  apiAccess: boolean;
  webhooks: boolean;
  sso: boolean;
  auditLog: boolean;
  multiPipeline: boolean;
}

export interface PlanLimits {
  seats: number;                // max users
  contacts: number;             // max contacts
  storage: number;              // MB
  apiCallsPerMonth: number;
  voiceMinutesPerMonth: number;
  pipelines: number;
  customFields: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    seats: 2,
    contacts: 500,
    storage: 100,
    apiCallsPerMonth: 1_000,
    voiceMinutesPerMonth: 0,
    pipelines: 1,
    customFields: 5,
  },
  starter: {
    seats: 5,
    contacts: 5_000,
    storage: 1_000,
    apiCallsPerMonth: 10_000,
    voiceMinutesPerMonth: 100,
    pipelines: 3,
    customFields: 20,
  },
  professional: {
    seats: 25,
    contacts: 50_000,
    storage: 10_000,
    apiCallsPerMonth: 100_000,
    voiceMinutesPerMonth: 1_000,
    pipelines: 10,
    customFields: 100,
  },
  enterprise: {
    seats: -1,        // unlimited
    contacts: -1,
    storage: -1,
    apiCallsPerMonth: -1,
    voiceMinutesPerMonth: -1,
    pipelines: -1,
    customFields: -1,
  },
};

export const PLAN_FEATURES: Record<Plan, FeatureFlags> = {
  free: {
    voiceBot: false,
    emailIntegration: true,
    analytics: false,
    customFields: true,
    apiAccess: false,
    webhooks: false,
    sso: false,
    auditLog: false,
    multiPipeline: false,
  },
  starter: {
    voiceBot: true,
    emailIntegration: true,
    analytics: true,
    customFields: true,
    apiAccess: true,
    webhooks: true,
    sso: false,
    auditLog: false,
    multiPipeline: true,
  },
  professional: {
    voiceBot: true,
    emailIntegration: true,
    analytics: true,
    customFields: true,
    apiAccess: true,
    webhooks: true,
    sso: true,
    auditLog: true,
    multiPipeline: true,
  },
  enterprise: {
    voiceBot: true,
    emailIntegration: true,
    analytics: true,
    customFields: true,
    apiAccess: true,
    webhooks: true,
    sso: true,
    auditLog: true,
    multiPipeline: true,
  },
};
