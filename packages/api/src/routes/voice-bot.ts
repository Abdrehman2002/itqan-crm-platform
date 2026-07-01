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
import { findSlaPolicy } from './tickets';
import * as sla from '../lib/sla';

// ─────────────────────────────────────────────────────────────────────────────
// 2026-06-30 BUG-AG — voice-bot tickets sat unassigned in their dept queue,
// forcing managers to manually pick them up. The user wants the bot tickets
// to **auto-route** to an available agent in the right dept; manager only
// oversees. Queue config already had routing_method='push_random' — handlers
// just weren't calling the assignment step. This helper centralises it.
//
// Picks the LEAST-LOADED online/busy agent in the queue's department_type
// (offline + away skipped). If no one's online, the ticket stays in the queue
// and the manager sees it as "needs attention" — same behaviour as today.
// ─────────────────────────────────────────────────────────────────────────────

// resolveVoiceBotContact — CNIC → phone → create-if-missing.
// Every voice-bot call MUST land on a contact row so managers can click the
// contact and see all past complaints/inquiries. Prior code only SELECTed by
// phone and left contact_id NULL for new callers → orphan tickets invisible in
// Customer 360. Lookup: (1) CNIC exact, (2) phone last-10 fuzzy, (3) create.
async function resolveVoiceBotContact(
  db: DatabaseClient,
  tenantId: string,
  input: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    nic?: string | null;
  },
): Promise<string | null> {
  return await db.withSuperAdmin(async (c) => {
    if (input.nic && input.nic.trim()) {
      const r = await c.query(
        `SELECT id FROM contacts WHERE tenant_id = $1 AND nic_number = $2 LIMIT 1`,
        [tenantId, input.nic.trim()],
      );
      if (r.rows[0]) return r.rows[0].id as string;
    }
    if (input.phone) {
      const last10 = input.phone.replace(/\D/g, '').slice(-10);
      if (last10.length >= 7) {
        const r = await c.query(
          `SELECT id FROM contacts
             WHERE tenant_id = $1
               AND (phone ILIKE $2 OR mobile ILIKE $2)
             LIMIT 1`,
          [tenantId, `%${last10}%`],
        );
        if (r.rows[0]) return r.rows[0].id as string;
      }
    }
    const raw = (input.name ?? '').trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const first = parts[0] || 'Unknown';
    const last  = parts.slice(1).join(' ') || null;
    const r = await c.query(
      `INSERT INTO contacts
         (tenant_id, first_name, last_name, phone, mobile, email, nic_number,
          status, source, tags, custom_fields, score, do_not_call, do_not_email)
       VALUES ($1,$2,$3,$4,$4,$5,$6,'active','voice_bot','{}','{}',0,false,false)
       RETURNING id`,
      [tenantId, first, last, input.phone ?? null, input.email ?? null, input.nic ?? null],
    );
    return r.rows[0].id as string;
  });
}

async function pushAssignFromQueue(
  db: DatabaseClient,
  tenantId: string,
  ticketId: string,
  queueId: string | null,
): Promise<{ assigneeId: string; assigneeName: string } | null> {
  if (!queueId) return null;
  return await db.withSuperAdmin(async (c) => {
    // Only auto-assign if the queue is in push mode.
    const qrow = (await c.query(
      `SELECT routing_method, department_type FROM ticket_queues WHERE id = $1`,
      [queueId],
    )).rows[0];
    if (!qrow) return null;
    const method   = qrow.routing_method as string;
    const deptType = qrow.department_type as string | null;
    if (method !== 'push_random' && method !== 'push_criteria') return null;

    // Pick least-loaded eligible agent. Filters:
    //   • role = 'agent' ONLY. Managers oversee, line_managers coach & escalate
    //     their sub-team — they see the ticket via BUG-Y subtree scope but are
    //     NOT in the push pool. User confirmed on 2026-07-01: standard call-centre
    //     pattern. They can still self-assign via the 3-dot menu if they choose.
    //   • is_active + not soft-deleted
    //   • agent_status in (online, busy) — skip offline/away
    //   • department_type matches the queue when the queue is dept-scoped
    const deptFilter = deptType ? `AND u.department_type = $2` : '';
    const params: any[] = [tenantId];
    if (deptType) params.push(deptType);
    const candidates = (await c.query(
      `SELECT u.id, u.name,
              COUNT(t.id) FILTER (WHERE t.status NOT IN ('resolved','closed','cancelled')) AS load
         FROM users u
         LEFT JOIN tickets t ON t.assignee_id = u.id
        WHERE u.tenant_id = $1
          AND u.role = 'agent'
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND u.agent_status IN ('online','busy')
          ${deptFilter}
        GROUP BY u.id, u.name
        ORDER BY load ASC, RANDOM()
        LIMIT 1`,
      params,
    )).rows;

    const agent = candidates[0];
    if (!agent) return null;

    await c.query(
      `UPDATE tickets SET assignee_id = $1, status = 'assigned' WHERE id = $2`,
      [agent.id, ticketId],
    );
    return { assigneeId: agent.id as string, assigneeName: agent.name as string };
  });
}

// Voice tickets were skipping the SLA pipeline — INSERTed with sla_policy_id=null,
// so the worker couldn't compute breach / reminders, and reports filtered them out.
// This helper runs the same matching + due-date math as the ticket-create path.
async function applySlaToVoiceTicket(
  db: DatabaseClient,
  tenantId: string,
  ticketId: string,
  priority: string,
  channel: string = 'voice_bot',
  department: string | null = null,
  tags: string[] = [],
): Promise<void> {
  const policy = await findSlaPolicy(db, tenantId, undefined, priority, { channel, department, tags });
  if (!policy) return;
  // Pull the matched policy's hours-schedule + holidays so due_at honours business hours.
  const [polRow] = await db.withSuperAdmin(async (c) => {
    const r = await c.query(
      `SELECT p.resolution_hours, p.business_hours_only, p.business_hours_schedule, t.settings
         FROM sla_policies p JOIN tenants t ON t.id = p.tenant_id
        WHERE p.id = $1`,
      [policy.id],
    );
    return r.rows;
  });
  const tz = (polRow?.settings?.timezone as string) ?? 'Asia/Karachi';
  const schedule = polRow?.business_hours_schedule ?? null;
  // BUG-AE: sla.loadHolidays takes a pg client (returns {rows:[...]}), NOT the
  // DatabaseClient wrapper (which returns rows[] directly). Old call
  // `sla.loadHolidays(db, tenantId)` had two bugs:
  //   1. Passed 2 args but loadHolidays takes 1 → tenantId silently dropped
  //   2. r.rows was undefined → r.rows.map() threw → swallowed by complaint
  //      handler's catch as "Cannot read properties of undefined (reading 'map')"
  // Fix: open a real pg client via withSuperAdmin and call loadHolidays(c).
  const holidays = await db.withSuperAdmin(async (c) => sla.loadHolidays(c));
  // BUG-AE: computeSlaDueAt takes POSITIONAL args (acceptedAt, policy, tz,
  // holidays) — voice-bot was calling it with a named-args object which
  // collapsed `policy` to undefined inside the function and threw
  // "Cannot read properties of undefined (reading 'resolution_hours')".
  // Fixed to use the positional form.
  const dueAt = sla.computeSlaDueAt(
    new Date(),
    {
      resolution_hours: polRow?.resolution_hours
        ?? (policy as any).resolution_hours
        ?? 24,
      business_hours_only: polRow?.business_hours_only ?? false,
      business_hours_schedule: schedule,
    },
    tz,
    holidays,
  );
  await db.withSuperAdmin(async (c) => {
    await c.query(
      `UPDATE tickets SET sla_policy_id = $1, sla_due_at = $2 WHERE id = $3`,
      [policy.id, dueAt, ticketId],
    );
  });
}

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

    // Look up contact by CNIC → phone → create if new. (See resolveVoiceBotContact.)
    const contactId = await resolveVoiceBotContact(db, tenantId, {
      name:  call.extractedName,
      phone: call.fromNumber,
      email: call.extractedEmail,
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
          contactId,
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
  reporterNic?: string; // CNIC captured by bot during identity verification
  category?: string;   // loan_issue | account_issue | staff_complaint | digital_banking | fraud | branch_service | other
  priority?: string;   // P1..P4 or urgent..low
  subject?: string;
  description?: string;
  fraudAmount?: string;
  transcript?: string;
  callId?: string;
}

// BUG-AE diagnostic: when this function fails we lose the error inside the
// catch. Expose the last error via a module-scope ref so the route handler
// can echo it back to the caller for debugging.
let lastComplaintError: string | null = null;

async function createComplaintFromStructured(
  db: DatabaseClient,
  eventBus: EventBus,
  tenantId: string,
  s: StructuredComplaint,
): Promise<{ ticketId: string; ticketNumber: string; voiceCallId: string; assignedTo: string | null } | null> {
  lastComplaintError = null;
  try {
    const priority = PRIORITY_MAP[(s.priority || 'medium').toLowerCase()] ?? 'medium';
    const subject = (s.subject || s.description || 'Voice complaint').slice(0, 120);
    const description = s.description || s.subject || '';

    const contactId = await resolveVoiceBotContact(db, tenantId, {
      name:  s.reporterName,
      phone: s.reporterPhone,
      email: s.reporterEmail,
      nic:   s.reporterNic,
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
    // Smart-match against match_conditions (channel=voice_bot, tags=[category]) rather
    // than a naive priority-only lookup — same matcher the ticket-create path uses.
    const matched = await findSlaPolicy(db, tenantId, undefined, priority, {
      channel: 'voice_bot',
      department: 'complaints',
      tags: s.category ? [s.category] : [],
    });
    const slaRow = matched ? { id: matched.id } : null;

    // Call record (provider='livekit')
    // BUG-AE (2026-06-30): the INSERT was omitting `direction` which is NOT NULL
    // on voice_bot_calls → every Nadia complaint silently 500'd at this step
    // and the caller-facing handler returned ticket_creation_failed. Now sets
    // direction='inbound' (LiveKit room means the user joined us) and started_at
    // explicitly so the timeline math works.
    const [botCall] = await db.withSuperAdmin(async (c) =>
      (await c.query(
        `INSERT INTO voice_bot_calls
           (tenant_id, provider, provider_call_id, from_number, direction, status,
            started_at, transcript, summary,
            sentiment, extracted_subject, extracted_priority, extracted_reporter_name,
            extracted_reporter_email, raw_payload)
         VALUES ($1,'livekit',$2,$3,'inbound','completed', NOW(),
                 $4,$5,$6,$7,$8,$9,$10,$11::jsonb)
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
         queueRow?.id ?? null, slaRow?.id ?? null, contactId,
         s.reporterPhone ?? null, s.reporterName ?? null, s.reporterEmail ?? null,
         [s.category ?? 'other'],
         JSON.stringify({ category: s.category, fraud_amount: s.fraudAmount, agent: 'nadia' })],
      )).rows);

    await db.withSuperAdmin(async (c) => {
      await c.query(`UPDATE voice_bot_calls SET ticket_id=$1 WHERE id=$2`, [ticket.id, botCall.id]);
    });

    // Even when slaRow was found above, the INSERT alone doesn't compute due_at —
    // that needs the business-hours + holidays math. applySlaToVoiceTicket re-runs
    // the same smart matcher and sets BOTH sla_policy_id and sla_due_at consistently.
    await applySlaToVoiceTicket(db, tenantId, ticket.id as string, priority, 'voice_bot', 'complaints',
                                s.category ? [s.category] : []);

    // BUG-AG: auto-route to a live agent so the manager doesn't have to. If the
    // queue is push-mode (Complaints Queue is), pick the least-loaded online
    // agent in the right dept and assign. Silent no-op if no one's online —
    // ticket stays in queue, manager sees it as "needs attention".
    const assigned = await pushAssignFromQueue(db, tenantId, ticket.id as string, queueRow?.id ?? null);

    await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, {
      source: 'livekit', ticketId: ticket.id, ticketType: 'complaint',
      assigneeId: assigned?.assigneeId ?? null,
    });

    return {
      ticketId: ticket.id as string,
      ticketNumber,
      voiceCallId: botCall.id as string,
      assignedTo: assigned?.assigneeName ?? null,  // bot can mention this to caller
    };
  } catch (err: any) {
    lastComplaintError = `${err?.message ?? err} ${err?.code ?? ''} ${err?.detail ?? ''}`.trim();
    console.error('[LiveKit→Ticket]', err?.message, err?.stack);
    return null;
  }
}

// Module-level read so the route handler can attach the captured error to its
// 500 response without making the function signature ugly.
function getLastComplaintError(): string | null { return lastComplaintError; }

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

    // ── Mid-call identity lookup ────────────────────────────────────────────────
    // The bot calls this during the greeting (via LLM function-tool) to check if
    // the caller is a known contact and has open tickets. Keyed by CNIC or
    // ticket number — NEVER by phone alone (spoofable) or name (guessable).
    //
    // Response is intentionally SPARSE and MASKED so the bot cannot leak PII to
    // an unverified caller. Full CNIC / full name never leave the server.
    // Contract used by NadiaAgent.lookup_customer() in agent.py.
    //
    // The bot MUST challenge with `verificationRequired` before revealing
    // ANYTHING back to the caller. If challenge fails, don't disclose.
    fastify.get('/livekit/lookup', async (req, reply) => {
      const { tenantId, cnic, ticket, name, last4 } = req.query as {
        tenantId?: string; cnic?: string; ticket?: string;
        name?: string;   // Caller-spoken name (first + last, any casing)
        last4?: string;  // Last 4 digits of caller's CNIC
      };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });
      // Accepted lookup shapes:
      //   ?cnic=XXXXX-XXXXXXX-X                (full CNIC, exact match)
      //   ?ticket=TKT-XXXXX                     (full ticket number)
      //   ?name=Ahmed+Raza&last4=1234           (STT-friendly: name + last 4 CNIC)
      const nameLast4Path = name && last4;
      if (!cnic && !ticket && !nameLast4Path) {
        return reply.code(400).send({
          error: 'need one of: (cnic) OR (ticket) OR (name + last4)',
        });
      }

      const mask = (nic: string | null): string | null => {
        if (!nic) return null;
        const clean = nic.replace(/\s/g, '');
        // 42101-1234567-8 → 42101-*****-8 (keep district + last check digit)
        const m = clean.match(/^(\d{5})-?(\d{7})-?(\d)$/);
        if (m) return `${m[1]}-*****-${m[3]}`;
        return clean.slice(0, 3) + '*****' + clean.slice(-1);
      };
      const firstNameInitial = (first: string | null, last: string | null): string => {
        const f = (first ?? '').trim();
        const l = (last ?? '').trim();
        if (!f) return 'Caller';
        return l ? `${f} ${l[0]}.` : f;
      };

      const result = await db.withSuperAdmin(async (c) => {
        // 1) Resolve the contact (CNIC exact → or via ticket_number's contact_id)
        let contactRow: any = null;
        if (cnic) {
          const r = await c.query(
            `SELECT id, first_name, last_name, nic_number
               FROM contacts
              WHERE tenant_id = $1 AND nic_number = $2
              LIMIT 1`,
            [tenantId, cnic.trim()],
          );
          contactRow = r.rows[0] ?? null;
        }
        if (!contactRow && ticket) {
          const r = await c.query(
            `SELECT co.id, co.first_name, co.last_name, co.nic_number
               FROM tickets t
               JOIN contacts co ON co.id = t.contact_id
              WHERE t.tenant_id = $1 AND t.ticket_number = $2
              LIMIT 1`,
            [tenantId, ticket.trim()],
          );
          contactRow = r.rows[0] ?? null;
        }
        // Name + last-4-CNIC path — STT-friendly identity check.
        // Deepgram's Urdu ASR mangles long digit runs; asking for a name and just
        // the last 4 CNIC digits is far more reliable. Match rules:
        //   - last4: extract 4 trailing digits from the caller-spoken value
        //   - name:  fuzzy compare (contains, both directions, case-insensitive)
        //   - REQUIRE EXACTLY ONE MATCH — if 2+ contacts share the same last 4
        //     digits and a name substring, reject with 'ambiguous' so the bot
        //     falls back to asking for the full CNIC.
        if (!contactRow && nameLast4Path) {
          const l4 = last4!.replace(/\D/g, '').slice(-4);
          if (l4.length !== 4) {
            return { __ambiguous: true, reason: 'invalid_last4' };
          }
          const nameTrim = name!.trim();
          if (nameTrim.length < 2) {
            return { __ambiguous: true, reason: 'invalid_name' };
          }
          // Fuzzy match using pg_trgm — STT can mishear names by 1-2 letters
          // (e.g. Urdu ساد vs سعد, English 'Saad' vs 'Sad'). Threshold 0.30
          // similarity works for both scripts. Last-4 CNIC uses exact match
          // on digits-only to keep the identity gate meaningful.
          //
          // Ranking:
          //   1. exact substring match on full name (strongest signal)
          //   2. trigram similarity ≥ 0.30
          //   3. word_similarity ≥ 0.25 (matches first-name in a longer full-name)
          const rows = (await c.query(
            `SELECT id, first_name, last_name, nic_number,
                    GREATEST(
                      similarity(first_name || ' ' || COALESCE(last_name,''), $3),
                      word_similarity($3, first_name || ' ' || COALESCE(last_name,''))
                    ) AS name_score
               FROM contacts
              WHERE tenant_id = $1
                AND REGEXP_REPLACE(nic_number, '\\D', '', 'g') LIKE $2
                AND (
                     (first_name || ' ' || COALESCE(last_name,'')) ILIKE ('%' || $3 || '%')
                  OR similarity(first_name || ' ' || COALESCE(last_name,''), $3) >= 0.30
                  OR word_similarity($3, first_name || ' ' || COALESCE(last_name,'')) >= 0.25
                )
              ORDER BY name_score DESC
              LIMIT 5`,
            [tenantId, `%${l4}`, nameTrim],
          )).rows;
          if (rows.length === 0) {
            contactRow = null;
          } else if (rows.length > 1) {
            return { __ambiguous: true, reason: 'multiple_matches', count: rows.length };
          } else {
            contactRow = rows[0];
          }
        }
        if (!contactRow) return null;

        // 2) Aggregate + fetch latest ticket
        const stats = (await c.query(
          `SELECT
             COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled')) AS open_count,
             COUNT(*)                                                                 AS total_count,
             BOOL_OR(priority IN ('urgent','high') AND status NOT IN ('resolved','closed','cancelled'))
               AS has_critical_open
             FROM tickets
            WHERE tenant_id = $1 AND contact_id = $2`,
          [tenantId, contactRow.id],
        )).rows[0];

        const latestRow = (await c.query(
          `SELECT t.ticket_number, t.subject, t.status, t.priority,
                  t.sla_due_at, t.created_at,
                  SPLIT_PART(u.name, ' ', 1) AS assignee_first_name
             FROM tickets t
             LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.tenant_id = $1 AND t.contact_id = $2
            ORDER BY t.created_at DESC
            LIMIT 1`,
          [tenantId, contactRow.id],
        )).rows[0];

        let latest: any = null;
        if (latestRow) {
          const now = Date.now();
          const dueMs = latestRow.sla_due_at ? new Date(latestRow.sla_due_at).getTime() : null;
          const hoursLeft = dueMs != null ? Math.max(0, (dueMs - now) / 3_600_000) : null;
          const created = new Date(latestRow.created_at).getTime();
          const daysAgo = Math.floor((now - created) / 86_400_000);
          latest = {
            number: latestRow.ticket_number,
            subject: (latestRow.subject ?? '').slice(0, 80),
            status: latestRow.status,
            priority: latestRow.priority,
            slaHoursLeft: hoursLeft != null ? Number(hoursLeft.toFixed(1)) : null,
            assigneeFirstName: latestRow.assignee_first_name ?? null,
            daysAgo,
          };
        }

        return {
          contactId: contactRow.id,
          displayName: firstNameInitial(contactRow.first_name, contactRow.last_name),
          cnicMasked: mask(contactRow.nic_number),
          totalTicketCount: Number(stats.total_count),
          openTicketCount:  Number(stats.open_count),
          hasCriticalOpen:  Boolean(stats.has_critical_open),
          latestTicket: latest,
          // No further verification needed on the name+last4 path — the caller
          // has already produced both identity signals to reach this match.
          verificationRequired: nameLast4Path ? 'none' : 'last4Cnic',
        };
      });

      if (!result) {
        return reply.send({ found: false });
      }
      // Ambiguous sentinel from the name+last4 branch — bot must ask for the
      // full CNIC to disambiguate. Never disclose ticket details on this path.
      if ((result as any).__ambiguous) {
        return reply.send({
          found: false,
          ambiguous: true,
          reason: (result as any).reason,
          hint: 'need_full_cnic',
        });
      }
      return reply.send({ found: true, ...result });
    });

    // Mid-call: create the complaint ticket from structured fields, return the TKT number.
    fastify.post('/livekit/complaint', async (req, reply) => {
      const { tenantId } = req.query as { tenantId?: string };
      if (!tenantId) return reply.code(400).send({ error: 'tenantId query param required' });
      if (!checkSecret(req)) return reply.code(401).send({ error: 'unauthorized' });

      const result = await createComplaintFromStructured(
        db, eventBus, tenantId, (req.body ?? {}) as StructuredComplaint,
      );
      if (!result) {
        // BUG-AE: captured the underlying error via module-level lastComplaintError
        // ref so the agent (and SQA) can see why instead of an opaque "failed".
        return reply.code(500).send({ success: false, error: 'ticket_creation_failed',
          message: getLastComplaintError() ?? 'unknown error' });
      }
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
        reporterEmail?: string | null; reporterNic?: string | null;
        city?: string;
        productInterest?: string; loanPurpose?: string;
        incomeRange?: string; employmentType?: string;
        leadScore?: string; callbackTime?: string;
        objections?: string;
      };
      // Contact upsert — CNIC → phone → create-if-new (Zara).
      const leadContactId = await resolveVoiceBotContact(db, tenantId, {
        name:  b.reporterName,
        phone: b.reporterPhone,
        email: b.reporterEmail,
        nic:   b.reporterNic,
      });

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
              ticket_type, queue_id, contact_id, reporter_name, reporter_phone, tags, custom_fields)
           VALUES ($1,$2,$3,$4,'open',$5,'voice_bot','sales',$6,$7,$8,$9,'{}', $10::jsonb)
           RETURNING id, ticket_number`,
          [tenantId, num, subject, description, priority, queueRow?.id ?? null,
           leadContactId,
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

        return { ticketNumber: ticketRow.ticket_number, voiceCallId: callRow.id, ticketId: ticketRow.id, queueId: queueRow?.id ?? null };
      });

      // Attach SLA policy + due_at AFTER the insert transaction so the worker picks it up.
      await applySlaToVoiceTicket(db, tenantId, (result as any).ticketId, priority, 'voice_bot', 'sales');

      // BUG-AG auto-route to a live sales agent so Manager Imran doesn't manually assign.
      const assigned = await pushAssignFromQueue(db, tenantId, (result as any).ticketId, (result as any).queueId ?? null);

      return reply.code(201).send({
        success: true,
        ticketNumber: result.ticketNumber,
        voiceCallId: result.voiceCallId,
        assignedTo: assigned?.assigneeName ?? null,
      });
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
        reporterNic?: string | null;
        subject?: string; description?: string;
        category?: string;        // billing / technical / account / general
        urgency?: string;         // low / medium / high
      };
      // Contact upsert — CNIC → phone → create-if-new (Sara).
      const supportContactId = await resolveVoiceBotContact(db, tenantId, {
        name:  b.reporterName,
        phone: b.reporterPhone,
        email: b.reporterEmail,
        nic:   b.reporterNic,
      });

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
              ticket_type, queue_id, contact_id, reporter_name, reporter_phone, reporter_email, tags, custom_fields)
           VALUES ($1,$2,$3,$4,'open',$5,'voice_bot','support',$6,$7,$8,$9,$10,'{}', $11::jsonb)
           RETURNING id, ticket_number`,
          [tenantId, num, subject, description, priority, queueRow?.id ?? null,
           supportContactId,
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

        return { ticketNumber: ticketRow.ticket_number, voiceCallId: callRow.id, ticketId: ticketRow.id, queueId: queueRow?.id ?? null };
      });

      await applySlaToVoiceTicket(db, tenantId, (result as any).ticketId, priority, 'voice_bot', 'support', [b.category ?? 'general']);

      // BUG-AG auto-route to a live support agent.
      const assigned = await pushAssignFromQueue(db, tenantId, (result as any).ticketId, (result as any).queueId ?? null);

      return reply.code(201).send({
        success: true,
        ticketNumber: result.ticketNumber,
        voiceCallId: result.voiceCallId,
        assignedTo: assigned?.assigneeName ?? null,
      });
    });
  };
}
