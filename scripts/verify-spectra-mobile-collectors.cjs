const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const android = read('mobile/spectra-android-collector/collector/src/main/java/com/legalwhat/spectra/collector/SpectraAndroidCollector.kt');
const androidManifest = read('mobile/spectra-android-collector/collector/src/main/AndroidManifest.xml');
const androidGradle = read('mobile/spectra-android-collector/collector/build.gradle.kts');
const apple = read('mobile/spectra-apple-collector/Sources/SpectraAppleCollector/SpectraAppleCollector.swift');
const applePackage = read('mobile/spectra-apple-collector/Package.swift');
const appleTests = read('mobile/spectra-apple-collector/Tests/SpectraAppleCollectorTests/SpectraAppleCollectorTests.swift');
const geo = read('server/routes/geoconsole.routes.ts');
const enrolled = read('server/services/spectra/SpectraEnrolledAcquisition.ts');

assert.match(android, /GnssMeasurementsEvent/);
assert.match(android, /telephonyManager\.allCellInfo/);
assert.match(android, /WifiRttManager/);
assert.match(android, /bluetoothLeScanner/);
assert.match(android, /recordUwbMeasurement/);
assert.match(android, /normalize\/android-radio-collector/);
assert.match(android, /Authorization", "Bearer \$ingestToken"/);
assert.match(android, /JSONArray\(uwbObservations\.toList\(\)\)/);
assert.match(androidManifest, /ACCESS_FINE_LOCATION/);
assert.match(androidManifest, /ACCESS_BACKGROUND_LOCATION/);
assert.match(androidManifest, /BLUETOOTH_SCAN/);
assert.match(androidManifest, /UWB_RANGING/);
assert.match(androidGradle, /compileSdk = 36/);

assert.match(apple, /CLLocationManager/);
assert.match(apple, /CBCentralManager/);
assert.match(apple, /NINearbyObject/);
assert.match(apple, /recordNearbyObject/);
assert.match(apple, /normalize\/canonical-telemetry/);
assert(apple.includes('Bearer \\\\(ingestToken)'),
  'Apple collector must send the enrolled device bearer token');
assert.match(apple, /forHTTPHeaderField: "Authorization"/);
assert.equal((apple.match(/public static func reportingEndpoint/g) || []).length, 1,
  'Apple collector must expose exactly one reporting endpoint helper');
assert.equal((apple.match(/public static func confidence\(forAccuracy/g) || []).length, 1,
  'Apple collector must expose exactly one accuracy-confidence helper');
assert.match(applePackage, /\.iOS\(\.v17\)/);
assert.match(applePackage, /SpectraAppleCollectorTests/);
assert.match(appleTests, /testReportingEndpointEncodesDeviceRefAndKeepsCanonicalPath/);

assert.match(geo, /telemetry\/enrolled\/:deviceRef\/normalize\/:kind/);
assert.match(geo, /enrolled-device\/:deviceRef\/ingest-token/);
assert.match(enrolled, /enrolled-device-inbox-active/);

const swift = spawnSync('swiftc', [
  '-parse',
  path.join(root, 'mobile/spectra-apple-collector/Sources/SpectraAppleCollector/SpectraAppleCollector.swift'),
], { encoding: 'utf8' });
if (swift.error && swift.error.code !== 'ENOENT') throw swift.error;
if (!swift.error) {
  assert.equal(swift.status, 0, swift.stderr || 'Apple collector Swift parser failed');
}

console.log('SPECTRA native Android/Apple collector wiring checks passed.');
