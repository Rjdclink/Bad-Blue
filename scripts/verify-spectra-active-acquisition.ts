import assert from 'node:assert/strict';
import {
  acquireSpectraActiveTelemetry,
  getSpectraActiveAcquisitionCapabilities,
} from '../server/services/spectra/SpectraActiveAcquisition';
import { resolveConfiguredSpectraAnchor } from '../server/services/spectra/SpectraAnchorRegistry';
import { normalizeSpectraProviderPayload } from '../server/services/spectra/SpectraProviderTelemetryNormalizer';

const originalFetch = globalThis.fetch;
const savedEnv = {
  ciscoUrl: process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE,
  ciscoToken: process.env.SPECTRA_CISCO_SPACES_TOKEN,
  activeAdapters: process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS,
  anchors: process.env.SPECTRA_ANCHOR_CATALOG_JSON,
};

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
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

  const skipped = await acquireSpectraActiveTelemetry({
    sessionId: 'fixture-session',
    subjectLabel: 'missing managed device',
  });
  assert.equal(skipped.batches.length, 0);
  assert.equal(skipped.attempts[0]?.status, 'skipped');

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

  console.log('SPECTRA managed-device active acquisition and anchor verification passed.');
} finally {
  globalThis.fetch = originalFetch;
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
  delete process.env.FIXTURE_COLLECTOR_TOKEN;
}
