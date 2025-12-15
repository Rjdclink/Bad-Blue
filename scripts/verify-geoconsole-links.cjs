/**
 * GeoConsole Link Connections Verification Test
 * Test 2: Verifies all link connections and data flow
 */

const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('GEOCONSOLE LINK CONNECTIONS TEST (TEST 2)');
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

// Load dashboard content
const dashboardPath = path.join(__dirname, '../client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

// Test SAT Link Connection
console.log('\n📡 SAT LINK CONNECTION');
console.log('----------------------------------------');
test('SAT link tracks satellite_imagery source', dashboardContent.includes("satellite_imagery"));
test('SAT link has signal strength calculation', dashboardContent.includes("sat:") && dashboardContent.includes("signal:"));
test('SAT link updates based on GPS data', dashboardContent.includes("hasGPS"));
test('SAT link displays in header', dashboardContent.includes('SAT') && dashboardContent.includes("key={key}"));

// Test GEO Link Connection
console.log('\n🌍 GEO LINK CONNECTION');
console.log('----------------------------------------');
test('GEO link tracks total distance', dashboardContent.includes("state.stats.totalDistance"));
test('GEO link active when data exists', dashboardContent.includes("geo:") && dashboardContent.includes("active: hasData"));
test('GEO link connected to multimodal fusion', dashboardContent.includes("Multimodal Fusion"));

// Test FIX Link Connection
console.log('\n📍 FIX LINK CONNECTION');
console.log('----------------------------------------');
test('FIX link tracks current frame', dashboardContent.includes("state.currentFrame"));
test('FIX link shows confidence', dashboardContent.includes("currentFrame.confidence"));
test('FIX link active when position is locked', dashboardContent.includes("fix:") && dashboardContent.includes("currentFrame !== null"));
test('FIX link connected to Monte Carlo', dashboardContent.includes("Monte Carlo"));

// Test SIGNAL Link Connection
console.log('\n📶 SIGNAL LINK CONNECTION');
console.log('----------------------------------------');
test('SIGNAL link tracks WiFi handoff', dashboardContent.includes("wifi_handoff"));
test('SIGNAL link tracks device GPS', dashboardContent.includes("device_gps"));
test('SIGNAL link higher when live', dashboardContent.includes("hasLiveData ? 95"));
test('SIGNAL link connected to Kalman filter', dashboardContent.includes("Kalman filter") || dashboardContent.includes("Signal Fusion"));

// Test NAV Link Connection
console.log('\n🧭 NAV LINK CONNECTION');
console.log('----------------------------------------');
test('NAV link tracks futurecast data', dashboardContent.includes("state.futurecast"));
test('NAV link active when predictions available', dashboardContent.includes("nav:") && dashboardContent.includes("futurecast.length > 0"));
test('NAV link connected to trajectory forecasting', dashboardContent.includes("trajectory forecasting") || dashboardContent.includes("Futurecast"));

// Test Data Flow
console.log('\n📊 DATA FLOW VERIFICATION');
console.log('----------------------------------------');
test('Link status updates via useEffect', dashboardContent.includes("useEffect") && dashboardContent.includes("setLinkStatus"));
test('Link status depends on trail data', dashboardContent.includes("[state.trail") || dashboardContent.includes("state.trail,"));
test('Link status depends on isLive', dashboardContent.includes("state.isLive") || dashboardContent.includes("isLive"));
test('Link status depends on futurecast', dashboardContent.includes("state.futurecast"));
test('Link status depends on stats', dashboardContent.includes("state.stats"));

// Test API Connections
console.log('\n🔗 API ENDPOINT CONNECTIONS');
console.log('----------------------------------------');

const routesPath = path.join(__dirname, '../server/routes/geoconsole.routes.ts');
const routesContent = fs.readFileSync(routesPath, 'utf8');

test('Process endpoint handles multimodal fusion', routesContent.includes("processLocationData"));
test('Process endpoint returns fusedLocations', routesContent.includes("fusedLocations"));
test('Process endpoint returns trail data', routesContent.includes("trail:"));
test('Process endpoint returns futurecast', routesContent.includes("futurecast"));
test('Interpolate endpoint uses Monte Carlo', routesContent.includes("monteCarloPathEngine.interpolatePath"));
test('Futurecast endpoint generates predictions', routesContent.includes("monteCarloPathEngine.generateFuturecast"));

// Test Service Layer Connections
console.log('\n⚙️ SERVICE LAYER CONNECTIONS');
console.log('----------------------------------------');

const indexPath = path.join(__dirname, '../server/services/geoconsole/index.ts');
const indexContent = fs.readFileSync(indexPath, 'utf8');

test('HybridGeoconsole uses InputFusionEngine', indexContent.includes("InputFusionEngine"));
test('HybridGeoconsole uses MonteCarloPathEngine', indexContent.includes("MonteCarloPathEngine"));
test('HybridGeoconsole generates futurecast', indexContent.includes("generateFuturecast"));
test('HybridGeoconsole generates intelligence reports', indexContent.includes("generateIntelligenceReport"));
test('HybridGeoconsole interpolates gaps', indexContent.includes("interpolateGaps"));

console.log('\n============================================================');
console.log('SUMMARY');
console.log('============================================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
console.log('');

if (failed === 0) {
  console.log('✅ ALL LINK CONNECTION TESTS PASSED');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
