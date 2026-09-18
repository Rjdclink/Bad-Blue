/**
 * SPECTRA / GeoConsole architecture verification.
 * Static invariants only: no network calls, deployment, or sample data.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function test(name, condition) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
}

const dashboard = read('client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
const map = read('client/src/components/geoconsole/MapLibreIntelligenceMap.tsx');
const runtime = read('client/src/hooks/useGeoRuntime.ts');
const tshpe = read('client/src/hooks/useTSHPELocator.ts');
const routes = read('server/routes/geoconsole.routes.ts');
const gpsRoutes = read('server/routes/gps.routes.ts');
const fusion = read('server/services/geoconsole/inputFusionEngine.ts');
const futurecast = read('server/services/geoconsole/monteCarloPathEngine.ts');
const media = read('server/services/locationIntelligence/MediaMetadataExtractor.ts');
const app = read('client/src/App.tsx');
const spectra = read('client/src/pages/spectra.tsx');
const spectraRoutes = read('server/routes/spectra.routes.ts');
const peopleRoute = read('server/routes/peopleSearch.routes.ts');
const peopleTypes = read('server/services/peopleSearch/types.ts');

console.log('\nSPECTRA / GEOCONSOLE INVARIANTS\n');

test('Primary dashboard uses canonical MapLibre renderer',
  dashboard.includes('MapLibreIntelligenceMap'));
test('Primary dashboard does not import Leaflet',
  !dashboard.includes("from 'leaflet'"));
test('MapLibre provides real terrain',
  map.includes("type: 'raster-dem'") && map.includes('map.setTerrain'));
test('MapLibre provides 3D building extrusion',
  map.includes("type: 'fill-extrusion'"));
test('MapLibre distinguishes predicted observations',
  map.includes('observationKind') && map.includes("'predicted'"));
test('Manual map gestures release follow mode',
  map.includes('onUserInteraction?.()') && dashboard.includes('setLockOnTarget(false)'));
test('Street imagery is hidden behind internal adapter',
  map.includes('/api/geoconsole/street-imagery') && !map.includes('api.openstreetcam.org'));
test('Earth observation layer is time-aware',
  map.includes('NASA_GIBS_TEMPLATE') && map.includes('nasaGibsTilesFor'));
test('Weather radar layer is timeline-aware with live/archive cache strategy',
  map.includes('weatherRadarTilesFor') &&
  map.includes('/cache/tile.py/1.0.0/{layer}') &&
  map.includes('/c/tile.py/1.0.0/{layer}') &&
  dashboard.includes('timelineContextTime'));
test('Candidate source separates point and uncertainty geometries',
  map.includes("filter: ['==', ['geometry-type'], 'Point']") &&
  map.includes("filter: ['==', ['geometry-type'], 'Polygon']"));

test('Runtime uses rolling previous hour',
  runtime.includes('ONE_HOUR_MS = 60 * 60 * 1000'));
test('Runtime futurecast horizon is one hour',
  runtime.includes('FUTURECAST_HOURS = 1'));
test('Runtime automatically invokes canonical processing',
  runtime.includes("fetch('/api/geoconsole/process'"));
test('Runtime renders server processed trail',
  runtime.includes('payload?.data?.trail?.points'));
test('Runtime futurecast uses server authority',
  runtime.includes("fetch('/api/geoconsole/futurecast'"));
test('Runtime contains no mock-frame generator',
  !runtime.includes('generateMockFrames'));

test('TSHPE has no random weighting authority',
  !tshpe.includes('Math.random()') && !tshpe.includes('MonteCarloSimulator'));
test('TSHPE has no client IP-geolocation dependency',
  !tshpe.includes('ipapi.co'));
test('TSHPE routes observations through canonical GeoConsole',
  tshpe.includes("fetch('/api/geoconsole/process'"));

test('GeoConsole routes require authentication',
  routes.includes('router.use(isAuthenticated)'));
test('GPS/media routes require authentication',
  gpsRoutes.includes('router.use(isAuthenticated)'));
test('People-search route requires authentication',
  peopleRoute.includes("router.post('/', isAuthenticated"));
test('Process response includes signed actual trail frames',
  routes.includes('points: signedTrailPoints') &&
  routes.includes('signServerEvidence'));
test('Street imagery adapter is provider-neutral to client',
  routes.includes("router.get('/street-imagery'"));

test('Fusion uses correlation groups',
  fusion.includes('correlationKey') && fusion.includes('correlationGroup'));
test('Fusion uses source-specific modeled accuracy',
  fusion.includes('defaultAccuracyMeters') && fusion.includes('effectiveAccuracyMeters'));
test('Fusion confidence uses independent evidence',
  fusion.includes('independentRepresentatives'));
test('Fusion does not decay historical reconstruction against wall clock',
  !fusion.includes('Date.now() - point.timestamp.getTime()'));
test('Single-source positions receive modeled accuracy',
  fusion.includes('accuracy: this.effectiveAccuracyMeters(point)'));
test('Futurecast defaults to one hour',
  futurecast.includes('hours: number = 1'));
test('Futurecast uses five-minute frames',
  futurecast.includes('const stepMinutes = 5'));
test('Futurecast is explicitly classified as predicted',
  futurecast.includes("observationKind: 'predicted'"));

test('Media pipeline extracts capture metadata',
  media.includes('dateTimeOriginal') && media.includes('gpsDateStamp'));
test('Media pipeline extracts device metadata',
  media.includes('serialNumber') && media.includes('lensModel'));
test('Upload route does not accept client filesystem paths',
  !gpsRoutes.includes("router.post('/extract'"));

test('People Finder compatibility route converges on SPECTRA',
  app.includes('<Route path="/people-finder" component={SpectraPage} />'));
test('SPECTRA does not promote regional hints into timed observations',
  spectra.includes('candidateLocations={candidateLocations}') &&
  spectraRoutes.includes('if (locationObservations.length === 0)') &&
  spectraRoutes.includes("basis: 'regional_context'"));
test('Phone is part of canonical People Search query and SPECTRA extraction',
  peopleTypes.includes('phone?: string') &&
  spectraRoutes.includes('extractPhoneNumber'));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
