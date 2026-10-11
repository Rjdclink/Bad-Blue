// Offline collector lifecycle and transaction boundary checks. Provider HTTP
// and the application pool are fixtures; optional PGlite verifies actual SQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-public-store-'));
const savedEnv = { ...process.env };
const savedInfo = console.info;
const savedWarn = console.warn;
const logs = [];
const fixture = { queries: [], connectCount: 0, released: 0, handler: async () => ({ rows: [] }), collect: async () => { throw new Error('Unexpected fetch'); } };
fixture.pool = {
  async query(sql, values) { fixture.queries.push({ sql, values }); return fixture.handler(sql, values); },
  async connect() {
    fixture.connectCount++;
    return { query: (...args) => fixture.pool.query(...args), release() { fixture.released++; } };
  },
};
global.__spectraStoreFixture = fixture;
let passed = 0;
const source = { id: 'usgs-earthquakes', label: 'USGS fixture', endpoint: 'https://earthquake.usgs.gov/fixture', documentationUrl: 'https://earthquake.usgs.gov/docs', refreshIntervalMs: 300000, limitations: ['Public event context'] };
const other = { ...source, id: 'nasa-eonet', refreshIntervalMs: 1800000 };
const record = (id = 'event-1', overrides = {}) => ({ provider: source.id, recordId: id, sourceUrl: source.endpoint, title: 'Public fixture', observedAt: null, sourceUpdatedAt: null, retrievedAt: new Date().toISOString(), geometry: null, rawRecord: { id, magnitude: 2 }, limitations: [], classification: 'public_geographic_context', ...overrides });
const lease = { provider: source.id, lease_token: '00000000-0000-4000-8000-000000000001', consecutive_failures: 0, last_record_count: 7, etag: 'fixture-v1', last_modified: 'Sat, 10 Oct 2026 12:00:00 GMT' };
const result = (status, records = [], extras = {}) => ({ provider: source.id, endpoint: source.endpoint, status, records, ...extras });
const reset = () => {
  fixture.queries = []; fixture.connectCount = 0; fixture.released = 0;
  fixture.handler = async sql => ({ rows: sql.includes('SELECT provider FROM') ? [{ provider: source.id }] : [] });
};
const check = async (name, work) => { reset(); await work(); passed++; savedInfo(`PASS ${name}`); };

(async () => {
  await esbuild.build({
    stdin: {
      contents: fs.readFileSync(path.join(root, 'server/services/spectra/SpectraPublicFeedStore.ts'), 'utf8')
        + '\nexport const fixtureAccess = { rawHash, refreshInterval, retentionDays, claimFeed, registerSources, persistFeedResult, pruneFeedRecords, runCollectionCycle };',
      resolveDir: path.join(root, 'server/services/spectra'), loader: 'ts',
    },
    outfile: path.join(temp, 'store.cjs'), bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'fixture-adapters-and-pool', setup(build) {
      build.onResolve({ filter: /^(\.\.\/\.\.\/db|\.\/SpectraPublicFeeds)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('/db')
        ? 'export const pool = globalThis.__spectraStoreFixture.pool; export const isDatabaseConfigured = true;'
        : `export const SPECTRA_PUBLIC_FEED_SOURCES = ${JSON.stringify([source, other])}; export const collectSpectraPublicFeed = (...args) => globalThis.__spectraStoreFixture.collect(...args);` }));
    } }],
  });
  const store = require(path.join(temp, 'store.cjs'));
  const t = store.fixtureAccess;
  console.info = console.warn = (...args) => logs.push(args);

  await check('raw identity ignores JSON object order and receipt time but changes with content', () => {
    const a = record('1', { rawRecord: { b: [2, { z: 1, a: 3 }], a: 1 } });
    const b = record('1', { rawRecord: { a: 1, b: [2, { a: 3, z: 1 }] }, retrievedAt: '2026-01-01T00:00:00Z' });
    assert.equal(t.rawHash(a), t.rawHash(b));
    assert.notEqual(t.rawHash(a), t.rawHash(record('changed')));
  });
  await check('configuration never increases requests beyond provider cadence', () => {
    process.env.SPECTRA_PUBLIC_FEEDS_INTERVAL_MS = '1'; assert.equal(t.refreshInterval(source), 300000);
    process.env.SPECTRA_PUBLIC_FEEDS_INTERVAL_MS = '600000'; assert.equal(t.refreshInterval(source), 600000);
    delete process.env.SPECTRA_PUBLIC_FEEDS_INTERVAL_MS;
    process.env.SPECTRA_PUBLIC_FEEDS_RETENTION_DAYS = '1'; assert.equal(t.retentionDays(), 7);
    delete process.env.SPECTRA_PUBLIC_FEEDS_RETENTION_DAYS; assert.equal(t.retentionDays(), 30);
  });
  await check('lease claim is a single atomic pool query and periodically forces complete content', async () => {
    fixture.handler = async () => ({ rows: [lease] });
    assert.deepEqual(await t.claimFeed(source), lease);
    assert.equal(fixture.connectCount, 0);
    assert.match(fixture.queries[0].sql, /lease_until <= now\(\)/);
    assert.match(fixture.queries[0].sql, /last_full_fetch_at > now\(\) - interval '1 day'/);
    assert.equal(fixture.queries[0].values[2], 180000);
  });
  await check('bulk archival deduplicates a batch and preserves immutable snapshots on conflict', async () => {
    const records = Array.from({ length: 450 }, (_, i) => record(String(i)));
    assert.equal(await t.persistFeedResult(source, lease, result('ok', [...records, records[0]], { etag: 'fixture-v2' })), true);
    const writes = fixture.queries.filter(q => q.sql.includes('INSERT INTO public.spectra_public_evidence_records'));
    assert.equal(writes.length, 3);
    assert.deepEqual(writes.map(q => JSON.parse(q.values[0]).length), [200, 200, 50]);
    assert.match(writes[0].sql, /ON CONFLICT \(provider, record_id, raw_sha256\) DO UPDATE SET\s+last_seen_at/);
    assert.equal(fixture.queries.at(-1).sql, 'COMMIT'); assert.equal(fixture.released, 1);
  });
  await check('an expired or replaced lease cannot write records', async () => {
    fixture.handler = async () => ({ rows: [] });
    assert.equal(await t.persistFeedResult(source, lease, result('ok', [record()])), false);
    assert(!fixture.queries.some(q => q.sql.includes('INSERT INTO')));
    assert.equal(fixture.queries.at(-1).sql, 'ROLLBACK'); assert.equal(fixture.released, 1);
  });
  await check('failed attempts never write records or advance success and use bounded backoff', async () => {
    await t.persistFeedResult(source, { ...lease, consecutive_failures: 15 }, result('failed', [record()], { errorCode: 'http_503' }));
    assert(!fixture.queries.some(q => q.sql.includes('INSERT INTO')));
    const update = fixture.queries.find(q => q.sql.includes('status = $3')).values;
    assert.equal(update[3], false); assert.equal(update[4], 21600000); assert.equal(update[6], 0);
    assert.equal(update[7], null); assert.equal(update[8], null); assert.equal(update[9], 'http_503');
  });
  await check('coverage-limited partial data remains visible and refreshes at ordinary cadence', async () => {
    await t.persistFeedResult(source, { ...lease, consecutive_failures: 9 }, result('partial', [record()], { etag: 'must-clear', errorCode: 'source_limit' }));
    const update = fixture.queries.find(q => q.sql.includes('status = $3')).values;
    assert.equal(update[3], false); assert.equal(update[4], 300000); assert.equal(update[5], 0);
    assert.equal(update[6], 1); assert.equal(update[7], null); assert.equal(update[9], 'source_limit');
  });
  await check('304 validates the feed without inventing individual record retrievals', async () => {
    await t.persistFeedResult(source, lease, result('not_modified'));
    assert(!fixture.queries.some(q => q.sql.includes('INSERT INTO')));
    const update = fixture.queries.find(q => q.sql.includes('status = $3')).values;
    assert.equal(update[3], true); assert.equal(update[6], 7); assert.equal(update[7], 'fixture-v1');
  });
  await check('write failures rollback and release the pool client without leaking data', async () => {
    fixture.handler = async sql => {
      if (sql.includes('INSERT INTO')) throw new Error('DO_NOT_LOG_PRIVATE_PAYLOAD');
      return { rows: sql.includes('SELECT provider FROM') ? [{ provider: source.id }] : [] };
    };
    await assert.rejects(t.persistFeedResult(source, lease, result('ok', [record()])));
    assert.equal(fixture.queries.at(-1).sql, 'ROLLBACK'); assert.equal(fixture.released, 1);
  });
  await check('read requests are bounded and persistence failures remain explicit', async () => {
    await assert.rejects(store.readSpectraPublicFeedRecords({ provider: 'unknown' }), RangeError);
    await assert.rejects(store.readSpectraPublicFeedRecords({ after: 'invalid' }), RangeError);
    const response = await store.readSpectraPublicFeedRecords({ limit: 9999 });
    assert.equal(response.persistenceAvailable, true);
    assert.equal(fixture.queries.at(-1).values[2], 500);
    fixture.handler = async () => { throw Object.assign(new Error('DO_NOT_LOG_PRIVATE_PAYLOAD'), { code: '42P01' }); };
    const unavailable = await store.readSpectraPublicFeedRecords();
    assert.equal(unavailable.persistenceAvailable, false); assert.equal(unavailable.errorCode, 'schema_missing');
  });
  await check('rolling-cache pruning is bounded and excludes tenant acquisition snapshots', async () => {
    await t.pruneFeedRecords();
    assert.equal(fixture.queries.length, 1); assert.match(fixture.queries[0].sql, /LIMIT 1000 FOR UPDATE SKIP LOCKED/);
    assert(!fixture.queries[0].sql.includes('spectra_acquisition_evidence_records'));
  });
  await check('disabled startup makes no requests; shutdown aborts active work and releases its lease', async () => {
    process.env.NO_INTERVALS = 'true'; store.startSpectraPublicFeedCollector(); await store.stopSpectraPublicFeedCollector();
    assert.equal(fixture.queries.length, 0); delete process.env.NO_INTERVALS;
    process.env.SPECTRA_PUBLIC_FEEDS_ENABLED = 'false'; store.startSpectraPublicFeedCollector(); await store.stopSpectraPublicFeedCollector();
    assert.equal(fixture.queries.length, 0); delete process.env.SPECTRA_PUBLIC_FEEDS_ENABLED;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let requests = 0;
    fixture.handler = async sql => ({ rows: sql.includes('RETURNING provider, lease_token') ? [lease] : [] });
    fixture.collect = async (_id, options) => {
      requests++; assert.equal(fixture.connectCount, 0, 'HTTP must not hold a transaction'); entered();
      return new Promise(resolve => options.signal.addEventListener('abort', () => resolve(result('failed', [], { errorCode: 'aborted' })), { once: true }));
    };
    store.startSpectraPublicFeedCollector(); store.startSpectraPublicFeedCollector();
    await started; await store.stopSpectraPublicFeedCollector();
    assert.equal(requests, 1); assert(fixture.queries.some(q => q.sql.includes("error_code = 'cancelled'")));
  });

  if (process.env.SPECTRA_PGLITE_MODULE) {
    await check('real PostgreSQL: migration, leases, versioning, readback, retention and denied API access', async () => {
      const { PGlite } = await import(process.env.SPECTRA_PGLITE_MODULE);
      const pg = new PGlite();
      try {
        await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.spectra_investigations(id uuid PRIMARY KEY);');
        const migration = fs.readFileSync(path.join(root, 'server/migrations/069_spectra_public_evidence_records.sql'), 'utf8');
        await pg.exec(migration); await pg.exec(migration);
        fixture.handler = async (sql, values) => {
          if (!values && sql.includes(';')) { await pg.exec(sql); return { rows: [] }; }
          return pg.query(sql, values);
        };
        await t.registerSources();
        let claimed = await t.claimFeed(source);
        assert(claimed); assert.equal(await t.claimFeed(source), null, 'live lease excludes another replica');
        const first = record('same');
        await t.persistFeedResult(source, claimed, result('ok', [first], { etag: 'fixture-v1' }));
        assert.equal(await t.claimFeed(source), null, 'durable due date excludes premature polling');
        const due = async () => pg.query('UPDATE spectra_public_feed_state SET next_due_at = now() WHERE provider=$1', [source.id]);
        await due(); claimed = await t.claimFeed(source); assert.equal(claimed.etag, 'fixture-v1');
        await t.persistFeedResult(source, claimed, result('ok', [{ ...first, retrievedAt: new Date(Date.now() + 1000).toISOString() }]));
        assert.equal((await pg.query('SELECT count(*)::int n FROM spectra_public_evidence_records')).rows[0].n, 1);
        await due(); claimed = await t.claimFeed(source);
        await t.persistFeedResult(source, claimed, result('ok', [record('same', { rawRecord: { magnitude: 3 }, retrievedAt: new Date(Date.now() + 2000).toISOString() })], { etag: 'fixture-v2' }));
        assert.equal((await pg.query('SELECT count(*)::int n FROM spectra_public_evidence_records')).rows[0].n, 2);
        const loaded = await store.readSpectraPublicFeedRecords();
        assert.equal(loaded.persistenceAvailable, true); assert.equal(loaded.records.length, 1); assert.equal(loaded.records[0].rawRecord.magnitude, 3);
        await pg.query("UPDATE spectra_public_feed_state SET next_due_at=now(), last_full_fetch_at=now()-interval '2 days' WHERE provider=$1", [source.id]);
        claimed = await t.claimFeed(source); assert.equal(claimed.etag, null, 'aged validators force a complete new fetch');
        await pg.query("UPDATE spectra_public_evidence_records SET last_seen_at=now()-interval '40 days'");
        await t.pruneFeedRecords();
        assert.equal((await pg.query('SELECT count(*)::int n FROM spectra_public_evidence_records')).rows[0].n, 0);
        await pg.exec('SET ROLE anon');
        await assert.rejects(pg.query('SELECT * FROM spectra_public_evidence_records'), /permission denied/);
        await pg.exec('RESET ROLE');
      } finally { await pg.close(); }
    });
  }
  assert(!JSON.stringify(logs).includes('DO_NOT_LOG_PRIVATE_PAYLOAD'));
  savedInfo(`${passed} public-feed store checks passed; no external HTTP or production database access.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  console.info = savedInfo; console.warn = savedWarn;
  delete global.__spectraStoreFixture;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  fs.rmSync(temp, { recursive: true, force: true });
});
