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
import * as sla from '../../../packages/api/src/lib/sla';

const SLA_WORKER_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

// ── Inline SLA worker — business-hours + pause-aware + multi-step ─────────
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
           t.sla_paused_at, t.sla_paused_total_ms, t.sla_reminders_sent,
           s.reminder_pct,
           s.l1_escalation_pct,
           s.l2_escalation_pct,
           s.resolution_hours,
           s.business_hours_only,
           s.business_hours_schedule,
           s.pause_on_pending,
           s.reminder_schedule,
           tn.settings->>'timezone' AS tenant_tz
         FROM tickets t
         LEFT JOIN sla_policies s ON t.sla_policy_id = s.id
         LEFT JOIN tenants     tn ON tn.id = t.tenant_id
         WHERE t.accepted_at IS NOT NULL
           AND t.status NOT IN ('resolved','closed')
           AND t.sla_due_at IS NOT NULL`,
      );
      return r.rows;
    });

    for (const ticket of activeTickets) {
      const now    = Date.now();
      const dueMs  = new Date(ticket.sla_due_at).getTime();
      const tz     = (ticket.tenant_tz as string) || 'UTC';

      // Business-hours + pause-aware elapsed percentage.
      // Falls back to straight wall-clock if the policy hasn't been
      // populated with business hours config (24/7 mode).
      const pct = ticket.resolution_hours
        ? sla.computeElapsedPct(
            {
              accepted_at:         ticket.accepted_at,
              sla_paused_at:       ticket.sla_paused_at,
              sla_paused_total_ms: ticket.sla_paused_total_ms,
            },
            {
              resolution_hours:        ticket.resolution_hours,
              business_hours_only:     ticket.business_hours_only,
              business_hours_schedule: ticket.business_hours_schedule,
              pause_on_pending:        ticket.pause_on_pending,
            },
            tz,
            now,
          )
        : 0;

      const reminderPct = ticket.reminder_pct      ?? 80;
      const l1Pct       = ticket.l1_escalation_pct ?? 100;
      const l2Pct       = ticket.l2_escalation_pct ?? 150;

      // ── Multi-step reminder schedule ─────────────────────────────────
      // If the policy has a configured reminder_schedule (jsonb array),
      // iterate each step and fire any that hit their pct threshold but
      // haven't been sent yet (tracked in tickets.sla_reminders_sent map).
      const schedule: Array<{
        id: string; pct: number; level: string; label: string; notifyTarget: string;
      }> = Array.isArray(ticket.reminder_schedule) ? ticket.reminder_schedule : [];
      const sentMap: Record<string, boolean> = ticket.sla_reminders_sent ?? {};

      for (const step of schedule) {
        if (pct < step.pct || sentMap[step.id]) continue;

        // Resolve who to notify based on the step's notifyTarget enum
        let notifyIds: string[] = [];
        if ((step.notifyTarget === 'assignee' || step.notifyTarget === 'all') && ticket.assignee_id) {
          notifyIds.push(ticket.assignee_id);
        }
        if (step.notifyTarget === 'managers' || step.notifyTarget === 'all') {
          const mgrs = await db.withSuperAdmin(async (c) => {
            const r = await c.query(
              `SELECT id FROM users WHERE tenant_id=$1 AND role IN ('manager','tenant_admin') AND is_active=true`,
              [ticket.tenant_id],
            );
            return r.rows.map((u: any) => u.id as string);
          });
          notifyIds.push(...mgrs);
        }
        if (step.notifyTarget === 'admins' || step.notifyTarget === 'all') {
          const adms = await db.withSuperAdmin(async (c) => {
            const r = await c.query(
              `SELECT id FROM users WHERE tenant_id=$1 AND role='tenant_admin' AND is_active=true`,
              [ticket.tenant_id],
            );
            return r.rows.map((u: any) => u.id as string);
          });
          notifyIds.push(...adms);
        }
        notifyIds = [...new Set(notifyIds)];

        // Mark sent, write notification rows, publish event
        sentMap[step.id] = true;
        await db.withSuperAdmin(async (c) => {
          await c.query(
            `UPDATE tickets SET sla_reminders_sent = $1::jsonb WHERE id = $2`,
            [JSON.stringify(sentMap), ticket.id],
          );
          for (const uid of notifyIds) {
            await c.query(
              `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
               VALUES ($1,$2,'sla_reminder',$3,$4,'ticket',$5)`,
              [ticket.tenant_id, uid,
               `SLA ${step.label}: ${ticket.ticket_number}`,
               `"${ticket.subject}" — reached ${Math.round(pct)}% of SLA budget (step "${step.label}").`,
               ticket.id],
            );
          }
        });
        await eventBus.publish(ticket.tenant_id, 'ticket.sla_reminder', {
          ticketId: ticket.id, stepId: step.id, level: step.level,
        });
        logger.info(`SLA reminder ${step.id} fired on ${ticket.ticket_number}`);
      }

      // Legacy single-reminder fallback for policies without a schedule.
      // Skip if any step in the schedule has already fired (multi-step path used).
      const legacyMode = schedule.length === 0;

      // ── Legacy single reminder (only if no multi-step schedule) ─────
      if (legacyMode && pct >= reminderPct && !ticket.reminder_sent_at && ticket.assignee_id) {
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

      // ── L1 Escalation (breach) — always runs regardless of schedule ──
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
    // permissionKey — see CRM module for rationale.
    // SLA Policies is governance-only (policy_admin + tenant_admin); Queues
    // are for managers configuring routing.
    { path: '/tickets',        label: 'Tickets',       icon: 'LifeBuoy', permissionKey: 'tickets:read'   },
    { path: '/tickets/queues', label: 'Queues',        icon: 'List',     permissionKey: 'tickets:assign' },
    { path: '/tickets/sla',    label: 'SLA Policies',  icon: 'Clock',    permissionKey: 'sla:edit'       },
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
