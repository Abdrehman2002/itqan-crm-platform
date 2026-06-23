import crypto from 'node:crypto';

/**
 * Canonical default sales pipeline stages for a freshly provisioned tenant.
 * Mirrors DEFAULT_STAGES in routes/deals.ts. Fresh UUIDs are generated per call
 * so each pipeline owns its own stage ids.
 */
export function defaultPipelineStages() {
  return [
    { id: crypto.randomUUID(), name: 'New',         order: 1, probability: 10,  color: '#94a3b8', rottenAfterDays: 14 },
    { id: crypto.randomUUID(), name: 'Qualified',   order: 2, probability: 25,  color: '#6366f1', rottenAfterDays: 14 },
    { id: crypto.randomUUID(), name: 'Proposal',    order: 3, probability: 50,  color: '#8b5cf6', rottenAfterDays: 10 },
    { id: crypto.randomUUID(), name: 'Negotiation', order: 4, probability: 75,  color: '#06b6d4', rottenAfterDays: 7  },
    { id: crypto.randomUUID(), name: 'Closed Won',  order: 5, probability: 100, color: '#10b981', rottenAfterDays: null },
  ];
}

/**
 * Ensure the tenant has at least one pipeline. If none exists, create a default
 * one marked is_default = true. Idempotent — safe to call repeatedly.
 * `client` must already be tenant-scoped or super-admin scoped.
 * Returns true if a pipeline was created, false if one already existed.
 */
export async function ensureDefaultPipeline(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> },
  tenantId: string,
): Promise<boolean> {
  const existing = await client.query(
    'SELECT 1 FROM pipelines WHERE tenant_id = $1 LIMIT 1',
    [tenantId],
  );
  if (existing.rows.length > 0) return false;

  await client.query(
    `INSERT INTO pipelines (tenant_id, name, stages, is_default)
     VALUES ($1, $2, $3::jsonb, true)`,
    [tenantId, 'Sales Pipeline', JSON.stringify(defaultPipelineStages())],
  );
  return true;
}
