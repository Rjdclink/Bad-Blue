/**
 * GeoConsole Verification Script
 * Verifies that all GeoConsole components and links are properly connected
 */

const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('GEOCONSOLE VERIFICATION TEST');
console.log('============================================================\n');

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
}

// Test 1: GeoconsoleRadarDashboard exists and has link status
const dashboardPath = path.join(__dirname, '../client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

test('Dashboard file exists', fs.existsSync(dashboardPath));
test('Dashboard has SAT link status', dashboardContent.includes("sat: {") && dashboardContent.includes("Satellite Link"));
test('Dashboard has GEO link status', dashboardContent.includes("geo: {") && dashboardContent.includes("Geo Link"));
test('Dashboard has FIX link status', dashboardContent.includes("fix: {") && dashboardContent.includes("Fix Link"));
test('Dashboard has SIGNAL link status', dashboardContent.includes("signal: {") && dashboardContent.includes("Signal Link"));
test('Dashboard has NAV link status', dashboardContent.includes("nav: {") && dashboardContent.includes("Nav Link"));
test('Dashboard uses full viewport stretch', dashboardContent.includes('h-full') && dashboardContent.includes('flex-1'));
test('Dashboard has System Capabilities panel', dashboardContent.includes('System Capabilities'));

// Test 2: People Finder page integrates GeoConsole correctly
const peoplefinderPath = path.join(__dirname, '../client/src/pages/people-finder.tsx');
const peoplefinderContent = fs.readFileSync(peoplefinderPath, 'utf8');

test('People Finder imports GeoconsoleRadarDashboard', peoplefinderContent.includes("import { GeoconsoleRadarDashboard }"));
test('People Finder has full viewport height for GeoConsole', peoplefinderContent.includes('h-[calc(100vh-280px)]'));
test('People Finder has minimum height constraint', peoplefinderContent.includes('min-h-[600px]'));

// Test 3: Server routes exist
const routesPath = path.join(__dirname, '../server/routes.ts');
const routesContent = fs.readFileSync(routesPath, 'utf8');

test('Server has geoconsole routes import', routesContent.includes('geoconsole.routes'));
test('Server registers /api/geoconsole endpoint', routesContent.includes("/api/geoconsole"));

// Test 4: Geoconsole API routes exist
const geoconsoleRoutesPath = path.join(__dirname, '../server/routes/geoconsole.routes.ts');
const geoconsoleRoutesContent = fs.readFileSync(geoconsoleRoutesPath, 'utf8');

test('Geoconsole routes file exists', fs.existsSync(geoconsoleRoutesPath));
test('Has /process endpoint', geoconsoleRoutesContent.includes("router.post('/process'"));
test('Has /status endpoint', geoconsoleRoutesContent.includes("router.get('/status'"));
test('Has /interpolate endpoint', geoconsoleRoutesContent.includes("router.post('/interpolate'"));
test('Has /futurecast endpoint', geoconsoleRoutesContent.includes("router.post('/futurecast'"));
test('Has /report endpoint', geoconsoleRoutesContent.includes("router.post('/report'"));

// Test 5: Geoconsole services exist
const geoconsoleIndexPath = path.join(__dirname, '../server/services/geoconsole/index.ts');
const signalFusionPath = path.join(__dirname, '../server/services/geoconsole/signalFusionEngine.ts');
const inputFusionPath = path.join(__dirname, '../server/services/geoconsole/inputFusionEngine.ts');
const monteCarloPath = path.join(__dirname, '../server/services/geoconsole/monteCarloPathEngine.ts');

test('Geoconsole service index exists', fs.existsSync(geoconsoleIndexPath));
test('Signal fusion engine exists', fs.existsSync(signalFusionPath));
test('Input fusion engine exists', fs.existsSync(inputFusionPath));
test('Monte Carlo path engine exists', fs.existsSync(monteCarloPath));

// Test 6: useGeoRuntime hook exists and is properly configured
const geoRuntimePath = path.join(__dirname, '../client/src/hooks/useGeoRuntime.ts');
const geoRuntimeContent = fs.readFileSync(geoRuntimePath, 'utf8');

test('useGeoRuntime hook exists', fs.existsSync(geoRuntimePath));
test('useGeoRuntime has GeoFrame interface', geoRuntimeContent.includes('interface GeoFrame'));
test('useGeoRuntime has play/pause actions', geoRuntimeContent.includes('play:') && geoRuntimeContent.includes('pause:'));
test('useGeoRuntime has futurecast support', geoRuntimeContent.includes('generateFuturecast'));

// Test 7: Shared types exist
const sharedTypesPath = path.join(__dirname, '../shared/geoconsoleTypes.ts');
const sharedTypesContent = fs.readFileSync(sharedTypesPath, 'utf8');

test('Shared geoconsole types exist', fs.existsSync(sharedTypesPath));
test('GPSPoint interface exists', sharedTypesContent.includes('interface GPSPoint'));
test('DataSource type exists', sharedTypesContent.includes('type DataSource'));

console.log('\n============================================================');
console.log('SUMMARY');
console.log('============================================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
console.log('');

if (failed === 0) {
  console.log('✅ ALL GEOCONSOLE VERIFICATION TESTS PASSED');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
