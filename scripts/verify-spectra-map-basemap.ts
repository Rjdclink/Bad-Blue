// Run with: node --import tsx scripts/verify-spectra-map-basemap.ts
import assert from 'node:assert/strict';
import { NASA_BASEMAP, satelliteBasemap, satelliteStyle, mapDeadline } from '../client/src/components/geoconsole/mapBasemap';

const style = satelliteStyle();
const source = style.sources['spectra-satellite'];
assert.equal(source.type, 'raster');
if (source.type !== 'raster') throw new Error('Expected a raster source');
assert.equal(source.tileSize, 256);
assert.equal(source.maxzoom, 8, 'Never request nonexistent NASA zoom levels');
assert.equal(source.tiles?.[0].replace('{z}', '3').replace('{y}', '2').replace('{x}', '1'),
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/3/2/1.jpeg');
assert.match(NASA_BASEMAP.label, /2004 composite/, 'Historical imagery must not be labeled live');
assert.equal(satelliteBasemap().tiles, NASA_BASEMAP.tiles);
const custom = satelliteBasemap('https://tiles.example.test/{z}/{x}/{y}.jpg', 'Test provider');
const customSource = satelliteStyle(custom).sources['spectra-satellite'];
assert.equal(customSource.type, 'raster');
if (customSource.type !== 'raster') throw new Error('Expected a custom raster source');
assert.equal(customSource.attribution, 'Test provider');
assert.equal(custom.maxNativeZoom, 19);
assert.equal(style.layers[1].id, 'spectra-satellite', 'Base imagery exists before evidence or an initial location');

// Exercise cancellation and rearming without a browser, real timers or network.
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const pending = new Map<number, () => void>();
let sequence = 0;
globalThis.setTimeout = ((fn: () => void) => { pending.set(++sequence, fn); return sequence; }) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => pending.delete(id)) as unknown as typeof clearTimeout;
try {
  let fallsBack = 0;
  const deadline = mapDeadline(() => fallsBack++);
  deadline.arm(); deadline.arm();
  assert.equal(pending.size, 1, 'Only one deadline survives a rearm');
  assert.equal(deadline.isPending(), true);
  deadline.cancel();
  assert.equal(pending.size, 0, 'Ready/unmount must cancel pending recovery');
  assert.equal(deadline.isPending(), false);
  deadline.arm();
  const callback = [...pending.values()][0]; pending.clear(); callback();
  assert.equal(fallsBack, 1, 'An unresponsive map must leave the startup state');
  deadline.cancel();
  assert.equal(pending.size, 0);
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
console.log('PASS: NASA basemap, custom attribution, native zoom and bounded map recovery');
