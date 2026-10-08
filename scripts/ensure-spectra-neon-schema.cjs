// Administrative pre-deploy step; never imported by application startup.
const fs = require('node:fs');
const path = require('node:path');

const TARGET = {
  RAILWAY_PROJECT_ID: '51340040-15c4-4d74-b60e-8471bdcae20e',
  RAILWAY_SERVICE_ID: '50136f51-cf5e-4a09-9bb3-92279c4f5c75',
  RAILWAY_ENVIRONMENT_ID: '91154a53-01a3-470c-8fdc-c0f13b4702fa',
};
const TABLES = [
  'spectra_investigations', 'spectra_clues', 'spectra_telemetry_events',
  'spectra_location_observations', 'spectra_motion_context',
];
const TABLE_SQL = TABLES.map(name => `public.${name}`).join(', ');

function connectionForTarget(env) {
  for (const [name, value] of Object.entries(TARGET)) {
    if (env[name] !== value) throw new Error('Spectra migration requires Bad-Blue production on adaptable-youth.');
  }
  // Use the same role and endpoint as the admitted runtime, so newly created
  // tables keep server ownership and do not depend on a separate admin role.
  const connection = String(env.NEON_DATABASE_URL || '').trim();
  if (!connection) return null;
  let url;
  try { url = new URL(connection); } catch { throw new Error('Invalid Neon connection configuration.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) {
    throw new Error('Spectra migration requires the configured Neon database.');
  }
  return connection;
}

function migrationSql(directory, postgisSchema) {
  const quotedSchema = '"' + postgisSchema.replaceAll('"', '""') + '"';
  const durable = fs.readFileSync(path.join(directory, '064_spectra_durable_observations.sql'), 'utf8');
  const extension = 'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;';
  if (!durable.startsWith(extension)) throw new Error('Unexpected Spectra spatial migration format.');
  const motion = fs.readFileSync(path.join(directory, '067_spectra_motion_context.sql'), 'utf8');
  const accessStart = motion.indexOf('\nREVOKE ALL ON TABLE public.spectra_motion_context');
  if (accessStart < 0) throw new Error('Unexpected Spectra access migration format.');
  const sql = [
    durable.slice(extension.length).replaceAll('extensions.', `${quotedSchema}.`),
    fs.readFileSync(path.join(directory, '066_spectra_foreign_key_indexes.sql'), 'utf8'),
    motion.slice(0, accessStart),
    // Neon does not require Supabase API roles. Preserve server-only access
    // without creating roles or failing when those roles are absent.
    `REVOKE ALL ON TABLE ${TABLE_SQL} FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE ${TABLE_SQL} FROM %I', api_role);
  END LOOP;
END
$$;`,
  ];
  return sql;
}

async function ensureSchema(client, directory, log = console.log) {
  const present = await client.query(
    'SELECT count(*) AS table_count FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])',
    ['public', TABLES],
  );
  if (Number(present.rows[0]?.table_count) === TABLES.length) {
    log('[SPECTRA Neon Schema] five runtime tables already present; no schema changes');
    return;
  }
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '90s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('spectra_neon_schema'))");
    let extension = await client.query("SELECT n.nspname AS schema_name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='postgis'");
    if (!extension.rows.length) {
      await client.query('CREATE SCHEMA IF NOT EXISTS extensions');
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions');
      extension = await client.query("SELECT n.nspname AS schema_name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='postgis'");
    }
    const schema = extension.rows[0]?.schema_name;
    if (!schema) throw new Error('PostGIS is unavailable for Spectra observations.');
    for (const sql of migrationSql(directory, schema)) await client.query(sql);
    const verified = await client.query(
      'SELECT count(*) AS table_count FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])',
      ['public', TABLES],
    );
    if (Number(verified.rows[0]?.table_count) !== TABLES.length) throw new Error('Spectra schema verification failed.');
    await client.query('COMMIT');
    log('[SPECTRA Neon Schema] verified all five runtime tables; canonical observations and server-only access retained');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main(env = process.env) {
  const connectionString = connectionForTarget(env);
  if (!connectionString) {
    console.log('[SPECTRA Neon Schema] Neon runtime not configured; no migration');
    return;
  }
  const { Client } = require('pg');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, application_name: 'spectra-production-predeploy' });
  try {
    await client.connect();
    const directory = fs.existsSync(path.resolve('dist/migrations/064_spectra_durable_observations.sql'))
      ? path.resolve('dist/migrations') : path.resolve('server/migrations');
    await ensureSchema(client, directory);
  } finally {
    await client.end();
  }
}

module.exports = { connectionForTarget, migrationSql, ensureSchema, TARGET, TABLES };
if (require.main === module) main().catch(error => {
  // Never emit connection strings, credentials, or user evidence.
  console.error('[SPECTRA Neon Schema] migration failed', { code: error.code || 'SCHEMA_NOT_READY' });
  process.exitCode = 1;
});
