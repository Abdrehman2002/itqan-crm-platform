/**
 * Record-visibility hierarchy helper.
 *
 * Defines WHICH users' records a given user is allowed to see, based on the
 * line-manager reporting tree (users.manager_id). This is the single source of
 * truth for "who can see whose work" and is applied as a HARD filter across
 * operational lists (contacts, deals, activities) and dashboards.
 *
 * Rules:
 *   • super_admin            → null  (no filter; platform owner — normally never
 *                               reaches tenant operational routes anyway)
 *   • everyone else          → self + every user beneath them in the reporting
 *                               tree, walked recursively to any depth:
 *       - plain agent/viewer (no reportees) → just themselves
 *       - line manager        → themselves + their direct & indirect reportees
 *       - department manager  → themselves + the whole sub-tree (their department)
 *
 * Note: tenant_admin is administrative-only and is blocked from operational
 * routes upstream; if it ever reaches here it gets the same self-only scoping
 * (returns just its own id, which owns no operational records → sees nothing).
 */

import type { PoolClient } from 'pg';

export type ScopedClient = Pick<PoolClient, 'query'>;

/**
 * Returns the set of user IDs whose records `userId` may see.
 *   • null  → unrestricted (super_admin)
 *   • array → restrict to these owner IDs (always includes `userId` itself)
 */
export async function getVisibleUserIds(
  client: ScopedClient,
  userId: string,
  role: string | undefined,
): Promise<string[] | null> {
  if (role === 'super_admin') return null; // platform owner — no filter

  const res = await client.query(
    `WITH RECURSIVE h AS (
       SELECT id FROM users WHERE manager_id = $1
       UNION ALL
       SELECT u.id FROM users u INNER JOIN h ON u.manager_id = h.id
     )
     SELECT id FROM h`,
    [userId],
  );

  // Always include self so a manager sees their own records too.
  return [userId, ...res.rows.map((r: { id: string }) => r.id)];
}

/**
 * Build a safe SQL fragment restricting `column` to the visible owner set.
 * Returns '' when unrestricted (super_admin).
 *
 * The IDs come exclusively from our own DB query (never user input), so they are
 * inlined as a UUID array literal — no positional parameter threading required.
 */
export function ownerScopeSql(column: string, scopeIds: string[] | null): string {
  if (scopeIds === null) return '';
  if (scopeIds.length === 0) return `AND false`; // defensive: no visibility
  const arr = scopeIds.map((id) => `'${id}'::uuid`).join(',');
  return `AND ${column} = ANY(ARRAY[${arr}])`;
}
