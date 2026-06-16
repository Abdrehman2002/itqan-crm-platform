import type { CRMModule, ModuleContext } from '@crm/shared';
import { CRM_EVENTS } from '@crm/core';
import type { EventBus } from '@crm/core';

export class VoiceModule implements CRMModule {
  name = 'voice';
  version = '1.0.0';
  description = 'Voice bot integration — provider-agnostic call management';
  requiredPlan = 'starter' as const;
  dependencies = ['contacts', 'activities'];

  async onLoad(ctx: ModuleContext): Promise<void> {
    const eventBus = ctx.eventBus as EventBus;
    const db = ctx.db as any;
    const redis = ctx.redis as any;

    // Cache live call state in Redis for real-time WebSocket streaming
    eventBus.on(CRM_EVENTS.VOICE_CALL_STARTED, async (event) => {
      const callData = event.payload;
      await redis.setex(
        `live_call:${event.tenantId}:${(callData as any).externalCallId}`,
        3600,
        JSON.stringify(callData),
      );
    });

    // Remove from live cache when call ends
    eventBus.on(CRM_EVENTS.VOICE_CALL_COMPLETED, async (event) => {
      const call = (event.payload as any).call;
      if (call?.external_call_id) {
        await redis.del(`live_call:${event.tenantId}:${call.external_call_id}`);
      }
    });

    // When transcription arrives, push to WebSocket subscribers
    eventBus.on(CRM_EVENTS.VOICE_CALL_TRANSCRIBED, async (event) => {
      const { callId, transcript } = event.payload as any;
      // Push to stream channel — picked up by WebSocket handler in voice route
      await redis.native.publish(
        `voice:stream:${event.tenantId}:${callId}`,
        JSON.stringify({ type: 'transcript', data: transcript }),
      );
    });
  }

  async onUnload(): Promise<void> {}
}
