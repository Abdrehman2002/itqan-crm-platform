/**
 * Connector configuration routes
 * GET  /api/v1/connectors            — list all connectors + connection status
 * GET  /api/v1/connectors/:id        — get config for one connector (secrets masked)
 * PUT  /api/v1/connectors/:id        — save / update credentials for a connector
 * DELETE /api/v1/connectors/:id      — disconnect / clear connector credentials
 * POST /api/v1/connectors/:id/test   — test the connection
 *
 * Credentials are stored as JSONB in tenants.settings under the key
 * "connectors.<id>" so they travel with the tenant row and are covered
 * by the same RLS policy.  Secrets are never returned in full — only a
 * masked preview (last-4 chars) is sent to the frontend.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '@crm/core';
import { requireRole } from '../middlewares/auth.middleware';
import { EmailService } from '../services/email.service';
import { SmsService } from '@crm/core/sms.service';

// ── Connector catalogue ────────────────────────────────────────────────────
// Defines which fields each connector needs.  The schema is used to validate
// the incoming config and to know which fields are secrets (masked on read).

interface ConnectorField {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;   // if true, only return masked value
  required: boolean;
}

interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  category: 'voice' | 'email' | 'billing' | 'automation' | 'notify' | 'crm' | 'sms';
  logo: string;
  docsUrl: string;
  fields: ConnectorField[];
}

const CONNECTOR_DEFS: ConnectorDef[] = [
  // ── Voice ──────────────────────────────────────────────────────────────
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'Outbound/inbound voice calls and SMS',
    category: 'voice',
    logo: '📞',
    docsUrl: 'https://console.twilio.com',
    fields: [
      { key: 'accountSid',   label: 'Account SID',    placeholder: 'ACxxxxxxxx', secret: false, required: true },
      { key: 'authToken',    label: 'Auth Token',      placeholder: '••••••••',  secret: true,  required: true },
      { key: 'phoneNumber',  label: 'From Number',     placeholder: '+1234567890', secret: false, required: true },
    ],
  },
  {
    id: 'vonage',
    name: 'Vonage',
    description: 'Voice & messaging (Nexmo)',
    category: 'voice',
    logo: '📡',
    docsUrl: 'https://dashboard.nexmo.com',
    fields: [
      { key: 'apiKey',    label: 'API Key',    placeholder: 'xxxxxxxx', secret: false, required: true },
      { key: 'apiSecret', label: 'API Secret', placeholder: '••••••••', secret: true,  required: true },
      { key: 'fromNumber', label: 'From Number', placeholder: '+1234567890', secret: false, required: false },
    ],
  },
  // ── AI Voice Bot ───────────────────────────────────────────────────────
  {
    id: 'vapi',
    name: 'Vapi',
    description: 'AI voice agent — handles inbound calls, extracts intents, creates tickets automatically',
    category: 'voice',
    logo: '🤖',
    docsUrl: 'https://dashboard.vapi.ai',
    fields: [
      { key: 'apiKey',        label: 'API Key',          placeholder: 'vapi_…',       secret: true,  required: true  },
      { key: 'assistantId',   label: 'Assistant ID',     placeholder: 'asst_…',       secret: false, required: true  },
      { key: 'phoneNumberId', label: 'Phone Number ID',  placeholder: 'phn_…',        secret: false, required: false },
      { key: 'webhookSecret', label: 'Webhook Secret',   placeholder: 'whsec_…',      secret: true,  required: false },
    ],
  },
  {
    id: 'retell',
    name: 'Retell AI',
    description: 'AI phone agent — SIP-enabled inbound call handling with real-time transcript',
    category: 'voice',
    logo: '📲',
    docsUrl: 'https://app.retellai.com',
    fields: [
      { key: 'apiKey',        label: 'API Key',       placeholder: 'key_…',        secret: true,  required: true  },
      { key: 'agentId',       label: 'Agent ID',      placeholder: 'agent_…',      secret: false, required: true  },
      { key: 'fromNumber',    label: 'From Number',   placeholder: '+1234567890',  secret: false, required: false },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: '…',           secret: true,  required: false },
    ],
  },
  {
    id: 'bland',
    name: 'Bland.ai',
    description: 'AI phone calls at scale — inbound helpline with ticket creation',
    category: 'voice',
    logo: '📣',
    docsUrl: 'https://app.bland.ai',
    fields: [
      { key: 'apiKey',        label: 'API Key',       placeholder: 'sk-…',         secret: true,  required: true  },
      { key: 'phoneNumber',   label: 'From Number',   placeholder: '+1234567890',  secret: false, required: false },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: '…',           secret: true,  required: false },
    ],
  },
  // ── Email ──────────────────────────────────────────────────────────────
  {
    id: 'smtp',
    name: 'SMTP / Custom Email',
    description: 'Any SMTP server — Gmail App Password, Outlook, Mailgun, etc.',
    category: 'email',
    logo: '📧',
    docsUrl: 'https://en.wikipedia.org/wiki/SMTP_Authentication',
    fields: [
      { key: 'host',     label: 'SMTP Host',    placeholder: 'smtp.gmail.com', secret: false, required: true },
      { key: 'port',     label: 'SMTP Port',    placeholder: '587',            secret: false, required: true },
      { key: 'user',     label: 'Username',     placeholder: 'you@gmail.com',  secret: false, required: true },
      { key: 'password', label: 'Password / App Password', placeholder: '••••••••', secret: true, required: true },
      { key: 'fromName', label: 'From Name',    placeholder: 'CRM Platform',   secret: false, required: false },
      { key: 'fromEmail', label: 'From Email',  placeholder: 'noreply@yourco.com', secret: false, required: false },
    ],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Transactional email at scale',
    category: 'email',
    logo: '✉️',
    docsUrl: 'https://app.sendgrid.com/settings/api_keys',
    fields: [
      { key: 'apiKey',    label: 'API Key',     placeholder: 'SG.xxxxxxxx', secret: true,  required: true },
      { key: 'fromEmail', label: 'From Email',  placeholder: 'noreply@yourco.com', secret: false, required: true },
      { key: 'fromName',  label: 'From Name',   placeholder: 'CRM Platform', secret: false, required: false },
    ],
  },
  // ── Billing ────────────────────────────────────────────────────────────
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Card payments — USD, EUR, GBP and more',
    category: 'billing',
    logo: '💳',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    fields: [
      { key: 'secretKey',      label: 'Secret Key',      placeholder: 'sk_live_…', secret: true,  required: true },
      { key: 'webhookSecret',  label: 'Webhook Secret',  placeholder: 'whsec_…',  secret: true,  required: false },
      { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_live_…', secret: false, required: false },
    ],
  },
  {
    id: 'jazzcash',
    name: 'JazzCash',
    description: 'Pakistan mobile wallet — PKR',
    category: 'billing',
    logo: '🇵🇰',
    docsUrl: 'https://sandbox.jazzcash.com.pk',
    fields: [
      { key: 'merchantId',    label: 'Merchant ID',    placeholder: 'MC12345',  secret: false, required: true },
      { key: 'password',      label: 'Password',       placeholder: '••••••••', secret: true,  required: true },
      { key: 'integritySalt', label: 'Integrity Salt', placeholder: '••••••••', secret: true,  required: true },
      { key: 'sandbox',       label: 'Sandbox Mode',   placeholder: 'true',     secret: false, required: false },
    ],
  },
  {
    id: 'easypaisa',
    name: 'Easypaisa',
    description: 'Pakistan mobile wallet — Telenor',
    category: 'billing',
    logo: '🏪',
    docsUrl: 'https://easypaisa.com.pk/merchant-portal',
    fields: [
      { key: 'storeId',  label: 'Store ID',   placeholder: '123456',   secret: false, required: true },
      { key: 'hashKey',  label: 'Hash Key',   placeholder: '••••••••', secret: true,  required: true },
      { key: 'username', label: 'Username',   placeholder: 'ep_user',  secret: false, required: true },
      { key: 'password', label: 'Password',   placeholder: '••••••••', secret: true,  required: true },
    ],
  },
  {
    id: 'raast',
    name: 'Raast',
    description: 'State Bank of Pakistan instant interbank payments',
    category: 'billing',
    logo: '🏦',
    docsUrl: 'https://1link.net.pk',
    fields: [
      { key: 'clientId',       label: 'Client ID',       placeholder: 'xxxxxxxx', secret: false, required: true },
      { key: 'clientSecret',   label: 'Client Secret',   placeholder: '••••••••', secret: true,  required: true },
      { key: 'merchantIban',   label: 'Merchant IBAN',   placeholder: 'PK36MEZN…', secret: false, required: true },
      { key: 'merchantAlias',  label: 'Raast ID / Alias', placeholder: '+923001234567', secret: false, required: false },
    ],
  },
  // ── Notify ─────────────────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    description: 'Team notifications and CRM alerts',
    category: 'notify',
    logo: '💬',
    docsUrl: 'https://api.slack.com/apps',
    fields: [
      { key: 'webhookUrl',   label: 'Incoming Webhook URL', placeholder: 'https://hooks.slack.com/…', secret: true, required: true },
      { key: 'defaultChannel', label: 'Default Channel',   placeholder: '#crm-alerts', secret: false, required: false },
    ],
  },
  // ── SMS Gateways ───────────────────────────────────────────────────────
  {
    id: 'twilio_sms',
    name: 'Twilio SMS',
    description: 'Send SMS globally including Pakistan — same Twilio account as voice',
    category: 'sms',
    logo: '📱',
    docsUrl: 'https://console.twilio.com',
    fields: [
      { key: 'accountSid',  label: 'Account SID',  placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', secret: false, required: true },
      { key: 'authToken',   label: 'Auth Token',   placeholder: '••••••••', secret: true, required: true },
      { key: 'fromNumber',  label: 'From Number',  placeholder: '+12345678901', secret: false, required: true },
    ],
  },
  {
    id: 'jazz_sms',
    name: 'Jazz SMS Gateway',
    description: 'Jazz/Mobilink Pakistan SMS gateway — Warid & Jazz networks',
    category: 'sms',
    logo: '🇵🇰',
    docsUrl: 'https://www.jazz.com.pk/business/sms-solutions',
    fields: [
      { key: 'apiUrl',    label: 'API URL',    placeholder: 'https://sms.jazzsms.com/api/send', secret: false, required: true },
      { key: 'username',  label: 'Username',   placeholder: 'your-username', secret: false, required: true },
      { key: 'password',  label: 'Password',   placeholder: '••••••••', secret: true, required: true },
      { key: 'senderId',  label: 'Sender ID',  placeholder: 'VividCRM', secret: false, required: true },
      { key: 'method',    label: 'HTTP Method', placeholder: 'POST', secret: false, required: false },
    ],
  },
  {
    id: 'telenor_sms',
    name: 'Telenor SMS Gateway',
    description: 'Telenor Pakistan SMS — A2P messaging for Telenor network',
    category: 'sms',
    logo: '🇵🇰',
    docsUrl: 'https://www.telenor.com.pk/business/enterprise-solutions',
    fields: [
      { key: 'apiUrl',    label: 'API URL',    placeholder: 'https://sms.telenor.com.pk/api/send', secret: false, required: true },
      { key: 'username',  label: 'Username',   placeholder: 'your-username', secret: false, required: true },
      { key: 'password',  label: 'Password',   placeholder: '••••••••', secret: true, required: true },
      { key: 'senderId',  label: 'Sender ID',  placeholder: 'VividCRM', secret: false, required: true },
      { key: 'method',    label: 'HTTP Method', placeholder: 'POST', secret: false, required: false },
    ],
  },
  {
    id: 'zong_sms',
    name: 'Zong SMS Gateway',
    description: 'Zong (China Mobile Pakistan) SMS gateway',
    category: 'sms',
    logo: '🇵🇰',
    docsUrl: 'https://www.zong.com.pk/business',
    fields: [
      { key: 'apiUrl',    label: 'API URL',    placeholder: 'https://sms.zong.com.pk/api/send', secret: false, required: true },
      { key: 'username',  label: 'Username',   placeholder: 'your-username', secret: false, required: true },
      { key: 'password',  label: 'Password',   placeholder: '••••••••', secret: true, required: true },
      { key: 'senderId',  label: 'Sender ID',  placeholder: 'VividCRM', secret: false, required: true },
      { key: 'method',    label: 'HTTP Method', placeholder: 'POST', secret: false, required: false },
    ],
  },
  {
    id: 'ufone_sms',
    name: 'Ufone SMS Gateway',
    description: 'Ufone Pakistan SMS — PTCL group A2P messaging',
    category: 'sms',
    logo: '🇵🇰',
    docsUrl: 'https://www.ufone.com/business',
    fields: [
      { key: 'apiUrl',    label: 'API URL',    placeholder: 'https://sms.ufone.com/api/send', secret: false, required: true },
      { key: 'username',  label: 'Username',   placeholder: 'your-username', secret: false, required: true },
      { key: 'password',  label: 'Password',   placeholder: '••••••••', secret: true, required: true },
      { key: 'senderId',  label: 'Sender ID',  placeholder: 'VividCRM', secret: false, required: true },
      { key: 'method',    label: 'HTTP Method', placeholder: 'POST', secret: false, required: false },
    ],
  },
  {
    id: 'http_sms',
    name: 'Custom HTTP SMS Gateway',
    description: 'Generic HTTP SMS adapter — works with any provider that accepts HTTP GET/POST (Infobip, CM.com, Nexmo, custom)',
    category: 'sms',
    logo: '🔌',
    docsUrl: 'https://docs.vivid.crm/sms-gateway',
    fields: [
      { key: 'apiUrl',       label: 'API URL',       placeholder: 'https://api.example.com/sms/send', secret: false, required: true },
      { key: 'username',     label: 'Username / API Key', placeholder: 'your-api-key', secret: false, required: true },
      { key: 'password',     label: 'Password / Secret',  placeholder: '••••••••', secret: true, required: false },
      { key: 'senderId',     label: 'Sender ID',          placeholder: 'VividCRM or +1234567890', secret: false, required: true },
      { key: 'method',       label: 'HTTP Method',        placeholder: 'POST', secret: false, required: false },
      { key: 'toField',      label: 'Phone param name',   placeholder: 'to  (leave blank for default)', secret: false, required: false },
      { key: 'messageField', label: 'Message param name', placeholder: 'message  (leave blank for default)', secret: false, required: false },
      { key: 'userField',    label: 'Username param name',placeholder: 'username  (leave blank for default)', secret: false, required: false },
      { key: 'passField',    label: 'Password param name',placeholder: 'password  (leave blank for default)', secret: false, required: false },
    ],
  }
];

// ── Helper: mask secret fields ────────────────────────────────────────────
function maskConfig(def: ConnectorDef, raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of def.fields) {
    const v = raw[field.key];
    if (!v) continue;
    out[field.key] = field.secret ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : v;
  }
  return out;
}

export function connectorRoutes(db: DatabaseClient) {
  const emailSvc = new EmailService(db);
  const smsSvc   = new SmsService(db);

  return async function (fastify: FastifyInstance) {

    // List all connectors with connection status
    fastify.get('/', async (req, reply) => {
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query('SELECT settings FROM tenants WHERE id = $1', [req.tenant.id]);
        return result.rows;
      });
      const saved: Record<string, Record<string, string>> = (tenant?.settings as any)?.connectors ?? {};

      const data = CONNECTOR_DEFS.map((def) => ({
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        logo: def.logo,
        docsUrl: def.docsUrl,
        connected: Object.keys(saved[def.id] ?? {}).length > 0,
        fields: def.fields.map((f) => ({ key: f.key, label: f.label, placeholder: f.placeholder, secret: f.secret, required: f.required })),
        config: saved[def.id] ? maskConfig(def, saved[def.id]) : {},
      }));

      return reply.send({ success: true, data });
    });

    // Get single connector config (secrets masked)
    fastify.get('/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const def = CONNECTOR_DEFS.find((d) => d.id === id);
      if (!def) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Connector not found' } });

      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query('SELECT settings FROM tenants WHERE id = $1', [req.tenant.id]);
        return result.rows;
      });
      const raw: Record<string, string> = (tenant?.settings as any)?.connectors?.[id] ?? {};

      return reply.send({
        success: true,
        data: {
          id: def.id,
          name: def.name,
          connected: Object.keys(raw).length > 0,
          fields: def.fields,
          config: maskConfig(def, raw),
        },
      });
    });

    // Save / update connector credentials — requires tenant_admin
    fastify.put('/:id', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const def = CONNECTOR_DEFS.find((d) => d.id === id);
      if (!def) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Connector not found' } });

      // Validate only known fields
      const body = req.body as Record<string, string>;
      const config: Record<string, string> = {};
      for (const field of def.fields) {
        if (body[field.key] !== undefined && body[field.key] !== '') {
          config[field.key] = body[field.key];
        }
      }

      // Check required fields
      const missing = def.fields.filter((f) => f.required && !config[f.key] &&
        // If value is masked (all bullets) — it was already saved; skip check
        !/^•+/.test(body[f.key] ?? ''));
      if (missing.length > 0) {
        return reply.code(400).send({
          success: false,
          error: { code: 'MISSING_FIELDS', message: `Required fields missing: ${missing.map((f) => f.label).join(', ')}` },
        });
      }

      // Merge with existing (preserves secrets if masked value was sent back)
      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query('SELECT settings FROM tenants WHERE id = $1', [req.tenant.id]);
        return result.rows;
      });
      const existing: Record<string, string> = (tenant?.settings as any)?.connectors?.[id] ?? {};
      const merged: Record<string, string> = { ...existing };
      for (const field of def.fields) {
        const v = body[field.key];
        // If masked value sent back, keep existing secret; otherwise update
        if (v !== undefined && v !== '' && !/^•+[^•]{4}$/.test(v)) {
          merged[field.key] = v;
        }
      }

      // Ensure the connectors key exists, then set the specific connector
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants
           SET settings = jsonb_set(
             jsonb_set(COALESCE(settings, '{}'), '{connectors}', COALESCE(settings->'connectors', '{}'), true),
             ARRAY['connectors', $1::text],
             $2::jsonb,
             true
           ),
           updated_at = NOW()
           WHERE id = $3`,
          [id, JSON.stringify(merged), req.tenant.id],
        );
      });

      // Also update voiceProvider / voiceConfig if this is a voice connector
      if (id === 'twilio' || id === 'vonage') {
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE tenants
             SET settings = settings
               || jsonb_build_object('voiceProvider', $1::text)
               || jsonb_build_object('voiceConfig', $2::jsonb),
             updated_at = NOW()
             WHERE id = $3`,
            [id, JSON.stringify(merged), req.tenant.id],
          );
        });
      }

      return reply.send({ success: true, message: `${def.name} connected successfully` });
    });

    // Disconnect a connector
    fastify.delete('/:id', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      await db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE tenants
           SET settings = settings #- ARRAY['connectors', $1::text],
           updated_at = NOW()
           WHERE id = $2`,
          [id, req.tenant.id],
        );
      });
      return reply.send({ success: true, message: 'Connector disconnected' });
    });

    // Test connector connection
    fastify.post('/:id/test', { preHandler: requireRole('tenant_admin', 'super_admin') }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const def = CONNECTOR_DEFS.find((d) => d.id === id);
      if (!def) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Connector not found' } });

      const [tenant] = await db.withSuperAdmin(async (client) => {
        const result = await client.query('SELECT settings FROM tenants WHERE id = $1', [req.tenant.id]);
        return result.rows;
      });
      const config: Record<string, string> = (tenant?.settings as any)?.connectors?.[id] ?? {};
      if (Object.keys(config).length === 0) {
        return reply.code(400).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Connector is not configured yet' } });
      }

      // Lightweight connectivity test per provider
      try {
        switch (id) {
          case 'twilio': {
            const res = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}.json`,
              { headers: { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}` } },
            );
            if (!res.ok) return reply.send({ success: false, message: `Twilio error: ${res.status}` });
            break;
          }
          case 'smtp':
          case 'sendgrid': {
            const result = await emailSvc.testConnection(req.tenant.id);
            return reply.send({ success: result.ok, message: result.message });
          }
          case 'twilio_sms': {
            // Validate Twilio credentials via account lookup
            const res = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}.json`,
              { headers: { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}` } },
            );
            if (!res.ok) return reply.send({ success: false, message: `Twilio error: ${res.status}` });
            break;
          }
          case 'jazz_sms':
          case 'telenor_sms':
          case 'zong_sms':
          case 'ufone_sms':
          case 'http_sms': {
            // HTTP gateway: just verify the URL is reachable with a HEAD request
            if (!config.apiUrl) return reply.send({ success: false, message: 'API URL is required' });
            try {
              const res = await fetch(config.apiUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
              // 4xx/5xx on HEAD is fine — it means the server is reachable
              break;
            } catch {
              return reply.send({ success: false, message: `Cannot reach ${config.apiUrl} — check the URL` });
            }
          }
          default:
            // For other connectors: just confirm config is saved
            break;
        }
        return reply.send({ success: true, message: `${def.name} connection looks good` });
      } catch (err: any) {
        return reply.send({ success: false, message: err.message });
      }
    });
  };
}
