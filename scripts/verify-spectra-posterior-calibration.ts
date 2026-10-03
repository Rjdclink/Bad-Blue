import assert from 'node:assert/strict';
import type { GPSPoint } from '../server/services/geoconsole/types';
import { assessSpectraLiveLocation } from '../server/services/spectra/SpectraLiveConfidence';

const TRIALS = 10_000;
const BASE_LATITUDE = 43.5446;
const BASE_LONGITUDE = -96.7311;
const EARTH_RADIUS_METERS = 6_371_000;
const NOW = new Date('2026-10-02T21:30:00.000Z');

class SeededRandom {
  private state = 0x5eed1234;

  uniform(): number {
    this.state = (Math.imul(1_664_525, this.state) + 1_013_904_223) >>> 0;
    return (this.state + 0.5) / 0x1_0000_0000;
  }

  normalPair(): [number, number] {
    const first = Math.max(1e-12, this.uniform());
    const second = this.uniform();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;
    return [
      magnitude * Math.cos(angle),
      magnitude * Math.sin(angle),
    ];
  }
}

function sigmaForRadius(radiusMeters: number, confidenceLevel = 0.68): number {
  return radiusMeters / Math.sqrt(-2 * Math.log(1 - confidenceLevel));
}

function offsetCoordinate(
  eastMeters: number,
  northMeters: number,
): { latitude: number; longitude: number } {
  const latitude =
    BASE_LATITUDE
    + northMeters / EARTH_RADIUS_METERS * 180 / Math.PI;
  const longitude =
    BASE_LONGITUDE
    + eastMeters
    / (
      EARTH_RADIUS_METERS
      * Math.cos(BASE_LATITUDE * Math.PI / 180)
    )
    * 180 / Math.PI;
  return { latitude, longitude };
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const latitude1 = toRadians(latitudeA);
  const latitude2 = toRadians(latitudeB);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1)
    * Math.cos(latitude2)
    * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2
    * Math.atan2(
      Math.sqrt(haversine),
      Math.sqrt(Math.max(0, 1 - haversine)),
    );
}

const sourceConfigurations = [
  {
    source: 'gnss_fix' as const,
    provider: 'rtk-rover',
    radiusMeters: 1.2,
    confidence: 0.998,
  },
  {
    source: 'wifi_rtt' as const,
    provider: 'wifi-rtt-array',
    radiusMeters: 0.8,
    confidence: 0.997,
  },
  {
    source: 'bluetooth_channel_sounding' as const,
    provider: 'bluetooth-cs-array',
    radiusMeters: 0.25,
    confidence: 0.999,
  },
  {
    source: 'uwb_range' as const,
    provider: 'uwb-anchor-network',
    radiusMeters: 0.3,
    confidence: 0.999,
  },
];

const random = new SeededRandom();
let containedByReported99Region = 0;
let posteriorConfidenceAbove99 = 0;
let radiusSum = 0;

for (let trial = 0; trial < TRIALS; trial += 1) {
  const observations: GPSPoint[] = sourceConfigurations.map((configuration, index) => {
    const sigma = sigmaForRadius(configuration.radiusMeters);
    const [eastNormal, northNormal] = random.normalPair();
    const coordinate = offsetCoordinate(
      eastNormal * sigma,
      northNormal * sigma,
    );

    return {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      accuracy: configuration.radiusMeters,
      timestamp: new Date(NOW.getTime() - index * 5),
      confidence: configuration.confidence,
      source: configuration.source,
      observationKind: 'observed',
      provenance: { provider: configuration.provider },
      metadata: {
        accuracyConfidenceLevel: 0.68,
      },
    };
  });

  const assessment = assessSpectraLiveLocation(observations, NOW);
  assert.ok(assessment.consensusCenter);
  assert.ok(Number.isFinite(assessment.confidenceRadiusMeters99));

  const errorMeters = distanceMeters(
    assessment.consensusCenter!.latitude,
    assessment.consensusCenter!.longitude,
    BASE_LATITUDE,
    BASE_LONGITUDE,
  );
  const radius99 = assessment.confidenceRadiusMeters99!;

  if (errorMeters <= radius99) containedByReported99Region += 1;
  if (assessment.confidenceScore > 0.99) posteriorConfidenceAbove99 += 1;
  radiusSum += radius99;
}

const empiricalContainment = containedByReported99Region / TRIALS;
const posteriorAbove99Rate = posteriorConfidenceAbove99 / TRIALS;
const averageRadius99Meters = radiusSum / TRIALS;

console.log({
  trials: TRIALS,
  empiricalContainment,
  posteriorAbove99Rate,
  averageRadius99Meters,
});

// This is a calibration regression test, not a runtime threshold or score floor.
// Under independent zero-mean Gaussian errors matching each source's declared
// confidence radius, the reported 99% region must empirically contain truth
// at least 99% of the time.
assert.ok(
  empiricalContainment >= 0.99,
  `Expected >=99% empirical coverage, observed ${(empiricalContainment * 100).toFixed(3)}%`,
);

// The high-quality independent source configuration must be capable of
// producing >99% evidence confidence without a forced minimum score.
assert.ok(
  posteriorAbove99Rate >= 0.95,
  `Expected fresh independent precision sources to naturally exceed 99% posterior confidence in >=95% of trials; observed ${(posteriorAbove99Rate * 100).toFixed(3)}%`,
);

assert.ok(
  averageRadius99Meters < 1,
  `Expected a sub-meter average 99% radius, observed ${averageRadius99Meters.toFixed(3)} m`,
);

console.log('SPECTRA posterior calibration checks passed.');
