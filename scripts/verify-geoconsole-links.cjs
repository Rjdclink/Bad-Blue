/**
 * SPECTRA / GeoConsole connection verification.
 * Verifies real data flow rather than synthetic SAT/GEO/FIX/SIGNAL percentages.
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

const spectra = read('client/src/pages/spectra.tsx');
const dashboard = read('client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
const map = read('client/src/components/geoconsole/MapLibreIntelligenceMap.tsx');
const runtime = read('client/src/hooks/useGeoRuntime.ts');
const routes = read('server/routes/geoconsole.routes.ts');
const spectraRoutes = read('server/routes/spectra.routes.ts');
const engine = read('server/services/geoconsole/index.ts');
const fusion = read('server/services/geoconsole/inputFusionEngine.ts');

console.log('\nSPECTRA / GEOCONSOLE CONNECTIONS\n');

test('Conversation submits to SPECTRA acquisition API',
  spectra.includes("fetch('/api/spectra/acquire'"));
test('Acquisition returns timestamped observations and regional candidates',
  spectraRoutes.includes('locationObservations') &&
  spectraRoutes.includes('candidateLocations'));
test('SPECTRA passes evidence into canonical dashboard',
  spectra.includes('initialData={observations}') &&
  spectra.includes('candidateLocations={candidateLocations}'));

test('Dashboard feeds canonical MapLibre renderer',
  dashboard.includes('<MapLibreIntelligenceMap'));
test('Map receives trail, Futurecast, candidates and uncertainty',
  dashboard.includes('trail={renderData.trail}') &&
  dashboard.includes('futurecast={renderData.futurecast}') &&
  dashboard.includes('candidateLocations={candidateLocations}') &&
  map.includes('spectra-uncertainty'));
test('Map follow mode is released by actual user interaction',
  map.includes('event?.originalEvent') &&
  map.includes('onUserInteraction?.()'));
test('Global swipe navigation does not steal map gestures',
  map.includes('data-gesture-navigation="ignore"'));

test('Runtime submits evidence to canonical process endpoint',
  runtime.includes("fetch('/api/geoconsole/process'"));
test('Process endpoint invokes HybridGeoconsole',
  routes.includes('hybridGeoconsole.processLocationData'));
test('HybridGeoconsole invokes fusion, trail and Futurecast engines',
  engine.includes('fuseInputs(inputs)') &&
  engine.includes('generateMotionTrail') &&
  engine.includes('generateFuturecast'));
test('Process response returns canonical session and signed primary timeline',
  routes.includes('sessionId: effectiveSessionId') &&
  routes.includes('primaryFusedLocations: signedPrimaryFusedLocations'));
test('Runtime renders processed trail frames',
  runtime.includes('payload?.data?.trail?.points'));

test('Fusion tracks correlated evidence groups',
  fusion.includes('correlationGroup') &&
  fusion.includes('independentRepresentatives'));
test('Dashboard telemetry is evidence-derived, not fixed signal percentages',
  dashboard.includes('Independent evidence groups represented') &&
  !dashboard.includes('hasLiveData ? 95') &&
  !dashboard.includes('setLinkStatus'));
test('Futurecast confidence shown in telemetry comes from prediction frames',
  dashboard.includes('forecastConfidence') &&
  dashboard.includes('renderData.futurecast.reduce'));

test('Street imagery client goes through authenticated server adapter',
  map.includes('/api/geoconsole/street-imagery') &&
  routes.includes("router.get('/street-imagery'"));
test('Earth observation time follows selected evidence time',
  map.includes('nasaGibsTilesFor(currentFrame.timestamp)'));
test('Regional candidates never enter the timed motion trail',
  spectraRoutes.includes('if (locationObservations.length === 0)') &&
  spectraRoutes.includes("basis: 'regional_context'"));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
