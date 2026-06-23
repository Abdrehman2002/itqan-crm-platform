import 'dotenv/config';
import Fastify from 'fastify';
import FastifyJWT from '@fastify/jwt';
import FastifyCors from '@fastify/cors';
import FastifyHelmet from '@fastify/helmet';
import FastifyRateLimit from '@fastify/rate-limit';
import FastifyMultipart from '@fastify/multipart';
import FastifySwagger from '@fastify/swagger';
import FastifySwaggerUI from '@fastify/swagger-ui';
import mercurius from 'mercurius';

import { DatabaseClient, EventBus, ModuleRegistry, TenantService } from '@crm/core';
import { buildRedisClient } from '@crm/core/config/redis';
import { logger } from '@crm/core/config/logger';
import { buildTenantMiddleware } from './middlewares/tenant.middleware';
import { buildAuthMiddleware } from './middlewares/auth.middleware';

// Routes
import { contactRoutes } from './routes/contacts';
import { dealRoutes } from './routes/deals';
import { activityRoutes } from './routes/activities';
import { voiceRoutes } from './routes/voice';
import { billingRoutes } from './routes/billing';
import { analyticsRoutes } from './routes/analytics';
import { webhookRoutes } from './routes/webhooks';
import { apiKeyRoutes } from './routes/api-keys';
import { superAdminRoutes } from './routes/super-admin';
import { authRoutes } from './routes/auth';
import { companyRoutes } from './routes/companies';
import { settingsRoutes } from './routes/settings';
import { modulesRoute } from './routes/modules';
import { rolesRoutes } from './routes/roles';
import { connectorRoutes } from './routes/connectors';
import { ticketRoutes } from './routes/tickets';
import { csatPublicRoutes, csatProtectedRoutes } from './routes/csat';
import { ticketAnalyticsRoutes } from './routes/ticket-analytics';
import { notificationRoutes } from './routes/notifications';
import { emailRoutes } from './routes/emails';
import { voiceBotRoutes } from './routes/voice-bot';
import { invoiceRoutes } from './routes/sales/invoices';
import { billingContactRoutes } from './routes/sales/billing-contacts';
import { salesSettingsRoutes } from './routes/sales/sales-settings';
import { salesDashboardRoutes } from './routes/sales/sales-dashboard';
import { invoiceTemplateRoutes } from './routes/sales/invoice-templates';
import { sectorRoutes } from './routes/sector';
import { departmentRoutes } from './routes/departments';
import { opportunityRoutes } from './routes/opportunities';
import { teamMessageRoutes } from './routes/team-messages';

// Feature modules (internal building blocks)
import { ContactsModule } from '../../../modules/contacts/src';
import { DealsModule } from '../../../modules/deals/src';
import { ActivitiesModule } from '../../../modules/activities/src';
import { VoiceModule } from '../../../modules/voice/src';
import { AnalyticsModule } from '../../../modules/analytics/src';
import { ConnectorsModule } from '../../../modules/connectors/src';

// Platform modules (HubSpot-style product "Hubs")
import { CRMPlatformModule } from '../../../modules/crm/src';
import { VoicePlatformModule } from '../../../modules/voice-module/src';
import { TicketingPlatformModule } from '../../../modules/ticketing/src';
import { SalesPlatformModule } from '../../../modules/sales/src';

import { buildGraphQLSchema } from './graphql/schema';
import { startWebhookWorker } from './lib/webhook-worker';
import { startWebhookDispatcher } from './lib/webhook-dispatcher';
import { startAnalyticsRefreshWorker } from './lib/analytics-refresh-worker';

async function buildServer() {
  const fastify = Fastify({
    logger: false, // We use winston
    trustProxy: true,
  });

  // ── Infrastructure ────────────────────────────────────────
  const db = new DatabaseClient(process.env.DATABASE_URL!);
  const redis = buildRedisClient(process.env.REDIS_URL!);
  // Only use Redis-backed features (BullMQ event bus, distributed rate-limit)
  // when a REAL ioredis client is present. The in-memory fallback lacks ioredis
  // internals like defineCommand, so we pass null/undefined instead.
  const hasRealRedis = !!(redis.native && typeof (redis.native as any).defineCommand === 'function');
  const eventBus = new EventBus(hasRealRedis ? redis.native : null);
  const tenantService = new TenantService(db, redis);

  await db.connect();
  logger.info('Infrastructure connected');

  // Start webhook delivery worker (polls every 5 s, exponential backoff retries)
  const stopWebhookWorker = startWebhookWorker(db);
  // Start webhook dispatcher — BullMQ worker that fans out crm-events to tenant webhooks
  const stopWebhookDispatcher = startWebhookDispatcher(db, redis.native);
  // Start analytics MV refresh worker (warms up on boot, refreshes hourly)
  const stopAnalyticsRefresh = startAnalyticsRefreshWorker(db);

  // ── Module registry ───────────────────────────────────────
  const moduleRegistry = new ModuleRegistry();

  // Register low-level feature modules
  moduleRegistry.register(new ContactsModule());
  moduleRegistry.register(new DealsModule());
  moduleRegistry.register(new ActivitiesModule());
  moduleRegistry.register(new VoiceModule());
  moduleRegistry.register(new AnalyticsModule());
  moduleRegistry.register(new ConnectorsModule());

  // Register platform modules (product Hubs)
  moduleRegistry.registerPlatform(new CRMPlatformModule());
  moduleRegistry.registerPlatform(new VoicePlatformModule());
  moduleRegistry.registerPlatform(new TicketingPlatformModule());
  moduleRegistry.registerPlatform(new SalesPlatformModule());

  const moduleCtx = { db, redis, queue: null, eventBus, config: process.env as any };
  await moduleRegistry.loadAll(moduleCtx);
  await moduleRegistry.loadAllPlatform(moduleCtx);

  // ── Fastify plugins ───────────────────────────────────────

  // Security headers — must be registered before routes
  await fastify.register(FastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", "'unsafe-inline'"],
        imgSrc:         ["'self'", 'data:', 'https:'],
        connectSrc:     ["'self'"],
        fontSrc:        ["'self'"],
        objectSrc:      ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // CORS — fail-safe: require explicit origins in production
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
  if (!corsOrigins?.length && process.env.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGINS environment variable must be set in production');
  }
  await fastify.register(FastifyCors, {
    origin: corsOrigins?.length ? corsOrigins : true, // true only allowed in development
    credentials: true,
  });

  await fastify.register(FastifyJWT, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: '8h' },
  });

  await fastify.register(FastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max for template uploads
  });

  await fastify.register(FastifyRateLimit, {
    global: true,
    max: 1000,
    timeWindow: '1 minute',
    redis: hasRealRedis ? redis.native : undefined,
    // Per-tenant rate limiting based on plan
    keyGenerator: (req) => {
      const tenantId = req.tenant?.id ?? req.ip;
      return `ratelimit:${tenantId}`;
    },
  });

  // API documentation — only in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    await fastify.register(FastifySwagger, {
      openapi: {
        info: { title: 'CRM Platform API', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            apiKey: { type: 'apiKey', in: 'header', name: 'Authorization' },
          },
        },
      },
    });
    await fastify.register(FastifySwaggerUI, { routePrefix: '/docs' });
  }

  // ── Global error handler — must be set before routes ───────────────────
  // Catches Zod validation errors and maps them to 400 Bad Request.
  // Uses try/catch internally so the handler itself never throws.
  fastify.setErrorHandler(function errorHandler(err, req, reply) {
    try {
      // Detect ZodError by name or by presence of .issues array
      const isZod = err.name === 'ZodError' || Array.isArray((err as any).issues);
      if (isZod) {
        let details: Array<{ field: string; message: string }> = [];
        try {
          const issues: any[] = (err as any).issues ?? JSON.parse(err.message);
          details = issues.map((i: any) => ({
            field: Array.isArray(i.path) && i.path.length > 0 ? i.path.join('.') : 'body',
            message: String(i.message ?? 'Invalid value'),
          }));
        } catch { /* ignore parse failure — return empty details */ }
        return reply.code(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details },
        });
      }
    } catch { /* handler itself threw — fall through to defaults */ }

    // Postgres / known errors with a statusCode
    const status = (err as any).statusCode ?? reply.statusCode;
    if (status >= 400 && status < 500) {
      return reply.code(status).send(err);
    }

    // Unexpected 5xx — log and return generic message
    logger.error('Unhandled request error', { method: req.method, url: req.url, error: err.message, code: (err as any).code });
    return reply.code(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });


  // ── GraphQL ───────────────────────────────────────────────
  const { typeDefs, resolvers } = buildGraphQLSchema(moduleRegistry);
  await fastify.register(mercurius, {
    schema: typeDefs,
    resolvers,
    graphiql: process.env.NODE_ENV !== 'production',
    path: '/graphql',
    context: (req: any) => ({ db, redis, eventBus, tenant: req.tenant, user: req.user }),
  });

  // ── Middleware hooks ──────────────────────────────────────
  const tenantMiddleware = buildTenantMiddleware(tenantService);
  const authMiddleware = buildAuthMiddleware(db, redis);

  fastify.addHook('preHandler', async (req, reply) => {
    const isPublic = req.url.startsWith('/public') || req.url.startsWith('/docs') || req.url === '/health'
      || req.url.startsWith('/auth')
      || req.url.startsWith('/api/v1/auth')
      || req.url.startsWith('/api/v1/billing/webhook')
      || req.url.startsWith('/api/v1/voice/webhook')
      || req.url.startsWith('/api/v1/voice-bot/webhook')
      || req.url.startsWith('/api/v1/voice-bot/livekit')
      || req.url.startsWith('/api/v1/emails/webhook')
      || req.url.startsWith('/api/v1/emails/track');
    if (isPublic) return;
    await authMiddleware(req, reply);
    if (reply.sent) return;
    // Super admin may access specific tenant-scoped routes (integrations, settings, roles, modules)
    // but is still blocked from data-mutating tenant routes to prevent accidental cross-tenant writes.
    const SUPER_ADMIN_ALLOWED_PREFIXES = [
      '/api/v1/connectors',
      '/api/v1/webhooks',
      '/api/v1/api-keys',
      '/api/v1/settings',
      '/api/v1/roles',
      '/api/v1/modules',
      '/api/v1/billing',
      '/api/v1/messages',
      '/api/v1/contacts',
      '/api/v1/companies',
      '/api/v1/deals',
      '/api/v1/activities',
      '/api/v1/analytics',
      '/api/v1/tickets',
      '/api/v1/sector',
      '/api/v1/notifications',
      '/api/v1/emails',
      '/api/v1/voice',
      '/api/v1/voice-bot',
      '/api/v1/departments',
      '/api/v1/opportunities',
      '/api/v1/sales',
    ];
    if (
      req.url.startsWith('/api/v1/') &&
      (req.user as any)?.role === 'super_admin' &&
      !SUPER_ADMIN_ALLOWED_PREFIXES.some((p) => req.url.startsWith(p))
    ) {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Super admin cannot access tenant-scoped routes. Use /super-admin/* endpoints.' } });
    }

    // Tenant admin is an ADMINISTRATIVE role only (manage users, roles, settings,
    // integrations / keep the system live). They have NO visibility of operational
    // data — contacts, deals, activities, tickets, sales/invoicing, analytics,
    // emails, voice and billing are all off-limits. This is separation of duties:
    // the person who manages accounts is not the person who sees the operations.
    // Billing (both subscription AND customer invoicing) belongs to a Finance/Sales
    // role, never the admin.
    const TENANT_ADMIN_BLOCKED_PREFIXES = [
      '/api/v1/contacts',
      '/api/v1/companies',
      '/api/v1/deals',
      '/api/v1/activities',
      '/api/v1/analytics',
      '/api/v1/tickets',
      '/api/v1/sales',
      '/api/v1/opportunities',
      '/api/v1/emails',
      '/api/v1/voice',
      '/api/v1/voice-bot',
      '/api/v1/billing',
    ];
    if (
      req.url.startsWith('/api/v1/') &&
      (req.user as any)?.role === 'tenant_admin' &&
      TENANT_ADMIN_BLOCKED_PREFIXES.some((p) => req.url.startsWith(p))
    ) {
      return reply.code(403).send({ success: false, error: { code: 'ADMIN_NO_OPERATIONS', message: 'Administrators manage users, roles, settings and integrations — operational and billing data is not accessible to this role.' } });
    }

    await tenantMiddleware(req, reply);
  });

  // ── Routes ────────────────────────────────────────────────
  await fastify.register(authRoutes(db, redis), { prefix: '/auth' });
  await fastify.register(contactRoutes(db, eventBus), { prefix: '/api/v1/contacts' });
  await fastify.register(dealRoutes(db, eventBus), { prefix: '/api/v1/deals' });
  await fastify.register(activityRoutes(db, eventBus), { prefix: '/api/v1/activities' });
  await fastify.register(voiceRoutes(db, eventBus, tenantService), { prefix: '/api/v1/voice' });
  await fastify.register(analyticsRoutes(db), { prefix: '/api/v1/analytics' });
  await fastify.register(webhookRoutes(db, eventBus), { prefix: '/api/v1/webhooks' });
  await fastify.register(apiKeyRoutes(db), { prefix: '/api/v1/api-keys' });
  await fastify.register(superAdminRoutes(db, tenantService), { prefix: '/super-admin' });
  await fastify.register(companyRoutes(db, eventBus), { prefix: '/api/v1/companies' });
  await fastify.register(settingsRoutes(db), { prefix: '/api/v1/settings' });
  await fastify.register(billingRoutes(db, eventBus), { prefix: '/api/v1/billing' });
  await fastify.register(modulesRoute(moduleRegistry), { prefix: '/api/v1/modules' });
  await fastify.register(connectorRoutes(db), { prefix: '/api/v1/connectors' });
  await fastify.register(ticketRoutes(db, eventBus), { prefix: '/api/v1/tickets' });
  await fastify.register(csatProtectedRoutes(db), { prefix: '/api/v1/tickets/csat' });
  await fastify.register(ticketAnalyticsRoutes(db), { prefix: '/api/v1/tickets/analytics' });
  await fastify.register(csatPublicRoutes(db, eventBus), { prefix: '/public/csat' });
  await fastify.register(notificationRoutes(db), { prefix: '/api/v1/notifications' });
  await fastify.register(emailRoutes(db, eventBus), { prefix: '/api/v1/emails' });
  await fastify.register(voiceBotRoutes(db, eventBus), { prefix: '/api/v1/voice-bot' });
  await fastify.register(rolesRoutes(db), { prefix: '/api/v1/roles' });
  // Sales & Invoicing module routes
  await fastify.register(invoiceRoutes(db),        { prefix: '/api/v1/sales/invoices' });
  await fastify.register(billingContactRoutes(db), { prefix: '/api/v1/sales/billing-contacts' });
  await fastify.register(salesSettingsRoutes(db),      { prefix: '/api/v1/sales/settings' });
  await fastify.register(salesDashboardRoutes(db),     { prefix: '/api/v1/sales/dashboard' });
  await fastify.register(invoiceTemplateRoutes(db),    { prefix: '/api/v1/sales/templates' });
  await fastify.register(sectorRoutes(db),         { prefix: '/api/v1/sector' });
  await fastify.register(departmentRoutes(db),     { prefix: '/api/v1/departments' });
  await fastify.register(opportunityRoutes(db),    { prefix: '/api/v1/opportunities' });
  await fastify.register(teamMessageRoutes(db),    { prefix: '/api/v1/messages' });

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
  }));

  // ── Graceful shutdown ─────────────────────────────────────
  const shutdown = async () => {
    logger.info('Shutting down...');
    stopWebhookWorker();
    stopAnalyticsRefresh();
    await stopWebhookDispatcher();
    await moduleRegistry.unloadAll();
    await eventBus.shutdown();
    await db.end();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return fastify;
}

async function main() {
  const server = await buildServer();
  const port = parseInt(process.env.PORT ?? '3000');
  const host = process.env.HOST ?? '0.0.0.0';

  await server.listen({ port, host });
  logger.info(`Server running on ${host}:${port}`);
}

main().catch((err) => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});
