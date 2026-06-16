import type { CRMModule, ModuleContext } from '@crm/shared';
import { CRM_EVENTS } from '@crm/core';
import type { EventBus } from '@crm/core';

export class ConnectorsModule implements CRMModule {
  name = 'connectors';
  version = '1.0.0';
  description = 'Third-party integrations: Slack, email, Zapier, generic webhooks';
  requiredPlan = 'starter' as const;

  private eventBus!: EventBus;

  async onLoad(ctx: ModuleContext): Promise<void> {
    this.eventBus = ctx.eventBus as EventBus;
    this.registerEventForwarding();
  }

  private registerEventForwarding(): void {
    // Forward key CRM events to Zapier / Make.com style catch-all webhooks
    // Each tenant can configure which events trigger outbound webhooks
    // (handled by the webhooks route — this module handles the dispatch logic)

    // Slack notification on deal won
    this.eventBus.on(CRM_EVENTS.DEAL_WON, async (event) => {
      await this.notifySlack(event.tenantId, {
        text: `🎉 Deal won: *${(event.payload.deal as any)?.name}* — $${(event.payload.deal as any)?.amount ?? 0}`,
      });
    });

    // Slack notification on voice transfer request
    this.eventBus.on(CRM_EVENTS.VOICE_TRANSFER_REQUESTED, async (event) => {
      await this.notifySlack(event.tenantId, {
        text: `📞 Voice bot requesting transfer for call ${event.payload.callId} to agent ${event.payload.agentId}`,
      });
    });
  }

  private async notifySlack(tenantId: string, message: { text: string }): Promise<void> {
    // Slack webhook URL is stored in tenant settings.voiceConfig or a connector config table
    // This is a no-op if not configured
  }
}
