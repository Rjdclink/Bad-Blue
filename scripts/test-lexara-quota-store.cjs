/* Test-only embedded PostgreSQL. Install @electric-sql/pglite separately and set
 * PGLITE_MODULE to its path; no production database or provider APIs are used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
async function main() {
  const db = new PGlite();
  let queue = Promise.resolve();
  const pool = {
    async connect() {
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      return { query: (sql, values) => db.query(sql, values), release };
    },
    async query(sql, values) {
      const client = await this.connect();
      try { return await client.query(sql, values); } finally { client.release(); }
    },
  };
  function load() {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync('server/legalQuotaStore.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, process: { env: { NODE_ENV: 'production' } },
      require: name => { assert.equal(name, './db'); return { pool }; }, Map, Date, Number, JSON });
    return module.exports;
  }
  const first = load();
  const second = load();
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second)
    .changeLegalQuotaState('groq', state => { state.dayRequests++; })));
  assert.equal((await second.readLegalQuotaStates(['groq'])).get('groq').dayRequests, 20);
  console.log('PASS shared PostgreSQL state survives separate module instances and concurrent updates');
  await assert.rejects(first.changeLegalQuotaState('groq', state => {
    state.dayRequests = 900; throw new Error('rollback test');
  }), /rollback test/);
  assert.equal((await load().readLegalQuotaStates(['groq'])).get('groq').dayRequests, 20);
  console.log('PASS transaction rollback preserves previous allowance');
  const result = await db.query("SELECT relrowsecurity, relacl::text FROM pg_class WHERE oid='public.lexara_provider_quota'::regclass");
  assert.equal(result.rows[0].relrowsecurity, true);
  assert.ok(!/(^|,)=[^,}]/.test(result.rows[0].relacl || ''));
  console.log('PASS quota table enables RLS and grants no PUBLIC access');
  await db.close();
  console.log('3/3 embedded PostgreSQL checks passed; single-connection transaction serialization is provided by the test adapter.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
