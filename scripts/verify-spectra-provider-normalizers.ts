import assert from 'node:assert/strict';
import {
  normalizeSpectraProviderPayload,
  SpectraProviderNormalizationError,
} from '../server/services/spectra/SpectraProviderTelemetryNormalizer';

function measurement(batch: ReturnType<typeof normalizeSpectraProviderPayload>, index = 0) {
  const value = batch.measurements[index] as Record<string, any> | undefined;
  assert.ok(value, `Expected measurement at index ${index}`);
  return value;
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'carrier-a',
    {
      sessionId: 'camara-circle',
      subjectLabel: 'device',
      lastLocationTime: '2025-01-02T03:04:05Z',
      area: {
        areaType: 'CIRCLE',
        center: { latitude: 45.754114, longitude: 4.860374 },
        radius: 800,
      },
      device: { phoneNumber: '+123456789' },
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'network_region');
  assert.equal(point.latitude, 45.754114);
  assert.equal(point.longitude, 4.860374);
  assert.equal(point.accuracy, 800);
  assert.equal(point.metadata.deviceIdentifierReturned, true);
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'carrier-b',
    {
      lastLocationTime: '2025-01-02T03:04:05Z',
      area: {
        areaType: 'POLYGON',
        boundary: [
          { latitude: 45.754114, longitude: 4.860374 },
          { latitude: 45.753845, longitude: 4.863185 },
          { latitude: 45.752490, longitude: 4.861876 },
          { latitude: 45.751224, longitude: 4.861125 },
          { latitude: 45.751442, longitude: 4.859827 },
        ],
      },
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'network_region');
  assert.ok(point.latitude > 45.751 && point.latitude < 45.755);
  assert.ok(point.longitude > 4.859 && point.longitude < 4.864);
  assert.ok(point.accuracy > 100);
}

{
  const batch = normalizeSpectraProviderPayload(
    'bluetooth-scanner',
    'ble-array-1',
    {
      sessionId: 'ble-session',
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        targetId: 'beacon-42',
        source: 'ble_rssi',
        anchors: [
          {
            id: 'scanner-a',
            latitude: 43.5446,
            longitude: -96.7311,
            rssiDbm: -61,
            txPowerAtOneMeterDbm: -59,
          },
          {
            id: 'scanner-b',
            latitude: 43.5450,
            longitude: -96.7300,
            rssiDbm: -66,
            txPowerAtOneMeterDbm: -59,
          },
          {
            id: 'scanner-c',
            latitude: 43.5439,
            longitude: -96.7298,
            rssiDbm: -64,
            txPowerAtOneMeterDbm: -59,
          },
        ],
      }],
    },
  );
  const ranging = measurement(batch);
  assert.equal(ranging.kind, 'ranging');
  assert.equal(ranging.source, 'ble_rssi');
  assert.equal(ranging.anchors.length, 3);
  assert.match(String(ranging.correlationGroup), /^bluetooth:ble-array-1:/);
}

{
  const batch = normalizeSpectraProviderPayload(
    'accessory-network',
    'partner-feed',
    {
      sessionId: 'accessory-session',
      network: 'google-find-hub',
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        latitude: 41.2565,
        longitude: -95.9345,
        accuracy: 35,
        deviceRef: 'accessory-7',
        observationId: 'obs-1',
      }],
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'network_region');
  assert.equal(point.accuracy, 35);
  assert.equal(point.metadata.network, 'google-find-hub');
  assert.equal(point.metadata.deviceRef, 'accessory-7');
}

assert.throws(
  () => normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'carrier-a',
    { area: { areaType: 'CIRCLE' } },
  ),
  SpectraProviderNormalizationError,
);

assert.throws(
  () => normalizeSpectraProviderPayload(
    'bluetooth-scanner',
    'ble-array-1',
    { observations: [{ timestamp: '2025-01-02T03:04:05Z', anchors: [] }] },
  ),
  SpectraProviderNormalizationError,
);

console.log('SPECTRA provider normalizer regression checks passed.');
