import 'dotenv/config';
import { DatabaseClient } from '@crm/core';
import { ensureDefaultPipeline } from '../lib/default-pipeline';

// Backfill: give every existing tenant a default sales pipeline if it has none.
async function main() {
  const db = new DatabaseClient(process.env.DATABASE_URL!);
  await db.connect();
  let created = 0, skipped = 0;
  await db.withSuperAdmin(async (client) => {
    const { rows: tenants } = await client.query('SELECT id, slug FROM tenants ORDER BY created_at');
    for (const t of tenants) {
      const made = await ensureDefaultPipeline(client, t.id);
      if (made) { created++; console.log(`  + created pipeline for ${t.slug}`); }
      else skipped++;
    }
  });
  console.log(`\nDone. created=${created} skipped(existing)=${skipped}`);
  await db.end();
}
main().catch((e) => { console.error('BACKFILL ERROR:', e.message); process.exit(1); });
