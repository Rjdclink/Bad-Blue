/**
 * SPECTRA / GeoConsole wiring verification.
 * Verifies that the client -> authenticated API -> canonical engines -> renderer
 * path is present without executing production services.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const test = (name, condition) => {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
};

const dashboard = read('client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
const map = read('client/src/components/geoconsole/MapLibreIntelligenceMap.tsx');
const runtime = read('client/src/hooks/useGeoRuntime.ts');
const routes = read('server/routes/geoconsole.routes.ts');
const hybrid = read('server/services/geoconsole/index.ts');
const fusion = read('server/services/geoconsole/inputFusionEngine.ts');
const futurecast = read('server/services/geoconsole/monteCarloPathEngine.ts');
const gpsRoutes = read('server/routes/gps.routes.ts');
const tshpe = read('client/src/hooks/useTSHPELocator.ts');

console.log('\nSPECTRA / GEOCONSOLE WIRING\n');

test('Dashboard -> canonical renderer',
  dashboard.includes('<MapLibreIntelligenceMap'));
test('Dashboard exposes weather-map-style -1h/+1h timeline',
  dashboard.includes('min={-60}') && dashboard.includes('max={60}'));
test('Dashboard timeline distinguishes Futurecast',
  dashboard.includes('timelineIsPrediction') && dashboard.includes('Futurecast'));
test('Map supports touch/mouse native navigation',
  map.includes('new maplibregl.Map') && map.includes('NavigationControl'));
test('Map follows target only while FIX remains enabled',
  map.includes('lockOnTarget') && map.includes('onUserInteraction'));

test('Runtime -> /process',
  runtime.includes("fetch('/api/geoconsole/process'"));
test('/process -> HybridGeoconsole',
  routes.includes('hybridGeoconsole.processLocationData'));
test('HybridGeoconsole -> InputFusionEngine',
  hybrid.includes('this.inputFusionEngine.fuseInputs'));
test('HybridGeoconsole -> motion trail',
  hybrid.includes('generateMotionTrail'));
test('HybridGeoconsole -> Futurecast',
  hybrid.includes('generateFuturecast'));
test('/process returns fused locations, trail and futurecast',
  routes.includes('fusedLocations: result.fusedLocations') &&
  routes.includes('points: result.trail.points') &&
  routes.includes('futurecast: result.futurecast'));
test('Runtime consumes processed trail',
  runtime.includes('processedTrail'));
test('Runtime consumes process Futurecast',
  runtime.includes("payload?.data?.futurecast"));

test('A single real observation remains renderable without synthetic motion',
  futurecast.includes("if (points.length === 0)") &&
  futurecast.includes('const sortedPoints = [...points]') &&
  futurecast.includes('points: trailPoints'));
test('Futurecast is server-only; browser failure produces no alternate prediction authority',
  runtime.includes("authority: 'server'") &&
  !runtime.includes("authority: 'client_fallback'") &&
  !runtime.includes('generateLocalFuturecastFallback'));
test('Historical evidence is not promoted to observation truth',
  fusion.includes("return 'historical'") &&
  futurecast.includes("point.observationKind !== 'predicted'"));
test('Predictions preserve provenance and remain classified separately',
  futurecast.includes("provider: 'canonical_geoconsole_futurecast'") &&
  futurecast.includes("observationKind: 'predicted'"));

test('Uploaded media -> authenticated extraction route and canonical acquisition',
  gpsRoutes.includes("router.post('/extract-upload'") &&
  gpsRoutes.includes('extractMediaMetadata') &&
  read('server/routes/spectra.routes.ts').includes('directEvidence'));
test('Street imagery -> authenticated internal adapter',
  routes.includes("router.get('/street-imagery'") &&
  map.includes('/api/geoconsole/street-imagery'));
test('TSHPE compatibility path -> canonical process/futurecast',
  tshpe.includes("fetch('/api/geoconsole/process'") &&
  tshpe.includes("fetch('/api/geoconsole/futurecast'"));

test('No Leaflet authority in primary dashboard',
  !dashboard.includes("import L from 'leaflet'"));
test('No synthetic TSHPE system-health randomness',
  !tshpe.includes('Math.random()'));
test('No direct TSHPE client IP lookup',
  !tshpe.includes('ipapi.co'));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
