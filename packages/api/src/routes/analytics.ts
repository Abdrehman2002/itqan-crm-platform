import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@crm/core';
import { requireFeature, requireScope, requireRole } from '../middlewares/auth.middleware';

export function analyticsRoutes(db: DatabaseClient) {
  return async function (fastify: FastifyInstance) {
    const preHandler = [requireFeature('analytics'), requireScope('analytics:read')];

    // Dashboard summary
    fastify.get('/dashboard', { preHandler }, async (req, reply) => {
      const tenantId  = req.tenant.id;
      const userId    = req.user.sub;
      const userRole  = req.user.role as string;
      const isAdmin   = ['tenant_admin', 'super_admin'].includes(userRole);

      // Resolve the set of user IDs this user may see:
      // - tenant_admin/super_admin → all users (no filter)
      // - user with reportees (line manager) → recursive hierarchy
      // - plain user (no reportees) → only themselves
      const scopedUserIds: string[] | null = await db.withTenant(tenantId, async (client) => {
        if (isAdmin) return null; // null = no filter (all)
        const hierarchy = await client.query(`
          WITH RECURSIVE h AS (
            SELECT id FROM users WHERE manager_id = $1
            UNION ALL
            SELECT u.id FROM users u INNER JOIN h ON u.manager_id = h.id
          )
          SELECT id FROM h
        `, [userId]);
        const ids: string[] = hierarchy.rows.map((r: any) => r.id);
        // Include self so manager sees own data too
        return [userId, ...ids];
      });

      // Build safe owner filter using parameterised IN clause
      // We pass the ids array and use a subquery to avoid dynamic SQL with user data
      const buildOwnerFilter = (alias = '') => {
        const col = alias ? `${alias}.owner_id` : 'owner_id';
        if (scopedUserIds === null) return { sql: '', params: [] as string[] };
        return {
          sql: `AND ${col} = ANY($1::uuid[])`,
          params: [scopedUserIds],
        };
      };
      const buildAssigneeFilter = (alias = '') => {
        const assigneeCol = alias ? `${alias}.assignee_id` : 'assignee_id';
        const createdCol  = alias ? `${alias}.created_by`  : 'created_by';
        if (scopedUserIds === null) return { sql: '', params: [] as string[] };
        return {
          sql: `AND (${assigneeCol} = ANY($1::uuid[]) OR ${createdCol} = ANY($1::uuid[]))`,
          params: [scopedUserIds],
        };
      };

      const of  = buildOwnerFilter();
      const af  = buildAssigneeFilter();
      // For the aggregate query we inline the filter as a literal UUID array — safe because
      // scopedUserIds comes from our own DB query, never from user input.
      const idsLiteral = scopedUserIds
        ? `ARRAY[${scopedUserIds.map(id => `'${id}'::uuid`).join(',')}]`
        : 'NULL';
      const ownerSql    = scopedUserIds ? `AND owner_id    = ANY(${idsLiteral})` : '';
      const assigneeSql = scopedUserIds ? `AND (assignee_id = ANY(${idsLiteral}) OR created_by = ANY(${idsLiteral}))` : '';

      const [stats] = await db.withTenant(tenantId, async (client) => {
        const result = await client.query(`
          SELECT
            -- CRM
            (SELECT COUNT(*) FROM contacts WHERE 1=1 ${ownerSql}) AS total_contacts,
            (SELECT COUNT(*) FROM contacts WHERE created_at > NOW() - INTERVAL '30 days' ${ownerSql}) AS new_contacts_30d,
            (SELECT COUNT(*) FROM companies WHERE 1=1 ${ownerSql}) AS total_companies,
            (SELECT COUNT(*) FROM deals WHERE status = 'open' ${ownerSql}) AS open_deals,
            (SELECT COALESCE(SUM(amount),0)::float8 FROM deals WHERE status = 'open' ${ownerSql}) AS pipeline_value,
            (SELECT COUNT(*) FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '30 days' ${ownerSql}) AS deals_won_30d,
            (SELECT COALESCE(SUM(amount),0)::float8 FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '30 days' ${ownerSql}) AS revenue_30d,
            (SELECT COALESCE(SUM(amount),0)::float8 FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '7 days' ${ownerSql}) AS revenue_7d,
            -- Activities
            (SELECT COUNT(*) FROM activities WHERE status = 'pending' AND due_at < NOW() ${ownerSql}) AS overdue_tasks,
            (SELECT COUNT(*) FROM activities WHERE status = 'pending' AND due_at::date = CURRENT_DATE ${ownerSql}) AS due_today,
            -- Voice (always tenant-wide — calls don't have owner_id)
            (SELECT COUNT(*) FROM voice_calls WHERE started_at > NOW() - INTERVAL '30 days') AS calls_30d,
            (SELECT COUNT(*) FROM voice_calls WHERE started_at > NOW() - INTERVAL '7 days')  AS calls_7d,
            -- Tickets
            (SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed') ${assigneeSql}) AS open_tickets,
            (SELECT COUNT(*) FROM tickets WHERE status = 'open' ${assigneeSql})                    AS unassigned_tickets,
            (SELECT COUNT(*) FROM tickets WHERE sla_due_at < NOW() AND status NOT IN ('resolved','closed') ${assigneeSql}) AS sla_breached,
            (SELECT COUNT(*) FROM tickets WHERE escalation_level >= 2 ${assigneeSql})              AS escalated_l2,
            (SELECT COUNT(*) FROM tickets WHERE created_at > NOW() - INTERVAL '30 days' ${assigneeSql}) AS tickets_30d,
            -- Emails (always tenant-wide)
            (SELECT COUNT(*) FROM emails WHERE status = 'delivered' AND created_at > NOW() - INTERVAL '30 days') AS emails_sent_30d,
            (SELECT COUNT(*) FROM emails WHERE status = 'failed'    AND created_at > NOW() - INTERVAL '30 days') AS emails_failed_30d,
            -- Voice bot (always tenant-wide)
            (SELECT COUNT(*) FROM voice_bot_calls WHERE created_at > NOW() - INTERVAL '30 days') AS bot_calls_30d,
            (SELECT COUNT(*) FROM voice_bot_calls WHERE ticket_id IS NULL AND created_at > NOW() - INTERVAL '30 days') AS bot_untriaged_30d
        `);
        return result.rows;
      });

      // Recent activities feed — scoped to hierarchy
      const recentActivity = await db.withTenant(tenantId, async (client) => {
        const r = scopedUserIds
          ? await client.query(`
              SELECT a.id, a.type, a.subject, a.status, a.created_at,
                     c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name,
                     u.name AS owner_name
              FROM activities a
              LEFT JOIN contacts c ON a.contact_id = c.id
              LEFT JOIN users u ON a.owner_id = u.id
              WHERE a.owner_id = ANY($1::uuid[])
              ORDER BY a.created_at DESC LIMIT 8
            `, [scopedUserIds])
          : await client.query(`
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
      const tenantId = req.tenant.id;
      // Read from materialized view — refreshed hourly by analytics-refresh-worker
      const data = await db.query(`
        WITH periods AS (
          SELECT generate_series(
            DATE_TRUNC($2, NOW() - ($3 || ' months')::INTERVAL + INTERVAL '1 month'),
            DATE_TRUNC($2, NOW()),
            ('1 ' || $2)::INTERVAL
          ) AS period
        ),
        actuals AS (
          SELECT
            DATE_TRUNC($2, day)      AS period,
            SUM(deals_won)::int      AS deals_won,
            SUM(deals_lost)::int     AS deals_lost,
            SUM(revenue_won)::float8 AS revenue
          FROM mv_daily_deal_stats
          WHERE tenant_id = $1
            AND day >= (NOW() - ($3 || ' months')::INTERVAL)::date
          GROUP BY 1
        )
        SELECT
          p.period,
          COALESCE(a.deals_won,  0) AS deals_won,
          COALESCE(a.revenue,    0) AS revenue,
          COALESCE(a.deals_lost, 0) AS deals_lost
        FROM periods p
        LEFT JOIN actuals a USING (period)
        ORDER BY p.period`,
        [tenantId, period, months],
      );
      return reply.send({ success: true, data: data.rows });
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

    // Agent leaderboard — reads from MV for deal+activity stats, live for voice calls
    fastify.get('/leaderboard', { preHandler }, async (req, reply) => {
      const { from, to } = req.query as any;
      const tenantId = req.tenant.id;
      const fromDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
      const toDate   = to   ?? new Date().toISOString();

      const result = await db.query(`
        SELECT
          u.id, u.name, u.avatar,
          COALESCE(d.deals_won,            0)::int     AS deals_won,
          COALESCE(d.revenue,              0)::float8  AS revenue,
          COALESCE(a.activities_completed, 0)::int     AS activities_completed,
          COALESCE(vc.calls_made,          0)::int     AS calls_made
        FROM users u
        LEFT JOIN (
          SELECT owner_id,
                 SUM(deals_won)::int      AS deals_won,
                 SUM(revenue_won)::float8 AS revenue
          FROM mv_daily_deal_stats
          WHERE tenant_id = $1 AND day BETWEEN $2::date AND $3::date
          GROUP BY owner_id
        ) d ON d.owner_id = u.id
        LEFT JOIN (
          SELECT owner_id,
                 SUM(activities_completed)::int AS activities_completed
          FROM mv_daily_activity_stats
          WHERE tenant_id = $1 AND day BETWEEN $2::date AND $3::date
          GROUP BY owner_id
        ) a ON a.owner_id = u.id
        LEFT JOIN (
          SELECT agent_id, COUNT(*) AS calls_made
          FROM voice_calls
          WHERE tenant_id = $1 AND started_at BETWEEN $2 AND $3
          GROUP BY agent_id
        ) vc ON vc.agent_id = u.id
        WHERE u.tenant_id = $1 AND u.is_active = true
        ORDER BY revenue DESC`,
        [tenantId, fromDate, toDate],
      );
      return reply.send({ success: true, data: result.rows });
    });

    // Contact source breakdown — reads from MV
    fastify.get('/contact-sources', { preHandler }, async (req, reply) => {
      const result = await db.query(
        `SELECT source, total AS count, converted
         FROM mv_contact_source_stats
         WHERE tenant_id = $1
         ORDER BY total DESC`,
        [req.tenant.id],
      );
      return reply.send({ success: true, data: result.rows });
    });

    // MV refresh status — shows when each view was last refreshed and how long it took
    fastify.get('/refresh-status', { preHandler: [requireScope('admin:read')] }, async (_req, reply) => {
      const result = await db.query(
        `SELECT view_name, refreshed_at, duration_ms FROM analytics_refresh_log ORDER BY view_name`,
      );
      return reply.send({ success: true, data: result.rows });
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
      const userId     = req.user.sub;
      const role       = req.user.role as string ?? 'agent';
      const rawDept    = (req as any).user?.department as string | null ?? null;
      const isAdmin    = ['tenant_admin','super_admin'].includes(role);

      // Build the hierarchy user-ID set for this user (recursive — all levels deep)
      // null = no filter (tenant_admin sees everything)
      const scopeIds: string[] | null = await db.withTenant(tenantId, async (client) => {
        if (isAdmin) return null;
        const hier = await client.query(`
          WITH RECURSIVE h AS (
            SELECT id FROM users WHERE manager_id = $1
            UNION ALL
            SELECT u.id FROM users u INNER JOIN h ON u.manager_id = h.id
          )
          SELECT id FROM h
        `, [userId]);
        return [userId, ...hier.rows.map((r: any) => r.id)];
      });

      const isManager = isAdmin || (scopeIds !== null && scopeIds.length > 1);
      // Build safe SQL fragment for filtering by hierarchy (owner/assignee)
      const scopeLiteral = scopeIds
        ? `ARRAY[${scopeIds.map(id => `'${id}'::uuid`).join(',')}]`
        : 'NULL';
      const scopeOwnerSql    = scopeIds ? `AND owner_id     = ANY(${scopeLiteral})` : '';
      const scopeAssigneeSql = scopeIds ? `AND (assignee_id = ANY(${scopeLiteral}) OR created_by = ANY(${scopeLiteral}))` : '';
      const scopeAgentSql    = scopeIds ? `AND agent_id     = ANY(${scopeLiteral})` : '';

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
      const ticketBreakdown = await db.withTenant(tenantId, async (client) => {
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
          WHERE 1=1 ${scopeAssigneeSql} ${deptTicketFilter}
          GROUP BY ticket_type
          ORDER BY total DESC
        `, []);
        const r = await client.query(sql, params);
        return r.rows;
      });

      // ── Call stats ───────────────────────────────────────────────────────
      const callStats = await db.withTenant(tenantId, async (client) => {
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
          WHERE 1=1 ${scopeAgentSql}
        `);
        return r.rows[0] ?? {};
      });

      // ── Ticket summary totals ────────────────────────────────────────────
      const myTickets = await db.withTenant(tenantId, async (client) => {
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
          WHERE 1=1 ${scopeAssigneeSql} ${deptTicketFilter}
        `, []);
        const r = await client.query(sql1, params1);

        // Per-user breakdown: assigned-to-me vs created-by-me (always useful regardless of scope)
        const [sql2, params2] = resolveDept(`
          SELECT
            COUNT(*) FILTER (WHERE assignee_id = $1 AND status NOT IN ('resolved','closed')) AS assigned_to_me,
            COUNT(*) FILTER (WHERE created_by  = $1)                                          AS created_by_me
          FROM tickets
          WHERE (assignee_id = $1 OR created_by = $1) ${deptTicketFilter}
        `, [userId]);
        const o = await client.query(sql2, params2);

        return { ...r.rows[0], ...o.rows[0] };
      });

      // ── Sentiment / ratings ──────────────────────────────────────────────
      const sentiment = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`
          SELECT
            ROUND(AVG((sentiment->>'score')::numeric) FILTER (WHERE sentiment IS NOT NULL))::int AS avg_sentiment,
            COUNT(*) FILTER (WHERE (sentiment->>'label') = 'positive')  AS positive_calls,
            COUNT(*) FILTER (WHERE (sentiment->>'label') = 'negative')  AS negative_calls,
            COUNT(*) FILTER (WHERE (sentiment->>'label') = 'neutral')   AS neutral_calls
          FROM voice_calls
          WHERE status = 'completed' ${scopeAgentSql}
        `);

        let avgRating = null;
        try {
          // Scope ratings to tickets assigned within the hierarchy
          const ratingFilter = scopeIds
            ? `JOIN tickets t2 ON tr.ticket_id = t2.id AND t2.assignee_id = ANY(${scopeLiteral})`
            : '';
          const rr = await client.query(`
            SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                   COUNT(*) AS total_ratings
            FROM ticket_ratings tr ${ratingFilter}
          `);
          avgRating = rr.rows[0] ?? null;
        } catch (_) { /* table may not exist */ }

        return { ...r.rows[0], ...avgRating };
      });

      // ── Recent tickets (hierarchy-scoped) ───────────────────────────────
      const recentTickets = await db.withTenant(tenantId, async (client) => {
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
            ${scopeAssigneeSql}
            ${deptTicketFilter}
          ORDER BY
            CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            t.created_at DESC
          LIMIT 10
        `, [userId]);
        const r = await client.query(sql, params);
        return r.rows;
      });

      // ── CRM Activities (hierarchy-scoped) ────────────────────────────────
      const activityStats = await db.withTenant(tenantId, async (client) => {
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
          WHERE 1=1 ${scopeOwnerSql}
        `);
        return r.rows[0] ?? {};
      });

      const recentActivities = await db.withTenant(tenantId, async (client) => {
        const r = await client.query(`
          SELECT a.id, a.type, a.subject, a.status, a.due_at, a.created_at,
                 u.name AS owner_name,
                 c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name
          FROM activities a
          LEFT JOIN contacts c ON a.contact_id = c.id
          LEFT JOIN users u ON a.owner_id = u.id
          WHERE 1=1 ${scopeOwnerSql}
          ORDER BY a.created_at DESC LIMIT 8
        `);
        return r.rows;
      });

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

      // ── Human agent stats (hierarchy-scoped for managers) ────────────────
      const humanStats = isManager ? await db.withTenant(tenantId, async (client) => {
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
          WHERE 1=1 ${scopeAgentSql}
        `);

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
          WHERE 1=1 ${scopeAssigneeSql} ${deptTicketFilter}
        `, []);
        const tickets = await client.query(tktSql, tktParams);

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
          WHERE 1=1 ${scopeOwnerSql}
        `);

        // Leaderboard scoped to hierarchy members only
        const hierarchyFilter = scopeIds
          ? `AND u.id = ANY(${scopeLiteral})`
          : `AND u.role IN ('agent','manager')`;
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
            ${hierarchyFilter}
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
            ${scopeAssigneeSql}
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

    // ── Shared helper: get all users in the reporting hierarchy under a manager ─
    // Uses a recursive CTE to traverse direct + indirect reports at any depth.
    // tenant_admin / super_admin get ALL tenant users (no hierarchy restriction).
    async function getHierarchyUserIds(
      client: any,
      userId: string,
      role: string,
    ): Promise<string[]> {
      if (role === 'tenant_admin' || role === 'super_admin') {
        const r = await client.query(`SELECT id FROM users WHERE role != 'super_admin'`);
        return r.rows.map((row: any) => row.id);
      }
      // Recursive CTE: start from the manager, collect everyone below
      const r = await client.query(`
        WITH RECURSIVE hierarchy AS (
          SELECT id FROM users WHERE manager_id = $1
          UNION ALL
          SELECT u.id FROM users u
          INNER JOIN hierarchy h ON u.manager_id = h.id
        )
        SELECT id FROM hierarchy
      `, [userId]);
      return r.rows.map((row: any) => row.id);
    }

    // ── Team (manager) analytics ─────────────────────────────────────────
    // GET /analytics/team-summary
    // Query params:
    //   period   = 7d | 30d | 90d | ytd | custom   (default: 30d)
    //   from     = ISO date string (required when period=custom)
    //   to       = ISO date string (required when period=custom)
    //   reporteeId = UUID — drill-down to a single user
    // Access: any user who has reportees OR tenant_admin / super_admin
    const teamPreHandler = [requireRole('super_admin', 'tenant_admin', 'manager', 'agent', 'viewer')];
    fastify.get('/team-summary', { preHandler: teamPreHandler }, async (req, reply) => {
      const { period = '30d', reporteeId, from: fromDate, to: toDate } =
        req.query as { period?: string; reporteeId?: string; from?: string; to?: string };
      const userId = req.user.sub;
      const role   = req.user.role as string;

      const data = await db.withTenant(req.tenant.id, async (client) => {
        // Resolve date range
        let dateFrom: string;
        let dateTo: string;
        if (period === 'custom' && fromDate && toDate) {
          dateFrom = fromDate;
          dateTo   = toDate;
        } else {
          dateTo = new Date().toISOString();
          const days = period === '7d' ? 7 : period === '90d' ? 90 : period === 'ytd'
            ? Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)
            : 30;
          dateFrom = new Date(Date.now() - days * 86400000).toISOString();
        }

        // Determine the set of user IDs:
        // - reporteeId supplied → drill into a single user
        // - admin → full tenant
        // - user with reportees → full hierarchy
        // - user with no reportees → just themselves (personal view)
        let userIds: string[];
        if (reporteeId) {
          userIds = [reporteeId];
        } else {
          const hierarchyIds = await getHierarchyUserIds(client, userId, role);
          // For non-admins, hierarchyIds only contains reports; add self so they always see own data
          const isAdmin = ['tenant_admin', 'super_admin'].includes(role);
          userIds = isAdmin ? hierarchyIds : [userId, ...hierarchyIds.filter(id => id !== userId)];
        }

        if (userIds.length === 0) return { stats: [], activities: [], trend: [], period, dateFrom, dateTo };

        const ph = (arr: any[], offset = 0) => arr.map((_: any, i: number) => `$${i + 1 + offset}`).join(', ');
        const ids = userIds;

        // Per-user stats
        const statsResult = await client.query(`
          SELECT
            u.id, u.name, u.email, u.role,
            r.name  AS role_name, r.color AS role_color,
            m.name  AS manager_name,
            (SELECT COUNT(*) FROM contacts   WHERE owner_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS contacts_created,
            (SELECT COUNT(*) FROM deals      WHERE owner_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS deals_created,
            (SELECT COUNT(*) FROM deals      WHERE owner_id = u.id AND status = 'won' AND won_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS deals_won,
            (SELECT COALESCE(SUM(amount),0)::float8 FROM deals WHERE owner_id = u.id AND status = 'won' AND won_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS revenue,
            (SELECT COUNT(*) FROM activities WHERE owner_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS activities_total,
            (SELECT COUNT(*) FROM activities WHERE owner_id = u.id AND status = 'completed' AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS activities_done,
            (SELECT COUNT(*) FROM activities WHERE owner_id = u.id AND status = 'pending' AND due_at < NOW()) AS overdue,
            (SELECT COUNT(*) FROM tickets    WHERE assignee_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS tickets_handled
          FROM users u
          LEFT JOIN roles r ON r.id = u.custom_role_id
          LEFT JOIN users m ON m.id = u.manager_id
          WHERE u.id IN (${ph(ids)})
          ORDER BY u.name ASC
        `, [...ids, dateFrom, dateTo]);

        // Recent activities
        const actResult = await client.query(`
          SELECT a.id, a.type, a.subject, a.status, a.due_at, a.created_at,
                 u.name AS owner_name,
                 c.first_name || ' ' || COALESCE(c.last_name,'') AS contact_name
          FROM activities a
          LEFT JOIN users u ON a.owner_id = u.id
          LEFT JOIN contacts c ON a.contact_id = c.id
          WHERE a.owner_id IN (${ph(ids)})
            AND a.created_at BETWEEN $${ids.length+1} AND $${ids.length+2}
          ORDER BY a.created_at DESC LIMIT 20
        `, [...ids, dateFrom, dateTo]);

        // Daily trend
        const trendResult = await client.query(`
          SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS count
          FROM activities
          WHERE owner_id IN (${ph(ids)})
            AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}
          GROUP BY 1 ORDER BY 1
        `, [...ids, dateFrom, dateTo]);

        return { stats: statsResult.rows, activities: actResult.rows, trend: trendResult.rows, period, dateFrom, dateTo };
      });

      if (data === null) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'No team members report to you' } });
      }
      return reply.send({ success: true, data });
    });

    // GET /analytics/team-reportees — flat list of full hierarchy (for filter UI)
    fastify.get('/team-reportees', { preHandler: teamPreHandler }, async (req, reply) => {
      const userId = req.user.sub;
      const role   = req.user.role as string;

      const reportees = await db.withTenant(req.tenant.id, async (client) => {
        const isAdmin = ['tenant_admin', 'super_admin'].includes(role);
        const hierarchyIds = await getHierarchyUserIds(client, userId, role);
        // Always include self; for non-admins prepend userId
        const ids = isAdmin ? hierarchyIds : [userId, ...hierarchyIds.filter((id: string) => id !== userId)];
        if (ids.length === 0) return [];
        const ph = ids.map((_: any, i: number) => `$${i + 1}`).join(', ');
        const r = await client.query(
          `SELECT u.id, u.name, u.email, r.name AS role_name, m.name AS manager_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.custom_role_id
           LEFT JOIN users m ON m.id = u.manager_id
           WHERE u.id IN (${ph}) ORDER BY u.name`,
          ids,
        );
        return r.rows;
      });

      return reply.send({ success: true, data: reportees });
    });

    // GET /analytics/team-export — download CSV or JSON
    // Supports same params as team-summary plus format=csv|json
    fastify.get('/team-export', { preHandler: teamPreHandler }, async (req, reply) => {
      const { period = '30d', reporteeId, from: fromDate, to: toDate, format = 'csv' } =
        req.query as { period?: string; reporteeId?: string; from?: string; to?: string; format?: string };
      const userId = req.user.sub;
      const role   = req.user.role as string;

      const rows = await db.withTenant(req.tenant.id, async (client) => {
        const isAdmin = ['tenant_admin', 'super_admin'].includes(role);

        let dateFrom: string;
        let dateTo: string;
        if (period === 'custom' && fromDate && toDate) {
          dateFrom = fromDate; dateTo = toDate;
        } else {
          dateTo = new Date().toISOString();
          const days = period === '7d' ? 7 : period === '90d' ? 90 : period === 'ytd'
            ? Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000) : 30;
          dateFrom = new Date(Date.now() - days * 86400000).toISOString();
        }

        let ids: string[];
        if (reporteeId) {
          ids = [reporteeId];
        } else {
          const hierarchyIds = await getHierarchyUserIds(client, userId, role);
          ids = isAdmin ? hierarchyIds : [userId, ...hierarchyIds.filter((id: string) => id !== userId)];
        }
        if (ids.length === 0) return [];
        const ph = (arr: any[], offset = 0) => arr.map((_: any, i: number) => `$${i + 1 + offset}`).join(', ');

        const result = await client.query(`
          SELECT
            u.name AS "Name", u.email AS "Email", u.role AS "Role",
            r.name AS "Custom Role", m.name AS "Line Manager",
            (SELECT COUNT(*) FROM contacts   WHERE owner_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS "Contacts Created",
            (SELECT COUNT(*) FROM deals      WHERE owner_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS "Deals Created",
            (SELECT COUNT(*) FROM deals      WHERE owner_id = u.id AND status = 'won' AND won_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS "Deals Won",
            (SELECT COALESCE(SUM(amount),0)::numeric(12,2) FROM deals WHERE owner_id = u.id AND status = 'won' AND won_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS "Revenue",
            (SELECT COUNT(*) FROM activities WHERE owner_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS "Activities Total",
            (SELECT COUNT(*) FROM activities WHERE owner_id = u.id AND status = 'completed' AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS "Activities Completed",
            (SELECT COUNT(*) FROM activities WHERE owner_id = u.id AND status = 'pending' AND due_at < NOW()) AS "Overdue Activities",
            (SELECT COUNT(*) FROM tickets    WHERE assignee_id = u.id AND created_at BETWEEN $${ids.length+1} AND $${ids.length+2}) AS "Tickets Handled"
          FROM users u
          LEFT JOIN roles r ON r.id = u.custom_role_id
          LEFT JOIN users m ON m.id = u.manager_id
          WHERE u.id IN (${ph(ids)})
          ORDER BY u.name ASC
        `, [...ids, dateFrom, dateTo]);
        return result.rows;
      });

      if (rows === null) return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });

      if (format === 'csv') {
        if (rows.length === 0) {
          reply.header('Content-Type', 'text/csv').header('Content-Disposition', 'attachment; filename="team-report.csv"');
          return reply.send('No data');
        }
        const headers = Object.keys(rows[0]);
        const escape  = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = [headers.map(escape).join(','), ...rows.map((r: any) => headers.map(h => escape(r[h])).join(','))].join('\n');
        reply.header('Content-Type', 'text/csv').header('Content-Disposition', 'attachment; filename="team-report.csv"');
        return reply.send(csv);
      }

      return reply.send({ success: true, data: rows });
    });

  };
}
