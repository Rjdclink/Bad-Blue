import assert from 'node:assert/strict';
import type { GPSPoint } from '../server/services/geoconsole/types';
import { assessSpectraLiveLocation } from '../server/services/spectra/SpectraLiveConfidence';

const now = new Date('2026-10-02T21:30:00.000Z');

function point(overrides: Partial<GPSPoint> & Pick<GPSPoint, 'source'>): GPSPoint {
  return {
    latitude: 43.544600,
    longitude: -96.731100,
    accuracy: 5,
    timestamp: new Date(now.getTime() - 250),
    confidence: 0.98,
    observationKind: 'observed',
    provenance: { provider: 'test-provider' },
    metadata: { accuracyConfidenceLevel: 0.68 },
    ...overrides,
  };
}

{
  const assessment = assessSpectraLiveLocation([
    point({ source: 'gnss_fix', accuracy: 4 }),
  ], now);

  assert.equal(assessment.status, 'estimated');
  assert.equal(assessment.independentFamilyCount, 1);
  assert.ok(assessment.confidenceScore > 0);
  assert.ok(assessment.confidenceScore < 1);
  assert.ok((assessment.confidenceRadiusMeters99 ?? Infinity) > 0);
}

{
  const assessment = assessSpectraLiveLocation([
    point({ source: 'gnss_fix', accuracy: 4 }),
    point({
      source: 'wifi_rtt',
      latitude: 43.544603,
      longitude: -96.731097,
      accuracy: 3,
      confidence: 0.98,
    }),
  ], now);

  assert.equal(assessment.status, 'corroborated');
  assert.equal(assessment.independentFamilyCount, 2);
  assert.ok(assessment.effectiveSourceCount > 1);
  assert.ok((assessment.confidenceRadiusMeters99 ?? Infinity) < 10);
}

{
  const assessment = assessSpectraLiveLocation([
    point({
      source: 'gnss_fix',
      accuracy: 1.2,
      confidence: 0.998,
      provenance: { provider: 'gnss-rtk-rover' },
      timestamp: new Date(now.getTime() - 50),
    }),
    point({
      source: 'wifi_rtt',
      provenance: { provider: 'wifi-rtt-array' },
      latitude: 43.5446004,
      longitude: -96.7310996,
      accuracy: 0.8,
      confidence: 0.997,
      timestamp: new Date(now.getTime() - 40),
    }),
    point({
      source: 'bluetooth_channel_sounding',
      provenance: { provider: 'bluetooth-cs-array' },
      latitude: 43.5446002,
      longitude: -96.7310998,
      accuracy: 0.25,
      confidence: 0.999,
      timestamp: new Date(now.getTime() - 30),
      metadata: {
        accuracyConfidenceLevel: 0.68,
        providerKind: 'bluetooth-channel-sounding',
      },
    }),
    point({
      source: 'uwb_range',
      provenance: { provider: 'uwb-anchor-network' },
      latitude: 43.5446001,
      longitude: -96.7311001,
      accuracy: 0.3,
      confidence: 0.999,
      timestamp: new Date(now.getTime() - 20),
    }),
  ], now);

  assert.equal(assessment.status, 'corroborated');
  assert.ok(assessment.confidenceScore > 0.99);
  assert.ok((assessment.confidenceRadiusMeters99 ?? Infinity) < 2);
  assert.ok(assessment.consistencyScore > 0.9);
  assert.ok(assessment.freshnessScore > 0.99);
}

{
  const assessment = assessSpectraLiveLocation([
    point({
      source: 'gnss_fix',
      accuracy: 2,
      confidence: 0.99,
    }),
    point({
      source: 'wifi_rtt',
      latitude: 43.544602,
      longitude: -96.731098,
      accuracy: 2,
      confidence: 0.99,
    }),
    point({
      source: 'bluetooth_channel_sounding',
      latitude: 44.000000,
      longitude: -97.000000,
      accuracy: 0.3,
      confidence: 0.999,
    }),
  ], now);

  assert.equal(assessment.status, 'conflicted');
  assert.ok(assessment.consistencyScore < 0.05);
  assert.ok(assessment.confidenceScore < 0.99);
  assert.ok(assessment.residualScale > 1);
}

{
  const stale = point({
    source: 'gnss_fix',
    timestamp: new Date(now.getTime() - 15 * 60_000),
  });
  const assessment = assessSpectraLiveLocation([stale], now);

  assert.ok(assessment.freshnessScore < 0.01);
  assert.ok(assessment.confidenceScore < 0.2);
}

{
  const assessment = assessSpectraLiveLocation([
    point({
      source: 'device_gps',
      accuracy: 8,
      metadata: {
        providerKind: 'apple-managed-lost-mode',
        accuracyConfidenceLevel: 0.68,
      },
    }),
    point({
      source: 'network_region',
      latitude: 43.5447,
      longitude: -96.7310,
      accuracy: 80,
      confidence: 0.85,
      metadata: {
        providerKind: 'camara-location-retrieval',
        networkDerived: true,
        accuracyConfidenceLevel: 0.50,
      },
    }),
    point({
      source: 'wifi_fingerprint',
      latitude: 43.54465,
      longitude: -96.73105,
      accuracy: 25,
      confidence: 0.9,
      metadata: {
        providerKind: 'cisco-spaces-location',
        accuracyConfidenceLevel: 0.68,
      },
    }),
  ], now);

  assert.equal(assessment.independentFamilyCount, 3);
  assert.ok(assessment.sources.some(source => source.family === 'managed-device'));
  assert.ok(assessment.sources.some(source => source.family === 'carrier-network'));
  assert.ok(assessment.sources.some(source => source.family === 'enterprise-sensor'));
}

console.log('SPECTRA posterior live-confidence regression checks passed.');
