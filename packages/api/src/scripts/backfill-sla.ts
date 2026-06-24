/**
 * One-time backfill: seed default SLA policies for all tenants that have none.
 * Run once: npx tsx src/scripts/backfill-sla.ts
 */
import 'dotenv/config';
import { DatabaseClient } from '@crm/core';
import { seedDefaultSlaPolicies } from '../routes/tickets';

async function main() {
  const db = new DatabaseClient(process.env.DATABASE_URL!);
  await db.connect();

  const tenants = await db.withSuperAdmin(async (client: any) => {
    const r = await client.query(`
      SELECT t.id, t.name
      FROM tenants t
      WHERE NOT EXISTS (SELECT 1 FROM sla_policies s WHERE s.tenant_id = t.id)
      ORDER BY t.name
    `);
    return r.rows;
  });

  console.log(`Backfilling SLA policies for ${tenants.length} tenant(s)...`);

  for (const t of tenants) {
    await seedDefaultSlaPolicies(db, t.id);
    console.log(`  ✓ ${t.name} (${t.id})`);
  }

  await db.end();
  console.log('Done.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
