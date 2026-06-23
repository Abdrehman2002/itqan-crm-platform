/**
 * Team Messaging routes — internal tenant chat (channels + DMs)
 * GET  /api/v1/messages/channels          — list available channels
 * GET  /api/v1/messages/channel/:name     — get messages in a channel
 * POST /api/v1/messages/channel/:name     — post to a channel
 * GET  /api/v1/messages/dm/:userId        — get DM thread with a user
 * POST /api/v1/messages/dm/:userId        — send a DM
 * GET  /api/v1/messages/team-members      — list users in this tenant
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';

const DEFAULT_CHANNELS = ['general', 'announcements', 'support', 'sales'];

export function teamMessageRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    // Ensure table exists (idempotent bootstrap)
    fastify.addHook('onReady', async () => {
      await db.withSuperAdmin(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS team_messages (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID        NOT NULL,
            sender_id    UUID        NOT NULL,
            sender_name  TEXT        NOT NULL,
            channel      TEXT,
            recipient_id UUID,
            content      TEXT        NOT NULL,
            message_type TEXT        NOT NULL DEFAULT 'channel'
              CHECK (message_type IN ('channel', 'dm')),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_team_msgs_tenant  ON team_messages(tenant_id, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_team_msgs_channel ON team_messages(tenant_id, channel, created_at DESC) WHERE channel IS NOT NULL`);
      });
    });

    // List channels (distinct channels that have messages + defaults)
    fastify.get('/channels', async (req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT DISTINCT channel, COUNT(*) as message_count,
                  MAX(created_at) as last_message_at
           FROM team_messages
           WHERE tenant_id = $1 AND message_type = 'channel' AND channel IS NOT NULL
           GROUP BY channel
           ORDER BY MAX(created_at) DESC`,
          [req.tenant.id],
        );
        return res.rows;
      });

      const activeChannels = rows.map((r: any) => r.channel);
      const allChannels = [...new Set([...DEFAULT_CHANNELS, ...activeChannels])];

      const channelData = allChannels.map((name) => {
        const row = rows.find((r: any) => r.channel === name);
        return { name, message_count: row ? parseInt(row.message_count) : 0, last_message_at: row?.last_message_at ?? null };
      });

      return reply.send({ success: true, data: channelData });
    });

    // Get messages in a channel (last 100, newest last)
    fastify.get('/channel/:name', async (req, reply) => {
      const { name } = req.params as { name: string };
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT id, sender_id, sender_name, content, created_at
           FROM team_messages
           WHERE tenant_id = $1 AND channel = $2 AND message_type = 'channel'
           ORDER BY created_at ASC
           LIMIT 100`,
          [req.tenant.id, name],
        );
        return res.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // Post to a channel
    fastify.post('/channel/:name', async (req, reply) => {
      const { name } = req.params as { name: string };
      const { content } = req.body as { content: string };
      if (!content?.trim()) return reply.code(400).send({ success: false, error: { code: 'EMPTY', message: 'Message cannot be empty' } });

      const senderName = (req.user as any).name || (req.user as any).email;

      const [row] = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `INSERT INTO team_messages (tenant_id, sender_id, sender_name, channel, content, message_type)
           VALUES ($1, $2, $3, $4, $5, 'channel') RETURNING *`,
          [req.tenant.id, (req.user as any).id, senderName, name, content.trim()],
        );
        return res.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // List team members
    fastify.get('/team-members', async (req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT id, name, email, role
           FROM users WHERE tenant_id = $1 AND is_active = true
           ORDER BY name`,
          [req.tenant.id],
        );
        return res.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // Get DM thread with a user (messages between me and them, both directions)
    fastify.get('/dm/:userId', async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const myId = (req.user as any).id;

      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT id, sender_id, sender_name, recipient_id, content, created_at
           FROM team_messages
           WHERE tenant_id = $1 AND message_type = 'dm'
             AND (
               (sender_id = $2 AND recipient_id = $3) OR
               (sender_id = $3 AND recipient_id = $2)
             )
           ORDER BY created_at ASC LIMIT 100`,
          [req.tenant.id, myId, userId],
        );
        return res.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // Send a DM
    fastify.post('/dm/:userId', async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const { content } = req.body as { content: string };
      if (!content?.trim()) return reply.code(400).send({ success: false, error: { code: 'EMPTY', message: 'Message cannot be empty' } });

      const senderName = (req.user as any).name || (req.user as any).email;

      const [row] = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `INSERT INTO team_messages (tenant_id, sender_id, sender_name, recipient_id, content, message_type)
           VALUES ($1, $2, $3, $4, $5, 'dm') RETURNING *`,
          [req.tenant.id, (req.user as any).id, senderName, userId, content.trim()],
        );
        return res.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });
  };
}
