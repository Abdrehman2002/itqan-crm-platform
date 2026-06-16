import type { CRMModule, ModuleContext } from '@crm/shared';
import { CRM_EVENTS } from '@crm/core';
import type { EventBus } from '@crm/core';

export class DealsModule implements CRMModule {
  name = 'deals';
  version = '1.0.0';
  description = 'Deal pipeline management with Kanban board';
  requiredPlan = 'free' as const;

  private eventBus!: EventBus;

  async onLoad(ctx: ModuleContext): Promise<void> {
    this.eventBus = ctx.eventBus as EventBus;
    const db = ctx.db as any;

    // Auto-create deal when voice bot detects qualifying intent
    this.eventBus.on('voice.qualified_lead', async (event) => {
      const { callId, intent, entities } = event.payload as any;

      // Get default pipeline for this tenant
      const [pipeline] = await db.withTenant(event.tenantId, async (client: any) => {
        const result = await client.query(
          `SELECT id, stages FROM pipelines WHERE is_default = true LIMIT 1`,
        );
        return result.rows;
      });
      if (!pipeline) return;

      const firstStage = (pipeline.stages as any[])[0];
      if (!firstStage) return;

      // Get first available owner
      const [owner] = await db.withTenant(event.tenantId, async (client: any) => {
        const result = await client.query(
          `SELECT id FROM users WHERE is_active = true ORDER BY last_login_at DESC LIMIT 1`,
        );
        return result.rows;
      });

      await db.withTenant(event.tenantId, async (client: any) => {
        await client.query(
          `INSERT INTO deals
             (tenant_id, name, pipeline_id, stage_id, owner_id, source, tags, status)
           VALUES ($1, $2, $3, $4, $5, 'voice_bot', ARRAY[$6], 'open')`,
          [
            event.tenantId,
            `${intent.replace(/_/g, ' ')} — ${entities?.name ?? 'Voice Lead'}`,
            pipeline.id,
            firstStage.id,
            owner?.id,
            intent,
          ],
        );
      });
    });

    // Log activity when deal stage changes
    this.eventBus.on(CRM_EVENTS.DEAL_STAGE_CHANGED, async (event) => {
      const { deal, oldStageId, newStageId } = event.payload as any;
      await db.withTenant(event.tenantId, async (client: any) => {
        await client.query(
          `INSERT INTO activities
             (tenant_id, type, subject, status, deal_id, owner_id)
           VALUES ($1, 'deal_stage_change', $2, 'completed', $3, $4)`,
          [
            event.tenantId,
            `Deal moved: ${oldStageId} → ${newStageId}`,
            deal.id,
            deal.owner_id,
          ],
        );
      });
    });
  }

  async onUnload(): Promise<void> {}
}
