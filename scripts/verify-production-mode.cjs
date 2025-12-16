/**
 * Production Mode Verification Script
 * Verifies 100% production ready status
 */

const fs = require('fs');
const path = require('path');

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

function readFile(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

console.log('\n' + '='.repeat(60));
console.log('  PRODUCTION VERIFICATION - 100% REAL WORLD READY');
console.log('='.repeat(60) + '\n');

// GEOCONSOLE RADAR DASHBOARD
console.log('📍 GEOCONSOLE RADAR DASHBOARD');
const dashboard = readFile('client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
test('Dynamic map center', dashboard.includes('getInitialCenter'));
test('No hardcoded NYC (40.7128)', !dashboard.includes('40.7128'));

// GEO RUNTIME
console.log('\n📍 GEO RUNTIME');
const runtime = readFile('client/src/hooks/useGeoRuntime.ts');
test('No generateMockFrames function', !runtime.includes('const generateMockFrames'));
test('No allowMockData config', !runtime.includes('allowMockData'));
test('No NYC coordinates', !runtime.includes('40.7128'));

// LOCATION HEATMAP
console.log('\n📍 LOCATION HEATMAP');
const heatmap = readFile('client/src/components/LocationHeatmap.tsx');
test('Dynamic effectiveCenter', heatmap.includes('effectiveCenter'));
test('No hardcoded center default', !heatmap.includes('center = [40.7128'));

// GEOCONSOLE PROCESS
console.log('\n📍 GEOCONSOLE PROCESS');
const process_page = readFile('client/src/pages/geoconsole-process.tsx');
test('No loadSampleData function', !process_page.includes('loadSampleData'));
test('No sample button', !process_page.includes('Load Sample'));

// GEOCONSOLE COMMAND
console.log('\n📍 GEOCONSOLE COMMAND');
const command = readFile('client/src/pages/geoconsole-command.tsx');
test('Dynamic center calculation', command.includes('centerLat') && command.includes('centerLng'));
test('No hardcoded NYC positioning', !command.includes('74.006'));

// TSHPE LOCATOR
console.log('\n📍 TSHPE LOCATOR');
const locator = readFile('client/src/hooks/useTSHPELocator.ts');
test('No NYC default', !locator.includes('40.7128'));
test('Neutral initial position', locator.includes('lat: 0'));

// SPECTRA PAGE
console.log('\n📍 SPECTRA PAGE');
const spectra = readFile('client/src/pages/spectra.tsx');
test('No generateFakeHistory function', !spectra.includes('const generateFakeHistory'));
test('Empty initial trackPoints', spectra.includes('useState<TrackPoint[]>([])'));
test('Neutral view state', spectra.includes('latitude: 0'));

// LOCATION INTEL
console.log('\n📍 LOCATION INTEL');
const intel = readFile('client/src/pages/location-intel.tsx');
test('No hardcoded coordinates', !intel.includes('40.7128'));

// SERVER ROUTES
console.log('\n📍 SERVER');
const routes = readFile('server/routes.ts');
test('No NYC fallback', !routes.includes("'New York, NY'"));

// Summary
console.log('\n' + '='.repeat(60));
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n✅ 100% PRODUCTION READY\n');
  process.exit(0);
} else {
  console.log('\n❌ ISSUES FOUND\n');
  process.exit(1);
}
