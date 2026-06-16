import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';
import type { ApiScope } from '@crm/shared';

const ALL_SCOPES: ApiScope[] = [
  'contacts:read','contacts:write','deals:read','deals:write',
  'activities:read','activities:write','voice:read','voice:write',
  'analytics:read','webhooks:manage',
];

const CreateKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(ALL_SCOPES as [ApiScope, ...ApiScope[]])).min(1),
  rateLimit: z.number().optional(),
  expiresAt: z.string().datetime().optional(),
});

export function apiKeyRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    const adminOnly = requireRole('tenant_admin', 'super_admin');

    // List API keys (never show full key — only prefix)
    fastify.get('/', { preHandler: adminOnly }, async (req, reply) => {
      const keys = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT id, name, key_prefix, scopes, expires_at, last_used_at, created_at
           FROM api_keys ORDER BY created_at DESC`,
        );
        return result.rows;
      });
      return reply.send({ success: true, data: keys });
    });

    // Create API key — this is the ONLY time the full key is returned
    fastify.post('/', { preHandler: adminOnly }, async (req, reply) => {
      const body = CreateKeySchema.parse(req.body);

      // Generate: crm_live_<32 random bytes hex>
      const rawKey = `crm_live_${crypto.randomBytes(24).toString('hex')}`;
      const keyPrefix = rawKey.slice(0, 12);
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      const [apiKey] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, rate_limit, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, name, key_prefix, scopes, expires_at, created_at`,
          [req.tenant.id, body.name, keyPrefix, keyHash, body.scopes, body.rateLimit, body.expiresAt],
        );
        return result.rows;
      });

      // Return full key ONCE — user must copy it now
      return reply.code(201).send({
        success: true,
        data: { ...apiKey, key: rawKey },
        warning: 'This is the only time the full API key is shown. Copy it now.',
      });
    });

    // Revoke key
    fastify.delete('/:id', { preHandler: adminOnly }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withTenant(req.tenant.id, async (client) => {
        await client.query('DELETE FROM api_keys WHERE id = $1', [id]);
      });
      return reply.code(204).send();
    });

    // Available scopes reference
    fastify.get('/scopes', async (req, reply) => {
      const scopes = [
        { scope: 'contacts:read',     description: 'Read contacts and companies' },
        { scope: 'contacts:write',    description: 'Create and update contacts' },
        { scope: 'deals:read',        description: 'Read deals and pipelines' },
        { scope: 'deals:write',       description: 'Create and update deals' },
        { scope: 'activities:read',   description: 'Read activities and tasks' },
        { scope: 'activities:write',  description: 'Create and complete activities' },
        { scope: 'voice:read',        description: 'Read call logs and transcripts' },
        { scope: 'voice:write',       description: 'Initiate calls and update records' },
        { scope: 'analytics:read',    description: 'Read analytics and reports' },
        { scope: 'webhooks:manage',   description: 'Create and manage outbound webhooks' },
      ];
      return reply.send({ success: true, data: scopes });
    });
  };
}
