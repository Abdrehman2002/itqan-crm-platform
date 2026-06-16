import type { FastifyInstance } from 'fastify';

// ── Low-level feature module (internal building block) ─────────────────────

export interface CRMModule {
  name: string;
  version: string;
  description: string;
  requiredPlan: 'free' | 'starter' | 'professional' | 'enterprise';
  dependencies?: string[];       // other module names this depends on

  // Lifecycle hooks
  onLoad(ctx: ModuleContext): Promise<void>;
  onUnload?(): Promise<void>;

  // Register routes into the Fastify instance
  registerRoutes?(fastify: FastifyInstance, prefix: string): Promise<void>;

  // GraphQL schema extension (SDL string)
  graphqlSchema?: string;

  // Event handlers this module subscribes to
  eventHandlers?: ModuleEventHandler[];
}

export interface ModuleContext {
  db: unknown;          // DatabaseClient
  redis: unknown;       // RedisClient
  queue: unknown;       // QueueManager
  eventBus: unknown;    // EventBus
  config: Record<string, string>;
}

export interface ModuleEventHandler {
  event: string;
  handler: (payload: unknown, tenantId: string) => Promise<void>;
}

export interface ModuleManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  requiredPlan: string;
  entryPoint: string;   // path to module factory
  icon?: string;
  tags: string[];
}

// ── Top-level product module (HubSpot-style "Hub") ─────────────────────────
// Each PlatformModule is a self-contained product (CRM, Voice, Ticketing…)
// that owns its own routes, nav items, and sub-feature modules.

export interface NavItem {
  /** URL path, e.g. "/contacts" */
  path: string;
  /** Display label */
  label: string;
  /** Lucide icon name, e.g. "Users" */
  icon: string;
  /** Optional badge (e.g. unread count) */
  badge?: number;
  /** Child items for nested menus */
  children?: NavItem[];
}

export interface PlatformModule {
  /** Unique machine-readable id, e.g. "crm" | "voice" | "ticketing" */
  id: string;
  /** Human label shown in module switcher */
  label: string;
  /** Icon for the module switcher */
  icon: string;
  /** Minimum plan required */
  requiredPlan: 'free' | 'starter' | 'professional' | 'enterprise';
  /** Sidebar nav items exposed by this module */
  navItems: NavItem[];
  /** Called once when the module is activated for a server instance */
  onLoad(ctx: ModuleContext): Promise<void>;
  onUnload?(): Promise<void>;
  /** Register all HTTP routes under the given prefix */
  registerRoutes(fastify: FastifyInstance, prefix: string): Promise<void>;
}

/** Shape returned by GET /api/v1/modules */
export interface ActiveModuleInfo {
  id: string;
  label: string;
  icon: string;
  navItems: NavItem[];
}
