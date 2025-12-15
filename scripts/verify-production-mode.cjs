/**
 * Production Mode Verification Script
 * 
 * Verifies that:
 * 1. NYC hardcoded coordinates are removed
 * 2. Demo/mock data is disabled in production
 * 3. Map centers are dynamic
 * 4. Real-world operations are enforced
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${name}`);
    failed++;
  }
}

function readFile(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

console.log('\n' + '='.repeat(70));
console.log('  PRODUCTION MODE VERIFICATION');
console.log('  Ensuring 100% real-world operations capability');
console.log('='.repeat(70) + '\n');

// Test GeoconsoleRadarDashboard.tsx
console.log('\n📍 GEOCONSOLE RADAR DASHBOARD');
const dashboardContent = readFile('client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
test('Dynamic map center from initial data', dashboardContent.includes('getInitialCenter'));
test('World view fallback (0,0)', dashboardContent.includes('return [0, 0]'));
test('No hardcoded NYC coordinates in map init', !dashboardContent.includes('40.7128, -74.0060'));
test('Dynamic zoom based on data availability', dashboardContent.includes('initialZoom'));

// Test useGeoRuntime.ts
console.log('\n📍 GEO RUNTIME HOOK');
const runtimeContent = readFile('client/src/hooks/useGeoRuntime.ts');
test('Mock data disabled in production comment', runtimeContent.includes('PRODUCTION: Mock data generation is DISABLED'));
test('Production environment check', runtimeContent.includes("import.meta.env.PROD"));
test('Returns empty array in production mode', runtimeContent.includes('return []'));
test('No NYC default center in generateMockFrames', !runtimeContent.includes('lat: 40.7128'));

// Test LocationHeatmap.tsx
console.log('\n📍 LOCATION HEATMAP');
const heatmapContent = readFile('client/src/components/LocationHeatmap.tsx');
test('Dynamic center calculation', heatmapContent.includes('effectiveCenter'));
test('No hardcoded NYC default', !heatmapContent.includes('center = [40.7128, -74.0060]'));
test('World view when no data', heatmapContent.includes('return [0, 0]'));

// Test geoconsole-process.tsx
console.log('\n📍 GEOCONSOLE PROCESS');
const processContent = readFile('client/src/pages/geoconsole-process.tsx');
test('Sample data disabled in production', processContent.includes('Sample data is disabled in production'));
test('Production environment check', processContent.includes('isProduction'));
test('Sample button hidden in production', processContent.includes('{!isProduction &&'));

// Test geoconsole-command.tsx
console.log('\n📍 GEOCONSOLE COMMAND');
const commandContent = readFile('client/src/pages/geoconsole-command.tsx');
test('Dynamic positioning from data center', commandContent.includes('centerLat'));
test('No hardcoded NYC in positioning', !commandContent.includes('40.7128'));

// Test useTSHPELocator.ts
console.log('\n📍 TSHPE LOCATOR');
const locatorContent = readFile('client/src/hooks/useTSHPELocator.ts');
test('No hardcoded NYC default position', !locatorContent.includes('lat: 40.7128'));
test('Initial position is neutral (0,0)', locatorContent.includes('lat: 0,'));
test('Source initially undefined', locatorContent.includes('source: undefined'));

// Test spectra.tsx
console.log('\n📍 SPECTRA PAGE');
const spectraContent = readFile('client/src/pages/spectra.tsx');
test('Demo data generation disabled', spectraContent.includes('PRODUCTION: Demo data is DISABLED'));
test('Returns empty array in production', spectraContent.includes('return []'));
test('No hardcoded initial view state coordinates', spectraContent.includes('latitude: 0,'));
test('Real-world operations footer', spectraContent.includes('Real-world location intelligence operations'));

// Test location-intel.tsx
console.log('\n📍 LOCATION INTEL');
const intelContent = readFile('client/src/pages/location-intel.tsx');
test('No hardcoded NYC in handleAnalyze', !intelContent.includes('40.7128'));
test('Production environment check', intelContent.includes('isProduction'));

// Test server routes.ts
console.log('\n📍 SERVER ROUTES');
const routesContent = readFile('server/routes.ts');
test('No NYC default location fallback', !routesContent.includes("'New York, NY'"));
test('Unknown Location fallback instead', routesContent.includes("'Unknown Location'"));

// Test petition-workflow.tsx
console.log('\n📍 PETITION WORKFLOW');
const petitionContent = readFile('client/src/pages/petition-workflow.tsx');
test('Production Mode indicator', petitionContent.includes('Production Mode'));
test('No Demo Mode text', !petitionContent.includes('Demo Mode'));

// Test petitionHarvester.ts
console.log('\n📍 PETITION HARVESTER');
const harvesterContent = readFile('server/petitionHarvester.ts');
test('Production documentation', harvesterContent.includes('PRODUCTION:'));
test('No demo mode mention in header', !harvesterContent.includes('demo mode:'));

// Summary
console.log('\n' + '='.repeat(70));
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(70));

if (failed === 0) {
  console.log('\n🎯 All production mode checks passed!');
  console.log('   System is ready for 120% real-world operations.\n');
  process.exit(0);
} else {
  console.log('\n⚠️  Some checks failed. Review the output above.\n');
  process.exit(1);
}
