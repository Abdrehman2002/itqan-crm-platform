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

    // Resolve sender_name from the users table since the JWT payload doesn't
    // carry name — using `(req.user as any).name` returned undefined and broke
    // the NOT NULL constraint on sender_name. Cache per request.
    async function senderNameOf(client: any, userId: string): Promise<string> {
      const r = await client.query('SELECT name, email FROM users WHERE id = $1', [userId]);
      return r.rows[0]?.name || r.rows[0]?.email || 'Unknown';
    }

    // Post to a channel
    fastify.post('/channel/:name', async (req, reply) => {
      const { name } = req.params as { name: string };
      const { content } = req.body as { content: string };
      if (!content?.trim()) return reply.code(400).send({ success: false, error: { code: 'EMPTY', message: 'Message cannot be empty' } });

      const [row] = await db.withSuperAdmin(async (client) => {
        const senderName = await senderNameOf(client, req.user.sub);
        const res = await client.query(
          `INSERT INTO team_messages (tenant_id, sender_id, sender_name, channel, content, message_type)
           VALUES ($1, $2, $3, $4, $5, 'channel') RETURNING *`,
          [req.tenant.id, req.user.sub, senderName, name, content.trim()],
        );
        return res.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // List team members. Uses withSuperAdmin because we don't have a tenant role
    // context here, but the manual tenant_id filter (and the deleted_at filter
    // added per U6) does the isolation. Important for the user concern
    // "agent in workspace A must never see / message users from workspace B".
    fastify.get('/team-members', async (req, reply) => {
      const rows = await db.withSuperAdmin(async (client) => {
        const res = await client.query(
          `SELECT id, name, email, role
             FROM users
            WHERE tenant_id = $1
              AND is_active = true
              AND deleted_at IS NULL
              AND role != 'super_admin'
            ORDER BY name`,
          [req.tenant.id],
        );
        return res.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // GET /api/v1/messages/dm-summary
    // Per-peer summary so the contact list can show an "X unread" badge next to
    // each user. Frontend tracks "last seen" per peer in localStorage; backend
    // returns the last message and a 30-day-window unread count from each peer.
    // The frontend filters/decides what's actually unread vs already-viewed.
    //
    // Without this, the only way to know you have a new DM was to open the exact
    // conversation — user reported (2026-06-29) sending from TA → Omar, Omar
    // didn't see it (he wasn't on that thread).
    fastify.get('/dm-summary', async (req, reply) => {
      const myId = req.user.sub;
      const rows = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT peer_id,
                  MAX(created_at) AS last_at,
                  COUNT(*) FILTER (
                    WHERE sender_id = peer_id
                      AND created_at > NOW() - INTERVAL '30 days'
                  ) AS recent_from_peer,
                  (ARRAY_AGG(content     ORDER BY created_at DESC))[1] AS last_content,
                  (ARRAY_AGG(sender_name ORDER BY created_at DESC))[1] AS last_sender_name,
                  (ARRAY_AGG(sender_id   ORDER BY created_at DESC))[1] AS last_sender_id
             FROM (
               SELECT id, sender_id, sender_name, recipient_id, content, created_at,
                      CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer_id
                 FROM team_messages
                WHERE tenant_id = $2
                  AND message_type = 'dm'
                  AND (sender_id = $1 OR recipient_id = $1)
             ) t
            GROUP BY peer_id
            ORDER BY last_at DESC NULLS LAST`,
          [myId, req.tenant.id],
        );
        return r.rows;
      });
      return reply.send({ success: true, data: rows });
    });

    // Get DM thread with a user (messages between me and them, both directions)
    fastify.get('/dm/:userId', async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const myId = req.user.sub;

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

      const [row] = await db.withSuperAdmin(async (client) => {
        const senderName = await senderNameOf(client, req.user.sub);
        const res = await client.query(
          `INSERT INTO team_messages (tenant_id, sender_id, sender_name, recipient_id, content, message_type)
           VALUES ($1, $2, $3, $4, $5, 'dm') RETURNING *`,
          [req.tenant.id, req.user.sub, senderName, userId, content.trim()],
        );
        return res.rows;
      });
      return reply.code(201).send({ success: true, data: row });
    });

    // GET /api/v1/messages/unread-count?since=<iso8601>
    // Returns the count of messages addressed to me (DMs to me, OR any channel
    // post) authored by someone else since the given timestamp. Frontend tracks
    // the timestamp in localStorage — no DB schema change needed.
    fastify.get('/unread-count', async (req, reply) => {
      const { since } = req.query as { since?: string };
      const sinceDt = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date(0);
      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT COUNT(*) AS n,
                  COUNT(*) FILTER (WHERE message_type = 'dm')      AS dm_n,
                  COUNT(*) FILTER (WHERE message_type = 'channel') AS channel_n,
                  MAX(created_at) AS latest,
                  (ARRAY_AGG(sender_name ORDER BY created_at DESC))[1] AS latest_sender,
                  (ARRAY_AGG(content     ORDER BY created_at DESC))[1] AS latest_content
             FROM team_messages
            WHERE tenant_id = $1
              AND created_at > $2
              AND sender_id != $3
              AND (recipient_id = $3 OR message_type = 'channel')`,
          [req.tenant.id, sinceDt, req.user.sub],
        );
        return r.rows;
      });
      return reply.send({
        success: true,
        data: {
          total:       Number(row?.n ?? 0),
          dm:          Number(row?.dm_n ?? 0),
          channel:     Number(row?.channel_n ?? 0),
          latestAt:    row?.latest ?? null,
          latestSender: row?.latest_sender ?? null,
          latestPreview: row?.latest_content ? String(row.latest_content).slice(0, 80) : null,
        },
      });
    });
  };
}
