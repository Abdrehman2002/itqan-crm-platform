import type { FastifyRequest, FastifyReply } from 'fastify';
import type { TenantService } from '@crm/core';
import type { Tenant } from '@crm/shared';

declare module 'fastify' {
  interface FastifyRequest {
    tenant: Tenant;
  }
}

// Resolves tenant from:
//   SECURITY: Resolution priority is strict to prevent cross-tenant attacks:
//   - JWT-authenticated users → tenant ALWAYS from JWT claim (X-Tenant-ID ignored)
//   - API-key-authenticated requests → X-Tenant-ID header allowed
//   - Unauthenticated (login/register) → Host subdomain or custom domain
export function buildTenantMiddleware(tenantService: TenantService) {
  return async function tenantMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Skip for super-admin routes and public routes
    if (req.url.startsWith('/super-admin') || req.url.startsWith('/public')) return;

    let tenant: Tenant | null = null;

    // 1. JWT claim takes highest priority for authenticated users.
    //    This prevents X-Tenant-ID header injection attacks where an authenticated
    //    user from Tenant A sends X-Tenant-ID: <Tenant B UUID> to access Tenant B data.
    if ((req as any).user?.tenantId) {
      tenant = await tenantService.findById((req as any).user.tenantId);
    }

    // 2. X-Tenant-ID header ONLY for API key authenticated requests (no JWT user).
    //    Server-to-server integrations use this path.
    if (!tenant && (req as any).apiKey) {
      const tenantIdHeader = req.headers['x-tenant-id'] as string | undefined;
      if (tenantIdHeader) {
        tenant = await tenantService.findById(tenantIdHeader);
      }
    }

    // 3. Host header for subdomain or custom domain (unauthenticated flows: login, register).
    if (!tenant) {
      const host = req.headers.host ?? '';
      const platformDomain = process.env.PLATFORM_DOMAIN ?? 'yourcrm.com';

      if (host.endsWith(`.${platformDomain}`)) {
        const slug = host.replace(`.${platformDomain}`, '').split('.')[0];
        tenant = await tenantService.findBySlug(slug);
      } else {
        // Custom domain
        tenant = await tenantService.findByDomain(host);
      }
    }

    if (!tenant) {
      return reply.code(404).send({ success: false, error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } });
    }

    if (tenant.status === 'suspended') {
      return reply.code(403).send({ success: false, error: { code: 'TENANT_SUSPENDED', message: 'Account suspended' } });
    }

    if (tenant.status === 'cancelled') {
      return reply.code(403).send({ success: false, error: { code: 'TENANT_CANCELLED', message: 'Account cancelled' } });
    }

    req.tenant = tenant;
  };
}
