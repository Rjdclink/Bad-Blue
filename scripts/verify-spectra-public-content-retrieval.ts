import assert from 'node:assert/strict';
import { htmlEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const source = 'https://public-library.example.org/locations/central';
const hugeNavigation = 'Menu shortcut services ' .repeat(5_000);
const lateMain = htmlEvidence(
  '<!doctype html><html><head><title>Central Library</title>'
  + '<meta property="article:published_time" content="2026-09-11">'
  + '</head><body><header><nav>' + hugeNavigation + '</nav></header>'
  + '<main><h1>Central Library</h1>'
  + '<p>Public institutional address: 700 Boylston Street, Boston, MA 02116.</p>'
  + '</main><footer>Old navigation references to unrelated cities</footer></body></html>',
  source,
);
assert.ok(lateMain.textExcerpt?.includes('700 Boylston Street, Boston, MA'),
  'public institution address after a long navigation header must survive');
assert.ok(!lateMain.textExcerpt?.includes('Menu shortcut services'),
  'navigation controls should not displace source evidence');
assert.equal(lateMain.publishedAt, '2026-09-11T00:00:00.000Z',
  'publication date in head survives content extraction');
assert.equal(lateMain.title, 'Central Library');

const fallback = htmlEvidence(
  '<html><body><header><nav>Navigation irrelevant city noise</nav></header>'
  + '<section><h1>Wisconsin Historical Society</h1>'
  + '<p>816 State St., Madison, WI 53706, public institution headquarters.</p>'
  + '</section><footer>Footer irrelevant archive</footer></body></html>',
  'https://venue.example.net/history',
);
assert.ok(fallback.textExcerpt?.includes('Madison, WI 53706'),
  'body fallback should recover venue address without semantic main');
assert.ok(!fallback.textExcerpt?.includes('Footer irrelevant archive'),
  'footer boilerplate must not corrupt evidence excerpt');
assert.equal(fallback.publishedAt, undefined,
  'page retrieval without a publication date remains undated');

const proseWithNoMain = htmlEvidence(
  '<html><body><article><h1>Public library address</h1>'
  + '<p>Seattle Central Library is at 1000 Fourth Ave, Seattle, WA 98104.</p>'
  + '</article><aside>' + hugeNavigation + '</aside></body></html>',
  'https://visit.example.org/venues',
);
assert.ok(proseWithNoMain.textExcerpt?.includes('1000 Fourth Ave, Seattle, WA'),
  'article evidence must be retained when body also has large sidebars');
assert.ok(!proseWithNoMain.textExcerpt?.includes('Menu shortcut services'),
  'sidebars must not override article text');

// Source-page GPS still describes that page's geospatial context, not an
// individual's position; publication time remains separate from retrieval.
const metadataPage = htmlEvidence(
  '<html><head><meta name="geo.position" content="42.3;-71.1">'
  + '</head><body><main><p>Public building coordinates.</p></main></body></html>',
  source,
);
assert.equal(metadataPage.observations.length, 1);
assert.equal(metadataPage.observations[0].acquisitionMethod, 'html-geospatial-metadata');
assert.equal(metadataPage.observations[0].latitude, 42.3);
assert.equal(metadataPage.publishedAt, undefined);

const malformedGeo = htmlEvidence(
  '<html><head><script type="application/ld+json">'
  + '{"@type":"Place","geo":{"latitude":false,"longitude":[]}}'
  + '</script></head><body><main>Public venue listing.</main></body></html>',
  source,
);
assert.equal(malformedGeo.observations.length, 0,
  'boolean and array geotags must not produce invented zero coordinates');

const validZeroGeo = htmlEvidence(
  '<html><head><script type="application/ld+json">'
  + '{"@type":"Place","geo":{"latitude":0,"longitude":"0"}}'
  + '</script></head><body><main>Valid equatorial point.</main></body></html>',
  source,
);
assert.equal(validZeroGeo.observations.length, 1,
  'explicit numeric zero coordinates remain valid');

console.log('SPECTRA public page content extraction passed: long navigation, semantic main/article, body fallback, independent publication date and unbound venue metadata.');
