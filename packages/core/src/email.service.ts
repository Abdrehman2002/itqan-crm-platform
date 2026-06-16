/**
 * EmailService
 *
 * Reads tenant connector credentials (smtp or sendgrid) and dispatches
 * emails through the configured provider.  Every sent email is logged
 * to the `emails` table and cross-referenced as an activity so it appears
 * in contact / deal timelines.
 *
 * Providers
 *  • SMTP   — nodemailer (covers Gmail App Password, Outlook, Mailgun SMTP …)
 *  • SendGrid — v3 Mail Send REST API via native fetch (no SDK needed)
 */

import type { DatabaseClient } from './database';
import { logger } from './config/logger';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SendEmailOpts {
  to: string | string[];       // recipient address(es)
  toName?: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  // CRM associations (optional)
  contactId?: string;
  dealId?: string;
  ticketId?: string;
  sentBy?: string;             // user UUID
}

export interface SendResult {
  emailId: string;
  providerId?: string;         // message-id from SMTP / SendGrid
  status: 'delivered' | 'failed';
  error?: string;
}

interface SmtpConfig {
  host: string;
  port: string;
  user: string;
  password: string;
  fromName?: string;
  fromEmail?: string;
}

interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

type ConnectorConfig =
  | { provider: 'smtp';      config: SmtpConfig }
  | { provider: 'sendgrid';  config: SendGridConfig }
  | { provider: null;        config: null };

// ── Email Service ─────────────────────────────────────────────────────────

export class EmailService {
  constructor(private readonly db: DatabaseClient) {}

  // ── Resolve provider from tenant connector settings ──────────────────

  async getConnectorConfig(tenantId: string): Promise<ConnectorConfig> {
    const [tenant] = await this.db.withSuperAdmin(async (client) => {
      const r = await client.query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
      return r.rows;
    });

    const connectors = (tenant?.settings as any)?.connectors ?? {};

    if (connectors.sendgrid?.apiKey && connectors.sendgrid?.fromEmail) {
      return { provider: 'sendgrid', config: connectors.sendgrid as SendGridConfig };
    }
    if (connectors.smtp?.host && connectors.smtp?.user && connectors.smtp?.password) {
      return { provider: 'smtp', config: connectors.smtp as SmtpConfig };
    }

    return { provider: null, config: null };
  }

  // ── Public send ───────────────────────────────────────────────────────

  async send(tenantId: string, opts: SendEmailOpts): Promise<SendResult> {
    const toList  = Array.isArray(opts.to) ? opts.to : [opts.to];
    const toEmail = toList[0];   // primary recipient for DB record

    // ── 1. Create email record (status = queued) ──
    const emailId: string = await this.db.withSuperAdmin(async (client) => {
      // Bypass RLS — we need super-admin to write directly
      const r = await client.query(
        `INSERT INTO emails
           (tenant_id, from_email, from_name, to_email, to_name, cc, bcc, reply_to,
            subject, body_html, body_text, status, contact_id, deal_id, ticket_id, sent_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued',$12,$13,$14,$15)
         RETURNING id`,
        [
          tenantId,
          '',       // from — filled in below once we know the provider
          '',
          toEmail,
          opts.toName ?? null,
          opts.cc  ?? [],
          opts.bcc ?? [],
          opts.replyTo ?? null,
          opts.subject,
          opts.bodyHtml  ?? null,
          opts.bodyText  ?? null,
          opts.contactId ?? null,
          opts.dealId    ?? null,
          opts.ticketId  ?? null,
          opts.sentBy    ?? null,
        ],
      );
      return r.rows[0].id as string;
    });

    // ── 2. Resolve connector ──────────────────────
    const { provider, config } = await this.getConnectorConfig(tenantId);
    if (!provider || !config) {
      await this.markFailed(emailId, 'No email connector configured. Please set up SMTP or SendGrid in Integrations.');
      return { emailId, status: 'failed', error: 'No email connector configured' };
    }

    // Compute from address
    const fromEmail = provider === 'sendgrid'
      ? (config as SendGridConfig).fromEmail
      : (config as SmtpConfig).fromEmail || (config as SmtpConfig).user;
    const fromName = provider === 'sendgrid'
      ? (config as SendGridConfig).fromName
      : (config as SmtpConfig).fromName;

    // Update from fields in DB
    await this.db.withSuperAdmin(async (client) => {
      await client.query(
        `UPDATE emails SET from_email = $1, from_name = $2, provider = $3, status = 'sending', updated_at = NOW()
         WHERE id = $4`,
        [fromEmail, fromName ?? null, provider, emailId],
      );
    });

    // ── 3. Dispatch ───────────────────────────────
    try {
      let providerId: string | undefined;

      if (provider === 'smtp') {
        providerId = await this.sendViaSMTP(config as SmtpConfig, toList, opts, fromEmail, fromName);
      } else {
        providerId = await this.sendViaSendGrid(config as SendGridConfig, toList, opts);
      }

      // ── 4. Mark delivered ────────────────────────
      await this.db.withSuperAdmin(async (client) => {
        await client.query(
          `UPDATE emails
           SET status = 'delivered', provider_id = $1, sent_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [providerId ?? null, emailId],
        );
      });

      // ── 5. Log as activity (contact / deal timeline) ──
      if (opts.contactId || opts.dealId) {
        await this.db.withSuperAdmin(async (client) => {
          await client.query(
            `INSERT INTO activities
               (tenant_id, type, subject, body, status, contact_id, deal_id, owner_id, completed_at, metadata)
             VALUES ($1,'email',$2,$3,'completed',$4,$5,
                    COALESCE($6,(SELECT id FROM users WHERE tenant_id=$1 AND role='tenant_admin' LIMIT 1)),
                    NOW(), $7)`,
            [
              tenantId,
              opts.subject,
              opts.bodyText ?? (opts.bodyHtml ?? '').replace(/<[^>]*>/g, '').slice(0, 500),
              opts.contactId ?? null,
              opts.dealId    ?? null,
              opts.sentBy    ?? null,
              JSON.stringify({ emailId, to: toEmail, provider }),
            ],
          );
        });
      }

      logger.info('Email sent', { emailId, provider, to: toEmail });
      return { emailId, providerId, status: 'delivered' };

    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error('Email dispatch failed', { emailId, error: msg });
      await this.markFailed(emailId, msg);
      return { emailId, status: 'failed', error: msg };
    }
  }

  // ── SMTP via nodemailer ───────────────────────────────────────────────

  private async sendViaSMTP(
    cfg: SmtpConfig,
    toList: string[],
    opts: SendEmailOpts,
    fromEmail: string,
    fromName?: string,
  ): Promise<string | undefined> {
    // Dynamic import — nodemailer is optional dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: parseInt(cfg.port, 10),
      secure: parseInt(cfg.port, 10) === 465,
      auth: { user: cfg.user, pass: cfg.password },
    });

    const info = await transporter.sendMail({
      from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to:      toList.join(', '),
      cc:      (opts.cc  ?? []).join(', ') || undefined,
      bcc:     (opts.bcc ?? []).join(', ') || undefined,
      replyTo: opts.replyTo,
      subject: opts.subject,
      html:    opts.bodyHtml,
      text:    opts.bodyText,
    });

    return info.messageId as string;
  }

  // ── SendGrid v3 REST API ──────────────────────────────────────────────

  private async sendViaSendGrid(
    cfg: SendGridConfig,
    toList: string[],
    opts: SendEmailOpts,
  ): Promise<string | undefined> {
    const personalizations = [{
      to: toList.map((e, i) => ({
        email: e,
        ...(i === 0 && opts.toName ? { name: opts.toName } : {}),
      })),
      ...(opts.cc?.length  ? { cc:  opts.cc.map(e => ({ email: e }))  } : {}),
      ...(opts.bcc?.length ? { bcc: opts.bcc.map(e => ({ email: e })) } : {}),
    }];

    const body: Record<string, unknown> = {
      personalizations,
      from: { email: cfg.fromEmail, name: cfg.fromName ?? undefined },
      subject: opts.subject,
      content: opts.bodyHtml
        ? [
            { type: 'text/html', value: opts.bodyHtml },
            ...(opts.bodyText ? [{ type: 'text/plain', value: opts.bodyText }] : []),
          ]
        : [{ type: 'text/plain', value: opts.bodyText ?? '' }],
    };
    if (opts.replyTo) body.reply_to = { email: opts.replyTo };

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SendGrid ${res.status}: ${text}`);
    }

    // SendGrid returns 202; message-id is in X-Message-Id header
    return res.headers.get('X-Message-Id') ?? undefined;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async markFailed(emailId: string, error: string): Promise<void> {
    await this.db.withSuperAdmin(async (client) => {
      await client.query(
        `UPDATE emails SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        [error.slice(0, 1000), emailId],
      );
    });
  }

  async testConnection(tenantId: string): Promise<{ ok: boolean; message: string }> {
    const { provider, config } = await this.getConnectorConfig(tenantId);
    if (!provider) return { ok: false, message: 'No email connector configured' };

    try {
      if (provider === 'smtp') {
        const nodemailer = require('nodemailer');
        const cfg = config as SmtpConfig;
        const t = nodemailer.createTransport({
          host: cfg.host,
          port: parseInt(cfg.port, 10),
          secure: parseInt(cfg.port, 10) === 465,
          auth: { user: cfg.user, pass: cfg.password },
        });
        await t.verify();
        return { ok: true, message: 'SMTP connection verified' };
      }
      if (provider === 'sendgrid') {
        const cfg = config as SendGridConfig;
        const r = await fetch('https://api.sendgrid.com/v3/scopes', {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
        if (!r.ok) return { ok: false, message: `SendGrid API error: ${r.status}` };
        return { ok: true, message: 'SendGrid API key valid' };
      }
      return { ok: false, message: 'Unknown provider' };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }
}
