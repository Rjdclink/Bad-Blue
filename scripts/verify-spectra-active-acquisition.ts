import assert from 'node:assert/strict';
import {
  acquireSpectraActiveTelemetry,
  getSpectraActiveAcquisitionCapabilities,
} from '../server/services/spectra/SpectraActiveAcquisition';
import { resolveConfiguredSpectraAnchor } from '../server/services/spectra/SpectraAnchorRegistry';
import { normalizeSpectraProviderPayload } from '../server/services/spectra/SpectraProviderTelemetryNormalizer';

const originalFetch = globalThis.fetch;
const savedEnv = {
  androidUrl: process.env.SPECTRA_ANDROID_MDM_LOCATION_URL_TEMPLATE,
  androidToken: process.env.SPECTRA_ANDROID_MDM_LOCATION_TOKEN,
  appleUrl: process.env.SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE,
  appleToken: process.env.SPECTRA_APPLE_MDM_LOCATION_TOKEN,
  ciscoUrl: process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE,
  ciscoToken: process.env.SPECTRA_CISCO_SPACES_TOKEN,
  activeAdapters: process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS,
  anchors: process.env.SPECTRA_ANCHOR_CATALOG_JSON,
  infrastructureBindings: process.env.SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS,
};

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  process.env.SPECTRA_ANDROID_MDM_LOCATION_URL_TEMPLATE =
    'https://emm.example/devices/{{deviceRef}}/latest-location';
  process.env.SPECTRA_ANDROID_MDM_LOCATION_TOKEN = 'android-token';
  delete process.env.SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE;
  delete process.env.SPECTRA_APPLE_MDM_LOCATION_TOKEN;
  delete process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE;
  delete process.env.SPECTRA_CISCO_SPACES_TOKEN;
  process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS = '[]';

  globalThis.fetch = async (input: any, init?: RequestInit) => {
    assert.equal(String(input), 'https://emm.example/devices/android-a/latest-location');
    assert.equal(
      (init?.headers as Record<string, string>)?.Authorization,
      'Bearer android-token',
    );
    return new Response(JSON.stringify({
      usageLogEvents: [{
        eventTime: '2026-10-03T14:58:00Z',
        eventId: 'android-event-1',
        lostModeLocationEvent: {
          batteryLevel: 72,
          location: {
            latitude: 43.549,
            longitude: -96.729,
          },
        },
      }],
      device: 'enterprises/e/devices/android-a',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const android = await acquireSpectraActiveTelemetry({
    deviceRef: 'android-a',
    sessionId: 'fixture-session',
    subjectLabel: 'managed android',
  });
  assert.equal(android.batches.length, 1);
  assert.equal(android.batches[0]?.measurements[0]?.source, 'device_gps');
  assert.equal(
    (android.batches[0]?.measurements[0]?.metadata as any)?.providerKind,
    'android-managed-lost-mode',
  );

  delete process.env.SPECTRA_ANDROID_MDM_LOCATION_URL_TEMPLATE;
  delete process.env.SPECTRA_ANDROID_MDM_LOCATION_TOKEN;
  process.env.SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE =
    'https://mdm.example/devices/{{deviceRef}}/latest-location';
  process.env.SPECTRA_APPLE_MDM_LOCATION_TOKEN = 'apple-token';

  globalThis.fetch = async (input: any, init?: RequestInit) => {
    assert.equal(String(input), 'https://mdm.example/devices/apple-a/latest-location');
    assert.equal(
      (init?.headers as Record<string, string>)?.Authorization,
      'Bearer apple-token',
    );
    return new Response(JSON.stringify({
      UDID: 'apple-a',
      Status: 'Acknowledged',
      Timestamp: '2026-10-03T14:59:00Z',
      Latitude: 43.550,
      Longitude: -96.730,
      HorizontalAccuracy: 3.5,
      VerticalAccuracy: 5,
      Speed: 1.2,
      Course: 180,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const apple = await acquireSpectraActiveTelemetry({
    deviceRef: 'apple-a',
    sessionId: 'fixture-session',
    subjectLabel: 'supervised apple',
  });
  assert.equal(apple.batches.length, 1);
  assert.equal(apple.batches[0]?.measurements[0]?.source, 'device_gps');
  assert.equal(apple.batches[0]?.measurements[0]?.speed, 1.2);
  assert.equal(apple.batches[0]?.measurements[0]?.heading, 180);

  delete process.env.SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE;
  delete process.env.SPECTRA_APPLE_MDM_LOCATION_TOKEN;
  process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE =
    'https://dnaspaces.example/api/location/v1/clients/{{deviceRef}}';
  process.env.SPECTRA_CISCO_SPACES_TOKEN = 'fixture-cisco-token';
  process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS = '[]';

  globalThis.fetch = async (input: any, init?: RequestInit) => {
    assert.equal(
      String(input),
      'https://dnaspaces.example/api/location/v1/clients/00%3A11%3A22%3A33%3A44%3A55',
    );
    assert.equal(init?.method, 'GET');
    assert.equal(
      (init?.headers as Record<string, string>)?.Authorization,
      'Bearer fixture-cisco-token',
    );
    return new Response(JSON.stringify({
      results: [{
        macAddress: '00:11:22:33:44:55',
        coordinates: [43.55, -96.73],
        confidenceFactor: 18,
        computeType: 'RSSI',
        lastLocationAt: '2026-10-03T15:00:00Z',
        numDetectingAps: 4,
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const cisco = await acquireSpectraActiveTelemetry({
    deviceRef: '00:11:22:33:44:55',
    sessionId: 'fixture-session',
    subjectLabel: 'managed device',
  });
  assert.equal(cisco.batches.length, 1);
  assert.equal(cisco.attempts[0]?.status, 'fulfilled');
  assert.equal(cisco.batches[0]?.measurements[0]?.source, 'wifi_fingerprint');
  assert.equal(
    (cisco.batches[0]?.measurements[0]?.metadata as any)?.providerKind,
    'cisco-spaces-location',
  );

  delete process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE;
  delete process.env.SPECTRA_CISCO_SPACES_TOKEN;
  process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS = JSON.stringify([{
    id: 'android-collector-fixture',
    label: 'Android collector fixture',
    url: 'https://collector.example/device/{{deviceRef}}',
    method: 'POST',
    normalizerKind: 'canonical-telemetry',
    target: 'device',
    headersFromEnv: { Authorization: 'FIXTURE_COLLECTOR_TOKEN' },
  }]);
  process.env.FIXTURE_COLLECTOR_TOKEN = 'collector-token';

  globalThis.fetch = async (input: any, init?: RequestInit) => {
    assert.equal(String(input), 'https://collector.example/device/device-a');
    assert.equal(
      (init?.headers as Record<string, string>)?.Authorization,
      'collector-token',
    );
    const body = JSON.parse(String(init?.body || '{}'));
    assert.equal(body.deviceRef, 'device-a');
    return new Response(JSON.stringify({
      measurements: [{
        kind: 'position',
        source: 'device_gps',
        timestamp: '2026-10-03T15:01:00Z',
        latitude: 43.551,
        longitude: -96.731,
        accuracy: 4,
        confidence: 0.95,
        provider: 'android-device',
        metadata: {
          speedAccuracyMps: 0.4,
          courseAccuracyDegrees: 3,
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const collector = await acquireSpectraActiveTelemetry({
    deviceRef: 'device-a',
    sessionId: 'fixture-session',
    subjectLabel: 'managed device',
  });
  assert.equal(collector.batches.length, 1);
  assert.equal(collector.batches[0]?.measurements[0]?.source, 'device_gps');
  assert.equal(collector.batches[0]?.metadata?.acquisition, 'active-provider-pull');

  let repeatedFetchCalled = false;
  globalThis.fetch = async () => {
    repeatedFetchCalled = true;
    throw new Error('provider cooldown should have prevented this fetch');
  };
  const cooledDown = await acquireSpectraActiveTelemetry({
    deviceRef: 'device-a',
    sessionId: 'fixture-session',
    subjectLabel: 'managed device',
  });
  assert.equal(cooledDown.batches.length, 0);
  assert.equal(cooledDown.attempts[0]?.status, 'skipped');
  assert.match(
    String(cooledDown.attempts[0]?.reason || ''),
    /poll cooldown/i,
  );
  assert.equal(repeatedFetchCalled, false);

  const skipped = await acquireSpectraActiveTelemetry({
    sessionId: 'fixture-session',
    subjectLabel: 'missing managed device',
  });
  assert.equal(skipped.batches.length, 0);
  assert.equal(skipped.attempts[0]?.status, 'skipped');

  process.env.SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS = JSON.stringify([{
    providerId: 'android-collector-fixture',
    identifier: 'device:device-b',
    sessionId: 'bound-session',
    subjectLabel: 'Bound managed device',
  }]);

  globalThis.fetch = async (input: any, init?: RequestInit) => {
    assert.equal(String(input), 'https://collector.example/device/device-b');
    const body = JSON.parse(String(init?.body || '{}'));
    assert.equal(body.deviceRef, 'device-b');
    return new Response(JSON.stringify({
      measurements: [{
        kind: 'position',
        source: 'device_gps',
        timestamp: '2026-10-03T15:01:30Z',
        latitude: 43.552,
        longitude: -96.732,
        accuracy: 5,
        confidence: 0.94,
        provider: 'android-device',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const configuredBindingAcquisition = await acquireSpectraActiveTelemetry({
    sessionId: 'bound-session',
    subjectLabel: 'Bound managed device',
  });
  assert.equal(configuredBindingAcquisition.batches.length, 1);
  assert.equal(
    configuredBindingAcquisition.attempts.find(
      attempt => attempt.id === 'android-collector-fixture'
    )?.status,
    'fulfilled',
  );

  process.env.SPECTRA_ANCHOR_CATALOG_JSON = JSON.stringify([
    { id: 'uwb-a', latitude: 43.55, longitude: -96.73, accuracyMeters: 0.1 },
    { id: 'uwb-b', latitude: 43.5505, longitude: -96.73, accuracyMeters: 0.1 },
    { id: 'uwb-c', latitude: 43.55, longitude: -96.7305, accuracyMeters: 0.1 },
  ]);
  assert.equal(resolveConfiguredSpectraAnchor({ peerId: 'uwb-b' })?.latitude, 43.5505);

  const normalizedRanging = normalizeSpectraProviderPayload(
    'android-ranging-manager',
    'android-device-fixture',
    {
      results: [
        {
          timestamp: '2026-10-03T15:02:00Z',
          technology: 'uwb',
          peerId: 'uwb-a',
          distanceMeters: 10,
          distanceUncertaintyMeters: 0.2,
          anchor: { id: 'uwb-a' },
        },
        {
          timestamp: '2026-10-03T15:02:00Z',
          technology: 'uwb',
          peerId: 'uwb-b',
          distanceMeters: 12,
          distanceUncertaintyMeters: 0.2,
          anchor: { id: 'uwb-b' },
        },
        {
          timestamp: '2026-10-03T15:02:00Z',
          technology: 'uwb',
          peerId: 'uwb-c',
          distanceMeters: 8,
          distanceUncertaintyMeters: 0.2,
          anchor: { id: 'uwb-c' },
        },
      ],
    },
  );
  assert.equal(normalizedRanging.measurements.length, 3);
  assert.equal(
    (normalizedRanging.measurements[0]?.anchors as any[])?.[0]?.latitude,
    43.55,
  );

  const capabilities = getSpectraActiveAcquisitionCapabilities();
  assert.ok(capabilities.some(capability => capability.id === 'android-collector-fixture'));
  assert.equal(
    capabilities.find(capability => capability.id === 'android-collector-fixture')
      ?.minPollIntervalMs,
    5000,
  );

  console.log('SPECTRA managed-device active acquisition and anchor verification passed.');
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv(
    'SPECTRA_ANDROID_MDM_LOCATION_URL_TEMPLATE',
    savedEnv.androidUrl,
  );
  restoreEnv(
    'SPECTRA_ANDROID_MDM_LOCATION_TOKEN',
    savedEnv.androidToken,
  );
  restoreEnv(
    'SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE',
    savedEnv.appleUrl,
  );
  restoreEnv(
    'SPECTRA_APPLE_MDM_LOCATION_TOKEN',
    savedEnv.appleToken,
  );
  restoreEnv(
    'SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE',
    savedEnv.ciscoUrl,
  );
  restoreEnv(
    'SPECTRA_CISCO_SPACES_TOKEN',
    savedEnv.ciscoToken,
  );
  restoreEnv(
    'SPECTRA_ACTIVE_PROVIDER_ADAPTERS',
    savedEnv.activeAdapters,
  );
  restoreEnv(
    'SPECTRA_ANCHOR_CATALOG_JSON',
    savedEnv.anchors,
  );
  restoreEnv(
    'SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS',
    savedEnv.infrastructureBindings,
  );
  delete process.env.FIXTURE_COLLECTOR_TOKEN;
}
