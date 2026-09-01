'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const { Client } = pg;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePostgresUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:' ? parsed : null;
  } catch {
    return null;
  }
}

function projectIdentity(value) {
  const parsed = parsePostgresUrl(value);
  if (!parsed) return null;
  const direct = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
  if (direct) return direct.toLowerCase();
  const username = decodeURIComponent(parsed.username || '');
  const pooled = username.match(/^postgres\.([a-z0-9]+)$/i)?.[1];
  return pooled ? pooled.toLowerCase() : null;
}

function isSupabasePooler(value) {
  const parsed = parsePostgresUrl(value);
  return Boolean(parsed && /(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname));
}

function sessionPoolerUrl(value) {
  const parsed = parsePostgresUrl(value);
  if (!parsed) throw new Error('OVERFLOW_GATE_1_INVALID_POSTGRES_URL');
  if (!isSupabasePooler(value)) {
    throw new Error('OVERFLOW_GATE_1_REQUIRES_SUPABASE_SHARED_POOLER');
  }
  if (parsed.port !== '5432' && parsed.port !== '6543') {
    throw new Error('OVERFLOW_GATE_1_INVALID_POOLER_PORT');
  }
  parsed.port = '5432';
  return parsed.toString();
}

function resolveMigration(name) {
  const candidates = [
    path.resolve(process.cwd(), 'server', 'migrations', 'overflow', name),
    path.resolve(process.cwd(), 'dist', 'migrations', 'overflow', name),
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) throw new Error(`OVERFLOW_GATE_2_MIGRATION_MISSING:${name}`);
  return resolved;
}

function readMigration(name) {
  return fs.readFileSync(resolveMigration(name), 'utf8');
}

const overflowUrl = clean(process.env.SUPABASE_DATABASE_URL_OVERFLOW);
const primaryUrl = clean(
  process.env.SUPABASE_DATABASE_URL
    || process.env.SUPABASE_DB_URL
    || process.env.DATABASE_URL,
);

if (!overflowUrl) throw new Error('OVERFLOW_GATE_1_NOT_CONFIGURED');
if (!primaryUrl) throw new Error('OVERFLOW_GATE_1_PRIMARY_IDENTITY_UNAVAILABLE');

const overflowProject = projectIdentity(overflowUrl);
const primaryProject = projectIdentity(primaryUrl);
if (!overflowProject || !primaryProject) {
  throw new Error('OVERFLOW_GATE_1_PROJECT_IDENTITY_UNVERIFIED');
}
if (overflowProject === primaryProject) {
  throw new Error('OVERFLOW_GATE_1_PRIMARY_AND_OVERFLOW_MUST_BE_DISTINCT');
}

const provisioningUrl = sessionPoolerUrl(overflowUrl);
console.log('[OVERFLOW-PROVISION] Gate 1/4 PASS: distinct Supabase overflow project and bounded session provisioning lane verified');

const migrationNames = [
  '001_cryptara_comp_cache.sql',
  '002_cryptara_parallel_proxy.sql',
];
const migrations = migrationNames.map(name => ({ name, sql: readMigration(name) }));
const forbiddenAuthoritySurface = /\bpublic\.(?:users|complaints|lawsuit_filings|cryptocrawler_resource_leases)\b/i;
for (const migration of migrations) {
  if (forbiddenAuthoritySurface.test(migration.sql)) {
    throw new Error(`OVERFLOW_GATE_2_AUTHORITY_LEAK:${migration.name}`);
  }
  if (!/\bprivate\.cryptara_/i.test(migration.sql)) {
    throw new Error(`OVERFLOW_GATE_2_NON_AUXILIARY_MIGRATION:${migration.name}`);
  }
}
console.log('[OVERFLOW-PROVISION] Gate 2/4 PASS: migration contract is auxiliary-only and does not copy primary authority tables');

const client = new Client({
  connectionString: provisioningUrl,
  connectionTimeoutMillis: 10_000,
  query_timeout: 20_000,
  statement_timeout: 20_000,
  keepAlive: true,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  application_name: 'badblue-overflow-schema-provisioner',
});

async function main() {
  await client.connect();
  try {
    await client.query('begin');
    for (const migration of migrations) {
      await client.query(migration.sql);
    }
    await client.query('commit');
    console.log('[OVERFLOW-PROVISION] Gate 3/4 PASS: auxiliary mirror schema provisioned atomically');

    const proof = await client.query(`select
      to_regclass('private.cryptara_comp_cache') is not null as comp_cache,
      to_regclass('private.cryptara_parallel_snapshots') is not null as snapshots,
      to_regclass('private.cryptara_parallel_events') is not null as events,
      to_regclass('private.cryptara_parallel_jobs') is not null as jobs,
      to_regprocedure('private.cryptara_claim_parallel_jobs(text,integer,integer)') is not null as claimant,
      to_regclass('public.users') is not null as has_users,
      to_regclass('public.complaints') is not null as has_complaints,
      to_regclass('public.lawsuit_filings') is not null as has_lawsuit_filings,
      to_regclass('public.cryptocrawler_resource_leases') is not null as has_resource_leases`);
    const row = proof.rows[0] || {};
    const auxiliaryReady = row.comp_cache === true
      && row.snapshots === true
      && row.events === true
      && row.jobs === true
      && row.claimant === true;
    const authorityLeak = row.has_users === true
      || row.has_complaints === true
      || row.has_lawsuit_filings === true
      || row.has_resource_leases === true;
    if (!auxiliaryReady) throw new Error('OVERFLOW_GATE_4_AUXILIARY_SCHEMA_INCOMPLETE');
    if (authorityLeak) throw new Error('OVERFLOW_GATE_4_PRIMARY_AUTHORITY_TABLES_PRESENT');
    console.log('[OVERFLOW-PROVISION] Gate 4/4 PASS: exact auxiliary objects verified and primary authority remains isolated');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Best effort only; original failure remains authoritative.
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[OVERFLOW-PROVISION] FAILED:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
