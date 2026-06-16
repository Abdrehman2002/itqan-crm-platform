import type { CRMModule, ModuleContext } from '@crm/shared';
import type { EventBus } from '@crm/core';

export class BillingModule implements CRMModule {
  name = 'billing';
  version = '1.0.0';
  description = 'Subscription billing — Stripe, Wise, JazzCash, Easypaisa, Raast';
  requiredPlan = 'free' as const;

  async onLoad(ctx: ModuleContext): Promise<void> {
    const eventBus = ctx.eventBus as EventBus;

    // When a tenant's trial ends, suspend or send reminder
    eventBus.on('billing.payment_failed', async (event) => {
      const db = ctx.db as any;
      // Mark as past_due after 3 failed attempts (webhook handles retry logic)
      await db.withSuperAdmin(async (client: any) => {
        await client.query(
          `UPDATE tenants SET status = 'past_due' WHERE id = $1`,
          [event.tenantId],
        );
      });
    });

    eventBus.on('billing.payment_succeeded', async (event) => {
      const db = ctx.db as any;
      // Ensure status is active after successful payment
      await db.withSuperAdmin(async (client: any) => {
        await client.query(
          `UPDATE tenants SET status = 'active' WHERE id = $1`,
          [event.tenantId],
        );
      });
    });
  }

  async onUnload(): Promise<void> {}
}
