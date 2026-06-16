import type { CRMModule, ModuleContext } from '@crm/shared';
import { CRM_EVENTS } from '@crm/core';
import type { EventBus } from '@crm/core';

export class ContactsModule implements CRMModule {
  name = 'contacts';
  version = '1.0.0';
  description = 'Contacts and Companies management with lead scoring';
  requiredPlan = 'free' as const;

  private eventBus!: EventBus;

  async onLoad(ctx: ModuleContext): Promise<void> {
    this.eventBus = ctx.eventBus as EventBus;

    // Auto-bump contact score when a call completes
    this.eventBus.on(CRM_EVENTS.VOICE_CALL_COMPLETED, async (event) => {
      const { contactId } = event.payload as any;
      if (!contactId) return;
      const db = ctx.db as any;
      await db.withTenant(event.tenantId, async (client: any) => {
        await client.query(
          `UPDATE contacts
           SET score = LEAST(score + 5, 100),
               last_contacted_at = NOW()
           WHERE id = $1`,
          [contactId],
        );
      });
    });

    // Create contact from voice bot if caller not matched
    this.eventBus.on('voice.qualified_lead', async (event) => {
      const { callId, intent, entities } = event.payload as any;
      const db = ctx.db as any;
      const phone = entities?.phone ?? entities?.caller_number;
      if (!phone) return;

      await db.withTenant(event.tenantId, async (client: any) => {
        await client.query(
          `INSERT INTO contacts
             (tenant_id, first_name, phone, source, status, tags, score)
           VALUES ($1, $2, $3, 'voice_bot', 'lead', ARRAY[$4], 20)
           ON CONFLICT DO NOTHING`,
          [event.tenantId, entities?.name ?? 'Unknown', phone, intent],
        );
      });
    });
  }

  async onUnload(): Promise<void> {}
}
