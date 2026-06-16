/**
 * In-app notifications — /api/v1/notifications
 *
 * GET  /          unread + recent notifications for the current user
 * POST /:id/read  mark a notification as read
 * POST /read-all  mark all as read
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';

export function notificationRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {

    fastify.get('/', async (req, reply) => {
      const userId   = req.user.sub;
      const tenantId = req.tenant.id;

      const notifications = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `SELECT * FROM notifications
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [userId],
        );
        return r.rows;
      });

      const unreadCount = notifications.filter((n: any) => !n.is_read).length;

      return reply.send({ success: true, data: notifications, meta: { unreadCount } });
    });

    fastify.post('/:id/read', async (req, reply) => {
      const { id }   = req.params as { id: string };
      const userId   = req.user.sub;
      const tenantId = req.tenant.id;

      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
          [id, userId],
        );
      });

      return reply.send({ success: true });
    });

    fastify.post('/read-all', async (req, reply) => {
      const userId   = req.user.sub;
      const tenantId = req.tenant.id;

      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
          [userId],
        );
      });

      return reply.send({ success: true });
    });
  };
}
