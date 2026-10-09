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

  assert.equal(assessment.status, 'estimated');
  assert.equal(assessment.independentDomainCount, 1);
  assert.ok(assessment.reasons.some(reason => reason.includes('independent corroboration is not established')));
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
      accuracy: 0.04,
      confidence: 0.999,
      provenance: { provider: 'rtk-provider-a' },
      metadata: {
        providerKind: 'gnss-precision-solution',
        solutionType: 'rtk-fixed',
        accuracyConfidenceLevel: 0.95,
        correctionAgeSeconds: 0.4,
        ambiguityRatio: 5.1,
        ambiguitiesFixed: true,
        satellitesUsed: 20,
        hdop: 0.7,
        horizontalProtectionLevelMeters: 0.09,
        covariance: { eastVariance: 0.0001, northVariance: 0.0001 },
      },
    }),
    point({
      source: 'gnss_fix',
      latitude: 43.5446001,
      longitude: -96.7311001,
      accuracy: 0.08,
      confidence: 0.995,
      provenance: { provider: 'ppp-provider-b' },
      metadata: {
        providerKind: 'gnss-precision-solution',
        solutionType: 'ppp-rtk',
        accuracyConfidenceLevel: 0.95,
        correctionAgeSeconds: 0.7,
        ambiguityRatio: 4.2,
        satellitesUsed: 18,
        hdop: 0.8,
        covariance: { eastVariance: 0.0004, northVariance: 0.0004 },
      },
    }),
  ], now);

  assert.equal(assessment.independentFamilyCount, 1);
  assert.equal(assessment.independentDomainCount, 2);
  assert.equal(assessment.status, 'corroborated');
  assert.equal(assessment.sources.length, 2);
}

{
  const assessment = assessSpectraLiveLocation([
    point({
      source: 'gnss_fix',
      accuracy: 0.04,
      confidence: 0.999,
      provenance: { provider: 'rtk-rover' },
      metadata: {
        providerKind: 'gnss-precision-solution',
        deviceRef: 'rover-1',
        correlationDomain: 'rover-1',
        solutionType: 'rtk-fixed',
        accuracyConfidenceLevel: 0.95,
        correctionAgeSeconds: 0.4,
        ambiguityRatio: 5.2,
        ambiguitiesFixed: true,
        satellitesUsed: 21,
        hdop: 0.7,
        covariance: { eastVariance: 0.0001, northVariance: 0.0001 },
      },
    }),
    point({
      source: 'visual_positioning',
      latitude: 43.5446002,
      longitude: -96.7310999,
      accuracy: 1.0,
      confidence: 0.98,
      provenance: { provider: 'arcore-vps' },
      metadata: {
        providerKind: 'arcore-geospatial-pose',
        deviceRef: 'rover-1',
        correlationDomain: 'rover-1',
        accuracyConfidenceLevel: 0.68,
        vpsUsed: true,
      },
    }),
  ], now);

  assert.equal(assessment.independentFamilyCount, 2);
  assert.equal(assessment.independentDomainCount, 1);
  assert.equal(assessment.status, 'estimated');
}

{
  const assessment = assessSpectraLiveLocation([
    point({
      source: 'gnss_fix',
      latitude: 43.5446000,
      longitude: -96.7311000,
      accuracy: 0.03,
      confidence: 0.999,
      timestamp: new Date(now.getTime() - 40),
      provenance: { provider: 'rtk-rover' },
      metadata: {
        providerKind: 'gnss-precision-solution',
        deviceRef: 'rover-precision-1',
        correlationDomain: 'rover-precision-1',
        solutionType: 'rtk-fixed',
        accuracyConfidenceLevel: 0.95,
        correctionAgeSeconds: 0.3,
        ambiguityRatio: 5.4,
        ambiguitiesFixed: true,
        satellitesUsed: 22,
        hdop: 0.6,
        horizontalProtectionLevelMeters: 0.08,
        covariance: { eastVariance: 0.0001, northVariance: 0.0001 },
        integrity: {
          integrityScore: 0.99,
          precisionReadinessScore: 0.99,
          spoofingSuspected: false,
          jammingSuspected: false,
          navigationAuthenticationStatus: 'authenticated',
        },
      },
    }),
    point({
      source: 'visual_positioning',
      latitude: 43.5446003,
      longitude: -96.7310998,
      accuracy: 1.1,
      confidence: 0.98,
      timestamp: new Date(now.getTime() - 30),
      provenance: { provider: 'arcore-vps' },
      metadata: {
        providerKind: 'arcore-geospatial-pose',
        deviceRef: 'rover-precision-1',
        correlationDomain: 'rover-precision-1',
        accuracyConfidenceLevel: 0.68,
        vpsUsed: true,
      },
    }),
    point({
      source: 'uwb_range',
      latitude: 43.5446001,
      longitude: -96.7311001,
      accuracy: 0.20,
      confidence: 0.999,
      timestamp: new Date(now.getTime() - 20),
      provenance: { provider: 'independent-uwb-anchor-network' },
      metadata: {
        accuracyConfidenceLevel: 0.68,
        correlationDomain: 'uwb-anchor-network-a',
      },
    }),
  ], now);

  assert.equal(assessment.status, 'corroborated');
  assert.equal(assessment.independentDomainCount, 2);
  assert.ok(assessment.confidenceScore > 0.99);
  assert.ok((assessment.confidenceRadiusMeters99 ?? Infinity) < 1);
  assert.ok(assessment.consistencyPenalty > 0.99);
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
