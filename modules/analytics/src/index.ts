import type { CRMModule, ModuleContext } from '@crm/shared';
import { CRM_EVENTS } from '@crm/core';
import type { EventBus } from '@crm/core';

export class AnalyticsModule implements CRMModule {
  name = 'analytics';
  version = '1.0.0';
  description = 'Revenue analytics, pipeline funnel, and leaderboards';
  requiredPlan = 'starter' as const;

  async onLoad(ctx: ModuleContext): Promise<void> {
    const eventBus = ctx.eventBus as EventBus;
    const redis = ctx.redis as any;

    // Invalidate dashboard cache on any meaningful event
    const invalidate = (tenantId: string) =>
      redis.del(`analytics:dashboard:${tenantId}`).catch(() => {});

    eventBus.on(CRM_EVENTS.DEAL_WON,    (e) => invalidate(e.tenantId));
    eventBus.on(CRM_EVENTS.DEAL_LOST,   (e) => invalidate(e.tenantId));
    eventBus.on(CRM_EVENTS.DEAL_CREATED,(e) => invalidate(e.tenantId));
    eventBus.on(CRM_EVENTS.CONTACT_CREATED, (e) => invalidate(e.tenantId));
    eventBus.on(CRM_EVENTS.VOICE_CALL_COMPLETED, (e) => invalidate(e.tenantId));
  }

  async onUnload(): Promise<void> {}
}
