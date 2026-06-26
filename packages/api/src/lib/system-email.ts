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
// Returns true on dispatch, false if nothing is configured or the provider
// errored. Caller decides whether to show the credential on screen as a fallback.

export interface SystemEmailOpts {
  to:       string;
  toName:   string;
  subject:  string;
  bodyHtml: string;
  bodyText: string;
}

export async function sendSystemEmail(opts: SystemEmailOpts): Promise<boolean> {
  const sgKey  = process.env.SENDGRID_API_KEY;
  const sgFrom = process.env.SENDGRID_FROM_EMAIL;
  if (sgKey && sgFrom) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
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
      return res.ok || res.status === 202;
    } catch { return false; }
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
      return true;
    } catch { return false; }
  }

  return false;
}

// Convenience wrapper for the very common "your password is X" mail.
export async function sendTempPasswordEmail(opts: {
  to: string; toName: string; tempPassword: string; subject?: string;
}): Promise<boolean> {
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
}): Promise<boolean> {
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
