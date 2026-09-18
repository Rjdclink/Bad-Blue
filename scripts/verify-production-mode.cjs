/**
 * SPECTRA production-mode verification.
 * Static invariants only: no network calls and no synthetic location fixtures.
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
const tshpe = read('client/src/hooks/useTSHPELocator.ts');
const fusion = read('server/services/geoconsole/inputFusionEngine.ts');
const futurecast = read('server/services/geoconsole/monteCarloPathEngine.ts');
const geoRoutes = read('server/routes/geoconsole.routes.ts');
const spectraRoutes = read('server/routes/spectra.routes.ts');
const gpsRoutes = read('server/routes/gps.routes.ts');
const geocoder = read('server/services/geoconsole/city-state-geocoder.ts');

console.log('\nSPECTRA PRODUCTION INVARIANTS\n');

test('SPECTRA begins with the target question',
  spectra.includes("What is it that you want to locate?"));
test('SPECTRA waits for target information before acquisition',
  spectra.includes("phase === 'awaiting_details'") &&
  spectra.includes('await acquireTarget(target, message)'));
test('No manual coordinate-entry workflow remains in SPECTRA',
  !spectra.includes('Add Point') &&
  !spectra.includes('Enter latitude') &&
  !spectra.includes('Enter longitude'));
test('No synthetic target-track generator exists in SPECTRA',
  !spectra.includes('generateFakeHistory') &&
  !spectra.includes('generateMockFrames'));
test('Voice cannot listen while SPECTRA audio is loading or speaking',
  spectra.includes('voiceSynthesis.isLoading || voiceSynthesis.isSpeaking') &&
  spectra.includes('voiceMode.isSuspended'));

test('Canonical renderer is MapLibre, not Leaflet',
  dashboard.includes('MapLibreIntelligenceMap') &&
  !dashboard.includes("from 'leaflet'"));
test('Renderer has true terrain and 3D building support',
  map.includes("type: 'raster-dem'") &&
  map.includes('map.setTerrain') &&
  map.includes("type: 'fill-extrusion'"));
test('Regional candidates show uncertainty instead of point precision',
  map.includes('spectra-candidate-area') &&
  map.includes('candidateZoomForAccuracy') &&
  geocoder.includes('accuracyMeters'));
test('Map popups use DOM text instead of untrusted HTML',
  map.includes('setDOMContent') &&
  !map.includes('.setHTML('));
test('Observed, historical, inferred and interpolated evidence are visually classified',
  map.includes("'historical', '#60a5fa'") &&
  map.includes("'inferred', '#f59e0b'") &&
  map.includes("'interpolated', '#94a3b8'"));

test('Runtime uses canonical server processing',
  runtime.includes("fetch('/api/geoconsole/process'"));
test('Runtime futurecast uses server authority',
  runtime.includes("fetch('/api/geoconsole/futurecast'"));
test('Runtime never fabricates target motion or fallback predictions',
  !runtime.includes('generateMockFrames') &&
  !runtime.includes('generateLocalFuturecastFallback') &&
  !runtime.includes("authority: 'client_fallback'"));
test('TSHPE has no random location authority',
  !tshpe.includes('Math.random()') &&
  !tshpe.includes('ipapi.co') &&
  tshpe.includes("/api/geoconsole/process"));

test('Fusion models accuracy and correlated evidence',
  fusion.includes('effectiveAccuracyMeters') &&
  fusion.includes('independentRepresentatives') &&
  fusion.includes('correlationKey'));
test('Fusion cache keys include the complete evidence set',
  fusion.includes("createHash('sha256')") &&
  !fusion.includes('slice(0, 10)'));
test('Fusion and interpolation are antimeridian-safe',
  fusion.includes('unwrapLongitude') &&
  fusion.includes('weightedLngSin') &&
  futurecast.includes('endLongitudeUnwrapped') &&
  futurecast.includes('pointLongitude = this.unwrapLongitude'));
test('Futurecast is bounded to one hour and deterministic',
  futurecast.includes('hours: number = 1') &&
  futurecast.includes('MAX_SIMULATION_STEPS') &&
  futurecast.includes('seededRandom') &&
  futurecast.includes("observationKind: 'predicted'"));
test('Unsupported, implausible and long evidence gaps are not interpolated',
  read('server/services/geoconsole/index.ts').includes('maxInterpolationGapMinutes') &&
  read('server/services/geoconsole/index.ts').includes('maxInterpolationSpeedMps') &&
  read('server/services/geoconsole/index.ts').includes('unsupported_evidence_continuity') &&
  read('server/services/geoconsole/index.ts').includes('implausible_required_speed') &&
  read('server/services/geoconsole/index.ts').includes("continuity: 'discontinuous'"));

test('GeoConsole and SPECTRA APIs require authentication',
  geoRoutes.includes('router.use(isAuthenticated)') &&
  spectraRoutes.includes('router.use(isAuthenticated)'));
test('SPECTRA only promotes qualified timestamped coordinate evidence',
  spectraRoutes.includes('explicitTimestamp') &&
  spectraRoutes.includes('hasLocationContext'));
test('Media evidence is upload-derived, signed and carried into SPECTRA acquisition',
  gpsRoutes.includes("router.post('/extract-upload'") &&
  gpsRoutes.includes('signServerEvidence') &&
  spectraRoutes.includes('directEvidence') &&
  spectraRoutes.includes('normalizeClientEvidence') &&
  !gpsRoutes.includes("router.post('/extract'"));

test('No production geospatial core depends on a hardcoded NYC fallback',
  !spectra.includes('40.7128') &&
  !dashboard.includes('40.7128') &&
  !runtime.includes('40.7128') &&
  !map.includes('40.7128'));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
