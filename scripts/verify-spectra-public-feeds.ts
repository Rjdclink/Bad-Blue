import assert from 'node:assert/strict';
import { collectSpectraPublicFeed, SPECTRA_PUBLIC_FEED_SOURCES } from '../server/services/spectra/SpectraPublicFeeds.ts';

function json(payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json', ...headers } });
}

function fixtureFetch(payload: unknown): typeof fetch {
  return async () => json(payload);
}

function earthquake(id = 'test-event') {
  return { type: 'Feature', id, properties: {
    title: 'M 2.5 - Fictional test event', time: 1_796_400_000_000,
    updated: 1_796_400_100_000, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
  }, geometry: { type: 'Point', coordinates: [-100, 40, 7] } };
}

function alert(id = 'test-alert') {
  return { type: 'Feature', id: `https://api.weather.gov/alerts/${id}`, geometry: null,
    properties: { headline: 'Fictional alert', event: 'Test', sent: '2026-10-10T12:00:00-05:00',
      onset: '2026-10-10T18:00:00Z', affectedZones: ['https://api.weather.gov/zones/forecast/ILZ001'],
      geocode: { UGC: ['ILZ001'] }, description: 'Original complete alert text' } };
}

{
  const raw = earthquake();
  let called = 0;
  const result = await collectSpectraPublicFeed('usgs-earthquakes', { fetchImpl: async (url, options) => {
    called++;
    assert.equal(url, SPECTRA_PUBLIC_FEED_SOURCES[0].endpoint);
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.credentials, 'omit');
    assert.ok(options?.signal);
    assert.ok(new Headers(options?.headers).get('user-agent'));
    assert.equal(new Headers(options?.headers).get('authorization'), null);
    return json({ type: 'FeatureCollection', features: [raw] }, { etag: '"v1"' });
  } });
  assert.equal(called, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.etag, '"v1"');
  assert.equal(result.records[0].recordId, raw.id);
  assert.deepEqual(result.records[0].rawRecord, raw);
  assert.deepEqual(result.records[0].geometry, raw.geometry);
  assert.equal(result.records[0].observedAt, new Date(raw.properties.time).toISOString());
  assert.equal(result.records[0].sourceUpdatedAt, new Date(raw.properties.updated).toISOString());
  assert.equal(result.records[0].classification, 'public_geographic_context');
  assert.ok(result.records[0].limitations.some(value => value.includes('person or device')));
  assert.ok(!('latitude' in result.records[0]));
}

{
  const raw = { id: 'EONET_test', title: 'Fictional natural event',
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_test',
    sources: [{ id: 'SOURCE', url: 'https://source.example.test/full-original-record' }],
    geometry: [
      { date: '2026-10-08T00:00:00Z', type: 'Point', coordinates: [20, 30] },
      { date: '2026-10-09T12:30:00Z', type: 'Polygon', coordinates: [[[20, 30], [21, 30], [21, 31], [20, 30]]] },
    ],
  };
  const result = await collectSpectraPublicFeed('nasa-eonet', { fetchImpl: fixtureFetch({ events: [raw] }) });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.records[0].rawRecord, raw);
  assert.deepEqual(result.records[0].geometry, { type: 'GeometryCollection', geometries: raw.geometry });
  assert.equal(result.records[0].observedAt, '2026-10-09T12:30:00.000Z');
  assert.equal(result.records[0].sourceUpdatedAt, null);
  assert.ok(result.records[0].limitations.some(value => value.includes('Midnight')));
}

{
  const raw = alert();
  const result = await collectSpectraPublicFeed('nws-alerts', { fetchImpl: fixtureFetch({ type: 'FeatureCollection', features: [raw] }) });
  assert.equal(result.status, 'ok');
  assert.equal(result.records[0].recordId, 'test-alert');
  assert.equal(result.records[0].geometry, null);
  assert.equal(result.records[0].observedAt, null, 'alert onset/issuance must not be invented as an observation');
  assert.equal(result.records[0].sourceUpdatedAt, '2026-10-10T17:00:00.000Z');
  assert.deepEqual(result.records[0].rawRecord, raw, 'zones and full alert descriptions must be retained');
}

for (const source of SPECTRA_PUBLIC_FEED_SOURCES) {
  const payload = source.id === 'nasa-eonet' ? { events: [] } : { type: 'FeatureCollection', features: [] };
  const empty = await collectSpectraPublicFeed(source.id, { fetchImpl: fixtureFetch(payload) });
  assert.equal(empty.status, 'ok', 'a genuine empty snapshot is successful');
  assert.deepEqual(empty.records, []);
  assert.equal(empty.errorCode, undefined);
}

{
  const raw = { ...earthquake(), properties: { time: null, updated: 'not-a-time', url: 'https://attacker.example/event', title: 'Test' },
    geometry: { type: 'Point', coordinates: ['40', -100] } };
  const result = await collectSpectraPublicFeed('usgs-earthquakes', { fetchImpl: fixtureFetch({ type: 'FeatureCollection', features: [raw] }) });
  assert.equal(result.status, 'ok');
  assert.equal(result.records[0].geometry, null);
  assert.equal(result.records[0].observedAt, null);
  assert.equal(result.records[0].sourceUpdatedAt, null);
  assert.equal(new URL(result.records[0].sourceUrl).hostname, 'earthquake.usgs.gov');
  assert.deepEqual(result.records[0].rawRecord, raw);
}

{
  const result = await collectSpectraPublicFeed('nasa-eonet', { fetchImpl: fixtureFetch({ events: [{ id: 'EONET_missing', geometry: [] }] }) });
  assert.equal(result.records[0].geometry, null);
  assert.equal(result.records[0].observedAt, null);
  const invalidDate = await collectSpectraPublicFeed('nasa-eonet', { fetchImpl: fixtureFetch({ events: [{
    id: 'EONET_bad_date', geometry: [{ date: '2026-02-30T00:00:00Z', type: 'Point', coordinates: [0, 0] }],
  }] }) });
  assert.equal(invalidDate.records[0].observedAt, null, 'invalid calendar dates must not roll forward into invented dates');
}

for (const [fetchImpl, code] of [
  [async () => new Response('rate limited', { status: 429 }), 'http_429'],
  [async () => new Response('bad json', { headers: { 'content-type': 'application/json' } }), 'invalid_json'],
  [async () => new Response('<html>Unavailable</html>', { headers: { 'content-type': 'text/html' } }), 'unsupported_content_type'],
  [fixtureFetch({ error: 'Provider unavailable' }), 'provider_error'],
  [fixtureFetch({ features: [] }), 'invalid_payload'],
  [async () => { throw new Error('Network problem'); }, 'network_error'],
] as const) {
  const result = await collectSpectraPublicFeed('usgs-earthquakes', { fetchImpl });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, code);
  assert.deepEqual(result.records, []);
}

{
  const result = await collectSpectraPublicFeed('usgs-earthquakes', { etag: '"before"', fetchImpl: async (_url, options) => {
    assert.equal(new Headers(options?.headers).get('if-none-match'), '"before"');
    return new Response(null, { status: 304, headers: { etag: '"after"' } });
  } });
  assert.equal(result.status, 'not_modified');
  assert.equal(result.etag, '"after"');
  assert.deepEqual(result.records, []);
  const unsolicited = await collectSpectraPublicFeed('usgs-earthquakes', { fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal(unsolicited.errorCode, 'unexpected_not_modified');
}

{
  const result = await collectSpectraPublicFeed('usgs-earthquakes', { fetchImpl: async () => json({}, { 'content-length': String(8 * 1024 * 1024 + 1) }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'body_too_large');
  const streamed = await collectSpectraPublicFeed('usgs-earthquakes', { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); controller.close(); },
  })) });
  assert.equal(streamed.errorCode, 'body_too_large', 'body cap also applies when Content-Length is absent');
  const hugeRecord = { ...earthquake('huge'), extra: 'x'.repeat(256 * 1024) };
  const recordLimit = await collectSpectraPublicFeed('usgs-earthquakes', {
    fetchImpl: fixtureFetch({ type: 'FeatureCollection', features: [hugeRecord, earthquake('small')] }),
  });
  assert.equal(recordLimit.status, 'partial');
  assert.equal(recordLimit.errorCode, 'record_too_large');
  assert.deepEqual(recordLimit.records.map(record => record.recordId), ['small']);
}

{
  let requests = 0;
  const result = await collectSpectraPublicFeed('nws-alerts', { fetchImpl: async () => {
    requests++;
    return json({ type: 'FeatureCollection', features: [alert(`page-${requests}`)],
      pagination: { next: `https://api.weather.gov/alerts/active?cursor=${requests}` } }, { etag: '"first-page"' });
  } });
  assert.equal(requests, 3);
  assert.equal(result.status, 'partial');
  assert.equal(result.errorCode, 'pagination_limit');
  assert.equal(result.records.length, 3);
  assert.equal(result.nextUrl, 'https://api.weather.gov/alerts/active?cursor=3');
  assert.equal(result.etag, undefined);
}

for (const next of ['https://attacker.example/alerts/active?cursor=2', 'https://api.weather.gov/points/0,0', 'https://api.weather.gov/alerts?cursor=2', 'https://api.weather.gov/alerts/active?cursor=2&redirect=https://attacker.example']) {
  let requests = 0;
  const result = await collectSpectraPublicFeed('nws-alerts', { fetchImpl: async () => {
    requests++;
    return json({ type: 'FeatureCollection', features: [alert()], pagination: { next } });
  } });
  assert.equal(requests, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.errorCode, 'untrusted_next_url');
  assert.equal(result.records.length, 1, 'valid fetched records remain available when pagination is rejected');
}

{
  let requests = 0;
  const result = await collectSpectraPublicFeed('nws-alerts', { fetchImpl: async (_url, options) => {
    requests++;
    if (requests === 2) {
      assert.equal(new Headers(options?.headers).get('if-none-match'), null);
      return json({ type: 'FeatureCollection', features: [alert('first'), alert('second')] });
    }
    return json({ type: 'FeatureCollection', features: [alert('first')], pagination: { next: 'https://api.weather.gov/alerts?active=true&cursor=2' } }, { etag: '"page1"' });
  } });
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 2, 'overlapping pages are deduplicated by stable provider ID');
  assert.equal(result.etag, undefined, 'first-page validators cannot attest to later pages');
}

{
  const result = await collectSpectraPublicFeed('nasa-eonet', { fetchImpl: fixtureFetch({
    events: Array.from({ length: 100 }, (_, index) => ({ id: `EONET_${index}`, geometry: [] })),
  }) });
  assert.equal(result.status, 'partial');
  assert.equal(result.errorCode, 'source_limit', 'EONET has no documented pagination; a full limit is not a complete catalog');
  const invalid = await collectSpectraPublicFeed('usgs-earthquakes', { fetchImpl: fixtureFetch({
    type: 'FeatureCollection', features: [earthquake(), { type: 'Feature', properties: {} }],
  }) });
  assert.equal(invalid.status, 'partial');
  assert.equal(invalid.errorCode, 'invalid_records');
  assert.equal(invalid.records.length, 1);
}

{
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const result = await collectSpectraPublicFeed('usgs-earthquakes', { signal: controller.signal, fetchImpl: async () => { called = true; return json({}); } });
  assert.equal(result.errorCode, 'aborted');
  assert.equal(called, false);
  const during = new AbortController();
  const timer = setTimeout(() => during.abort(), 15);
  const stalled = await collectSpectraPublicFeed('usgs-earthquakes', { signal: during.signal,
    fetchImpl: async () => new Response(new ReadableStream({ start() { /* intentionally stalled response */ } })),
  });
  clearTimeout(timer);
  assert.equal(stalled.errorCode, 'aborted', 'the deadline signal must interrupt a stalled body reader');
}

assert.equal((await collectSpectraPublicFeed('unknown')).errorCode, 'unsupported_provider');
console.log('SPECTRA public feed adapters: official-record normalization, provenance, bounds, pagination, cache and failure checks passed.');
