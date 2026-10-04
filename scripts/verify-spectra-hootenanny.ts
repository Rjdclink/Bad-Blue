import assert from 'node:assert/strict';
import {
  acquireSpectraHootenannyContext,
  spectraHootenannyConfigured,
  submitSpectraHootenannyConflation,
} from '../server/services/spectra/SpectraHootenannyContext';
import { acquireSpectraPlaceContext } from '../server/services/spectra/SpectraPlaceContext';
import { getSpectraAdapterCapabilities } from '../server/services/spectra/SpectraAdapterRegistry';

const originalFetch = globalThis.fetch;
const original = {
  base: process.env.SPECTRA_HOOTENANNY_BASE_URL,
  map: process.env.SPECTRA_HOOTENANNY_MAP_ID,
  tokenEnv: process.env.SPECTRA_HOOTENANNY_TOKEN_ENV,
  token: process.env.SPECTRA_HOOTENANNY_TEST_TOKEN,
};

const xml = `<osm version="0.6">
  <node id="1" lat="43" lon="-96" />
  <node id="2" lat="43.002" lon="-96" />
  <node id="3" lat="43.002" lon="-95.998" />
  <node id="4" lat="43.001" lon="-95.999"><tag k="amenity" v="library"/><tag k="name" v="Library"/></node>
  <node id="5" lat="" lon="-96"><tag k="amenity" v="invalid"/></node>
  <node id="6" lat="120" lon="-96"><tag k="amenity" v="invalid"/></node>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
  <way id="11"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="building" v="yes"/></way>
  <way id="12"><nd ref="missing"/><tag k="highway" v="residential"/></way>
</osm>`;

async function main() {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  process.env.SPECTRA_HOOTENANNY_BASE_URL = 'https://hoot.example/hoot-services';
  process.env.SPECTRA_HOOTENANNY_MAP_ID = 'map-7';
  process.env.SPECTRA_HOOTENANNY_TOKEN_ENV = 'SPECTRA_HOOTENANNY_TEST_TOKEN';
  process.env.SPECTRA_HOOTENANNY_TEST_TOKEN = 'example-token';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.includes('/osm/api/0.6/map/')) {
      return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    if (url.pathname.endsWith('/conflation/execute')) {
      return Response.json({ jobId: 'job-1' });
    }
    return Response.json({ elements: [], results: [] });
  }) as typeof fetch;

  try {
    assert.equal(spectraHootenannyConfigured(), true);
    const capability = () => getSpectraAdapterCapabilities()
      .find(adapter => adapter.id === 'hootenanny-conflated-map-context');
    assert.equal(capability()?.configured, true);
    delete process.env.SPECTRA_HOOTENANNY_MAP_ID;
    assert.equal(capability()?.configured, false, 'both service URL and map ID are required');
    process.env.SPECTRA_HOOTENANNY_MAP_ID = 'map-7';
    const features = await acquireSpectraHootenannyContext(43.001, -95.999, 300);
    assert.equal(features.length, 3, 'only located road, building, and POI should survive');
    const road = features.find(feature => feature.id === '10');
    const building = features.find(feature => feature.id === '11');
    assert.equal(road?.tags.highway, 'residential');
    assert.equal(road?.geometry?.length, 2);
    assert.equal(building?.geometry?.length, 4);
    assert.ok(Math.abs((building?.latitude ?? 0) - (43 + 43.002 + 43.002) / 3) < 1e-8);
    assert.ok(features.every(feature => feature.contextOnly));

    const mapRequest = requests.find(request => request.url.pathname.includes('/osm/api/0.6/map/'));
    assert.ok(mapRequest?.url.pathname.includes('/map/map-7/'));
    assert.equal((mapRequest?.init?.headers as Record<string, string>).Authorization, 'Bearer example-token');

    const places = await acquireSpectraPlaceContext(43.001, -95.999, 300);
    const conflated = places.filter(place => place.provider === 'Hootenanny');
    assert.deepEqual(conflated.map(place => place.category).sort(), ['building', 'poi', 'road']);
    assert.equal((conflated.find(place => place.category === 'road')?.metadata?.geometry as unknown[])?.length, 2);
    assert.ok(conflated.every(place => place.metadata?.contextOnly === true));

    const job = await submitSpectraHootenannyConflation({
      input1: 'roads', input2: 'buildings', outputName: 'conflated-map',
    });
    assert.equal(job?.jobId, 'job-1');
    const submission = requests.find(request => request.url.pathname.endsWith('/conflation/execute'));
    assert.equal(JSON.parse(String(submission?.init?.body)).OUTPUT_NAME, 'conflated-map');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      SPECTRA_HOOTENANNY_BASE_URL: original.base,
      SPECTRA_HOOTENANNY_MAP_ID: original.map,
      SPECTRA_HOOTENANNY_TOKEN_ENV: original.tokenEnv,
      SPECTRA_HOOTENANNY_TEST_TOKEN: original.token,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().then(
  () => console.log('SPECTRA Hootenanny context verification passed.'),
  error => { console.error(error); process.exitCode = 1; },
);
