import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import type { DatabaseClient, TenantService } from '@crm/core';
import type { EventBus } from '@crm/core';
import { CRM_EVENTS } from '@crm/core';
import type { VoiceWebhookEvent, VoiceCallStatus } from '@crm/shared';
import { requireFeature, requireScope } from '../middlewares/auth.middleware';
import { TwilioAdapter } from '../../../../modules/connectors/src/twilio/adapter';
import { VonageAdapter } from '../../../../modules/connectors/src/vonage/adapter';
import type { VoiceProviderAdapter } from '../../../../modules/voice/src/provider.interface';
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk';

// Outcomes that automatically trigger a support ticket
const TICKET_TRIGGERING_OUTCOMES = new Set([
  'support_requested',
  'issue_reported',
  'complaint',
  'escalation_requested',
  'callback_requested',
  'ticket_requested',
]);

/** Create a support ticket from a completed voice call */
async function autoCreateTicketFromCall(
  db: DatabaseClient,
  eventBus: EventBus,
  tenantId: string,
  call: {
    id: string;
    outcome: string;
    from_number: string;
    contact_id?: string;
    bot_intent?: string;
    transcript?: any;
  },
): Promise<void> {
  try {
    const { nextTicketNumber, findSlaPolicy, notify } = await import('./tickets').then(m => ({
      nextTicketNumber: (m as any).nextTicketNumber ?? null,
      findSlaPolicy: (m as any).findSlaPolicy ?? null,
      notify: (m as any).notify ?? null,
    }));
    // Use a direct DB approach since we can't easily call the route handler
    const ticketNum = await generateTicketNumber(db, tenantId);

    const subject = call.bot_intent
      ? `${formatIntent(call.bot_intent)} — auto-created from call`
      : `Support request from ${call.from_number || 'caller'}`;

    const description = call.transcript
      ? `Auto-created from voice call.\n\nTranscript summary:\n${
          typeof call.transcript === 'string' ? call.transcript.slice(0, 500)
          : JSON.stringify(call.transcript).slice(0, 500)
        }`
      : `Auto-created from inbound voice call. Outcome: ${call.outcome}`;

    await db.withSuperAdmin(async (client) => {
      // Get counter
      const [{ next_val }] = (await client.query(
        `INSERT INTO ticket_counters (tenant_id, next_val)
         VALUES ($1, 2)
         ON CONFLICT (tenant_id) DO UPDATE SET next_val = ticket_counters.next_val + 1
         RETURNING next_val`,
        [tenantId],
      )).rows;
      const num = `TKT-${String(Number(next_val) - 1).padStart(5, '0')}`;

      // Get default queue and SLA
      const [queueRow] = (await client.query(
        `SELECT id FROM ticket_queues WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
        [tenantId],
      )).rows;
      const [slaRow] = (await client.query(
        `SELECT id FROM sla_policies WHERE tenant_id = $1 AND priority = 'medium' AND is_active = true LIMIT 1`,
        [tenantId],
      )).rows;

      await client.query(
        `INSERT INTO tickets
           (tenant_id, ticket_number, subject, description, status, priority, channel,
            queue_id, sla_policy_id, contact_id, voice_call_id, reporter_phone, tags, custom_fields)
         VALUES ($1,$2,$3,$4,'open','medium','voice_bot',$5,$6,$7,$8,$9,'{}','{}')`,
        [tenantId, num, subject, description,
         queueRow?.id ?? null, slaRow?.id ?? null,
         call.contact_id ?? null, call.id,
         call.from_number ?? null],
      );
    });

    await eventBus.publish(tenantId, CRM_EVENTS.TICKET_CREATED, {
      source: 'voice_bot', callId: call.id, outcome: call.outcome,
    });
  } catch (err: any) {
    // Never crash the voice webhook handler
    console.error('[Voice→Ticket] Auto-create failed:', err.message);
  }
}

function generateTicketNumber(_db: DatabaseClient, _tenantId: string): string {
  return `TKT-${Date.now().toString().slice(-5)}`; // fallback — real counter via DB above
}

function formatIntent(intent: string): string {
  return intent.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function voiceRoutes(db: DatabaseClient, eventBus: EventBus, tenantService: TenantService) {
  return async function (fastify: FastifyInstance) {

    // ── Web call: dispatch the LiveKit agent (Nadia) into a fresh room and
    //    return a browser join token. Powers the CRM "Call Nadia" button. ──────
    fastify.post('/web-call', { preHandler: [requireScope('voice:read', 'voice:write')] }, async (req, reply) => {
      const url = process.env.LIVEKIT_URL;
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      if (!url || !apiKey || !apiSecret) {
        return reply.code(503).send({ success: false, error: { code: 'LIVEKIT_NOT_CONFIGURED', message: 'Voice calling is not configured yet.' } });
      }
      // Pick which agent to dispatch — body.agentName overrides env default.
      // Allowed agents are hardcoded so a bad request can't dispatch arbitrary names.
      const ALLOWED_AGENTS = new Set(['nadia', 'sara', 'zara']);
      const requested = String((req.body as any)?.agentName ?? '').toLowerCase();
      const agentName = ALLOWED_AGENTS.has(requested)
        ? requested
        : (process.env.LIVEKIT_AGENT_NAME || 'nadia');
      const room = `crm-${agentName}-${req.tenant.id.slice(0, 8)}-${Date.now().toString(36)}`;
      const httpUrl = url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
      // Server→LiveKit dispatch can hit the local server directly (no TLS hop).
      const dispatchHost = process.env.LIVEKIT_DISPATCH_URL || httpUrl;

      // Agents started with an agent_name require an explicit dispatch.
      try {
        const dispatchClient = new AgentDispatchClient(dispatchHost, apiKey, apiSecret);
        await dispatchClient.createDispatch(room, agentName, {
          metadata: JSON.stringify({ tenantId: req.tenant.id, startedBy: req.user.sub }),
        });
      } catch (err: any) {
        return reply.code(502).send({ success: false, error: { code: 'DISPATCH_FAILED', message: err?.message ?? 'agent dispatch failed' } });
      }

      // Mint a browser participant token (1h).
      const at = new AccessToken(apiKey, apiSecret, { identity: `crm-${req.user.sub}`, name: 'CRM Agent', ttl: '1h' });
      at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
      const token = await at.toJwt();

      return reply.send({ success: true, data: { url, token, room, agent: agentName } });
    });

    // ── Outbound call initiation ──────────────────────────────
    fastify.post('/calls/initiate', {
      preHandler: [requireFeature('voiceBot'), requireScope('voice:write')],
    }, async (req, reply) => {
      const { contactId, toNumber, fromNumber, script } = req.body as any;
      const tenant = req.tenant;
      const adapter = getAdapter(tenant.settings.voiceProvider, tenant.settings.voiceConfig ?? {});

      const { allowed } = await tenantService.checkLimit(tenant.id, 'voiceMinutesPerMonth');
      if (!allowed) {
        return reply.code(429).send({ success: false, error: { code: 'VOICE_LIMIT_REACHED', message: 'Monthly voice minutes exhausted' } });
      }

      const providerCall = await adapter.initiateCall({ toNumber, fromNumber, script });

      const [call] = await db.withTenant(tenant.id, async (client) => {
        const result = await client.query(
          `INSERT INTO voice_calls (tenant_id, external_call_id, provider, direction, status, from_number, to_number, contact_id, bot_handled)
           VALUES ($1,$2,$3,'outbound','initiated',$4,$5,$6,true) RETURNING *`,
          [tenant.id, providerCall.callId, tenant.settings.voiceProvider, fromNumber, toNumber, contactId],
        );
        return result.rows;
      });

      await eventBus.publish(tenant.id, CRM_EVENTS.VOICE_CALL_STARTED, { call });
      return reply.code(201).send({ success: true, data: { callId: call.id, externalCallId: providerCall.callId } });
    });

    // ── Provider-agnostic inbound webhook ─────────────────────
    // POST /api/v1/voice/webhook/:provider
    // Twilio, Vonage, Plivo, or custom all normalize to VoiceWebhookEvent
    fastify.post('/webhook/:provider', {
      config: { rawBody: true },  // needed for signature verification
    }, async (req, reply) => {
      const { provider } = req.params as { provider: string };
      const tenantId = (req.headers['x-tenant-id'] as string) ?? req.query?.tenantId;

      if (!tenantId) {
        return reply.code(400).send({ error: 'Missing tenant ID' });
      }

      // Verify webhook signature per provider
      const tenant = await tenantService.findById(tenantId);
      if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

      const isValid = verifyWebhookSignature(provider, req, tenant.settings.voiceConfig ?? {});
      if (!isValid) {
        return reply.code(403).send({ error: 'Invalid signature' });
      }

      const adapter = getAdapter(provider, tenant.settings.voiceConfig ?? {});
      const event: VoiceWebhookEvent = adapter.normalizeWebhook(provider, req.body as any, req.headers as any);

      await processVoiceEvent(event, tenantId, db, eventBus, tenantService);

      // Return provider-specific acknowledgment
      return reply.send(adapter.webhookAck(event.eventType));
    });

    // ── Real-time WebSocket for live call streaming ───────────
    fastify.get('/calls/:callId/stream', { websocket: true }, async (connection, req) => {
      const { callId } = req.params as { callId: string };
      const tenantId = req.tenant.id;

      // Subscribe to live events for this call
      eventBus.on(`voice.stream:${tenantId}:${callId}`, async (evt) => {
        if (connection.readyState === 1 /* OPEN */) {
          connection.send(JSON.stringify(evt.payload));
        }
      });

      connection.on('close', () => {
        // Clean up subscription
      });
    });

    // ── Call list & detail ────────────────────────────────────
    fastify.get('/calls', { preHandler: requireScope('voice:read') }, async (req, reply) => {
      const { page = 1, pageSize = 25, direction, status, contactId } = req.query as any;
      const offset = (Number(page) - 1) * Number(pageSize);

      const params: unknown[] = [];
      let where = 'WHERE 1=1';
      if (direction) { params.push(direction); where += ` AND vc.direction = $${params.length}`; }
      if (status)    { params.push(status);    where += ` AND vc.status = $${params.length}`; }
      if (contactId) { params.push(contactId); where += ` AND vc.contact_id = $${params.length}`; }
      params.push(Number(pageSize), offset);

      const calls = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(
          `SELECT vc.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name
           FROM voice_calls vc
           LEFT JOIN contacts c ON vc.contact_id = c.id
           ${where}
           ORDER BY vc.started_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        return result.rows;
      });

      return reply.send({ success: true, data: calls });
    });

    fastify.get('/calls/:id', { preHandler: requireScope('voice:read') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const [call] = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query('SELECT * FROM voice_calls WHERE id = $1', [id]);
        return result.rows;
      });

      if (!call) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Call not found' } });
      return reply.send({ success: true, data: call });
    });

    // ── Transfer call to human agent ─────────────────────────
    fastify.post('/calls/:id/transfer', {
      preHandler: requireScope('voice:write'),
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const { agentId } = req.body as { agentId: string };

      await db.withTenant(req.tenant.id, async (client) => {
        await client.query(
          `UPDATE voice_calls SET agent_id = $1, bot_handled = false WHERE id = $2`,
          [agentId, id],
        );
      });

      await eventBus.publish(req.tenant.id, CRM_EVENTS.VOICE_TRANSFER_REQUESTED, { callId: id, agentId });
      return reply.send({ success: true });
    });

    // ── Analytics ─────────────────────────────────────────────
    fastify.get('/analytics', { preHandler: requireScope('voice:read') }, async (req, reply) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
      const toDate   = to   ? new Date(to)   : new Date();

      const [stats, daily, outcomes] = await db.withTenant(req.tenant.id, async (client) => {
        const summaryRes = await client.query(
          `SELECT
             COUNT(*)                                        AS total_calls,
             COUNT(*) FILTER (WHERE direction = 'inbound')  AS inbound,
             COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
             COUNT(*) FILTER (WHERE bot_handled = true)     AS bot_handled,
             COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
             COUNT(*) FILTER (WHERE status = 'missed')      AS missed,
             COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
             ROUND(AVG(duration))                           AS avg_duration_seconds,
             COALESCE(SUM(duration) / 60, 0)               AS total_minutes
           FROM voice_calls
           WHERE started_at BETWEEN $1 AND $2`,
          [fromDate, toDate],
        );

        const dailyRes = await client.query(
          `SELECT
             DATE(started_at)                                      AS day,
             COUNT(*)                                              AS total,
             COUNT(*) FILTER (WHERE direction = 'inbound')        AS inbound,
             COUNT(*) FILTER (WHERE direction = 'outbound')       AS outbound,
             COALESCE(ROUND(AVG(duration)), 0)                    AS avg_duration
           FROM voice_calls
           WHERE started_at BETWEEN $1 AND $2
           GROUP BY DATE(started_at)
           ORDER BY day ASC`,
          [fromDate, toDate],
        );

        const outcomeRes = await client.query(
          `SELECT outcome, COUNT(*) AS count
           FROM voice_calls
           WHERE started_at BETWEEN $1 AND $2
             AND outcome IS NOT NULL
           GROUP BY outcome
           ORDER BY count DESC
           LIMIT 10`,
          [fromDate, toDate],
        );

        return [summaryRes.rows[0], dailyRes.rows, outcomeRes.rows];
      });

      return reply.send({ success: true, data: { summary: stats, daily, outcomes } });
    });
    // ── Backward-compat alias: /stats → /analytics ───────────────────
    fastify.get('/stats', { preHandler: requireScope('voice:read') }, async (req, reply) => {
      return reply.redirect(307, '/api/v1/voice/analytics');
    });

  };
}

async function processVoiceEvent(
  event: VoiceWebhookEvent,
  tenantId: string,
  db: DatabaseClient,
  eventBus: EventBus,
  tenantService: TenantService,
): Promise<void> {
  switch (event.eventType) {
    case 'call.started':
    case 'call.ringing': {
      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `INSERT INTO voice_calls (tenant_id, external_call_id, provider, direction, status, from_number, to_number, bot_handled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true)
           ON CONFLICT (external_call_id) DO UPDATE SET status = $5`,
          [tenantId, event.callId, event.provider, event.payload.direction ?? 'inbound',
           event.eventType === 'call.started' ? 'in-progress' : 'ringing',
           event.payload.from, event.payload.to],
        );
      });

      // Try to match caller to existing contact
      const fromNumber = event.payload.from as string;
      if (fromNumber) {
        const [contact] = await db.withTenant(tenantId, async (client) => {
          const result = await client.query(
            `SELECT id FROM contacts WHERE phone = $1 OR mobile = $1 LIMIT 1`,
            [fromNumber],
          );
          return result.rows;
        });

        if (contact) {
          await db.withTenant(tenantId, async (client) => {
            await client.query(
              `UPDATE voice_calls SET contact_id = $1 WHERE external_call_id = $2`,
              [contact.id, event.callId],
            );
          });
        }
      }

      await eventBus.publish(tenantId, CRM_EVENTS.VOICE_CALL_STARTED, { event });
      break;
    }

    case 'call.completed': {
      const duration = event.payload.duration as number;
      const outcome  = event.payload.outcome as string | undefined;

      // Fetch the call record (we need contact_id, from_number etc. for auto-ticketing)
      const [completedCall] = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(
          `UPDATE voice_calls
           SET status = 'completed', duration = $1, ended_at = NOW(),
               recording_url = $2, outcome = $3
           WHERE external_call_id = $4
           RETURNING id, contact_id, from_number, bot_intent, transcript, outcome`,
          [duration, event.payload.recordingUrl ?? null, outcome ?? null, event.callId],
        );
        return r.rows;
      });

      // Track voice minutes usage for billing
      if (duration) await tenantService.incrementUsage(tenantId, 'voiceMinutesPerMonth', Math.ceil(duration / 60));

      // Auto-create support ticket if the call outcome warrants it
      if (completedCall && outcome && TICKET_TRIGGERING_OUTCOMES.has(outcome)) {
        await autoCreateTicketFromCall(db, eventBus, tenantId, completedCall);
      }

      await eventBus.publish(tenantId, CRM_EVENTS.VOICE_CALL_COMPLETED, { event });
      break;
    }

    case 'call.transcription': {
      await db.withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE voice_calls SET transcript = $1::jsonb, bot_intent = $2, bot_entities = $3::jsonb
           WHERE external_call_id = $4`,
          [JSON.stringify(event.payload.transcript), event.payload.intent, JSON.stringify(event.payload.entities), event.callId],
        );
      });
      await eventBus.publish(tenantId, CRM_EVENTS.VOICE_CALL_TRANSCRIBED, { event });
      break;
    }

    case 'intent.detected': {
      // Auto-create contact or deal based on bot-detected intent
      const intent = event.payload.intent as string;
      if (intent === 'schedule_demo' || intent === 'request_quote') {
        await eventBus.publish(tenantId, 'voice.qualified_lead', {
          callId: event.callId,
          intent,
          entities: event.payload.entities,
        });
      }
      break;
    }
  }
}

function getAdapter(provider: string | undefined, config: Record<string, string>): VoiceProviderAdapter {
  switch (provider) {
    case 'vonage': return new VonageAdapter(config);
    case 'twilio':
    default: return new TwilioAdapter(config);
  }
}

function verifyWebhookSignature(provider: string, req: any, config: Record<string, string>): boolean {
  try {
    if (provider === 'twilio') {
      const signature = req.headers['x-twilio-signature'];
      const authToken = config.authToken;
      if (!signature || !authToken) return false;
      const url = `${req.protocol}://${req.hostname}${req.url}`;
      const params = req.body as Record<string, string>;
      const sortedParams = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
      const expected = crypto.createHmac('sha1', authToken).update(sortedParams).digest('base64');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }
    // Other providers: validate their specific signatures
    return true;
  } catch {
    return false;
  }
}
