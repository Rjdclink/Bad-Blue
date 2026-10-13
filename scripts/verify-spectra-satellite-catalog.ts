import assert from 'node:assert/strict';
import { collectSpectraEarthSearchScenes } from '../server/services/spectra/SpectraPublicSatelliteRecords';

const from = new Date('2026-10-01T00:00:00.000Z');
const to = new Date('2026-10-12T00:00:00.000Z');
const feature = (id: string, collection: string, datetime: string, extra: Record<string, unknown> = {}) => ({
  id, collection, bbox: [-105.2, 39.1, -105.1, 39.2],
  properties: { datetime, 'eo:cloud_cover': 15, platform: 'Sentinel-2A' },
  links: [{ rel: 'preview', href: 'https://example.org/thumbnail.jpg' },
    { rel: 'self', href: 'javascript:alert(1)' }],
  ...extra,
});
let requests = 0;
const results = await collectSpectraEarthSearchScenes(39.15, -105.15, from, to, {
  fetchImpl: async (request, options) => {
    requests++;
    assert.equal(String(request), 'https://earth-search.aws.element84.com/v1/search');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('Authorization'), null);
    const body = JSON.parse(String(options?.body || '{}'));
    assert.deepEqual(body.collections, ['sentinel-2-c1-l2a', 'landsat-c2-l2']);
    assert.equal(body.limit, 20);
    return new Response(JSON.stringify({ features: [
      feature('s2', 'sentinel-2-c1-l2a', '2026-10-10T09:15:00Z'),
      feature('landsat', 'landsat-c2-l2', '2026-10-11T10:00:00Z'),
      feature('s2', 'sentinel-2-c1-l2a', '2026-10-10T09:15:00Z'),
      feature('outside', 'sentinel-2-c1-l2a', '2012-01-01T00:00:00Z'),
      feature('unexpected', 'external-collection', '2026-10-09T00:00:00Z'),
    ] }), { headers: { 'content-type': 'application/geo+json' } });
  },
});
assert.equal(requests, 1);
assert.deepEqual(results.map(item => item.id), ['landsat', 's2']);
assert(results.every(item => item.provider === 'Element 84 Earth Search'));
assert.equal(results[0].links.length, 1);
assert.equal(results[0].links[0].rel, 'preview');
assert.equal(results[0].observedAt, '2026-10-11T10:00:00.000Z');
assert.equal(results[0].cloudCover, 15);
assert.equal(await collectSpectraEarthSearchScenes(95, -105, from, to, {
  fetchImpl: async () => { throw new Error('invalid coordinates must not fetch'); },
}).then(items => items.length), 0);
assert.equal((await collectSpectraEarthSearchScenes(39, -105, from, to, {
  fetchImpl: async () => new Response('{"features":[]}', {
    headers: { 'content-type': 'application/json', 'content-length': '800000' },
  }),
})).length, 0, 'oversized response headers must fail closed');
assert.equal((await collectSpectraEarthSearchScenes(39, -105, from, to, {
  fetchImpl: async () => new Response('<html>not a catalogue</html>', {
    headers: { 'content-type': 'text/html' },
  }),
})).length, 0, 'HTML must not count as satellite catalogue evidence');
assert.equal((await collectSpectraEarthSearchScenes(39, -105, from, to, {
  fetchImpl: async () => { throw new Error('temporary satellite outage'); },
})).length, 0, 'unavailable sources must not fabricate imagery');
console.log('SPECTRA Earth Search: bounded, keyless Sentinel/Landsat catalog and negative cases passed.');
