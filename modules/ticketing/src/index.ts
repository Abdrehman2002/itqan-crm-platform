/**
 * Ticketing Platform Module
 *
 * Responsibilities:
 *  - Runs the SLA background worker (every 5 minutes)
 *  - Declares navItems for the dynamic sidebar
 *
 * Routes are registered directly in server.ts via ticketRoutes() to keep
 * the import graph clean (module → core only, not module → api routes).
 */

import type { FastifyInstance } from 'fastify';
import type { PlatformModule, ModuleContext } from '@crm/shared';
import { logger, EmailService } from '@crm/core';

const SLA_WORKER_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

// ── Inline SLA worker (no circular deps) ──────────────────────────────────
async function runSlaWorker(ctx: ModuleContext): Promise<void> {
  const { db, eventBus } = ctx;
  const emailSvc = new EmailService(db);
  try {
    const activeTickets = await db.withSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT
           t.id, t.tenant_id, t.ticket_number, t.subject,
           t.assignee_id, t.accepted_at, t.sla_due_at,
           t.escalation_level, t.reminder_sent_at,
           t.escalated_l1_at, t.escalated_l2_at,
           s.reminder_pct,
           s.l1_escalation_pct,
           s.l2_escalation_pct
         FROM tickets t
         LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
         WHERE t.accepted_at IS NOT NULL
           AND t.status NOT IN ('resolved','closed')
           AND t.sla_due_at IS NOT NULL`,
      );
      return r.rows;
    });

    for (const ticket of activeTickets) {
      const now        = Date.now();
      const acceptedMs = new Date(ticket.accepted_at).getTime();
      const dueMs      = new Date(ticket.sla_due_at).getTime();
      const totalMs    = dueMs - acceptedMs;
      const elapsedMs  = now - acceptedMs;
      const pct        = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;

      const reminderPct = ticket.reminder_pct      ?? 80;
      const l1Pct       = ticket.l1_escalation_pct ?? 100;
      const l2Pct       = ticket.l2_escalation_pct ?? 150;

      // ── Reminder ────────────────────────────────────────────────────
      if (pct >= reminderPct && !ticket.reminder_sent_at && ticket.assignee_id) {
        const remMins = Math.round((dueMs - now) / 60_000);
        await db.withSuperAdmin(async (c) => {
          await c.query(`UPDATE tickets SET reminder_sent_at = NOW() WHERE id = $1`, [ticket.id]);
          await c.query(
            `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
             VALUES ($1,$2,'sla_reminder',$3,$4,'ticket',$5)`,
            [ticket.tenant_id, ticket.assignee_id,
             `⏰ SLA reminder: ${ticket.ticket_number}`,
             `"${ticket.subject}" — ${remMins > 0 ? `${remMins}m remaining` : 'SLA due soon'}.`,
             ticket.id],
          );
        });
        await eventBus.publish(ticket.tenant_id, 'ticket.sla_reminder', { ticketId: ticket.id });
        logger.info(`SLA reminder sent for ticket ${ticket.ticket_number}`);
      }

      // ── L1 Escalation (breach) ───────────────────────────────────────
      if (pct >= l1Pct && ticket.escalation_level < 1 && !ticket.escalated_l1_at) {
        const managers = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('manager','tenant_admin') AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });

        const notifyIds = [...(ticket.assignee_id ? [ticket.assignee_id] : []), ...managers]
          .filter((v, i, a) => a.indexOf(v) === i);

        const overMins = Math.round((now - dueMs) / 60_000);
        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET escalation_level = 1, escalated_l1_at = NOW() WHERE id = $1`,
            [ticket.id],
          );
          await c.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1,$2,1,'sla_breach',$3)`,
            [ticket.tenant_id, ticket.id, notifyIds],
          );
          for (const uid of notifyIds) {
            await c.query(
              `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
               VALUES ($1,$2,'sla_breach',$3,$4,'ticket',$5)`,
              [ticket.tenant_id, uid,
               `🚨 SLA breached: ${ticket.ticket_number}`,
               `"${ticket.subject}" is ${overMins}m past the SLA deadline.`,
               ticket.id],
            );
          }
        });
        // Email all notified users
        const l1Users = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT email, name FROM users WHERE id = ANY($1) AND email IS NOT NULL`,
            [notifyIds],
          );
          return r.rows as { email: string; name: string }[];
        });
        for (const u of l1Users) {
          emailSvc.send(ticket.tenant_id, {
            to: u.email,
            toName: u.name,
            subject: `⚠️ SLA Breached: Ticket ${ticket.ticket_number}`,
            bodyHtml: `<p>Hi ${u.name},</p>
<p>Ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" has breached its SLA deadline by <strong>${overMins} minutes</strong>.</p>
<p>Please take immediate action to resolve or escalate this ticket.</p>`,
            bodyText: `Hi ${u.name},\n\nTicket ${ticket.ticket_number} ("${ticket.subject}") has breached SLA by ${overMins} minutes.\n\nPlease take immediate action.`,
            ticketId: ticket.id,
          }).catch(() => { /* non-fatal */ });
        }

        await eventBus.publish(ticket.tenant_id, 'ticket.sla_breach', { ticketId: ticket.id, level: 1 });
        logger.warn(`SLA L1 escalation for ticket ${ticket.ticket_number}`);
      }

      // ── L2 Escalation (hard) ─────────────────────────────────────────
      if (pct >= l2Pct && ticket.escalation_level < 2 && !ticket.escalated_l2_at) {
        const admins = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('tenant_admin','super_admin') AND is_active = true`,
            [ticket.tenant_id],
          );
          return r.rows.map((u: any) => u.id as string);
        });

        const overMins = Math.round((now - dueMs) / 60_000);
        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET escalation_level = 2, escalated_l2_at = NOW() WHERE id = $1`,
            [ticket.id],
          );
          await c.query(
            `INSERT INTO ticket_escalations (tenant_id, ticket_id, escalation_level, reason, notified_users)
             VALUES ($1,$2,2,'timeout_l2',$3)`,
            [ticket.tenant_id, ticket.id, admins],
          );
          for (const uid of admins) {
            await c.query(
              `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
               VALUES ($1,$2,'sla_escalated',$3,$4,'ticket',$5)`,
              [ticket.tenant_id, uid,
               `🔴 Critical: ${ticket.ticket_number} escalated to you`,
               `"${ticket.subject}" is ${overMins}m past SLA. Escalated to highest authority.`,
               ticket.id],
            );
          }
        });
        // Email all admins
        const adminUsers = await db.withSuperAdmin(async (c) => {
          const r = await c.query(
            `SELECT email, name FROM users WHERE id = ANY($1) AND email IS NOT NULL`,
            [admins],
          );
          return r.rows as { email: string; name: string }[];
        });
        for (const u of adminUsers) {
          emailSvc.send(ticket.tenant_id, {
            to: u.email,
            toName: u.name,
            subject: `🔴 CRITICAL — SLA L2 Escalation: ${ticket.ticket_number}`,
            bodyHtml: `<p>Hi ${u.name},</p>
<p>Ticket <strong>${ticket.ticket_number}</strong> — "<em>${ticket.subject}</em>" has been escalated to you as the highest authority after being <strong>${overMins} minutes past SLA</strong>.</p>
<p>Immediate intervention is required.</p>`,
            bodyText: `Hi ${u.name},\n\nCRITICAL: Ticket ${ticket.ticket_number} ("${ticket.subject}") is ${overMins} minutes past SLA and has been escalated to you.\n\nImmediate action required.`,
            ticketId: ticket.id,
          }).catch(() => { /* non-fatal */ });
        }

        await eventBus.publish(ticket.tenant_id, 'ticket.escalated', { ticketId: ticket.id, level: 2 });
        logger.error(`SLA L2 escalation for ticket ${ticket.ticket_number}`);
      }
    }
  } catch (err: any) {
    logger.error('[SLA Worker]', { error: err.message });
  }
}

// ── Platform Module ────────────────────────────────────────────────────────
export class TicketingPlatformModule implements PlatformModule {
  readonly id = 'ticketing';
  readonly label = 'Ticketing';
  readonly icon = 'LifeBuoy';
  readonly requiredPlan = 'starter' as const;

  readonly navItems = [
    { path: '/tickets',        label: 'Tickets',       icon: 'LifeBuoy' },
    { path: '/tickets/queues', label: 'Queues',        icon: 'List'     },
    { path: '/tickets/sla',    label: 'SLA Policies',  icon: 'Clock'    },
  ];

  private slaHandle?: ReturnType<typeof setInterval>;

  async onLoad(ctx: ModuleContext): Promise<void> {
    this.slaHandle = setInterval(() => runSlaWorker(ctx), SLA_WORKER_INTERVAL_MS);
    // Run once immediately to catch any SLAs that fired while server was down
    setImmediate(() => runSlaWorker(ctx));
    logger.info(`Ticketing module loaded — SLA worker every ${SLA_WORKER_INTERVAL_MS / 1000}s`);
  }

  async onUnload(): Promise<void> {
    if (this.slaHandle) { clearInterval(this.slaHandle); this.slaHandle = undefined; }
    logger.info('Ticketing module unloaded');
  }

  // Routes are registered directly in server.ts — nothing to do here
  async registerRoutes(_fastify: FastifyInstance, _prefix: string): Promise<void> {}
}
