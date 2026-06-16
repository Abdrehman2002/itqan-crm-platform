import type { VoiceProviderAdapter, InitiateCallOptions, ProviderCallResult } from '../../../voice/src/provider.interface';
import type { VoiceWebhookEvent } from '@crm/shared';

export class VonageAdapter implements VoiceProviderAdapter {
  readonly name = 'vonage';

  constructor(private config: Record<string, string>) {}

  async initiateCall(options: InitiateCallOptions): Promise<ProviderCallResult> {
    const ncco = [
      { action: 'talk', text: options.script ?? 'Hello, this is an automated call.' },
      { action: 'input', type: ['speech'], speechSettings: { endOnSilence: 3 } },
    ];

    const res = await fetch('https://api.nexmo.com/v1/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.jwt}`,
      },
      body: JSON.stringify({
        to: [{ type: 'phone', number: options.toNumber.replace('+', '') }],
        from: { type: 'phone', number: (options.fromNumber ?? this.config.defaultFromNumber).replace('+', '') },
        ncco,
        event_url: [`${process.env.API_BASE_URL}/api/v1/voice/webhook/vonage`],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Vonage error: ${data.title}`);
    return { callId: data.uuid, status: data.status };
  }

  normalizeWebhook(
    provider: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): VoiceWebhookEvent {
    return {
      provider: 'vonage',
      eventType: this.mapVonageEvent(body.status as string, body),
      callId: body.uuid as string,
      timestamp: body.timestamp as string ?? new Date().toISOString(),
      payload: {
        from: body.from,
        to: (body.to as any)?.number,
        direction: body.direction,
        status: body.status,
        duration: body.duration,
        recording_url: body.recording_url,
        speech: (body.speech as any)?.results?.[0]?.text,
        dtmf: (body.dtmf as any)?.digits,
      },
    };
  }

  webhookAck(eventType: string): unknown {
    // Vonage NCCO (Nexmo Call Control Object)
    return [{ action: 'talk', text: '' }];
  }

  private mapVonageEvent(status: string, body: Record<string, unknown>): any {
    if (body.speech) return 'speech.recognized';
    if (body.dtmf) return 'dtmf.received';
    if (body.recording_url) return 'call.recording';
    const map: Record<string, string> = {
      started: 'call.started',
      ringing: 'call.ringing',
      answered: 'call.answered',
      completed: 'call.completed',
      failed: 'call.failed',
      busy: 'call.failed',
      timeout: 'call.failed',
      rejected: 'call.failed',
      cancelled: 'call.failed',
    };
    return map[status] ?? 'call.started';
  }
}
