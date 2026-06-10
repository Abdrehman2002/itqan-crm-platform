import type { CRMModule, ModuleContext } from '@crm/shared';
import { CRM_EVENTS } from '@crm/core';
import type { EventBus } from '@crm/core';
import { Queue } from 'bullmq';

export class ActivitiesModule implements CRMModule {
  name = 'activities';
  version = '1.0.0';
  description = 'Tasks, calls, emails and timeline activities';
  requiredPlan = 'free' as const;
  dependencies = ['contacts'];

  private reminderQueue?: Queue;

  async onLoad(ctx: ModuleContext): Promise<void> {
    const eventBus = ctx.eventBus as EventBus;
    const db = ctx.db as any;
    const redis = ctx.redis as any;
    const hasRealRedis = !!(redis?.native && typeof redis.native.defineCommand === 'function');

    // BullMQ queue for delayed task reminders (only when a real Redis is present;
    // otherwise BullMQ would endlessly try to reach localhost:6379)
    if (hasRealRedis) {
      this.reminderQueue = new Queue('activity-reminders', {
        connection: redis.native,
      });
    }

    // Log voice call as a completed activity
    eventBus.on(CRM_EVENTS.VOICE_CALL_COMPLETED, async (event) => {
      const { call } = event.payload as any;
      if (!call) return;
      await db.withTenant(event.tenantId, async (client: any) => {
        await client.query(
          `INSERT INTO activities
             (tenant_id, type, subject, status, contact_id, deal_id,
              owner_id, completed_at, duration, metadata)
           VALUES ($1, 'voice_bot_call', $2, 'completed', $3, $4, $5, NOW(), $6, $7::jsonb)`,
          [
            event.tenantId,
            `${call.direction === 'inbound' ? 'Inbound' : 'Outbound'} call — ${call.status}`,
            call.contact_id,
            call.deal_id,
            call.agent_id,
            call.duration,
            JSON.stringify({ callId: call.id, provider: call.provider, botHandled: call.bot_handled }),
          ],
        );
      });
    });

    // Schedule reminders for due tasks
    eventBus.on(CRM_EVENTS.ACTIVITY_CREATED, async (event) => {
      const { activity } = event.payload as any;
      if (activity?.due_at && activity.type === 'task' && this.reminderQueue) {
        const delay = new Date(activity.due_at).getTime() - Date.now() - 15 * 60_000; // 15 min before
        if (delay > 0) {
          await this.reminderQueue.add(
            'remind',
            { activityId: activity.id, tenantId: event.tenantId },
            { delay },
          );
        }
      }
    });
  }

  async onUnload(): Promise<void> {
    await this.reminderQueue?.close();
  }
}
