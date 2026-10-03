import assert from 'node:assert/strict';
import type { GPSPoint } from '../server/services/geoconsole/types';
import { assessSpectraLiveLocation } from '../server/services/spectra/SpectraLiveConfidence';

const now = new Date('2026-10-02T21:30:00.000Z');

function point(overrides: Partial<GPSPoint> & Pick<GPSPoint, 'source'>): GPSPoint {
  return {
    latitude: 43.544600,
    longitude: -96.731100,
    accuracy: 5,
    timestamp: new Date(now.getTime() - 5_000),
    confidence: 0.95,
    observationKind: 'observed',
    provenance: { provider: 'test-provider' },
    metadata: {},
    ...overrides,
  };
}

{
  const assessment = assessSpectraLiveLocation([
    point({ source: 'gnss_fix', accuracy: 4 }),
  ], now);
  assert.equal(assessment.status, 'single-source');
  assert.equal(assessment.exceedsNinetyNinePercent, false);
  assert.ok(assessment.confidenceScore <= 0.89);
}

{
  const assessment = assessSpectraLiveLocation([
    point({ source: 'gnss_fix', accuracy: 4 }),
    point({
      source: 'wifi_rtt',
      latitude: 43.544610,
      longitude: -96.731090,
      accuracy: 6,
    }),
  ], now);
  assert.equal(assessment.status, 'corroborated');
  assert.equal(assessment.exceedsNinetyNinePercent, false);
  assert.ok(assessment.confidenceScore <= 0.989);
}

{
  const assessment = assessSpectraLiveLocation([
    point({ source: 'gnss_fix', accuracy: 4, confidence: 0.97 }),
    point({
      source: 'wifi_rtt',
      latitude: 43.544610,
      longitude: -96.731090,
      accuracy: 6,
      confidence: 0.94,
    }),
    point({
      source: 'bluetooth_channel_sounding',
      latitude: 43.544605,
      longitude: -96.731095,
      accuracy: 1.5,
      confidence: 0.97,
    }),
  ], now);
  assert.equal(assessment.status, 'high-confidence');
  assert.equal(assessment.exceedsNinetyNinePercent, true);
  assert.ok(assessment.confidenceScore > 0.99);
  assert.ok(assessment.strongConsensusFamilyCount >= 3);
}

{
  const assessment = assessSpectraLiveLocation([
    point({ source: 'gnss_fix', accuracy: 4, confidence: 0.97 }),
    point({
      source: 'wifi_rtt',
      latitude: 43.544610,
      longitude: -96.731090,
      accuracy: 6,
      confidence: 0.94,
    }),
    point({
      source: 'bluetooth_channel_sounding',
      latitude: 44.000000,
      longitude: -97.000000,
      accuracy: 1.5,
      confidence: 0.97,
    }),
  ], now);
  assert.equal(assessment.status, 'contradicted');
  assert.equal(assessment.exceedsNinetyNinePercent, false);
  assert.ok(assessment.contradictionCount > 0);
  assert.ok(assessment.confidenceScore <= 0.69);
}

{
  const stale = point({
    source: 'gnss_fix',
    timestamp: new Date(now.getTime() - 5 * 60_000),
  });
  const assessment = assessSpectraLiveLocation([stale], now);
  assert.equal(assessment.status, 'stale');
  assert.equal(assessment.isLive, false);
  assert.equal(assessment.confidenceScore, 0);
}

{
  const assessment = assessSpectraLiveLocation([
    point({
      source: 'device_gps',
      accuracy: 8,
      metadata: { providerKind: 'apple-managed-lost-mode' },
    }),
    point({
      source: 'network_region',
      latitude: 43.5447,
      longitude: -96.7310,
      accuracy: 80,
      confidence: 0.85,
      metadata: { providerKind: 'camara-location-retrieval', networkDerived: true },
    }),
    point({
      source: 'wifi_fingerprint',
      latitude: 43.54465,
      longitude: -96.73105,
      accuracy: 25,
      confidence: 0.9,
      metadata: { providerKind: 'cisco-spaces-location' },
    }),
  ], now);
  assert.equal(assessment.independentFamilyCount, 3);
  assert.ok(assessment.sources.some(source => source.family === 'managed-device'));
  assert.ok(assessment.sources.some(source => source.family === 'carrier-network'));
  assert.ok(assessment.sources.some(source => source.family === 'enterprise-sensor'));
}

console.log('SPECTRA live confidence regression checks passed.');
