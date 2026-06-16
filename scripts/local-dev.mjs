/**
 * Local dev launcher — no Docker, no system Postgres required.
 * Starts an embedded PostgreSQL, runs migrations + seed, then
 * launches the API (port 3000) and frontend (port 5173) in parallel.
 *
 * Usage:  npm run dev:local
 */

import EmbeddedPostgres from 'embedded-postgres';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load root .env into our env so all child processes (API, frontend, migrate,
// seed) inherit JWT_SECRET, CORS_ORIGINS, VITE_* etc. regardless of their cwd.
// (The app's own `import 'dotenv/config'` looks in the package cwd, where no
// .env exists, so we must propagate it here.)
dotenv.config({ path: path.join(ROOT, '.env') });

const DB_USER = 'postgres';
const DB_NAME = 'crm_platform';
const DB_PORT = 5433; // avoids clash with any future system Postgres on 5432

// trust auth — no password needed for local dev
const DATABASE_URL = `postgresql://${DB_USER}@localhost:${DB_PORT}/${DB_NAME}`;

// Propagate to all child processes
process.env.DATABASE_URL = DATABASE_URL;
process.env.NODE_ENV     = process.env.NODE_ENV || 'development';

// ── 1. Start embedded Postgres ───────────────────────────────────
const pg = new EmbeddedPostgres({
  databaseDir:  path.join(ROOT, '.pg-data'),
  user:         DB_USER,
  password:     'unused',
  authMethod:   'trust',   // no password needed for local dev
  port:         DB_PORT,
  persistent:   true,      // data directory survives restarts
  // Force UTF8 — the migration files contain UTF-8 box-drawing chars in
  // comments. On Windows the cluster would otherwise default to WIN1252,
  // which can't encode them and breaks migrations.
  initdbFlags:  ['--encoding=UTF8', '--locale=C'],
});

// Only run initdb if the data directory is not already a valid PG cluster
const pgVersionFile = path.join(ROOT, '.pg-data', 'PG_VERSION');
const alreadyInit = fs.existsSync(pgVersionFile);

if (!alreadyInit) {
  console.log('\n[pg] initialising embedded PostgreSQL…');
  await pg.initialise();
} else {
  console.log('\n[pg] using existing data directory');
}
await pg.start();
console.log(`[pg] running on localhost:${DB_PORT}`);

// ── 2. Create application database ──────────────────────────────
try {
  await pg.createDatabase(DB_NAME);
  console.log(`[pg] database '${DB_NAME}' created`);
} catch (e) {
  if (!String(e).includes('already exists')) throw e;
  console.log(`[pg] database '${DB_NAME}' already exists`);
}

// ── 3. Run migrations ────────────────────────────────────────────
// NB: call the @crm/api script directly (not via turbo) — turbo 2.x filters
// env vars, which would strip DATABASE_URL and make the script fall back to
// the default localhost:5432 instead of our embedded PG on :5433.
console.log('\n[migrate] applying migrations…');
execSync('npm run db:migrate --prefix packages/api', { cwd: ROOT, stdio: 'inherit', env: process.env, shell: true });

// ── 4. Seed (idempotent — skips if demo tenant exists) ───────────
console.log('\n[seed] seeding demo data…');
execSync('npm run db:seed --prefix packages/api', { cwd: ROOT, stdio: 'inherit', env: process.env, shell: true });

// ── 5. Start API + Frontend in parallel ─────────────────────────
console.log('\n[dev] starting servers…');
console.log('       API      → http://localhost:3000');
console.log('       Docs     → http://localhost:3000/docs');
console.log('       Frontend → http://localhost:5173');
console.log('       Login    → admin@demo.com / Demo1234!  (workspace: demo)\n');

const env = { ...process.env };

const api = spawn('npm', ['run', 'dev', '--prefix', 'packages/api'], {
  cwd: ROOT, stdio: 'inherit', env, shell: true,
});

const fe = spawn('npm', ['run', 'dev', '--prefix', 'packages/frontend'], {
  cwd: ROOT, stdio: 'inherit', env, shell: true,
});

async function shutdown() {
  api.kill('SIGTERM');
  fe.kill('SIGTERM');
  await pg.stop();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
