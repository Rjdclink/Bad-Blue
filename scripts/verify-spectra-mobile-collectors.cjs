const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const androidBuild = read('mobile/spectra-android-collector/collector/build.gradle.kts');
const androidManifest = read('mobile/spectra-android-collector/collector/src/main/AndroidManifest.xml');
const android = read('mobile/spectra-android-collector/collector/src/main/java/com/legalwhat/spectra/collector/SpectraAndroidCollector.kt');
const applePackage = read('mobile/spectra-apple-collector/Package.swift');
const apple = read('mobile/spectra-apple-collector/Sources/SpectraAppleCollector/SpectraAppleCollector.swift');
const routes = read('server/routes/geoconsole.routes.ts');
const store = read('server/services/spectra/SpectraEnrolledTelemetryStore.ts');
const enrolled = read('server/services/spectra/SpectraEnrolledAcquisition.ts');

assert.match(androidBuild, /compileSdk = 36/);
assert.match(androidManifest, /ACCESS_FINE_LOCATION/);
assert.match(androidManifest, /BLUETOOTH_SCAN/);
assert.match(androidManifest, /NEARBY_WIFI_DEVICES/);
assert.match(androidManifest, /UWB_RANGING/);
assert.match(android, /GnssMeasurementsEvent\.Callback/);
assert.match(android, /telephonyManager\.allCellInfo/);
assert.match(android, /WifiRttManager/);
assert.match(android, /startRanging/);
assert.match(android, /bluetoothLeScanner/);
assert.match(android, /recordUwbMeasurement/);
assert.match(android, /normalize\/android-radio-collector/);
assert.match(android, /Authorization", "Bearer \$ingestToken"/);
assert.doesNotMatch(android, /requestPermissions|requestAlwaysAuthorization|requestWhenInUseAuthorization/);

assert.match(applePackage, /\.iOS\(\.v17\)/);
assert.match(apple, /CLLocationManager/);
assert.match(apple, /CBCentralManagerDelegate/);
assert.match(apple, /NINearbyObject/);
assert.match(apple, /recordNearbyObject/);
assert.match(apple, /normalize\/canonical-telemetry/);
assert.match(apple, /Authorization", forHTTPHeaderField: "Authorization"/);
assert.doesNotMatch(apple, /requestAlwaysAuthorization|requestWhenInUseAuthorization/);

assert.match(routes, /telemetry\/enrolled\/:deviceRef\/normalize\/:kind/);
assert.match(routes, /enrolled-device\/:deviceRef\/ingest-token/);
assert.match(store, /ingest_token_hash/);
assert.match(store, /timingSafeEqual/);
assert.match(enrolled, /enrolled-device-inbox-active/);
assert.match(enrolled, /loadLatestSpectraEnrolledDeviceTelemetry/);

console.log('SPECTRA Android and Apple enrolled-device collector wiring verification passed.');
