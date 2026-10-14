const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const android = read('mobile/spectra-android-collector/collector/src/main/java/com/legalwhat/spectra/collector/SpectraAndroidCollector.kt');
const androidManifest = read('mobile/spectra-android-collector/collector/src/main/AndroidManifest.xml');
const androidGradle = read('mobile/spectra-android-collector/collector/build.gradle.kts');
const apple = read('mobile/spectra-apple-collector/Sources/SpectraAppleCollector/SpectraAppleCollector.swift');
const applePackage = read('mobile/spectra-apple-collector/Package.swift');

assert.match(android, /class SpectraAndroidCollector/);
assert.match(android, /registerGnssMeasurementsCallback/);
assert.match(android, /telephonyManager\.allCellInfo/);
assert.match(android, /WifiRttManager/);
assert.match(android, /RangingRequest\.Builder/);
assert.match(android, /bluetoothLeScanner/);
assert.match(android, /recordUwbMeasurement/);
assert.match(android, /normalize\/android-radio-collector/);
assert.match(android, /Authorization", "Bearer \$ingestToken"/);
assert.match(android, /deviceRef/);
assert.match(androidManifest, /ACCESS_FINE_LOCATION/);
assert.match(androidManifest, /NEARBY_WIFI_DEVICES/);
assert.match(androidManifest, /BLUETOOTH_SCAN/);
assert.match(androidManifest, /UWB_RANGING/);
assert.match(androidGradle, /compileSdk = 36/);
assert.match(androidGradle, /minSdk = 31/);

assert.match(apple, /final class SpectraAppleCollector/);
assert.match(apple, /CLLocationManagerDelegate/);
assert.match(apple, /CBCentralManagerDelegate/);
assert.match(apple, /NINearbyObject/);
assert.match(apple, /recordNearbyObject/);
assert.match(apple, /source": "device_gps"/);
assert.match(apple, /source": "uwb_range"/);
assert.match(apple, /source": "ble_rssi"/);
assert.match(apple, /normalize\/canonical-telemetry/);
assert.match(apple, /Bearer \\(ingestToken\)/);
assert.match(applePackage, /platforms: \[\.iOS\(\.v17\)\]/);
assert.match(applePackage, /SpectraAppleCollectorTests/);

for (const source of [android, apple]) {
  assert(!/consent form|authorization form/i.test(source),
    'native collector runtime must not implement a consent-form workflow');
  assert(!/http:\/\//i.test(source),
    'native collectors must not contain plaintext HTTP reporting endpoints');
}

console.log('SPECTRA native Android/Apple collector contract verification passed.');
