'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const { Pool } = pg;
// Railway pre-deploy executes inside the final image. Dockerfile intentionally
// copies the migration-owned Overflow DDL into dist/migrations/overflow and does
// not keep the source server/ tree in the runtime image.
const MIGRATIONS = [
  'dist/migrations/overflow/001_cryptara_comp_cache.sql',
  'dist/migrations/overflow/002_cryptara_parallel_proxy.sql',
];

function configuredOverflowUrl() {
  const raw = String(process.env.SUPABASE_DATABASE_URL_OVERFLOW || '').trim();
  if (!raw) throw new Error('[OVERFLOW-PROVISION] SUPABASE_DATABASE_URL_OVERFLOW is required');
  return raw;
}

function sessionCapableUrl(raw) {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('[OVERFLOW-PROVISION] overflow URL must be PostgreSQL');
  }
  if (/(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname) && parsed.port === '6543') {
    parsed.port = '5432';
  }
  return parsed.toString();
}

async function main() {
  const connectionString = sessionCapableUrl(configuredOverflowUrl());
  const pool = new Pool({
    connectionString,
    max: 1,
    min: 0,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    application_name: 'badblue-overflow-provisioning',
  });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    for (const relativePath of MIGRATIONS) {
      const sql = fs.readFileSync(path.resolve(relativePath), 'utf8');
      await client.query(sql);
    }
    await client.query('COMMIT');

    const verification = await client.query(`select
      to_regclass('private.cryptara_comp_cache') is not null as comp_cache,
      to_regclass('private.cryptara_parallel_snapshots') is not null as snapshots,
      to_regclass('private.cryptara_parallel_events') is not null as events,
      to_regclass('private.cryptara_parallel_jobs') is not null as jobs,
      to_regprocedure('private.cryptara_claim_parallel_jobs(text,integer,integer)') is not null as claimant`);
    const row = verification.rows?.[0] || {};
    const ready = row.comp_cache === true
      && row.snapshots === true
      && row.events === true
      && row.jobs === true
      && row.claimant === true;
    if (!ready) throw new Error('[OVERFLOW-PROVISION] auxiliary schema verification failed after migration');
    console.log('[OVERFLOW-PROVISION] auxiliary Overflow schema verified; runtime DDL remains disabled');
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
    }
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('[OVERFLOW-PROVISION] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
