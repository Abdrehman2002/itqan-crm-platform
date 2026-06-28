// Platform-level system email. Sender of last resort for messages that have to
// land BEFORE a tenant has configured its own email connector — welcome emails,
// admin password resets, "your workspace is ready", forgot-password links.
//
// Provider order (first one with creds wins):
//   1. SendGrid HTTP API   — SENDGRID_API_KEY + SENDGRID_FROM_EMAIL
//   2. Generic SMTP        — SYSTEM_SMTP_HOST + SYSTEM_SMTP_USER + SYSTEM_SMTP_PASS
//      (For Gmail App Passwords: host=smtp.gmail.com, port=465, secure=true,
//       user=vividd.solutions@gmail.com, pass=<16-char app password>.)
//
// Returns a SystemEmailResult so callers can surface the REAL failure (no key vs
// 401 from SendGrid vs SMTP auth failed vs sender not verified) instead of the
// useless "email didn't go".

export interface SystemEmailOpts {
  to:       string;
  toName:   string;
  subject:  string;
  bodyHtml: string;
  bodyText: string;
}

export type SystemEmailErrorCode =
  | 'NOT_CONFIGURED'        // no SendGrid + no SMTP env vars set
  | 'SENDGRID_AUTH'         // 401/403 from SendGrid (bad key)
  | 'SENDGRID_SENDER'       // 403 + sender-identity error (from email not verified)
  | 'SENDGRID_BAD_REQUEST'  // 400 (malformed payload — usually our bug)
  | 'SENDGRID_RATE_LIMIT'   // 429
  | 'SENDGRID_HTTP'         // any other non-2xx from SendGrid
  | 'SENDGRID_NETWORK'      // fetch threw before we got a response
  | 'SMTP_AUTH'             // EAUTH from nodemailer
  | 'SMTP_CONNECTION'       // ECONNECTION / ETIMEDOUT
  | 'SMTP_SENDER'           // 5xx response that mentions sender / from
  | 'SMTP_RECIPIENT'        // 5xx response that mentions recipient / to
  | 'SMTP_UNKNOWN'          // any other nodemailer throw
  ;

export interface SystemEmailResult {
  sent:      boolean;
  provider?: 'sendgrid' | 'smtp';
  errorCode?: SystemEmailErrorCode;
  errorDetail?: string;     // raw provider message — for the platform log, NOT for end users
  userMessage?: string;     // plain-language reason a super_admin should see
}

// One place to translate technical failures into something the super_admin can act on.
const USER_MESSAGES: Record<SystemEmailErrorCode, string> = {
  NOT_CONFIGURED:       'No email provider configured. Add SENDGRID_API_KEY + SENDGRID_FROM_EMAIL (or SYSTEM_SMTP_* vars) on the API server and restart.',
  SENDGRID_AUTH:        'SendGrid rejected the API key (401/403). Verify SENDGRID_API_KEY is correct and has Mail Send permission.',
  SENDGRID_SENDER:      'SendGrid rejected the sender address. The SENDGRID_FROM_EMAIL must be a verified Single Sender or part of an authenticated domain.',
  SENDGRID_BAD_REQUEST: 'SendGrid rejected the payload (400). This is usually a malformed recipient or subject — check API logs.',
  SENDGRID_RATE_LIMIT:  'SendGrid rate limit hit. Wait a few minutes or upgrade the SendGrid plan.',
  SENDGRID_HTTP:        'SendGrid returned an unexpected HTTP error. Check API logs for the response body.',
  SENDGRID_NETWORK:     'Could not reach SendGrid (network/DNS error). Check the API server has outbound HTTPS to api.sendgrid.com.',
  SMTP_AUTH:            'SMTP authentication failed. Verify SYSTEM_SMTP_USER and SYSTEM_SMTP_PASS. For Gmail, use a 16-character App Password — not your Google account password.',
  SMTP_CONNECTION:      'Could not connect to the SMTP host. Verify SYSTEM_SMTP_HOST + SYSTEM_SMTP_PORT and that the server allows outbound on that port.',
  SMTP_SENDER:          'SMTP rejected the sender address. Verify SYSTEM_SMTP_FROM (or SYSTEM_SMTP_USER) is allowed to send mail.',
  SMTP_RECIPIENT:       'SMTP rejected the recipient address. The email address looks invalid or blocked by the receiving server.',
  SMTP_UNKNOWN:         'SMTP send failed. Check API logs for the raw nodemailer error.',
};

function fail(errorCode: SystemEmailErrorCode, errorDetail?: string, provider?: 'sendgrid' | 'smtp'): SystemEmailResult {
  return { sent: false, provider, errorCode, errorDetail, userMessage: USER_MESSAGES[errorCode] };
}

export async function sendSystemEmail(opts: SystemEmailOpts): Promise<SystemEmailResult> {
  const sgKey  = process.env.SENDGRID_API_KEY;
  const sgFrom = process.env.SENDGRID_FROM_EMAIL;
  if (sgKey && sgFrom) {
    let res: Response;
    try {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sgKey}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: opts.to, name: opts.toName }] }],
          from: { email: sgFrom, name: process.env.SENDGRID_FROM_NAME ?? 'AmanahCX' },
          subject: opts.subject,
          content: [
            { type: 'text/plain', value: opts.bodyText },
            { type: 'text/html',  value: opts.bodyHtml },
          ],
        }),
      });
    } catch (e: any) {
      return fail('SENDGRID_NETWORK', e?.message, 'sendgrid');
    }
    if (res.ok || res.status === 202) return { sent: true, provider: 'sendgrid' };
    // Read the body once so we can categorise the failure precisely.
    const detail = await res.text().catch(() => '');
    if (res.status === 401)                       return fail('SENDGRID_AUTH',    detail, 'sendgrid');
    if (res.status === 403 && /sender/i.test(detail)) return fail('SENDGRID_SENDER', detail, 'sendgrid');
    if (res.status === 403)                       return fail('SENDGRID_AUTH',    detail, 'sendgrid');
    if (res.status === 400)                       return fail('SENDGRID_BAD_REQUEST', detail, 'sendgrid');
    if (res.status === 429)                       return fail('SENDGRID_RATE_LIMIT', detail, 'sendgrid');
    return fail('SENDGRID_HTTP', `HTTP ${res.status} — ${detail.slice(0, 240)}`, 'sendgrid');
  }

  const smtpHost = process.env.SYSTEM_SMTP_HOST;
  const smtpUser = process.env.SYSTEM_SMTP_USER;
  const smtpPass = process.env.SYSTEM_SMTP_PASS;
  const smtpFrom = process.env.SYSTEM_SMTP_FROM ?? smtpUser ?? '';
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = require('nodemailer');
      const port = parseInt(process.env.SYSTEM_SMTP_PORT ?? '587', 10);
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: process.env.SYSTEM_SMTP_FROM_NAME
          ? `"${process.env.SYSTEM_SMTP_FROM_NAME}" <${smtpFrom}>`
          : smtpFrom,
        to: `"${opts.toName}" <${opts.to}>`,
        subject: opts.subject,
        html: opts.bodyHtml,
        text: opts.bodyText,
      });
      return { sent: true, provider: 'smtp' };
    } catch (e: any) {
      const code = (e?.code ?? '').toString();
      const msg  = (e?.message ?? '').toString();
      const resp = (e?.response ?? '').toString();
      if (code === 'EAUTH')                                                return fail('SMTP_AUTH',       resp || msg, 'smtp');
      if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'EDNS') return fail('SMTP_CONNECTION', `${code} ${msg}`, 'smtp');
      if (/from|sender/i.test(resp) && /\b5\d{2}\b/.test(resp))            return fail('SMTP_SENDER',     resp, 'smtp');
      if (/recipient|^550\b/i.test(resp))                                  return fail('SMTP_RECIPIENT',  resp, 'smtp');
      return fail('SMTP_UNKNOWN', msg || resp || code, 'smtp');
    }
  }

  return fail('NOT_CONFIGURED');
}

// Convenience wrapper for the very common "your password is X" mail.
export async function sendTempPasswordEmail(opts: {
  to: string; toName: string; tempPassword: string; subject?: string;
}): Promise<SystemEmailResult> {
  return sendSystemEmail({
    to: opts.to,
    toName: opts.toName,
    subject: opts.subject ?? 'Your AmanahCX password',
    bodyHtml: `
      <p>Hi ${opts.toName},</p>
      <p>Your temporary password is below. Please log in and change it immediately.</p>
      <p style="margin:16px 0;">
        <strong>Temporary password: </strong>
        <span style="font-family:monospace;font-size:1.1em;background:#fef3c7;padding:2px 8px;border-radius:4px;">${opts.tempPassword}</span>
      </p>
      <p>If you did not expect this email, contact your platform provider immediately.</p>`,
    bodyText: `Hi ${opts.toName},\n\nYour temporary password is: ${opts.tempPassword}\n\nPlease log in and change it immediately.`,
  });
}

// Convenience wrapper for password-reset links.
export async function sendPasswordResetEmail(opts: {
  to: string; toName: string; resetUrl: string;
}): Promise<SystemEmailResult> {
  return sendSystemEmail({
    to: opts.to,
    toName: opts.toName,
    subject: 'Reset your AmanahCX password',
    bodyHtml: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#0f172a;">Reset your password</h2>
        <p>Hi ${opts.toName},</p>
        <p>We received a request to reset your password. Click the button below to choose a new one.
           This link expires in <strong>1 hour</strong>.</p>
        <p><a href="${opts.resetUrl}"
              style="display:inline-block;margin:16px 0;padding:12px 24px;background:#29ABE2;color:white;border-radius:8px;text-decoration:none;font-weight:600;">
          Reset Password
        </a></p>
        <p style="color:#64748b;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
    bodyText: `Reset your password: ${opts.resetUrl}\n\nThis link expires in 1 hour.`,
  });
}
