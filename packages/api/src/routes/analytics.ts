import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireFeature, requireScope } from '../middlewares/auth.middleware';

export function analyticsRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    const preHandler = [requireFeature('analytics'), requireScope('analytics:read')];

    // Dashboard summary
    fastify.get('/dashboard', { preHandler }, async (req, reply) => {
      const tenantId = req.tenant.id;
      const [stats] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`
          SELECT
            -- CRM
            (SELECT COUNT(*) FROM contacts) AS total_contacts,
            (SELECT COUNT(*) FROM contacts WHERE created_at > NOW() - INTERVAL '30 days') AS new_contacts_30d,
            (SELECT COUNT(*) FROM companies) AS total_companies,
            (SELECT COUNT(*) FROM deals WHERE status = 'open') AS open_deals,
            (SELECT COALESCE(SUM(amount),0)::float8 FROM deals WHERE status = 'open') AS pipeline_value,
            (SELECT COUNT(*) FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '30 days') AS deals_won_30d,
            (SELECT COALESCE(SUM(amount),0)::float8 FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '30 days') AS revenue_30d,
            (SELECT COALESCE(SUM(amount),0)::float8 FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '7 days') AS revenue_7d,
            -- Activities
            (SELECT COUNT(*) FROM activities WHERE status = 'pending' AND due_at < NOW()) AS overdue_tasks,
            (SELECT COUNT(*) FROM activities WHERE status = 'pending' AND due_at::date = CURRENT_DATE) AS due_today,
            -- Voice
            (SELECT COUNT(*) FROM voice_calls WHERE started_at > NOW() - INTERVAL '30 days') AS calls_30d,
            (SELECT COUNT(*) FROM voice_calls WHERE started_at > NOW() - INTERVAL '7 days')  AS calls_7d,
            -- Tickets
            (SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed')) AS open_tickets,
            (SELECT COUNT(*) FROM tickets WHERE status = 'open')                    AS unassigned_tickets,
            (SELECT COUNT(*) FROM tickets WHERE sla_due_at < NOW() AND status NOT IN ('resolved','closed')) AS sla_breached,
            (SELECT COUNT(*) FROM tickets WHERE escalation_level >= 2)             AS escalated_l2,
            (SELECT COUNT(*) FROM tickets WHERE created_at > NOW() - INTERVAL '30 days') AS tickets_30d,
            -- Emails
            (SELECT COUNT(*) FROM emails WHERE status = 'delivered' AND created_at > NOW() - INTERVAL '30 days') AS emails_sent_30d,
            (SELECT COUNT(*) FROM emails WHERE status = 'failed'    AND created_at > NOW() - INTERVAL '30 days') AS emails_failed_30d,
            -- Voice bot
            (SELECT COUNT(*) FROM voice_bot_calls WHERE created_at > NOW() - INTERVAL '30 days') AS bot_calls_30d,
            (SELECT COUNT(*) FROM voice_bot_calls WHERE ticket_id IS NULL AND created_at > NOW() - INTERVAL '30 days') AS bot_untriaged_30d
        `);
        return result.rows;
      });

      // Recent activities feed
      const recentActivity = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`
          SELECT a.id, a.type, a.subject, a.status, a.created_at,
                 c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
                 u.name AS owner_name
          FROM activities a
          LEFT JOIN contacts c ON a.contact_id = c.id
          LEFT JOIN users u ON a.owner_id = u.id
          ORDER BY a.created_at DESC LIMIT 8
        `);
        return r.rows;
      });

      // Recent tickets
      const recentTickets = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`
          SELECT t.id, t.ticket_number, t.subject, t.status, t.priority, t.created_at,
                 u.name AS assignee_name
          FROM tickets t
          LEFT JOIN users u ON t.assignee_id = u.id
          WHERE t.status NOT IN ('resolved','closed')
          ORDER BY
            CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            t.created_at DESC
          LIMIT 5
        `);
        return r.rows;
      });

      return reply.send({ success: true, data: { ...stats, recentActivity, recentTickets } });
    });

    // Revenue over time — always returns every period slot (0 revenue for empty months)
    fastify.get('/revenue', { preHandler }, async (req, reply) => {
      const { period = 'month', months = 12 } = req.query as any;
      const data = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(`
          WITH periods AS (
            SELECT generate_series(
              DATE_TRUNC($1, NOW() - ($2 || ' months')::INTERVAL + INTERVAL '1 month'),
              DATE_TRUNC($1, NOW()),
              ('1 ' || $1)::INTERVAL
            ) AS period
          ),
          actuals AS (
            SELECT
              DATE_TRUNC($1, won_at) AS period,
              COUNT(*)              AS deals_won,
              COALESCE(SUM(amount),0)::float8 AS revenue,
              COUNT(*) FILTER (WHERE status = 'lost') AS deals_lost
            FROM deals
            WHERE won_at > NOW() - ($2 || ' months')::INTERVAL
            GROUP BY 1
          )
          SELECT
            p.period,
            COALESCE(a.deals_won, 0)  AS deals_won,
            COALESCE(a.revenue,   0)  AS revenue,
            COALESCE(a.deals_lost,0)  AS deals_lost
          FROM periods p
          LEFT JOIN actuals a USING (period)
          ORDER BY p.period`,
          [period, months],
        );
        return result.rows;
      });
      return reply.send({ success: true, data });
    });

    // Pipeline funnel
    fastify.get('/funnel/:pipelineId', { preHandler }, async (req, reply) => {
      const { pipelineId } = req.params as { pipelineId: string };
      const data = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(`
          SELECT stage_id, COUNT(*) as count, SUM(amount) as value,
                 AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/86400) as avg_age_days
          FROM deals WHERE pipeline_id = $1 AND status = 'open'
          GROUP BY stage_id`,
          [pipelineId],
        );
        return result.rows;
      });
      return reply.send({ success: true, data });
    });

    // Agent leaderboard
    fastify.get('/leaderboard', { preHandler }, async (req, reply) => {
      const { from, to } = req.query as any;
      const data = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(`
          SELECT u.id, u.name, u.avatar,
            COUNT(d.*) FILTER (WHERE d.status = 'won') as deals_won,
            COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'won'), 0)::float8 as revenue,
            COUNT(a.*) as activities_completed,
            COUNT(vc.*) as calls_made
          FROM users u
          LEFT JOIN deals d ON d.owner_id = u.id AND d.won_at BETWEEN $1 AND $2
          LEFT JOIN activities a ON a.owner_id = u.id AND a.completed_at BETWEEN $1 AND $2
          LEFT JOIN voice_calls vc ON vc.agent_id = u.id AND vc.started_at BETWEEN $1 AND $2
          WHERE u.is_active = true
          GROUP BY u.id, u.name, u.avatar
          ORDER BY revenue DESC`,
          [from ?? new Date(Date.now() - 30 * 86_400_000), to ?? new Date()],
        );
        return result.rows;
      });
      return reply.send({ success: true, data });
    });

    // Contact source breakdown
    fastify.get('/contact-sources', { preHandler }, async (req, reply) => {
      const data = await db.withTenant(req.tenant.id, async (client) => {
        const result = await client.query(`
          SELECT source, COUNT(*) as count,
                 COUNT(*) FILTER (WHERE status = 'customer') as converted
          FROM contacts
          GROUP BY source ORDER BY count DESC`);
        return result.rows;
      });
      return reply.send({ success: true, data });
    });
    // ── Backward-compat aliases ──────────────────────────────────────────
    // /overview → same data as /dashboard
    fastify.get('/overview', { preHandler }, async (req, reply) => {
      return reply.redirect('/api/v1/analytics/dashboard');
    });

    // ── Operational Dashboard (role-aware) ───────────────────────────────
    // Agent  → personal call + ticket metrics for today
    // Manager/Admin → team-level aggregates + per-agent breakdown
    fastify.get('/ops-dashboard', { preHandler }, async (req, reply) => {
      const tenantId   = req.tenant.id;
      const userId     = (req as any).user?.id as string;
      const role       = (req as any).user?.role as string ?? 'agent';
      const rawDept    = (req as any).user?.department as string | null ?? null;
      const isManager  = ['manager','tenant_admin','super_admin'].includes(role);

      // Map user department → ticket_type value used in DB.
      // NULL department = no filter (all ticket types).
      // Strict allowlist — reject any department value not in this map.
      // This prevents a tampered JWT department claim from reaching SQL.
      const DEPT_TO_TYPE: Record<string, string> = {
        sales:       'sales',
        support:     'support',
        complaints:  'complaint',
        complaint:   'complaint',
      };
      const deptType: string | null = rawDept ? (DEPT_TO_TYPE[rawDept.toLowerCase()] ?? null) : null;

      // Parameterised helpers — callers append deptParam to their params array
      // and include the placeholder text in their SQL when deptType is set.
      // NEVER interpolate deptType directly into SQL strings.
      const deptParam             = deptType ? [deptType] : [];           // [] or [value]
      const hasDept               = deptType !== null;
      // These SQL fragments use $DEPT_PH as a placeholder; callers replace
      // $DEPT_PH with the actual positional $N once they know their param count.
      const deptTicketFilter      = hasDept ? `AND COALESCE(ticket_type,'support') = $DEPT_PH` : '';
      const deptTicketFilterT     = hasDept ? `AND COALESCE(t.ticket_type,'support') = $DEPT_PH` : '';
      const deptBotFilter         = hasDept ? `AND LOWER(COALESCE(extracted_category,'')) = $DEPT_PH` : '';

      /** Replace the $DEPT_PH placeholder with the correct positional param index */
      const resolveDept = (sql: string, baseParams: any[]): [string, any[]] => {
        if (!hasDept) return [sql, baseParams];
        const idx = baseParams.length + 1;
        return [sql.replace(/\$DEPT_PH/g, `$${idx}`), [...baseParams, deptType!]];
      };

      // NOTE: db.withTenant sets RLS context — no need for tenant_id in params.
      // Agent queries use $1 = userId; manager queries have no params.

      // ── Ticket type breakdown ────────────────────────────────────────────
      // Agent: tickets assigned to OR created by the agent
      // Manager: all tenant tickets
      const ticketBreakdown = await db.withTenant(tenantId, async (client) => {
        const agentFilter = isManager ? '' : 'AND (assignee_id = $1 OR created_by = $1)';
        const baseParams: any[] = isManager ? [] : [userId];
        const [sql, params] = resolveDept(`
          SELECT
            COALESCE(ticket_type,'support')                 AS ticket_type,
            COUNT(*)                                        AS total,
            COUNT(*) FILTER (WHERE status = 'open')        AS open,
            COUNT(*) FILTER (WHERE status = 'assigned')    AS assigned,
            COUNT(*) FILTER (WHERE status IN ('accepted','in_progress')) AS in_progress,
            COUNT(*) FILTER (WHERE status = 'pending')     AS pending,
            COUNT(*) FILTER (WHERE status = 'resolved')    AS resolved,
            COUNT(*) FILTER (WHERE status = 'closed')      AS closed
          FROM tickets
          WHERE 1=1 ${agentFilter} ${deptTicketFilter}
          GROUP BY ticket_type
          ORDER BY total DESC
        `, baseParams);
        const r = await client.query(sql, params);
        return r.rows;
      });

      // ── Call stats (agent's own calls only) ──────────────────────────────
      const callStats = await db.withTenant(tenantId, async (client) => {
        const agentFilter = isManager ? '' : 'AND agent_id = $1';
        const params: any[] = isManager ? [] : [userId];
        const r = await client.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'completed')                          AS completed_calls,
            COUNT(*) FILTER (WHERE status IN ('queued','ringing','in_progress'))  AS calls_in_queue,
            COUNT(*) FILTER (WHERE status = 'no_answer' OR status = 'missed')     AS dropped_calls,
            COUNT(*) FILTER (WHERE started_at::date = CURRENT_DATE)               AS calls_today,
            COUNT(*) FILTER (WHERE started_at::date = CURRENT_DATE AND status='completed') AS completed_today,
            COUNT(*) FILTER (WHERE started_at::date = CURRENT_DATE AND (status='no_answer' OR status='missed')) AS dropped_today,
            ROUND(AVG(duration) FILTER (WHERE status='completed' AND duration > 0))::int  AS avg_duration_seconds,
            ROUND(AVG(duration) FILTER (WHERE status='completed' AND started_at::date = CURRENT_DATE))::int AS avg_duration_today,
            COUNT(*) FILTER (WHERE bot_handled = true AND started_at::date = CURRENT_DATE) AS bot_calls_today
          FROM voice_calls
          WHERE 1=1 ${agentFilter}
        `, params);
        return r.rows[0] ?? {};
      });

      // ── Ticket summary totals ────────────────────────────────────────────
      // Agent: tickets assigned to OR created by the agent
      const myTickets = await db.withTenant(tenantId, async (client) => {
        const agentFilter = isManager ? '' : 'AND (assignee_id = $1 OR created_by = $1)';
        const baseParams: any[] = isManager ? [] : [userId];
        const [sql1, params1] = resolveDept(`
          SELECT
            COUNT(*)                                                              AS total,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))          AS active,
            COUNT(*) FILTER (WHERE status = 'open')                              AS open,
            COUNT(*) FILTER (WHERE status IN ('accepted','in_progress'))         AS in_progress,
            COUNT(*) FILTER (WHERE status = 'pending')                           AS pending,
            COUNT(*) FILTER (WHERE status = 'resolved' AND updated_at::date = CURRENT_DATE) AS resolved_today,
            COUNT(*) FILTER (WHERE sla_due_at < NOW() AND status NOT IN ('resolved','closed')) AS sla_breached
          FROM tickets
          WHERE 1=1 ${agentFilter} ${deptTicketFilter}
        `, baseParams);
        const r = await client.query(sql1, params1);

        // For agents: break down assigned-to-me vs created-by-me
        let ownership = { assigned_to_me: 0, created_by_me: 0 };
        if (!isManager) {
          const [sql2, params2] = resolveDept(`
            SELECT
              COUNT(*) FILTER (WHERE assignee_id = $1 AND status NOT IN ('resolved','closed')) AS assigned_to_me,
              COUNT(*) FILTER (WHERE created_by  = $1)                                          AS created_by_me
            FROM tickets
            WHERE (assignee_id = $1 OR created_by = $1) ${deptTicketFilter}
          `, [userId]);
          const o = await client.query(sql2, params2);
          ownership = o.rows[0] ?? ownership;
        }

        return { ...r.rows[0], ...ownership };
      });

      // ── Sentiment / ratings ──────────────────────────────────────────────
      const sentiment = await db.withTenant(tenantId, async (client) => {
        const agentFilter = isManager ? '' : 'AND agent_id = $1';
        const params: any[] = isManager ? [] : [userId];
        const r = await client.query(`
          SELECT
            ROUND(AVG((sentiment->>'score')::numeric) FILTER (WHERE sentiment IS NOT NULL))::int AS avg_sentiment,
            COUNT(*) FILTER (WHERE (sentiment->>'label') = 'positive')  AS positive_calls,
            COUNT(*) FILTER (WHERE (sentiment->>'label') = 'negative')  AS negative_calls,
            COUNT(*) FILTER (WHERE (sentiment->>'label') = 'neutral')   AS neutral_calls
          FROM voice_calls
          WHERE status = 'completed' ${agentFilter}
        `, params);

        let avgRating = null;
        try {
          const assigneeJoin = isManager ? '' : 'JOIN tickets t2 ON tr.ticket_id = t2.id AND t2.assignee_id = $1';
          const ratingParams: any[] = isManager ? [] : [userId];
          const rr = await client.query(`
            SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                   COUNT(*) AS total_ratings
            FROM ticket_ratings tr
            ${assigneeJoin}
          `, ratingParams);
          avgRating = rr.rows[0] ?? null;
        } catch (_) { /* table may not exist */ }

        return { ...r.rows[0], ...avgRating };
      });

      // ── Recent tickets (agent scope) ─────────────────────────────────────
      const recentTickets = !isManager ? await db.withTenant(tenantId, async (client) => {
        const [sql, params] = resolveDept(`
          SELECT t.id, t.ticket_number, t.subject, t.status, t.priority,
                 t.ticket_type, t.created_at, t.sla_due_at, t.assignee_id,
                 u.name  AS assignee_name,
                 cb.name AS created_by_name,
                 CASE WHEN t.assignee_id = $1 THEN 'assigned' ELSE 'created' END AS my_role
          FROM tickets t
          LEFT JOIN users u  ON t.assignee_id = u.id
          LEFT JOIN users cb ON t.created_by  = cb.id
          WHERE t.status NOT IN ('resolved','closed')
            AND (t.assignee_id = $1 OR t.created_by = $1)
            ${deptTicketFilter}
          ORDER BY
            CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            t.created_at DESC
          LIMIT 10
        `, [userId]);
        const r = await client.query(sql, params);
        return r.rows;
      }) : [];

      // ── CRM Activities (agent only) ───────────────────────────────────────
      const activityStats = !isManager ? await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`
          SELECT
            COUNT(*)                                                             AS total,
            COUNT(*) FILTER (WHERE status = 'pending')                          AS pending,
            COUNT(*) FILTER (WHERE status = 'completed')                        AS completed,
            COUNT(*) FILTER (WHERE status = 'pending' AND due_at < NOW())       AS overdue,
            COUNT(*) FILTER (WHERE status = 'pending' AND due_at::date = CURRENT_DATE) AS due_today,
            COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)             AS created_today,
            COUNT(*) FILTER (WHERE type = 'call')                               AS calls,
            COUNT(*) FILTER (WHERE type = 'email')                              AS emails,
            COUNT(*) FILTER (WHERE type = 'meeting')                            AS meetings,
            COUNT(*) FILTER (WHERE type = 'task')                               AS tasks,
            COUNT(*) FILTER (WHERE type = 'note')                               AS notes
          FROM activities
          WHERE owner_id = $1
        `, [userId]);
        return r.rows[0] ?? {};
      }) : {};

      const recentActivities = !isManager ? await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`
          SELECT a.id, a.type, a.subject, a.status, a.due_at, a.created_at,
                 c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name
          FROM activities a
          LEFT JOIN contacts c ON a.contact_id = c.id
          WHERE a.owner_id = $1
          ORDER BY a.created_at DESC LIMIT 8
        `, [userId]);
        return r.rows;
      }) : [];

      // ════════════════════════════════════════════════════════════════════
      // MANAGER-ONLY BLOCKS
      // ════════════════════════════════════════════════════════════════════

      // ── Bot stats (voice_bot_calls) ───────────────────────────────────────
      const botStats = isManager ? await db.withTenant(tenantId, async (client) => {
        const [botSql, botParams] = resolveDept(`
          SELECT
            COUNT(*)                                                              AS total_calls,
            COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)              AS calls_today,
            COUNT(*) FILTER (WHERE status = 'completed')                         AS completed,
            COUNT(*) FILTER (WHERE status IN ('failed','no_answer'))             AS failed,
            ROUND(AVG(duration_seconds) FILTER (WHERE status='completed'))::int  AS avg_duration_secs,
            COUNT(*) FILTER (WHERE ticket_id IS NOT NULL)                        AS tickets_created,
            COUNT(*) FILTER (WHERE ticket_id IS NULL AND status='completed')     AS untriaged,
            COUNT(*) FILTER (WHERE sentiment = 'positive')                       AS positive,
            COUNT(*) FILTER (WHERE sentiment = 'neutral')                        AS neutral,
            COUNT(*) FILTER (WHERE sentiment = 'negative')                       AS negative,
            COUNT(*) FILTER (WHERE sentiment = 'urgent')                         AS urgent,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')      AS calls_7d,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')     AS calls_30d
          FROM voice_bot_calls
          WHERE 1=1 ${deptBotFilter}
        `, []);
        const r = await client.query(botSql, botParams);

        // Category breakdown from bot calls
        const [catSql, catParams] = resolveDept(`
          SELECT
            COALESCE(extracted_category, 'uncategorised') AS category,
            COUNT(*)                                       AS total,
            COUNT(*) FILTER (WHERE ticket_id IS NOT NULL) AS with_ticket
          FROM voice_bot_calls
          WHERE 1=1 ${deptBotFilter}
          GROUP BY category ORDER BY total DESC LIMIT 6
        `, []);
        const cats = await client.query(catSql, catParams);

        // Bot config (is a bot active?)
        const cfg = await client.query(`
          SELECT provider, is_active, phone_number, assistant_id
          FROM voice_bot_configs
          ORDER BY created_at DESC LIMIT 1
        `);

        return { ...r.rows[0], categories: cats.rows, config: cfg.rows[0] ?? null };
      }) : null;

      // ── Human agent stats ─────────────────────────────────────────────────
      const humanStats = isManager ? await db.withTenant(tenantId, async (client) => {
        // Team-wide human call totals
        const calls = await client.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'completed')                         AS completed_calls,
            COUNT(*) FILTER (WHERE status IN ('queued','ringing','in_progress')) AS calls_in_queue,
            COUNT(*) FILTER (WHERE status IN ('no_answer','missed'))             AS dropped_calls,
            COUNT(*) FILTER (WHERE started_at::date = CURRENT_DATE)              AS calls_today,
            COUNT(*) FILTER (WHERE started_at::date = CURRENT_DATE AND status='completed') AS completed_today,
            ROUND(AVG(duration) FILTER (WHERE status='completed' AND duration>0))::int AS avg_duration_secs,
            COUNT(*) FILTER (WHERE bot_handled = false)                          AS manual_calls
          FROM voice_calls
        `);

        // Team ticket totals — filtered by department when set
        const [tktSql, tktParams] = resolveDept(`
          SELECT
            COUNT(*)                                                             AS total,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))         AS active,
            COUNT(*) FILTER (WHERE status = 'open')                             AS open,
            COUNT(*) FILTER (WHERE status IN ('accepted','in_progress'))        AS in_progress,
            COUNT(*) FILTER (WHERE status = 'resolved' AND updated_at::date = CURRENT_DATE) AS resolved_today,
            COUNT(*) FILTER (WHERE sla_due_at < NOW() AND status NOT IN ('resolved','closed')) AS sla_breached,
            COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)             AS created_today,
            COUNT(*) FILTER (WHERE COALESCE(ticket_type,'support') = 'sales')      AS sales_tickets,
            COUNT(*) FILTER (WHERE COALESCE(ticket_type,'support') = 'support')    AS support_tickets,
            COUNT(*) FILTER (WHERE COALESCE(ticket_type,'support') = 'complaint')  AS complaint_tickets
          FROM tickets
          WHERE 1=1 ${deptTicketFilter}
        `, []);
        const tickets = await client.query(tktSql, tktParams);

        // Team activity totals
        const acts = await client.query(`
          SELECT
            COUNT(*)                                                             AS total,
            COUNT(*) FILTER (WHERE status = 'completed')                        AS completed,
            COUNT(*) FILTER (WHERE status = 'pending' AND due_at < NOW())       AS overdue,
            COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)             AS created_today,
            COUNT(*) FILTER (WHERE type = 'call')    AS act_calls,
            COUNT(*) FILTER (WHERE type = 'email')   AS act_emails,
            COUNT(*) FILTER (WHERE type = 'meeting') AS act_meetings,
            COUNT(*) FILTER (WHERE type = 'task')    AS act_tasks
          FROM activities
        `);

        // Per-agent leaderboard — ticket join respects department filter
        const [lbSql, lbParams] = resolveDept(`
          SELECT
            u.id, u.name, u.role, u.email, u.is_active,
            COUNT(DISTINCT t.id)                                                         AS tickets_assigned,
            COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('accepted','in_progress'))   AS tickets_active,
            COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'resolved')                   AS tickets_resolved,
            COUNT(DISTINCT t.id) FILTER (WHERE t.sla_due_at < NOW()
              AND t.status NOT IN ('resolved','closed'))                                  AS sla_breached,
            COUNT(DISTINCT vc.id) FILTER (WHERE vc.status = 'completed')                AS calls_completed,
            COUNT(DISTINCT vc.id) FILTER (WHERE vc.started_at::date = CURRENT_DATE)     AS calls_today,
            ROUND(AVG(vc.duration) FILTER (WHERE vc.status='completed'))::int            AS avg_call_duration,
            ROUND(AVG((vc.sentiment->>'score')::numeric)
              FILTER (WHERE vc.sentiment IS NOT NULL))::int                              AS avg_sentiment,
            COUNT(DISTINCT a.id)                                                         AS activities_total,
            COUNT(DISTINCT a.id) FILTER (WHERE a.created_at::date = CURRENT_DATE)       AS activities_today
          FROM users u
          LEFT JOIN tickets    t  ON t.assignee_id = u.id ${deptTicketFilterT}
          LEFT JOIN voice_calls vc ON vc.agent_id  = u.id
          LEFT JOIN activities  a  ON a.owner_id   = u.id
          WHERE u.tenant_id = $1
            AND u.role IN ('agent','manager')
          GROUP BY u.id, u.name, u.role, u.email, u.is_active
          ORDER BY calls_today DESC, tickets_active DESC
        `, [tenantId]);
        const agents = await client.query(lbSql, lbParams);

        // Recent open tickets — department-scoped
        const [recSql, recParams] = resolveDept(`
          SELECT t.id, t.ticket_number, t.subject, t.status, t.priority,
                 t.ticket_type, t.created_at, t.sla_due_at,
                 u.name AS assignee_name
          FROM tickets t
          LEFT JOIN users u ON t.assignee_id = u.id
          WHERE t.status NOT IN ('resolved','closed')
            ${deptTicketFilter}
          ORDER BY
            CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            t.created_at DESC
          LIMIT 8
        `, []);
        const recentT = await client.query(recSql, recParams);

        return {
          calls:         calls.rows[0]  ?? {},
          tickets:       tickets.rows[0] ?? {},
          activities:    acts.rows[0]   ?? {},
          agentLeaderboard: agents.rows,
          recentTickets: recentT.rows,
        };
      }) : null;

      // ════════════════════════════════════════════════════════════════════
      // TENANT ADMIN BLOCK
      // ════════════════════════════════════════════════════════════════════
      const isTenantAdmin = role === 'tenant_admin';
      const tenantAdminStats = isTenantAdmin ? await db.withTenant(tenantId, async (client) => {
        // User stats (users table has no RLS — filter by tenant_id)
        const users = await client.query(`
          SELECT
            COUNT(*)                                              AS total,
            COUNT(*) FILTER (WHERE is_active = true)             AS active,
            COUNT(*) FILTER (WHERE is_active = false)            AS inactive,
            COUNT(*) FILTER (WHERE role = 'tenant_admin')        AS admins,
            COUNT(*) FILTER (WHERE role = 'manager')             AS managers,
            COUNT(*) FILTER (WHERE role = 'agent')               AS agents,
            COUNT(*) FILTER (WHERE role = 'viewer')              AS viewers,
            COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours') AS active_today,
            COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '7 days')   AS active_7d,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')     AS new_30d,
            -- department breakdown
            COUNT(*) FILTER (WHERE department = 'sales')         AS dept_sales,
            COUNT(*) FILTER (WHERE department = 'support')       AS dept_support,
            COUNT(*) FILTER (WHERE department = 'complaints')    AS dept_complaints,
            COUNT(*) FILTER (WHERE department IS NULL)           AS dept_unassigned
          FROM users WHERE tenant_id = $1
        `, [tenantId]);

        // Recent users list — include department for badge display
        const recentUsers = await client.query(`
          SELECT id, name, email, role, department, is_active, last_login_at, created_at
          FROM users
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 20
        `, [tenantId]);

        // Voice bot health
        const botHealth = await client.query(`
          SELECT
            vbc.provider, vbc.is_active, vbc.phone_number, vbc.assistant_id,
            vbc.auto_create_ticket, vbc.updated_at,
            (SELECT COUNT(*) FROM voice_bot_calls v WHERE v.tenant_id = $1) AS total_calls,
            (SELECT COUNT(*) FROM voice_bot_calls v WHERE v.tenant_id = $1
               AND v.created_at > NOW() - INTERVAL '24 hours') AS calls_24h,
            (SELECT COUNT(*) FROM voice_bot_calls v WHERE v.tenant_id = $1
               AND v.status = 'failed') AS failed_calls
          FROM voice_bot_configs vbc
          WHERE vbc.tenant_id = $1
          LIMIT 1
        `, [tenantId]);

        // Email health
        const emailHealth = await client.query(`
          SELECT
            COUNT(*)                                                                   AS total,
            COUNT(*) FILTER (WHERE status = 'delivered')                              AS delivered,
            COUNT(*) FILTER (WHERE status = 'failed')                                 AS failed,
            COUNT(*) FILTER (WHERE status = 'pending')                                AS queued,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')         AS last_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'
              AND status = 'delivered')                                               AS delivered_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'
              AND status = 'failed')                                                  AS failed_24h
          FROM emails
        `);

        return {
          users:       users.rows[0]        ?? {},
          recentUsers: recentUsers.rows,
          botHealth:   botHealth.rows[0]    ?? null,
          emailHealth: emailHealth.rows[0]  ?? {},
        };
      }) : null;

      return reply.send({
        success: true,
        data: {
          role,
          isManager,
          isTenantAdmin,
          department:    rawDept,
          departmentType: deptType,
          // Agent blocks
          ticketBreakdown,
          callStats,
          myTickets,
          sentiment,
          recentTickets,
          activityStats,
          recentActivities,
          // Manager blocks
          botStats,
          humanStats,
          // Tenant admin block
          tenantAdminStats,
        },
      });
    });

  };
}
