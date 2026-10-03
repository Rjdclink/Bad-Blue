import assert from 'node:assert/strict';
import {
  acquireSpectraActiveTelemetry,
  getSpectraActiveAcquisitionCapabilities,
} from '../server/services/spectra/SpectraActiveAcquisition';
import { resolveConfiguredSpectraAnchor } from '../server/services/spectra/SpectraAnchorRegistry';
import { normalizeSpectraProviderPayload } from '../server/services/spectra/SpectraProviderTelemetryNormalizer';

const originalFetch = globalThis.fetch;
const savedEnv = {
  camaraUrl: process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL,
  camaraToken: process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN,
  camaraMaxAge: process.env.SPECTRA_CAMARA_MAX_AGE_SECONDS,
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
  process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL =
    'https://carrier.example/location-retrieval/v1/retrieve';
  process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN = 'fixture-token';
  process.env.SPECTRA_CAMARA_MAX_AGE_SECONDS = '30';
  delete process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE;
  delete process.env.SPECTRA_CISCO_SPACES_TOKEN;
  process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS = '[]';

  let camaraCalled = false;
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    assert.equal(url, 'https://carrier.example/location-retrieval/v1/retrieve');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)?.Authorization, 'Bearer fixture-token');
    const body = JSON.parse(String(init?.body || '{}'));
    assert.equal(body.device.phoneNumber, '+17125550100');
    assert.equal(body.maxAge, 30);
    camaraCalled = true;
    return new Response(JSON.stringify({
      lastLocationTime: '2026-10-03T15:00:00Z',
      area: {
        areaType: 'CIRCLE',
        center: { latitude: 43.55, longitude: -96.73 },
        radius: 120,
      },
      device: { phoneNumber: '+17125550100' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const camara = await acquireSpectraActiveTelemetry({
    phoneNumber: '(712) 555-0100',
    sessionId: 'fixture-session',
    subjectLabel: 'fixture phone',
  });
  assert.equal(camaraCalled, true);
  assert.equal(camara.batches.length, 1);
  assert.equal(camara.attempts[0]?.status, 'fulfilled');
  assert.equal(camara.batches[0]?.measurements[0]?.source, 'network_region');
  assert.equal(camara.batches[0]?.measurements[0]?.accuracy, 120);
  assert.equal(
    (camara.batches[0]?.measurements[0]?.metadata as any)?.providerKind,
    'camara-location-retrieval',
  );

  delete process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL;
  delete process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN;
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
    assert.equal((init?.headers as Record<string, string>)?.Authorization, 'collector-token');
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
    subjectLabel: 'fixture device',
  });
  assert.equal(collector.batches.length, 1);
  assert.equal(collector.batches[0]?.measurements[0]?.source, 'device_gps');
  assert.equal(collector.batches[0]?.metadata?.acquisition, 'active-provider-pull');

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

  console.log('SPECTRA active acquisition and configured-anchor verification passed.');
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv(
    'SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL',
    savedEnv.camaraUrl,
  );
  restoreEnv(
    'SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN',
    savedEnv.camaraToken,
  );
  restoreEnv(
    'SPECTRA_CAMARA_MAX_AGE_SECONDS',
    savedEnv.camaraMaxAge,
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
  delete process.env.FIXTURE_COLLECTOR_TOKEN;
}
