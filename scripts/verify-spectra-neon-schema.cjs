const assert = require('node:assert/strict');
const path = require('node:path');
const { connectionForTarget, migrationSql, ensureSchema, TARGET, TABLES } = require('./ensure-spectra-neon-schema.cjs');
const directory = path.resolve(__dirname, '../server/migrations');
const env = { ...TARGET, NEON_DATABASE_URL: 'postgresql://fixture:fixture@ep-fixture.neon.tech/fixture?sslmode=require' };

assert.equal(connectionForTarget(env), env.NEON_DATABASE_URL);
for (const key of Object.keys(TARGET)) assert.throws(() => connectionForTarget({ ...env, [key]: 'other' }), /Bad-Blue production/);
assert.throws(() => connectionForTarget({ ...env, NEON_DATABASE_URL: 'postgresql://fixture@other.example/fixture' }), /configured Neon/);
assert.equal(connectionForTarget({ ...TARGET }), null);

const sql = migrationSql(directory, 'public').join('\n');
for (const table of TABLES) {
  assert(sql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`));
  assert(sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`));
}
assert(sql.includes('"public".geography(Point, 4326)'));
assert(sql.includes('"public".ST_MakePoint(longitude, latitude)'));
assert(!sql.includes('extensions.geography'), 'reuse the installed PostGIS schema without moving it');
assert(sql.includes('pg_roles WHERE rolname IN'), 'API role revocations must tolerate absent Supabase roles');
assert(!sql.includes('FROM PUBLIC, anon, authenticated'), 'Neon must not require Supabase roles');
assert(!/CREATE ROLE|DROP TABLE|TRUNCATE|DELETE FROM|cryptocrawl/i.test(sql));

function fixture({ alreadyPresent = false, schema = 'public', fail = false, verified = true } = {}) {
  const queries = [];
  let countQueries = 0;
  let extensionCreated = false;
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT count(*)')) {
        countQueries++;
        return { rows: [{ table_count: alreadyPresent || (countQueries > 1 && verified) ? 5 : 0 }] };
      }
      if (sql.includes('FROM pg_extension')) return { rows: schema || extensionCreated ? [{ schema_name: schema || 'extensions' }] : [] };
      if (sql.startsWith('CREATE EXTENSION')) extensionCreated = true;
      if (fail && sql.includes('CREATE TABLE IF NOT EXISTS public.spectra_motion_context')) throw new Error('fixture migration failure');
      return { rows: [] };
    },
  };
}

(async () => {
  const healthy = fixture({ alreadyPresent: true });
  await ensureSchema(healthy, directory, () => {});
  assert.equal(healthy.queries.length, 1, 'healthy databases must avoid schema mutation');
  const existingExtension = fixture();
  await ensureSchema(existingExtension, directory, () => {});
  assert.equal(existingExtension.queries.at(-1).sql, 'COMMIT');
  assert(!existingExtension.queries.some(item => item.sql.startsWith('CREATE EXTENSION')));
  assert(existingExtension.queries.some(item => item.sql.includes('"public".geography')));
  const fresh = fixture({ schema: null });
  await ensureSchema(fresh, directory, () => {});
  assert(fresh.queries.some(item => item.sql.startsWith('CREATE EXTENSION')));
  assert(fresh.queries.some(item => item.sql.includes('"extensions".geography')));
  for (const options of [{ fail: true }, { verified: false }]) {
    const failed = fixture(options);
    await assert.rejects(ensureSchema(failed, directory, () => {}));
    assert.equal(failed.queries.at(-1).sql, 'ROLLBACK');
    assert(!failed.queries.some(item => item.sql === 'COMMIT'));
  }
  console.log('PASS Spectra Neon schema: production target restriction, canonical spatial schema, unchanged healthy databases, bounded atomic migration, verification and rollback. Database I/O mocked.');
})().catch(error => { console.error(error); process.exitCode = 1; });
