import type { VoiceWebhookEvent, VoiceEventType } from '@crm/shared';

export interface InitiateCallOptions {
  toNumber: string;
  fromNumber: string;
  script?: string;
  webhookUrl?: string;
}

export interface ProviderCallResult {
  callId: string;           // provider-specific call SID/ID
  status: string;
}

// Every voice provider adapter must implement this interface.
// This makes the system provider-agnostic — swap Twilio for Vonage
// without touching any business logic.
export interface VoiceProviderAdapter {
  readonly name: string;

  initiateCall(options: InitiateCallOptions): Promise<ProviderCallResult>;

  // Normalize provider-specific webhook payload into our canonical event
  normalizeWebhook(
    provider: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): VoiceWebhookEvent;

  // Return the HTTP response the provider expects to ACK the webhook
  webhookAck(eventType: VoiceEventType | string): unknown;

  // Build TwiML/NCCO/etc. response for IVR
  buildCallScript?(script: string): string;
}
