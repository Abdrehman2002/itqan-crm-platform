import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthToken, ApiScope, UserRole } from '@crm/shared';
import { DatabaseClient, RedisClient } from '@crm/core';
import crypto from 'node:crypto';
import { isTokenRevoked } from '../routes/auth';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthToken;
    apiKey?: { id: string; scopes: ApiScope[] };
  }
}

// Supports both JWT bearer tokens and API key authentication
export function buildAuthMiddleware(db: DatabaseClient, redis: RedisClient) {
  return async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    // API Key: "ApiKey crm_live_xxxxxxxxxxxx"
    if (authHeader.startsWith('ApiKey ')) {
      const rawKey = authHeader.slice(7);
      await authenticateApiKey(req, reply, db, rawKey);
      return;
    }

    // JWT Bearer
    if (authHeader.startsWith('Bearer ')) {
      try {
        await (req as any).jwtVerify();
        // Check token revocation blocklist (logout / password change invalidation)
        const jti = (req.user as any)?.jti;
        if (jti && await isTokenRevoked(redis, jti)) {
          return reply.code(401).send({ success: false, error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked. Please log in again.' } });
        }
      } catch {
        return reply.code(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
      }
      return;
    }

    return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid auth scheme' } });
  };
}

async function authenticateApiKey(
  req: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseClient,
  rawKey: string,
): Promise<void> {
  const prefix = rawKey.slice(0, 12);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const [apiKey] = await db.withSuperAdmin(async (client) => {
    const result = await client.query(
      `SELECT id, tenant_id, scopes, expires_at, rate_limit
       FROM api_keys
       WHERE key_prefix = $1 AND key_hash = $2`,
      [prefix, keyHash],
    );
    return result.rows;
  });

  if (!apiKey) {
    return reply.code(401).send({ success: false, error: { code: 'INVALID_API_KEY', message: 'Invalid API key' } });
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return reply.code(401).send({ success: false, error: { code: 'API_KEY_EXPIRED', message: 'API key expired' } });
  }

  // Touch last_used_at async
  db.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [apiKey.id]).catch(() => {});

  req.user = {
    sub: `apikey:${apiKey.id}`,
    tenantId: apiKey.tenant_id,
    role: 'agent',
    plan: '',
    iat: 0,
    exp: 0,
  };
  req.apiKey = { id: apiKey.id, scopes: apiKey.scopes };
}

// Role-based access control guard factory
export function requireRole(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!roles.includes(req.user?.role as UserRole)) {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
  };
}

// Role numeric values for comparison
const ROLE_LEVEL: Record<string, number> = {
  super_admin:  50,
  tenant_admin: 40,
  manager:      30,
  line_manager: 25,   // BUG-P: was missing — caused requireScope to deny EVERY operational endpoint for line managers
  policy_admin: 25,   // Governance role — sits between manager (30) and agent (20); only role allowed to WRITE sla_policies
  agent:        20,
  viewer:       10,
};

// Minimum role required for each scope.
// Write scopes require 'agent' or above; admin scopes require 'manager' or above.
const SCOPE_MIN_ROLE: Record<ApiScope, number> = {
  'contacts:read':    ROLE_LEVEL.viewer,
  'contacts:write':   ROLE_LEVEL.agent,
  'deals:read':       ROLE_LEVEL.viewer,
  'deals:write':      ROLE_LEVEL.agent,
  'activities:read':  ROLE_LEVEL.viewer,
  'activities:write': ROLE_LEVEL.agent,
  'tickets:read':     ROLE_LEVEL.viewer,
  'tickets:write':    ROLE_LEVEL.agent,
  'voice:read':       ROLE_LEVEL.agent,
  'voice:write':      ROLE_LEVEL.agent,
  'analytics:read':   ROLE_LEVEL.agent,
  'webhooks:manage':  ROLE_LEVEL.manager,
  'admin:read':       ROLE_LEVEL.manager,
  'admin:write':      ROLE_LEVEL.tenant_admin,
  'billing:read':     ROLE_LEVEL.agent,
  'billing:manage':   ROLE_LEVEL.manager,
  'settings:read':    ROLE_LEVEL.manager,
  'settings:write':   ROLE_LEVEL.tenant_admin,
};

// Maps scope prefix → permissions map key
const SCOPE_PERMISSION_KEY: Partial<Record<string, string>> = {
  'deals':     'deals',
  'tickets':   'tickets',
  'voice':     'voice',
  'contacts':  'contacts',
  'activities':'activities',
  'analytics': 'analytics',
};

// Scope guard — enforces for BOTH API key and JWT users.
// Previously only checked API keys, allowing any JWT user (even viewer) to write.
export function requireScope(...scopes: ApiScope[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.apiKey) {
      // API key path: check explicit scope list
      const hasScope = scopes.some((s) => req.apiKey!.scopes.includes(s));
      if (!hasScope) {
        return reply.code(403).send({
          success: false,
          error: { code: 'INSUFFICIENT_SCOPE', message: `Required scope: ${scopes.join(' or ')}` },
        });
      }
    } else {
      // JWT path: check user role level satisfies at least one of the required scopes
      const userLevel = ROLE_LEVEL[req.user?.role ?? ''] ?? 0;
      const minRequired = Math.min(...scopes.map(s => SCOPE_MIN_ROLE[s] ?? 999));
      if (userLevel < minRequired) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions for this operation' },
        });
      }

      // Per-module permission check: deny if the user's permissions map explicitly sets the
      // module to "none". managers and above bypass this (they have cross-dept visibility).
      if (userLevel < ROLE_LEVEL.manager) {
        const perms = (req.user as any).permissions as Record<string, string> | undefined;
        if (perms) {
          const denied = scopes.every((s) => {
            const module = s.split(':')[0];
            const key = SCOPE_PERMISSION_KEY[module];
            return key !== undefined && perms[key] === 'none';
          });
          if (denied) {
            return reply.code(403).send({
              success: false,
              error: { code: 'FORBIDDEN', message: 'You do not have access to this module' },
            });
          }
        }
      }
    }
  };
}

// Entitlement guard — enforces the tenant's licensed feature allow-list
// (tenants.entitled_features) as the hard ceiling. Passes if the tenant is entitled
// to ANY of the given features. Legacy tenants with no recorded entitlement are
// allowed through so existing workspaces keep working.
export function requireEntitlement(...features: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const entitled = (req.tenant as any)?.entitled_features;
    if (!Array.isArray(entitled) || entitled.length === 0) return; // legacy → allow
    if (features.some((f) => entitled.includes(f))) return;
    return reply.code(403).send({
      success: false,
      error: {
        code: 'NOT_LICENSED',
        message: 'This feature is not included in your workspace licence. Contact your provider.',
      },
    });
  };
}

// Granular permission guard — enforces a specific action key (e.g. 'invoices:edit')
// against the user's role permission map carried in the JWT.
//   • super_admin / tenant_admin → full access (bypass)
//   • key present & true (or legacy 'full'/'view') → allow
//   • key explicitly false → deny
//   • key ABSENT from the map → allow (backward-compat: the role predates this
//     permission key, so we don't retroactively lock existing workspaces out)
export function requirePermission(key: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = req.user?.role;
    if (role === 'super_admin' || role === 'tenant_admin') return;
    const perms = (req.user as any)?.permissions as Record<string, unknown> | undefined;
    if (!perms) return; // no map at all → don't block
    const v = perms[key];
    if (v === undefined) return;                 // key not in this role → allow (legacy)
    if (v === true || v === 'full' || v === 'view') return;
    return reply.code(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'You do not have permission for this action.' },
    });
  };
}

// Feature flag guard
export function requireFeature(feature: keyof import('@crm/shared').FeatureFlags) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const flags = req.tenant?.settings?.features as Record<string, boolean>;
    if (!flags?.[feature]) {
      return reply.code(402).send({
        success: false,
        error: {
          code: 'FEATURE_NOT_AVAILABLE',
          message: `Feature '${feature}' is not available on your plan. Please upgrade.`,
        },
      });
    }
  };
}
