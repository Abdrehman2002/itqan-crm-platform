import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { DatabaseClient, RedisClient } from '@crm/core';
import { EmailService } from '../services/email.service';
import { SECTOR_MAP, getSector } from '@crm/shared';

// ── Security constants ────────────────────────────────────────────────────────
const BCRYPT_ROUNDS        = 14;          // PCI-DSS / ISO 27001 recommended
const LOGIN_MAX_ATTEMPTS   = 5;           // lock after N consecutive failures
const LOCKOUT_DURATION_S   = 15 * 60;    // 15 minutes initial lockout
const LOCKOUT_KEY          = (tenantId: string, email: string) => `lockout:${tenantId}:${email.toLowerCase()}`;
const FAIL_COUNT_KEY       = (tenantId: string, email: string) => `loginfail:${tenantId}:${email.toLowerCase()}`;
const BLOCKLIST_KEY        = (jti: string) => `blocklist:${jti}`;

/** Check whether a JTI is in the token revocation blocklist */
export async function isTokenRevoked(redis: RedisClient, jti: string): Promise<boolean> {
  const val = await redis.get(BLOCKLIST_KEY(jti));
  return val !== null;
}

/** Add a JTI to the revocation blocklist with a TTL matching token expiry */
async function revokeToken(redis: RedisClient, jti: string, expiresAt: number): Promise<void> {
  const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
  await redis.setex(BLOCKLIST_KEY(jti), ttl, '1');
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().optional(),
});

const VALID_SECTORS = ['banking','telecom','public_transport','logistics','insurance','education','ecommerce','other'] as const;

// Enterprise-grade password policy: min 10 chars, uppercase, lowercase, digit, special char
const ENTERPRISE_PASSWORD = z.string()
  .min(10, 'Password must be at least 10 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

const RegisterSchema = z.object({
  tenantName: z.string().min(2),
  tenantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name:       z.string().min(1),
  email:      z.string().email(),
  password:   ENTERPRISE_PASSWORD,
  sector:     z.enum(VALID_SECTORS).default('other'),
  phone:      z.string().optional(),
});

const ForgotPasswordSchema = z.object({
  email:      z.string().email(),
  tenantSlug: z.string().min(2),
});

const ResetPasswordSchema = z.object({
  token:    z.string().min(1),
  password: ENTERPRISE_PASSWORD,
});

export function authRoutes(db: DatabaseClient, redis: RedisClient) {
  const emailSvc = new EmailService(db);

  return async function (fastify: FastifyInstance) {

    // Self-service signup — creates tenant + admin user in one call
    fastify.post('/register', async (req, reply) => {
      const body = RegisterSchema.parse(req.body);

      const [existing] = await db.withSuperAdmin(async (client) => {
        const result = await client.query('SELECT id FROM tenants WHERE slug = $1', [body.tenantSlug]);
        return result.rows;
      });
      if (existing) {
        return reply.code(409).send({ success: false, error: { code: 'SLUG_TAKEN', message: 'This subdomain is already taken' } });
      }

      const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
      const sectorCfg    = getSector(body.sector);

      const { tenant, user } = await db.withSuperAdmin(async (client) => {
        // 1. Create tenant with sector
        const tenantResult = await client.query(
          `INSERT INTO tenants (name, slug, plan, status, trial_ends_at, sector, settings)
           VALUES ($1, $2, 'starter', 'trial', NOW() + INTERVAL '14 days', $3, $4)
           RETURNING *`,
          [
            body.tenantName,
            body.tenantSlug,
            body.sector,
            JSON.stringify({ sector: body.sector, contactLabel: sectorCfg.contactLabel }),
          ],
        );
        const t = tenantResult.rows[0];

        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.id]);

        // 2. Create admin user
        const userResult = await client.query(
          `INSERT INTO users (tenant_id, email, name, password_hash, role)
           VALUES ($1, $2, $3, $4, 'tenant_admin')
           RETURNING id, tenant_id, email, name, role`,
          [t.id, body.email, body.name, passwordHash],
        );
        const adminUser = userResult.rows[0];

        // 3. Seed sector-specific custom field definitions for the 'contact' entity
        for (const field of sectorCfg.fields) {
          await client.query(
            `INSERT INTO custom_field_definitions
               (tenant_id, entity, name, label, field_type, options, is_required, sort_order)
             VALUES ($1, 'contact', $2, $3, $4, $5, $6, $7)
             ON CONFLICT (tenant_id, entity, name) DO NOTHING`,
            [
              t.id,
              field.name,
              field.label,
              field.field_type,
              field.options ? JSON.stringify(field.options) : null,
              field.is_required,
              field.sort_order,
            ],
          );
        }

        // 4. Seed default ticket queues (departments) for the sector
        for (let i = 0; i < sectorCfg.departments.length; i++) {
          const dept = sectorCfg.departments[i];
          const colors = ['#29ABE2','#4D8B3C','#F5C518','#8b5cf6','#ef4444','#f97316','#0ea5e9','#10b981'];
          await client.query(
            `INSERT INTO ticket_queues (tenant_id, name, color, is_default)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [t.id, dept, colors[i % colors.length], i === 0],
          );
        }

        return { tenant: t, user: adminUser };
      });

      const regJti  = crypto.randomBytes(16).toString('hex');
      const token   = await reply.jwtSign({
        sub: user.id, tenantId: tenant.id, role: user.role, plan: tenant.plan,
        department: user.department ?? null,
        department_type: user.department_type ?? null,
        manager_id: user.manager_id ?? null,
        sector:     body.sector,
        jti:        regJti,
      });

      return reply.code(201).send({
        success: true,
        data: { token, user, tenant, sector: sectorCfg },
      });
    });

    // Login — with brute-force protection and account lockout
    fastify.post('/login', async (req, reply) => {
      const body = LoginSchema.parse(req.body);

      const host = req.headers.host ?? '';
      const platformDomain = process.env.PLATFORM_DOMAIN ?? 'yourcrm.com';
      let tenantSlug = body.tenantSlug;
      if (!tenantSlug && host.endsWith(`.${platformDomain}`)) {
        tenantSlug = host.replace(`.${platformDomain}`, '');
      }

      // Platform-level fallback: if no tenant slug supplied, this MAY be a
      // super_admin (they're platform-scoped, not bound to any tenant). Look up
      // the email globally and accept only if the matching active user is a
      // super_admin. Any other role still requires the slug — protects tenant
      // login from accidental cross-tenant matches.
      let tenant: any;
      if (!tenantSlug) {
        const [maybeSuper] = await db.withSuperAdmin(async (client) => {
          const r = await client.query(
            `SELECT * FROM users WHERE email = $1 AND is_active = true AND role = 'super_admin' LIMIT 1`,
            [body.email],
          );
          return r.rows;
        });
        if (!maybeSuper) {
          return reply.code(400).send({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Workspace slug required' } });
        }
        // Load the tenant the super_admin is anchored to (used only for JWT claims)
        [tenant] = await db.withSuperAdmin(async (client) => {
          const r = await client.query('SELECT * FROM tenants WHERE id = $1', [maybeSuper.tenant_id]);
          return r.rows;
        });
      } else {
        [tenant] = await db.withSuperAdmin(async (client) => {
          const result = await client.query('SELECT * FROM tenants WHERE slug = $1', [tenantSlug]);
          return result.rows;
        });
      }
      if (!tenant) {
        return reply.code(401).send({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
      }

      // ── Suspended tenant check ───────────────────────────────────────────
      if (tenant.status === 'suspended') {
        return reply.code(403).send({ success: false, error: { code: 'TENANT_SUSPENDED', message: 'This workspace has been suspended. Please contact your platform administrator.' } });
      }

      // ── Account lockout check ─────────────────────────────────────────────
      const lockKey = LOCKOUT_KEY(tenant.id, body.email);
      const lockedUntil = await redis.get(lockKey);
      if (lockedUntil) {
        const remaining = Math.ceil((parseInt(lockedUntil, 10) - Date.now()) / 1000 / 60);
        return reply.code(429).send({
          success: false,
          error: {
            code: 'ACCOUNT_LOCKED',
            message: `Account locked due to too many failed attempts. Try again in ${remaining} minute${remaining === 1 ? '' : 's'}.`,
          },
        });
      }

      const [user] = await db.withSuperAdmin(async (client) => {
        const result = await client.query(
          `SELECT u.*, r.name as role_name, r.color as role_color, r.permissions as role_permissions
           FROM users u
           LEFT JOIN roles r ON u.custom_role_id = r.id
           WHERE u.tenant_id = $1 AND u.email = $2 AND u.is_active = true`,
          [tenant.id, body.email],
        );
        return result.rows;
      });

      const failKey = FAIL_COUNT_KEY(tenant.id, body.email);

      // Validate credentials — use constant-time comparison even when user not found
      const dummyHash = '$2b$14$invalidhashfortimingattackprevention0000000000000000000';
      const hashToCheck = user?.password_hash ?? dummyHash;
      const valid = await bcrypt.compare(body.password, hashToCheck);

      if (!user || !user.password_hash || !valid) {
        // Increment failure counter with 30-minute sliding window
        const failCount = await redis.incrby(failKey, 1);
        await redis.expire(failKey, 30 * 60);

        if (failCount >= LOGIN_MAX_ATTEMPTS) {
          // Lock the account — progressive duration (doubles each batch of 5 failures)
          const lockBatch = Math.floor(failCount / LOGIN_MAX_ATTEMPTS);
          const lockDuration = LOCKOUT_DURATION_S * lockBatch;
          await redis.setex(lockKey, lockDuration, String(Date.now() + lockDuration * 1000));
          return reply.code(429).send({
            success: false,
            error: {
              code: 'ACCOUNT_LOCKED',
              message: `Too many failed attempts. Account locked for ${lockDuration / 60} minutes.`,
            },
          });
        }

        const attemptsLeft = LOGIN_MAX_ATTEMPTS - failCount;
        return reply.code(401).send({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: attemptsLeft <= 2
              ? `Invalid credentials. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before lockout.`
              : 'Invalid credentials',
          },
        });
      }

      // ── Success: clear failure counter, update last login ─────────────────
      await redis.del(failKey);
      db.withTenant(tenant.id, async (client) => {
        await client.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
      }).catch((e) => { fastify.log.error({ err: e }, 'Failed to update last_login_at'); });

      // Effective permissions: custom role permissions take priority, else use stored permissions
      const effectivePermissions = user.role_permissions ?? user.permissions ?? {};

      // Include a unique JTI (JWT ID) so this specific token can be revoked on logout
      const jti   = crypto.randomBytes(16).toString('hex');
      const token = await reply.jwtSign({
        sub: user.id, tenantId: tenant.id, role: user.role, plan: tenant.plan,
        department: user.department ?? null,
        department_type: user.department_type ?? null,
        manager_id: user.manager_id ?? null,
        sector:     tenant.sector ?? 'other',
        permissions: effectivePermissions,
        jti,
      });

      const { password_hash, ...safeUser } = user;
      return reply.send({ success: true, data: {
        token,
        user: { ...safeUser, effectivePermissions },
        tenant,
      } });
    });

    // ── Forgot password ─────────────────────────────────────────────────
    // POST /api/v1/auth/forgot-password
    // Always returns 200 (don't reveal whether email exists)
    fastify.post('/forgot-password', async (req, reply) => {
      const body = ForgotPasswordSchema.parse(req.body);

      const [tenant] = await db.withSuperAdmin(async (client) => {
        const r = await client.query('SELECT * FROM tenants WHERE slug = $1', [body.tenantSlug]);
        return r.rows;
      });
      if (!tenant) return reply.send({ success: true }); // silent

      const [user] = await db.withTenant(tenant.id, async (client) => {
        const r = await client.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [body.email]);
        return r.rows;
      });
      if (!user) return reply.send({ success: true }); // silent

      // Generate secure token + store hash with 1-hour expiry
      const token     = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.withSuperAdmin(async (client) => {
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET token_hash = $2, expires_at = $3, used = false`,
          [user.id, tokenHash, expiresAt],
        );
      });

      const appUrl   = process.env.APP_URL ?? 'http://localhost:5173';
      const resetUrl = `${appUrl}/reset-password?token=${token}&tenant=${body.tenantSlug}`;

      // Send reset email (best-effort)
      await emailSvc.send(tenant.id, {
        to:       user.email,
        subject:  'Reset your password',
        bodyHtml: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
            <h2 style="color:#0f172a;">Reset your password</h2>
            <p>Hi ${user.name},</p>
            <p>We received a request to reset your password. Click the button below to choose a new one.
               This link expires in <strong>1 hour</strong>.</p>
            <a href="${resetUrl}"
               style="display:inline-block;margin:16px 0;padding:12px 24px;background:#29ABE2;color:white;border-radius:8px;text-decoration:none;font-weight:600;">
              Reset Password
            </a>
            <p style="color:#64748b;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
        bodyText: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
      }).catch(() => {});

      return reply.send({ success: true });
    });

    // ── Reset password ──────────────────────────────────────────────────
    // POST /api/v1/auth/reset-password
    fastify.post('/reset-password', async (req, reply) => {
      const body      = ResetPasswordSchema.parse(req.body);
      const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');

      const [row] = await db.withSuperAdmin(async (client) => {
        const r = await client.query(
          `SELECT prt.*, u.tenant_id FROM password_reset_tokens prt
           JOIN users u ON prt.user_id = u.id
           WHERE prt.token_hash = $1 AND prt.used = false AND prt.expires_at > NOW()`,
          [tokenHash],
        );
        return r.rows;
      });

      if (!row) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset link' },
        });
      }

      const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

      await db.withSuperAdmin(async (client) => {
        // Update password
        await client.query(
          `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
          [passwordHash, row.user_id],
        );
        // Mark token as used
        await client.query(
          `UPDATE password_reset_tokens SET used = true WHERE token_hash = $1`,
          [tokenHash],
        );
      });

      return reply.send({ success: true, message: 'Password updated successfully' });
    });

    // Refresh token — re-validates user is still active before issuing new token
    fastify.post('/refresh', async (req, reply) => {
      try {
        await req.jwtVerify();
        const payload = req.user as any;

        // Verify user and tenant are still active (prevents deactivated users from refreshing)
        const [row] = await db.withSuperAdmin(async (client) => {
          const r = await client.query(
            `SELECT u.is_active, t.status AS tenant_status
             FROM users u JOIN tenants t ON t.id = u.tenant_id
             WHERE u.id = $1 AND u.tenant_id = $2`,
            [payload.sub, payload.tenantId],
          );
          return r.rows;
        });
        if (!row || !row.is_active || !['active', 'trial'].includes(row.tenant_status)) {
          return reply.code(401).send({ success: false, error: { code: 'ACCOUNT_INACTIVE', message: 'Account is no longer active' } });
        }

        // Revoke the OLD token's JTI before issuing a new one (token rotation)
        if (payload.jti) {
          await revokeToken(redis, payload.jti, payload.exp ?? 0);
        }

        // Issue new token with a fresh JTI
        const newJti   = crypto.randomBytes(16).toString('hex');
        const newToken = await reply.jwtSign({ ...payload, jti: newJti });
        return reply.send({ success: true, data: { token: newToken } });
      } catch {
        return reply.code(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
      }
    });

    // Heartbeat — frontend pings every 30s while a tab is open.
    // Updates users.last_active_at so manager dashboards can show online/idle/offline.
    // Cheap upsert — no logging, no eventBus, just a single UPDATE.
    fastify.post('/heartbeat', async (req, reply) => {
      try {
        await req.jwtVerify();
        const userId = (req.user as any)?.sub;
        const tenantId = (req.user as any)?.tenantId;
        if (!userId || !tenantId) return reply.code(401).send({ success: false });
        await db.withSuperAdmin(async (client) => {
          await client.query(
            `UPDATE users SET last_active_at = NOW() WHERE id = $1 AND tenant_id = $2`,
            [userId, tenantId],
          );
        });
        return reply.send({ success: true });
      } catch {
        return reply.code(401).send({ success: false });
      }
    });

    // Logout — revokes the current token's JTI in Redis
    fastify.post('/logout', async (req, reply) => {
      try {
        await req.jwtVerify();
        const payload = req.user as any;
        if (payload?.jti && payload?.exp) {
          await revokeToken(redis, payload.jti, payload.exp);
        }
      } catch {
        // Even if token is malformed, return success — client is logging out
      }
      return reply.send({ success: true });
    });
  };
}
