export type VoiceCallDirection = 'inbound' | 'outbound';
export type VoiceCallStatus =
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'no-answer'
  | 'busy'
  | 'failed'
  | 'voicemail';

export interface VoiceCall {
  id: string;
  tenantId: string;
  externalCallId: string;      // provider call SID/ID
  provider: string;            // twilio | vonage | plivo | custom
  direction: VoiceCallDirection;
  status: VoiceCallStatus;
  fromNumber: string;
  toNumber: string;
  contactId?: string;          // resolved contact if matched
  dealId?: string;             // associated deal
  agentId?: string;            // human agent if transferred
  botHandled: boolean;         // true if handled end-to-end by bot
  duration?: number;           // seconds
  recordingUrl?: string;
  transcript?: VoiceTranscript[];
  sentiment?: CallSentiment;
  botIntent?: string;          // detected intent from bot
  botEntities?: Record<string, string>;  // extracted entities
  tags: string[];
  notes?: string;
  outcome?: string;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
}

export interface VoiceTranscript {
  speaker: 'bot' | 'human' | 'agent';
  text: string;
  timestamp: number;           // offset in seconds
  confidence?: number;
}

export interface CallSentiment {
  overall: 'positive' | 'neutral' | 'negative';
  score: number;               // -1.0 to 1.0
  emotions?: Record<string, number>;
}

// Webhook payload from voice providers — normalized form
export interface VoiceWebhookEvent {
  provider: string;
  eventType: VoiceEventType;
  callId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type VoiceEventType =
  | 'call.started'
  | 'call.ringing'
  | 'call.answered'
  | 'call.completed'
  | 'call.failed'
  | 'call.transcription'
  | 'call.recording'
  | 'dtmf.received'
  | 'speech.recognized'
  | 'intent.detected'
  | 'transfer.requested'
  | 'voicemail.received';
