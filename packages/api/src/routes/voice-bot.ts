/**
 * Voice Bot routes — /api/v1/voice-bot
 *
 * Phase 1: Third-party AI voice bot integration.
 * Supported providers: Vapi, Retell AI, Bland.ai
 *
 * Flow:
 *   Customer calls helpline → Third-party AI answers via SIP
 *   → AI extracts complaint info → Provider sends webhook to us
 *   → We parse payload, create voice_bot_call record
 *   → If auto_create_ticket enabled → ticket created (channel='voice_bot')
 *
 * Webhook endpoints are PUBLIC (no auth — validated by signature instead):
 *   POST /api/v1/voice-bot/webhook/vapi
 *   POST /api/v1/voice-bot/webhook/retell
 *   POST /api/v1/voice-bot/webhook/bland
 *
 * Protected endpoints:
 *   GET  /api/v1/voice-bot/config            — get bot configuration
 *   PUT  /api/v1/voice-bot/config            — save bot configuration
 *   GET  /api/v1/voice-bot/calls             — list inbound bot calls
 *   GET  /api/v1/voice-bot/calls/:id         — single call detail
 *   POST /api/v1/voice-bot/calls/:id/ticket  — manually create ticket from a call
 *   GET  /api/v1/voice-bot/stats             — dashboard stats
 *   POST /api/v1/voice-bot/test-call         — initiate a test outbound call (Vapi/Retell)
 *   GET  /api/v1/voice-bot/webhook-url       — get the webhook URL to configure in provider
 */

import type { FastifyInstance } from 'fastify';
import { createHmac } from 'crypto';
import { z } from 'zod';
import type { DatabaseClient, EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import { requireScope, requireRole } from '../middlewares/auth.middleware';

// ── Default IVR menu ─────────────────────────────────────────────────────
const DEFAULT_IVR_MENU = [
  { option: 1, intent: 'complaint', label: 'Register a complaint',        ticketType: 'complaint', description: 'Lodge a complaint about a product or service' },
  { option: 2, intent: 'inquiry',   label: 'Product & service enquiries', ticketType: 'inquiry',   description: 'Ask about our products and offerings'          },
  { option: 3, intent: 'sales',     label: 'Speak to a sales agent',      ticketType: 'sales',     description: 'Connect with our sales team'                   },
];

// ── IVR system prompt generator ───────────────────────────────────────────
function buildSystemPrompt(menu: typeof DEFAULT_IVR_MENU, customPrompt?: string): string {
  const menuText = menu.map(m => `  Press ${m.option} — ${m.label}: ${m.description}`).join('\n');
  const base = `You are a professional customer service voice assistant. When a customer calls:

1. Greet them warmly and introduce yourself.
2. Ask how you can help them today.
3. Present the following options:
${menuText}

For COMPLAINT (option 1):
- Collect the customer's full name, contact number, and email address.
- Ask them to describe their complaint clearly.
- Confirm the details back to the customer.
- Inform them a support ticket will be raised and they will receive a reference number.
- Set extracted_subject to a one-line summary of the complaint.
- Set extracted_priority based on urgency (urgent/high/medium/low).
- Set ticket_type to "complaint".

For INQUIRY (option 2):
- Answer questions about products and services professionally.
- If the customer is interested in purchasing, collect their name, number and email.
- Set ticket_type to "inquiry".
- Set intent to "sales_lead" if they want to buy.

For SALES (option 3):
- Collect the customer's name, number, and email.
- Ask about their requirements briefly.
- Inform them a sales representative will contact them.
- Set ticket_type to "sales".

Always be polite, concise and professional. Speak clearly.`;

  return customPrompt
    ? base + '\n\nAdditional instructions:\n' + customPrompt
    : base;
}


// ── Ticket extraction from call data ──────────────────────────────────────

const URGENCY_KEYWORDS = [
  'urgent', 'emergency', 'critical', 'asap', 'immediately', 'right now',
  'serious', 'severe', 'life', 'danger', 'broken', 'not working', 'outage',
];

function extractPriority(text: string, configured: string[] = []): 'urgent' | 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase();
  const allKeywords = [...URGENCY_KEYWORDS, ...configured];
  if (allKeywords.some(k => lower.includes(k.toLowerCase()))) return 'urgent';
  if (lower.includes('important') || lower.includes('soon') || lower.includes('today')) return 'high';
  if (lower.includes('whenever') || lower.includes('low priority') || lower.includes('minor')) return 'low';
  return 'medium';
}

function extractSubject(summary: string, fallback: string): string {
  // Take the first sentence (up to 120 chars) of the AI summary
  const first = summary?.split(/[.!?]/)[0]?.trim();
  if (first && first.length > 10) return first.slice(0, 120);
  return fallback.slice(0, 120);
}

function extractSentiment(text: string): 'positive' | 'neutral' | 'negative' | 'urgent' {
  const lower = text.toLowerCase();
  if (URGENCY_KEYWORDS.some(k => lower.includes(k))) return 'urgent';
  const negWords = ['problem', 'issue', 'complaint', 'frustrated', 'unhappy', 'broken', 'fail', 'wrong', 'bad'];
  const posWords = ['great', 'happy', 'satisfied', 'pleased', 'wonderful', 'excellent', 'thank'];
  const negCount = negWords.filter(w => lower.includes(w)).length;
  const posCount = posWords.filter(w => lower.includes(w)).length;
  if (negCount > posCount) return 'negative';
  if (posCount > negCount) return 'positive';
  return 'neutral';
}

// ── Normalised call data (provider-agnostic) ─────────────────────────────

interface NormalisedCall {
  providerCallId: string;
  fromNumber: string;
  toNumber?: string;
  durationSeconds?: number;
  status: string;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  extractedName?: string;
  extractedEmail?: string;
  startedAt?: Date;
  endedAt?: Date;
  rawPayload: Record<string, unknown>;
}

// ── Provider normalisation ────────────────────────────────────────────────

function normaliseVapi(body: Record<string, unknown>): NormalisedCall | null {
  // Vapi sends a top-level "type" field; we care about "end-of-call-report"
  const type   = (body.type ?? body.message?.type ?? '') as string;
  const call   = (body.call ?? body.message?.call ?? body) as any;
  const analysis = (body.analysis ?? body.message?.analysis ?? {}) as any;

  if (!['end-of-call-report', 'call-ended', 'call.ended'].includes(type) && !call?.id) return null;

  const transcript = (body.transcript ?? body.message?.transcript ?? call?.transcript ?? '') as string;
  const summary    = (analysis?.summary ?? call?.summary ?? '') as string;

  return {
    providerCallId: (call?.id ?? call?.callId ?? '') as string,
    fromNumber:     (call?.customer?.number ?? call?.phoneNumber ?? '') as string,
    toNumber:       (call?.phoneNumber?.number ?? '') as string,
    durationSeconds: call?.duration ?? call?.durationSeconds,
    status: 'completed',
    transcript,
    summary: summary || transcript.slice(0, 500),
    recordingUrl: (call?.recordingUrl ?? call?.artifact?.recordingUrl) as string | undefined,
    extractedName:  (analysis?.customerName ?? call?.customer?.name) as string | undefined,
    extractedEmail: (analysis?.customerEmail) as string | undefined,
    startedAt: call?.startedAt ? new Date(call.startedAt) : undefined,
    endedAt:   call?.endedAt   ? new Date(call.endedAt)   : undefined,
    rawPayload: body,
  };
}

function normaliseRetell(body: Record<string, unknown>): NormalisedCall | null {
  const event = (body.event ?? '') as string;
  if (!['call_ended', 'call_analyzed'].includes(event) && !body.call_id) return null;

  const call     = (body.call ?? body) as any;
  const analysis = (call?.call_analysis ?? {}) as any;
  const transcript = (call?.transcript ?? body.transcript ?? '') as string;

  return {
    providerCallId: (call?.call_id ?? body.call_id ?? '') as string,
    fromNumber:     (call?.from_number ?? '') as string,
    toNumber:       (call?.to_number ?? '') as string,
    durationSeconds: call?.duration_ms ? Math.round(call.duration_ms / 1000) : undefined,
    status: 'completed',
    transcript,
    summary: (analysis?.call_summary ?? analysis?.summary ?? transcript.slice(0, 500)) as string,
    recordingUrl: (call?.recording_url) as string | undefined,
    extractedName:  (analysis?.custom_analysis_data?.customer_name ?? analysis?.caller_name) as string | undefined,
    extractedEmail: (analysis?.custom_analysis_data?.customer_email) as string | undefined,
    startedAt: call?.start_timestamp ? new Date(call.start_timestamp) : undefined,
    endedAt:   call?.end_timestamp   ? new Date(call.end_timestamp)   : undefined,
    rawPayload: body,
  };
}

function normaliseBland(body: Record<string, unknown>): NormalisedCall | null {
  // Bland sends the call data directly
  if (!body.call_id && !body.c_id) return null;

  const transcript = (body.transcript ?? body.concatenated_transcript ?? '') as string;
  const summary    = (body.summary ?? '') as string;

  return {
    providerCallId: (body.call_id ?? body.c_id ?? '') as string,
    fromNumber:     (body.from   ?? body.phone_number ?? '') as string,
    toNumber:       (body.to     ?? '') as string,
    durationSeconds: body.call_length ? Math.round(Number(body.call_length) * 60) : undefined,
    status: (body.status ?? 'completed') as string,
    transcript,
    summary: summary || transcript.slice(0, 500),
    recordingUrl: (body.recording_url) as string | undefined,
    extractedName:  (body.variables?.customer_name ?? body.metadata?.customer_name) as string | undefined,
    extractedEmail: (body.variables?.customer_email ?? body.metadata?.customer_email) as string | undefined,
    startedAt: body.start_time ? new Date(body.start_time as string) : undefined,
    endedAt:   body.end_time   ? new Date(body.end_time   as string) : undefined,
    rawPayload: body,
  };
}

const NORMALISERS: Record<string, (body: Record<string, unknown>) => NormalisedCall | null> = {
  vapi:   normaliseVapi,
  retell: normaliseRetell,
  bland:  normaliseBland,
};

// ── Webhook signature validation ──────────────────────────────────────────

function verifyWebhookSignature(
  provider: string,
  secret: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (!secret) return true; // no secret configured → skip (dev mode)

  const header = (key: string) => {
    const v = headers[key];
    return Array.isArray(v) ? v[0] : (v ?? '');
  };

  try {
    switch (provider) {
      case 'vapi': {
        // Vapi uses HMAC-SHA256 on the raw body, header: x-vapi-signature
        const sig = header('x-vapi-signature');
        const expected = createHmac('sha256', secret).update(body).digest('hex');
        return sig === expected || sig === `sha256=${expected}`;
      }
      case 'retell': {
        const sig = header('x-retell-signature');
        const expected = createHmac('sha256', secret).update(body).digest('hex');
        return sig === expected;
      }
      case 'bland': {
        const sig = header('x-bland-signature') || header('authorization');
        if (sig === secret) return true;
        const expected = createHmac('sha256', secret).update(body).digest('hex');
        return sig === expected;
      }
      default:
        return true;
    }
  } catch {
    return false;
  }
}

// ── Ticket creation from normalised call ─────────────────────────────────

async function createTicketFromBotCall(
  db: DatabaseClient,
  eventBus: EventBus,
  tenantId: string,
  botCallId: string,
  call: NormalisedCall,
  config: any,
): Promise<string | null> {
  try {
    const fullText = [call.summary, call.transcript].filter(Boolean).join(' ');
    const priority = extractPriority(fullText, config?.keyword_urgency ?? []) as string;

    const subject = extractSubject(
      call.summary ?? '',
      `Support request from ${call.fromNumber || 'caller'}`,
    );

    const description = [
      call.summary ? `Summary: ${call.summary}` : null,
      call.transcript ? `\nTranscript:\n${call.transcript.slice(0, 2000)}` : null,
    ].filter(Boolean).join('\n');

    // Look up contact by phone number
    const [contact] = await db.withSuperAdmin(async (c) => {
      if (!call.fromNumber) return [];
      const r = await c.query(
        `SELECT id FROM contacts WHERE tenant_id = $1 AND phone ILIKE $2 LIMIT 1`,
        [tenantId, `%${call.fromNumber.replace(/\D/g, '').slice(-10)}%`],
      );
      return r.rows;
    });

    const [{ next_val }] = (await db.withSuperAdmin(async (c) =>
      (await c.query(
        `INSERT INTO ticket_counters (tenant_id, next_val) VALUES ($1, 2)
         ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
         RETURNING next_val`,
        [tenantId],
      )).rows,
    ));
    const ticketNumber = `TKT-${String(Number(next_val) - 1).padStart(5, '0')}`;

    const [slaRow] = await db.withSuperAdmin(async (c) => {
      const r = await c.query(
        `SELECT id FROM sla_policies WHERE tenant_id = $1 AND priority = $2 AND is_active = true LIMIT 1`,
        [tenantId, priority],
      );
      return r.rows;
    });

    // Detect ticket_type from IVR menu intent (extracted from transcript/summary)
    const ivrMenu = config?.ivr_menu ?? DEFAULT_IVR_MENU;
    let ticketType = 'complaint';
    if (call.summary || call.transcript) {
      const text = (call.summary ?? '') + ' ' + (call.transcript ?? '');
      const lower = text.toLowerCase();
      if (lower.includes('sales') || lower.includes('buy') || lower.includes('purchase') || lower.includes('price') || lower.includes('offer')) {
        ticketType = 'sales';
      } else if (lower.includes('inquiry') || lower.includes('enquiry') || lower.includes('information') || lower.includes('product') || lower.includes('service')) {
        ticketType = 'inquiry';
      }
    }

    // Map ticket_type → department_type so we can pick the matching dept queue.
    const TICKET_TYPE_TO_DEPT: Record<string, string> = {
      complaint: 'complaint',
      sales:     'sales',
      inquiry:   'support',
      support:   'support',
    };
    const targetDept = TICKET_TYPE_TO_DEPT[ticketType] ?? null;

    // Queue selection priority:
    //  1) Dept-specific queue matching the inferred ticket type (migration 015 auto-creates these)
    //  2) IVR menu's mapped queue for this type
    //  3) voice_bot_config.default_queue_id
    //  4) tenant's is_default queue
    const [queueRow] = await db.withSuperAdmin(async (c) => {
      if (targetDept) {
        const r = await c.query(
          `SELECT id FROM ticket_queues WHERE tenant_id = $1 AND department_type = $2 LIMIT 1`,
          [tenantId, targetDept],
        );
        if (r.rows.length) return r.rows;
      }
      if (config?.default_queue_id) {
        const r = await c.query(
          `SELECT id FROM ticket_queues WHERE id = $1 AND tenant_id = $2`,
          [config.default_queue_id, tenantId],
        );
        if (r.rows.length) return r.rows;
      }
      const r = await c.query(
        `SELECT id FROM ticket_queues WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
        [tenantId],
      );
      return r.rows;
    });

    // IVR menu override (legacy — kept for backward compat)
    const ivrOption = ivrMenu.find((m: any) => m.ticketType === ticketType || m.intent === ticketType);
    const resolvedQueueId = queueRow?.id ?? ivrOption?.queueId ?? null;

    const [ticket] = await db.withSuperAdmin(async (c) => {
      const r = await c.query(
        `INSERT INTO tickets
           (tenant_id, ticket_number, subject, description, status, priority, channel,
            queue_id, sla_policy_id, contact_id, reporter_phone, reporter_name, reporter_email,
            ticket_type, tags, custom_fields)
         VALUES ($1,$2,$3,$4,'open',$5,'voice_bot',$6,$7,$8,$9,$10,$11,$12,'{}','{}')
         RETURNING *`,
        [
          tenantId, ticketNumber, subject, description, priority,
          resolvedQueueId,
          slaRow?.id   ?? null,
          contact?.id  ?? null,
          call.fromNumber       ?? null,
          call.extractedName    ?? null,
          call.extractedEmail   ?? null,
          ticketType,
        ],
      );
      return r.rows;
    });

    // Load milestone template for this ticket type
    const [milestoneTemplate] = await db.withSuperAdmin(async (c) => {
      const r = await c.query(
        `SELECT steps FROM ticket_milestone_templates WHERE tenant_id = $1 AND ticket_type = $2`,
        [tenantId, ticketType],
      );
      return r.rows;
    });
    if (milestoneTemplate?.steps?.length > 0) {
      await db.withSuperAdmin(async (c) => {
        await c.query(
          `UPDATE tickets SET milestones = $1::jsonb WHERE id = $2`,
          [JSON.stringify(milestoneTemplate.steps.map((s: any, idx: number) => ({ ...s, completed: false, order: idx }))), ticket.id],
        );
      });
    }

    // Link ticket back to the voice_bot_call record
    await db.withSuperAdmin(async (c) => {
      await c.query(
        `UPDATE voice_bot_calls SET ticket_id = $1 WHERE id = $2`,
        [ticket.id, botCallId],
      );
    });

    // Push routing — auto-assign if queue is configured for push
    const [qCfg] = await db.withSuperAdmin(async (c) => {
      if (!resolvedQueueId) return [];
      const r = await c.query(`SELECT routing_method FROM ticket_queues WHERE id = $1`, [resolvedQueueId]);
      return r.rows;
    });
    if (qCfg?.routing_method === 'push_random' || qCfg?.routing_method === 'push_criteria') {
      const agents = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `SELECT id FROM users WHERE tenant_id=$1 AND is_active=true AND role IN ('agent','manager') ORDER BY id`,
          [tenantId],
        );
        return r.rows.map((u: any) => u.id as string);
      });
      if (agents.length > 0) {
        const chosen = agents[Math.floor(Math.random() * agents.length)];
        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET assignee_id=$1, status='assigned' WHERE id=$2`,
            [chosen, ticket.id],
          );
        });
      }
    }

    await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, {
      source: 'voice_bot', ticketId: ticket.id, ticketType,
    });

    return ticket.id as string;
  } catch (err: any) {
    console.error('[VoiceBot→Ticket]', err.message);
    return null;
  }
}

// ── LiveKit (self-hosted Urdu agent "Nadia") — structured complaint → ticket ──
// Unlike the keyword-derived path above, this trusts the agent's explicit fields
// (it has already extracted priority/category/subject accurately in Urdu).

const PRIORITY_MAP: Record<string, 'urgent' | 'high' | 'medium' | 'low'> = {
  p1: 'urgent', p2: 'high', p3: 'medium', p4: 'low',
  urgent: 'urgent', high: 'high', medium: 'medium', low: 'low',
};

interface StructuredComplaint {
  reporterName?: string;
  reporterPhone?: string;
  reporterEmail?: string;
  category?: string;   // loan_issue | account_issue | staff_complaint | digital_banking | fraud | branch_service | other
  priority?: string;   // P1..P4 or urgent..low
  subject?: string;
  description?: string;
  fraudAmount?: string;
  transcript?: string;
  callId?: string;
}

async function createComplaintFromStructured(
  db: DatabaseClient,
  eventBus: EventBus,
  tenantId: string,
  s: StructuredComplaint,
): Promise<{ ticketId: string; ticketNumber: string; voiceCallId: string } | null> {
  try {
    const priority = PRIORITY_MAP[(s.priority || 'medium').toLowerCase()] ?? 'medium';
    const subject = (s.subject || s.description || 'Voice complaint').slice(0, 120);
    const description = s.description || s.subject || '';

    const [contact] = await db.withSuperAdmin(async (c) => {
      if (!s.reporterPhone) return [];
      const r = await c.query(
        `SELECT id FROM contacts WHERE tenant_id=$1 AND phone ILIKE $2 LIMIT 1`,
        [tenantId, `%${s.reporterPhone.replace(/\D/g, '').slice(-10)}%`],
      );
      return r.rows;
    });

    const [{ next_val }] = await db.withSuperAdmin(async (c) =>
      (await c.query(
        `INSERT INTO ticket_counters (tenant_id, next_val) VALUES ($1, 2)
         ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
         RETURNING next_val`, [tenantId])).rows);
    const ticketNumber = `TKT-${String(Number(next_val) - 1).padStart(5, '0')}`;

    // Nadia handles complaints — route to the Complaints dept queue (auto-created
    // by migration 015), fall back to default only if the Complaints queue is missing.
    const [queueRow] = await db.withSuperAdmin(async (c) =>
      (await c.query(
        `SELECT id FROM ticket_queues
          WHERE tenant_id = $1
            AND (LOWER(name) IN ('complaints','complaint','complaints queue') OR is_default = true)
          ORDER BY (LOWER(name) IN ('complaints','complaint','complaints queue')) DESC, is_default DESC
          LIMIT 1`, [tenantId])).rows);
    const [slaRow] = await db.withSuperAdmin(async (c) =>
      (await c.query(`SELECT id FROM sla_policies WHERE tenant_id=$1 AND priority=$2 AND is_active=true LIMIT 1`, [tenantId, priority])).rows);

    // Call record (provider='livekit')
    const [botCall] = await db.withSuperAdmin(async (c) =>
      (await c.query(
        `INSERT INTO voice_bot_calls
           (tenant_id, provider, provider_call_id, from_number, status, transcript, summary,
            sentiment, extracted_subject, extracted_priority, extracted_reporter_name,
            extracted_reporter_email, raw_payload)
         VALUES ($1,'livekit',$2,$3,'completed',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         RETURNING id`,
        [tenantId, s.callId ?? null, s.reporterPhone ?? null, s.transcript ?? null, description,
         priority === 'urgent' ? 'urgent' : 'negative', subject, priority,
         s.reporterName ?? null, s.reporterEmail ?? null,
         JSON.stringify({ category: s.category, fraudAmount: s.fraudAmount })],
      )).rows);

    const [ticket] = await db.withSuperAdmin(async (c) =>
      (await c.query(
        `INSERT INTO tickets
           (tenant_id, ticket_number, subject, description, status, priority, channel,
            queue_id, sla_policy_id, contact_id, reporter_phone, reporter_name, reporter_email,
            ticket_type, tags, custom_fields)
         VALUES ($1,$2,$3,$4,'open',$5,'voice_bot',$6,$7,$8,$9,$10,$11,'complaint',$12,$13::jsonb)
         RETURNING id`,
        [tenantId, ticketNumber, subject, description, priority,
         queueRow?.id ?? null, slaRow?.id ?? null, contact?.id ?? null,
         s.reporterPhone ?? null, s.reporterName ?? null, s.reporterEmail ?? null,
         [s.category ?? 'other'],
         JSON.stringify({ category: s.category, fraud_amount: s.fraudAmount, agent: 'nadia' })],
      )).rows);

    await db.withSuperAdmin(async (c) => {
      await c.query(`UPDATE voice_bot_calls SET ticket_id=$1 WHERE id=$2`, [ticket.id, botCall.id]);
    });

    await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, {
      source: 'livekit', ticketId: ticket.id, ticketType: 'complaint',
    });

    return { ticketId: ticket.id as string, ticketNumber, voiceCallId: botCall.id as string };
  } catch (err: any) {
    console.error('[LiveKit→Ticket]', err.message);
    return null;
  }
}

// ── Route factory ─────────────────────────────────────────────────────────

export function voiceBotRoutes(db: DatabaseClient, eventBus: EventBus) {
  return async function (fastify: FastifyInstance) {

    // ── Webhook URL helper (public) ───────────────────────────────────────
    // Returns the URL the tenant should paste into their provider's dashboard.
    // Needs the tenant's public API base URL from settings.
    fastify.get('/webhook-url', { preHandler: requireScope('settings:read') }, async (req, reply) => {
      const base = process.env.API_BASE_URL ?? `https://api.yourcrm.com`;
      const providers = ['vapi', 'retell', 'bland'];
      return reply.send({
        success: true,
        data: providers.reduce((acc, p) => ({
          ...acc,
          [p]: `${base}/api/v1/voice-bot/webhook/${p}?tenantId=${req.tenant.id}`,
        }), {} as Record<string, string>),
      });
    });

    // ── Inbound webhooks (PUBLIC — no auth, signature-verified) ──────────
    for (const provider of ['vapi', 'retell', 'bland'] as const) {
      fastify.post(`/webhook/${provider}`, async (req, reply) => {
        const { tenantId } = req.query as { tenantId?: string };

        if (!tenantId) {
          return reply.code(400).send({ error: 'tenantId query param required' });
        }

        // Load tenant connector config to get webhook secret
        const [tenant] = await db.withSuperAdmin(async (c) => {
          const r = await c.query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
          return r.rows;
        });
        if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

        const connectorCfg: Record<string, string> =
          (tenant.settings as any)?.connectors?.[provider] ?? {};

        // Verify webhook signature — REQUIRED. Reject if no secret is configured.
        // This prevents unauthenticated actors from forging webhook payloads.
        const rawBody = JSON.stringify(req.body);
        if (!connectorCfg.webhookSecret) {
          // No secret configured — refuse the request to prevent spoofing.
          // The tenant must configure a webhook secret in their connector settings.
          return reply.code(401).send({ error: 'Webhook secret not configured. Configure a webhook secret in your voice bot connector settings.' });
        }
        const valid = verifyWebhookSignature(
          provider,
          connectorCfg.webhookSecret,
          rawBody,
          req.headers as Record<string, string>,
        );
        if (!valid) {
          return reply.code(401).send({ error: 'Invalid webhook signature' });
        }

        // Normalise provider payload
        const normaliser = NORMALISERS[provider];
        const callData = normaliser(req.body as Record<string, unknown>);

        if (!callData || !callData.providerCallId) {
          // Unknown event type from this provider — acknowledge but skip
          return reply.code(200).send({ received: true, processed: false });
        }

        // Load bot config for this tenant + provider
        const [botConfig] = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT * FROM voice_bot_configs WHERE tenant_id = $1 AND provider = $2`,
            [tenantId, provider],
          );
          return r.rows;
        });

        const sentiment = extractSentiment(
          [callData.summary, callData.transcript].filter(Boolean).join(' '),
        );

        // Persist call record
        const [botCall] = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `INSERT INTO voice_bot_calls
               (tenant_id, provider, provider_call_id, from_number, to_number,
                duration_seconds, status, transcript, summary, recording_url, sentiment,
                extracted_subject, extracted_priority, extracted_reporter_name,
                extracted_reporter_email, raw_payload, started_at, ended_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              tenantId, provider, callData.providerCallId,
              callData.fromNumber || null,
              callData.toNumber   || null,
              callData.durationSeconds ?? null,
              callData.status,
              callData.transcript  ?? null,
              callData.summary     ?? null,
              callData.recordingUrl ?? null,
              sentiment,
              callData.summary     ? extractSubject(callData.summary, '') : null,
              extractPriority([callData.summary, callData.transcript].filter(Boolean).join(' '),
                botConfig?.keyword_urgency ?? []),
              callData.extractedName  ?? null,
              callData.extractedEmail ?? null,
              JSON.stringify(callData.rawPayload),
              callData.startedAt ?? null,
              callData.endedAt   ?? null,
            ],
          );
          return r.rows;
        });

        if (!botCall) {
          // Duplicate call ID — already processed
          return reply.code(200).send({ received: true, processed: false, reason: 'duplicate' });
        }

        // Auto-create ticket if configured (default: true)
        let ticketId: string | null = null;
        if (botConfig?.auto_create_ticket !== false) {
          ticketId = await createTicketFromBotCall(
            db, eventBus, tenantId, botCall.id, callData, botConfig,
          );
        }

        return reply.code(200).send({
          received: true,
          processed: true,
          botCallId: botCall.id,
          ticketId,
        });
      });
    }

    // ══ Protected routes below ═══════════════════════════════════════════

    // ── Bot configuration ──────────────────────────────────────────────

    fastify.get('/config', { preHandler: requireScope('settings:read') }, async (req, reply) => {
      const configs = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT vbc.*, tq.name AS queue_name
           FROM voice_bot_configs vbc
           LEFT JOIN ticket_queues tq ON vbc.default_queue_id = tq.id`,
        );
        return r.rows;
      });
      return reply.send({ success: true, data: configs });
    });

    const ConfigSchema = z.object({
      provider:           z.enum(['vapi', 'retell', 'bland', 'twilio_ai']),
      isActive:           z.boolean().optional(),
      assistantId:        z.string().optional(),
      phoneNumber:        z.string().optional(),
      greetingMessage:    z.string().optional(),
      systemPrompt:       z.string().optional(),
      language:           z.string().optional(),
      voiceId:            z.string().optional(),
      autoCreateTicket:   z.boolean().optional(),
      defaultQueueId:     z.string().uuid().optional().nullable(),
      defaultPriority:    z.enum(['urgent','high','medium','low']).optional(),
      keywordUrgency:     z.array(z.string()).optional(),
      sipUri:             z.string().optional(),
      ivrMenu:            z.array(z.object({
        option:      z.number().int().min(1).max(9),
        intent:      z.enum(['complaint', 'inquiry', 'sales', 'agent']),
        label:       z.string(),
        ticketType:  z.enum(['complaint', 'inquiry', 'sales']).optional(),
        queueId:     z.string().uuid().optional().nullable(),
        description: z.string().optional(),
      })).optional(),
    });

    fastify.put('/config', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const body = ConfigSchema.parse(req.body);

      const [cfg] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
           `INSERT INTO voice_bot_configs
              (tenant_id, provider, is_active, assistant_id, phone_number,
               greeting_message, system_prompt, language, voice_id,
               auto_create_ticket, default_queue_id, default_priority, keyword_urgency,
               sip_uri, ivr_menu)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT (tenant_id, provider) DO UPDATE SET
              is_active          = EXCLUDED.is_active,
              assistant_id       = EXCLUDED.assistant_id,
              phone_number       = EXCLUDED.phone_number,
              greeting_message   = EXCLUDED.greeting_message,
              system_prompt      = EXCLUDED.system_prompt,
              language           = EXCLUDED.language,
              voice_id           = EXCLUDED.voice_id,
              auto_create_ticket = EXCLUDED.auto_create_ticket,
              default_queue_id   = EXCLUDED.default_queue_id,
              default_priority   = EXCLUDED.default_priority,
              keyword_urgency    = EXCLUDED.keyword_urgency,
              sip_uri            = EXCLUDED.sip_uri,
              ivr_menu           = EXCLUDED.ivr_menu,
              updated_at         = NOW()
            RETURNING *`,
           [
             req.tenant.id,
             body.provider,
             body.isActive ?? true,
             body.assistantId     ?? null,
             body.phoneNumber     ?? null,
             body.greetingMessage ?? null,
             body.systemPrompt    ?? null,
             body.language        ?? 'en-US',
             body.voiceId         ?? null,
             body.autoCreateTicket ?? true,
             body.defaultQueueId  ?? null,
             body.defaultPriority ?? 'medium',
             body.keywordUrgency  ?? URGENCY_KEYWORDS,
             body.sipUri          ?? null,
             JSON.stringify(body.ivrMenu ?? DEFAULT_IVR_MENU),
           ],
        );
        return r.rows;
      });

      return reply.send({ success: true, data: cfg });
    });

    // ── Call list ──────────────────────────────────────────────────────

    fastify.get('/calls', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { provider, hasTicket, sentiment, search, page = 1, pageSize = 25 } =
        req.query as Record<string, string>;
      const offset = (Number(page) - 1) * Number(pageSize);

      // Parameterize every WHERE fragment. The old version interpolated
      // user-supplied provider/sentiment/search directly into the SQL — full
      // SQL injection by any authenticated user.
      const conds: string[] = [];
      const params: any[] = [];
      let p = 1;
      if (provider)   { conds.push(`vbc.provider  = $${p++}`); params.push(provider); }
      if (sentiment)  { conds.push(`vbc.sentiment = $${p++}`); params.push(sentiment); }
      if (hasTicket === 'true')  conds.push('vbc.ticket_id IS NOT NULL');
      if (hasTicket === 'false') conds.push('vbc.ticket_id IS NULL');
      if (search) {
        const like = `%${search}%`;
        conds.push(`(vbc.from_number ILIKE $${p} OR vbc.summary ILIKE $${p} OR vbc.extracted_reporter_name ILIKE $${p})`);
        params.push(like); p++;
      }
      const whereSql = conds.length ? 'AND ' + conds.join(' AND ') : '';
      params.push(Number(pageSize), offset);
      const limitOffsetIdx = `$${p} OFFSET $${p + 1}`;

      const calls = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT vbc.*,
             t.ticket_number, t.status AS ticket_status, t.priority AS ticket_priority,
             con.first_name || ' ' || COALESCE(con.last_name,'') AS contact_name
           FROM voice_bot_calls vbc
           LEFT JOIN tickets  t   ON vbc.ticket_id  = t.id
           LEFT JOIN contacts con ON vbc.contact_id = con.id
           WHERE 1=1 ${whereSql}
           ORDER BY vbc.created_at DESC
           LIMIT ${limitOffsetIdx}`,
          params,
        );
        // Count uses the same WHERE fragments (drop the last 2 limit/offset params).
        const cnt = await c.query(
          `SELECT COUNT(*) FROM voice_bot_calls vbc
           WHERE tenant_id = current_setting('app.tenant_id',true)::uuid ${whereSql}`,
          params.slice(0, params.length - 2),
        );
        return { rows: r.rows, total: parseInt(cnt.rows[0].count) };
      });

      return reply.send({
        success: true,
        data: calls.rows,
        meta: { total: calls.total, page: Number(page), pageSize: Number(pageSize) },
      });
    });

    // ── Single call ────────────────────────────────────────────────────

    fastify.get('/calls/:id', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [call] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT vbc.*,
             t.ticket_number, t.status AS ticket_status, t.subject AS ticket_subject,
             t.priority AS ticket_priority, t.assigned_to,
             u.name AS assignee_name,
             con.first_name || ' ' || COALESCE(con.last_name,'') AS contact_name,
             con.email AS contact_email
           FROM voice_bot_calls vbc
           LEFT JOIN tickets  t   ON vbc.ticket_id  = t.id
           LEFT JOIN users    u   ON t.assigned_to  = u.id
           LEFT JOIN contacts con ON vbc.contact_id = con.id
           WHERE vbc.id = $1`,
          [id],
        );
        return r.rows;
      });

      if (!call) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      return reply.send({ success: true, data: call });
    });

    // ── Manually create ticket from a call ─────────────────────────────

    fastify.post('/calls/:id/ticket', { preHandler: requireScope('tickets:write') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [botCall] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query('SELECT * FROM voice_bot_calls WHERE id = $1', [id]);
        return r.rows;
      });

      if (!botCall) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND' } });
      if (botCall.ticket_id) {
        return reply.code(409).send({
          success: false,
          error: { code: 'ALREADY_HAS_TICKET', message: 'A ticket already exists for this call' },
        });
      }

      const callData: NormalisedCall = {
        providerCallId: botCall.provider_call_id,
        fromNumber:     botCall.from_number ?? '',
        durationSeconds: botCall.duration_seconds,
        status: botCall.status,
        transcript: botCall.transcript,
        summary:    botCall.summary,
        recordingUrl: botCall.recording_url,
        extractedName:  botCall.extracted_reporter_name,
        extractedEmail: botCall.extracted_reporter_email,
        rawPayload: {},
      };

      const [botConfig] = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT * FROM voice_bot_configs WHERE tenant_id = current_setting('app.tenant_id',true)::uuid
           AND provider = $1`,
          [botCall.provider],
        );
        return r.rows;
      });

      const ticketId = await createTicketFromBotCall(
        db, eventBus, req.tenant.id, id, callData, botConfig,
      );

      if (!ticketId) {
        return reply.code(500).send({ success: false, error: { code: 'TICKET_CREATION_FAILED' } });
      }

      return reply.code(201).send({ success: true, data: { ticketId } });
    });

    // ── Stats dashboard ────────────────────────────────────────────────

    fastify.get('/stats', { preHandler: requireScope('activities:read') }, async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
      const toDate   = to   ?? new Date().toISOString();

      const stats = await db.withTenant(req.tenant.id, async (c) => {
        const r = await c.query(
          `SELECT
             COUNT(*) FILTER (WHERE created_at >= $1 AND created_at <= $2)                   AS total_calls,
             COUNT(*) FILTER (WHERE ticket_id IS NOT NULL AND created_at >= $1 AND created_at <= $2) AS calls_with_tickets,
             COUNT(*) FILTER (WHERE sentiment = 'negative' AND created_at >= $1 AND created_at <= $2) AS negative_calls,
             COUNT(*) FILTER (WHERE sentiment = 'urgent'   AND created_at >= $1 AND created_at <= $2) AS urgent_calls,
             AVG(duration_seconds) FILTER (WHERE created_at >= $1 AND created_at <= $2)       AS avg_duration,
             COUNT(DISTINCT from_number) FILTER (WHERE created_at >= $1 AND created_at <= $2) AS unique_callers,
             COUNT(*) FILTER (WHERE extracted_priority = 'urgent' AND created_at >= $1 AND created_at <= $2) AS urgent_tickets,
             COUNT(*) FILTER (WHERE provider = 'vapi'   AND created_at >= $1 AND created_at <= $2) AS vapi_calls,
             COUNT(*) FILTER (WHERE provider = 'retell' AND created_at >= $1 AND created_at <= $2) AS retell_calls,
             COUNT(*) FILTER (WHERE provider = 'bland'  AND created_at >= $1 AND created_at <= $2) AS bland_calls
           FROM voice_bot_calls`,
          [fromDate, toDate],
        );

        const daily = await c.query(
          `SELECT DATE(created_at) AS date,
             COUNT(*) AS calls,
             COUNT(*) FILTER (WHERE ticket_id IS NOT NULL) AS tickets_created,
             AVG(duration_seconds) AS avg_duration
           FROM voice_bot_calls
           WHERE created_at >= $1 AND created_at <= $2
           GROUP BY DATE(created_at) ORDER BY date`,
          [fromDate, toDate],
        );

        const sentiments = await c.query(
          `SELECT sentiment, COUNT(*) AS count
           FROM voice_bot_calls
           WHERE created_at >= $1 AND created_at <= $2
           GROUP BY sentiment`,
          [fromDate, toDate],
        );

        return {
          summary: r.rows[0],
          daily: daily.rows,
          sentiments: sentiments.rows,
        };
      });

      return reply.send({ success: true, data: stats });
    });

    // ── Initiate a test call (Vapi / Retell) ───────────────────────────

    fastify.post('/test-call', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const { provider, toNumber } = z.object({
        provider: z.enum(['vapi', 'retell', 'bland']),
        toNumber: z.string().min(5),
      }).parse(req.body);

      const [tenant] = await db.withSuperAdmin(async (c) => {
        const r = await c.query('SELECT settings FROM tenants WHERE id = $1', [req.tenant.id]);
        return r.rows;
      });
      const cfg: Record<string, string> = (tenant?.settings as any)?.connectors?.[provider] ?? {};

      if (!cfg.apiKey) {
        return reply.code(400).send({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: `${provider} connector not configured` },
        });
      }

      try {
        let result: unknown;
        if (provider === 'vapi') {
          const res = await fetch('https://api.vapi.ai/call/phone', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
              assistantId: cfg.assistantId,
              customer: { number: toNumber },
              phoneNumberId: cfg.phoneNumberId ?? undefined,
            }),
          });
          result = await res.json();
        } else if (provider === 'retell') {
          const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
              from_number: cfg.fromNumber,
              to_number: toNumber,
              agent_id: cfg.agentId,
            }),
          });
          result = await res.json();
        } else {
          const res = await fetch('https://api.bland.ai/v1/calls', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'authorization': cfg.apiKey,
            },
            body: JSON.stringify({
              phone_number: toNumber,
              from: cfg.phoneNumber ?? undefined,
              task: 'You are a customer support testing assistant. Say hello, ask the user to describe a test issue, then say goodbye.',
            }),
          });
          result = await res.json();
        }

        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.code(500).send({ success: false, error: { message: err.message } });
      }
    });

    // ══ LiveKit agent (Nadia) — structured ingestion ════════════════════════
    // Optional shared-secret: set LIVEKIT_INGEST_SECRET on the API; the agent
    // sends it as "Authorization: Bearer <secret>".
    const checkSecret = (req: any): boolean => {
      const secret = process.env.LIVEKIT_INGEST_SECRET;
      if (!secret) return true;
      return (req.headers['authorization'] || '') === `Bearer ${secret}`;
    };

    // Mid-call: create the complaint ticket from structured fields, return the TKT number.
    fastify.post('/livekit/complaint', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const result = await createComplaintFromStructured(
        db, eventBus, tenantId, (req.body ?? {}) as StructuredComplaint,
      );
      if (!result) return reply.code(500).send({ success: false, error: 'ticket_creation_failed' });
      return reply.code(201).send({ success: true, ...result });
    });

    // Call-end: attach the final transcript / summary / recording to the call record.
    fastify.post('/livekit/call-ended', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const b = (req.body ?? {}) as {
        voiceCallId?: string; transcript?: string; summary?: string;
        recordingUrl?: string; durationSeconds?: number; sentiment?: string;
      };
      if (!b.voiceCallId) return reply.code(400).send({ error: 'voiceCallId required' });

      await db.withSuperAdmin(async (c) => {
        await c.query(
          `UPDATE voice_bot_calls
             SET transcript=COALESCE($2,transcript), summary=COALESCE($3,summary),
                 recording_url=COALESCE($4,recording_url), duration_seconds=COALESCE($5,duration_seconds),
                 sentiment=COALESCE($6,sentiment), ended_at=NOW()
           WHERE id=$1 AND tenant_id=$7`,
          [b.voiceCallId, b.transcript ?? null, b.summary ?? null, b.recordingUrl ?? null,
           b.durationSeconds ?? null, b.sentiment ?? null, tenantId],
        );
      });
      return reply.send({ success: true });
    });

    // Generic call logger — Sara (FAQ) and Zara (sales, no-callback) use this
    // at call-end to create a voice_bot_calls record without a ticket.
    fastify.post('/livekit/log-call', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const b = (req.body ?? {}) as {
        agent?: string; callerPhone?: string | null; transcript?: string;
        summary?: string; sentiment?: string; durationSeconds?: number;
        metadata?: Record<string, unknown>;
      };

      const [row] = await db.withSuperAdmin(async (c) => {
        const r = await c.query(
          `INSERT INTO voice_bot_calls
             (tenant_id, provider, from_number, direction, status, duration_seconds,
              transcript, summary, sentiment, raw_payload, started_at, ended_at)
           VALUES ($1, $2, $3, 'inbound', 'completed', $4::int, $5, $6, $7, $8::jsonb,
                   NOW() - make_interval(secs => $4::int), NOW())
           RETURNING id`,
          [
            tenantId,
            b.agent ?? 'unknown',
            b.callerPhone ?? null,
            b.durationSeconds ?? 0,
            b.transcript ?? null,
            b.summary ?? null,
            b.sentiment ?? null,
            JSON.stringify(b.metadata ?? {}),
          ],
        );
        return r.rows;
      });

      return reply.code(201).send({ success: true, voiceCallId: row?.id });
    });

    // Sales lead — Zara uses this when the caller agrees to a callback.
    // Creates a voice_bot_calls record AND a ticket (channel=voice_bot, type=sales_lead).
    fastify.post('/livekit/lead', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const b = (req.body ?? {}) as {
        agent?: string;
        reporterName?: string; reporterPhone?: string | null;
        city?: string;
        productInterest?: string; loanPurpose?: string;
        incomeRange?: string; employmentType?: string;
        leadScore?: string; callbackTime?: string;
        objections?: string;
      };

      const score = (b.leadScore ?? '').toLowerCase();
      const priority = score === 'hot' ? 'high' : score === 'warm' ? 'medium' : 'low';
      const subject = `Sales callback — ${b.productInterest ?? 'general'} (${b.reporterName ?? 'unknown'})`;
      const description = [
        `Caller: ${b.reporterName ?? '—'}`,
        `Phone: ${b.reporterPhone ?? '—'}`,
        `City: ${b.city ?? '—'}`,
        `Product: ${b.productInterest ?? '—'}`,
        `Purpose: ${b.loanPurpose ?? '—'}`,
        `Income: ${b.incomeRange ?? '—'}`,
        `Employment: ${b.employmentType ?? '—'}`,
        `Lead score: ${b.leadScore ?? '—'}`,
        `Callback time: ${b.callbackTime ?? '—'}`,
        `Objections: ${b.objections ?? 'None'}`,
      ].join('\n');

      // Allocate ticket number via counter
      const result = await db.withSuperAdmin(async (c) => {
        const [{ next_val }] = (await c.query(
          `INSERT INTO ticket_counters (tenant_id, next_val)
           VALUES ($1, 2)
           ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
           RETURNING next_val`,
          [tenantId],
        )).rows;
        const num = `TKT-${String(Number(next_val) - 1).padStart(5, '0')}`;

        // Route to the SALES dept queue (auto-created by migration 015). Fall back to
        // the tenant's default queue only if the Sales queue doesn't exist.
        const [queueRow] = (await c.query(
          `SELECT id FROM ticket_queues
            WHERE tenant_id = $1
              AND (LOWER(name) IN ('sales','sales queue') OR is_default = true)
            ORDER BY (LOWER(name) IN ('sales','sales queue')) DESC, is_default DESC
            LIMIT 1`,
          [tenantId],
        )).rows;

        const [ticketRow] = (await c.query(
          `INSERT INTO tickets
             (tenant_id, ticket_number, subject, description, status, priority, channel,
              ticket_type, queue_id, reporter_name, reporter_phone, tags, custom_fields)
           VALUES ($1,$2,$3,$4,'open',$5,'voice_bot','sales',$6,$7,$8,'{}', $9::jsonb)
           RETURNING id, ticket_number`,
          [tenantId, num, subject, description, priority, queueRow?.id ?? null,
           b.reporterName ?? null, b.reporterPhone ?? null,
           JSON.stringify({
             productInterest: b.productInterest,
             leadScore: b.leadScore,
             callbackTime: b.callbackTime,
             city: b.city,
             incomeRange: b.incomeRange,
             employmentType: b.employmentType,
           })],
        )).rows;

        const [callRow] = (await c.query(
          `INSERT INTO voice_bot_calls
             (tenant_id, provider, from_number, direction, status,
              extracted_subject, extracted_priority, extracted_reporter_name,
              ticket_id, raw_payload, started_at)
           VALUES ($1, $2, $3, 'inbound', 'completed', $4, $5, $6, $7, $8::jsonb, NOW())
           RETURNING id`,
          [tenantId, b.agent ?? 'zara', b.reporterPhone ?? null,
           subject, priority, b.reporterName ?? null, ticketRow.id,
           JSON.stringify(b)],
        )).rows;

        return { ticketNumber: ticketRow.ticket_number, voiceCallId: callRow.id };
      });

      return reply.code(201).send({ success: true, ...result });
    });

    // Support inquiry — Sara uses this when the caller needs human follow-up.
    // Creates a voice_bot_calls record AND a ticket (channel=voice_bot, type=support)
    // routed to the Support dept queue. Mirrors Nadia's complaint flow.
    fastify.post('/livekit/support', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const b = (req.body ?? {}) as {
        agent?: string;
        reporterName?: string; reporterPhone?: string | null; reporterEmail?: string | null;
        subject?: string; description?: string;
        category?: string;        // billing / technical / account / general
        urgency?: string;         // low / medium / high
      };

      const urgency  = (b.urgency ?? 'medium').toLowerCase();
      const priority = urgency === 'high' ? 'high' : urgency === 'low' ? 'low' : 'medium';
      const subject  = b.subject ?? `Support inquiry — ${b.category ?? 'general'} (${b.reporterName ?? 'unknown'})`;
      const description = [
        `Caller: ${b.reporterName ?? '—'}`,
        `Phone: ${b.reporterPhone ?? '—'}`,
        `Email: ${b.reporterEmail ?? '—'}`,
        `Category: ${b.category ?? 'general'}`,
        `Urgency: ${urgency}`,
        '',
        b.description ?? '',
      ].join('\n');

      const result = await db.withSuperAdmin(async (c) => {
        const [{ next_val }] = (await c.query(
          `INSERT INTO ticket_counters (tenant_id, next_val) VALUES ($1, 2)
           ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
           RETURNING next_val`, [tenantId])).rows;
        const num = `TKT-${String(Number(next_val) - 1).padStart(5, '0')}`;

        // Route to Support Queue (auto-created by migration 015) — fall back to default
        const [queueRow] = (await c.query(
          `SELECT id FROM ticket_queues
            WHERE tenant_id = $1
              AND (LOWER(name) IN ('support','support queue') OR is_default = true)
            ORDER BY (LOWER(name) IN ('support','support queue')) DESC, is_default DESC
            LIMIT 1`, [tenantId])).rows;

        const [ticketRow] = (await c.query(
          `INSERT INTO tickets
             (tenant_id, ticket_number, subject, description, status, priority, channel,
              ticket_type, queue_id, reporter_name, reporter_phone, reporter_email, tags, custom_fields)
           VALUES ($1,$2,$3,$4,'open',$5,'voice_bot','support',$6,$7,$8,$9,'{}', $10::jsonb)
           RETURNING id, ticket_number`,
          [tenantId, num, subject, description, priority, queueRow?.id ?? null,
           b.reporterName ?? null, b.reporterPhone ?? null, b.reporterEmail ?? null,
           JSON.stringify({ category: b.category, urgency: b.urgency })],
        )).rows;

        const [callRow] = (await c.query(
          `INSERT INTO voice_bot_calls
             (tenant_id, provider, from_number, direction, status,
              extracted_subject, extracted_priority, extracted_reporter_name,
              ticket_id, raw_payload, started_at)
           VALUES ($1, $2, $3, 'inbound', 'completed', $4, $5, $6, $7, $8::jsonb, NOW())
           RETURNING id`,
          [tenantId, b.agent ?? 'sara', b.reporterPhone ?? null,
           subject, priority, b.reporterName ?? null, ticketRow.id,
           JSON.stringify(b)],
        )).rows;

        return { ticketNumber: ticketRow.ticket_number, voiceCallId: callRow.id };
      });

      return reply.code(201).send({ success: true, ...result });
    });
  };
}
