import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { DatabaseClient } from '@crm/core';
import { logger } from '@crm/core/config/logger';
import { PLAN_FEATURES, PLAN_LIMITS } from '@crm/shared';
import { seedDefaultPipeline } from '../routes/deals';

const DEMO_TENANT = {
  name: 'Demo Company',
  slug: 'demo',
  plan: 'professional' as const,
};

const DEMO_USER = {
  email: 'admin@demo.com',
  password: 'Demo1234!',
  name: 'Demo Admin',
  role: 'tenant_admin',
};

// Platform super admin (manages all tenants via /super-admin/*).
// Separate account from the tenant admin so the demo UI login keeps working
// (super admins are blocked from tenant-scoped /api/v1/* routes by design).
const SUPER_ADMIN = {
  email: 'superadmin@demo.com',
  password: 'Vivid@Solutions1',
  name: 'Platform Super Admin',
  role: 'super_admin',
};

async function seed() {
  const db = new DatabaseClient(process.env.DATABASE_URL!);
  await db.connect();

  const [existing] = await db.withSuperAdmin(async (client) => {
    const result = await client.query('SELECT id FROM tenants WHERE slug = $1', [DEMO_TENANT.slug]);
    return result.rows;
  });

  if (existing) {
    logger.info('Demo tenant already exists — skipping seed');
    await db.end();
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_USER.password, 12);
  const superAdminHash = await bcrypt.hash(SUPER_ADMIN.password, 12);

  const { tenantId } = await db.withSuperAdmin(async (client) => {
    const settings = {
      features: PLAN_FEATURES[DEMO_TENANT.plan],
      limits: PLAN_LIMITS[DEMO_TENANT.plan],
    };
    const t = await client.query(
      `INSERT INTO tenants (name, slug, plan, status, settings, active_modules)
       VALUES ($1, $2, $3, 'active', $4, $5) RETURNING id`,
      [DEMO_TENANT.name, DEMO_TENANT.slug, DEMO_TENANT.plan, JSON.stringify(settings),
       ['crm', 'ticketing', 'voice', 'sales']],
    );
    const tenantId = t.rows[0].id;

    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    await client.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, DEMO_USER.email, DEMO_USER.name, passwordHash, DEMO_USER.role],
    );

    // Platform super admin — used by the SQA suite and /super-admin/* portal
    await client.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, SUPER_ADMIN.email, SUPER_ADMIN.name, superAdminHash, SUPER_ADMIN.role],
    );

    // Seed sample companies
    const companies = ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Ltd'];
    for (const name of companies) {
      await client.query(
        `INSERT INTO companies (tenant_id, name, industry, size)
         VALUES ($1, $2, 'Technology', '11-50')`,
        [tenantId, name],
      );
    }

    // Seed sample contacts
    const contacts = [
      { first: 'Alice', last: 'Johnson', email: 'alice@acme.com', title: 'CEO' },
      { first: 'Bob',   last: 'Smith',   email: 'bob@globex.com', title: 'CTO' },
      { first: 'Carol', last: 'White',   email: 'carol@initech.com', title: 'VP Sales' },
    ];
    for (const c of contacts) {
      await client.query(
        `INSERT INTO contacts (tenant_id, first_name, last_name, email, job_title, status, source)
         VALUES ($1, $2, $3, $4, $5, 'lead', 'website')`,
        [tenantId, c.first, c.last, c.email, c.title],
      );
    }

    return { tenantId };
  });

  // Seed default sales pipeline
  await seedDefaultPipeline(db, tenantId);

  logger.info(`Demo tenant seeded — login: ${DEMO_USER.email} / ${DEMO_USER.password}`);
  logger.info(`Workspace slug: ${DEMO_TENANT.slug}`);
  await db.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
