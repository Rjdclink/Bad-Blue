import assert from 'node:assert/strict';
import type { GPSPoint } from '../server/services/geoconsole/types';
import { resolveSpectraRadioConsensus } from '../server/services/spectra/SpectraRadioConsensus';

function point(input: {
  latitude: number;
  longitude: number;
  accuracy: number;
  confidence: number;
  provider: string;
  source?: GPSPoint['source'];
}): GPSPoint {
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy,
    timestamp: new Date('2026-10-04T00:00:00.000Z'),
    source: input.source || 'wifi_fingerprint',
    confidence: input.confidence,
    observationKind: 'inferred',
    correlationGroup: `radio:${input.provider}`,
    provenance: {
      provider: input.provider,
      capturedAt: new Date('2026-10-04T00:00:00.000Z'),
    },
  };
}

const clustered = resolveSpectraRadioConsensus([
  point({
    latitude: 41.25650,
    longitude: -95.93450,
    accuracy: 45,
    confidence: 0.82,
    provider: 'provider-a',
  }),
  point({
    latitude: 41.25662,
    longitude: -95.93458,
    accuracy: 55,
    confidence: 0.78,
    provider: 'provider-b',
  }),
  point({
    latitude: 42.10000,
    longitude: -96.90000,
    accuracy: 35,
    confidence: 0.91,
    provider: 'outlier-provider',
  }),
]);
assert(clustered, 'radio consensus should return a result');
assert.equal(clustered.agreeingProviderCount, 2);
assert.equal(clustered.excludedProviderCount, 1);
assert.equal(clustered.candidateCount, 3);
assert.equal(clustered.point.provenance?.provider, 'SPECTRA radio consensus');
assert.equal(
  (clustered.point.metadata as any).radioConsensusMethod,
  'robust-provider-cluster-weighted-centroid',
);
assert.deepEqual(
  new Set((clustered.point.metadata as any).radioConsensusProviders),
  new Set(['provider-a', 'provider-b']),
);
assert.deepEqual(
  (clustered.point.metadata as any).radioExcludedProviders,
  ['outlier-provider'],
);
assert(
  Number(clustered.point.accuracy) >= 45,
  'consensus must not claim accuracy tighter than the best agreeing provider',
);
assert(
  clustered.point.latitude > 41.25649 && clustered.point.latitude < 41.25663,
  'centroid should remain inside the agreeing cluster',
);

const duplicatedProvider = resolveSpectraRadioConsensus([
  point({
    latitude: 41.25,
    longitude: -95.93,
    accuracy: 500,
    confidence: 0.6,
    provider: 'same-provider',
  }),
  point({
    latitude: 41.251,
    longitude: -95.931,
    accuracy: 80,
    confidence: 0.8,
    provider: 'same-provider',
  }),
]);
assert(duplicatedProvider);
assert.equal(
  duplicatedProvider.candidateCount,
  1,
  'same provider must not manufacture independent corroboration',
);
assert.equal(duplicatedProvider.point.accuracy, 80);

const single = resolveSpectraRadioConsensus([
  point({
    latitude: 41.26,
    longitude: -95.94,
    accuracy: 120,
    confidence: 0.7,
    provider: 'only-provider',
  }),
]);
assert(single);
assert.equal(single.agreeingProviderCount, 1);
assert.equal(
  (single.point.metadata as any).radioConsensusMethod,
  'single-best-candidate',
);

const split = resolveSpectraRadioConsensus([
  point({
    latitude: 41.0,
    longitude: -95.0,
    accuracy: 30,
    confidence: 0.88,
    provider: 'p1',
  }),
  point({
    latitude: 42.0,
    longitude: -96.0,
    accuracy: 40,
    confidence: 0.8,
    provider: 'p2',
  }),
  point({
    latitude: 43.0,
    longitude: -97.0,
    accuracy: 50,
    confidence: 0.75,
    provider: 'p3',
  }),
]);
assert(split);
assert.equal(split.agreeingProviderCount, 1);
assert.equal(split.excludedProviderCount, 2);
assert.equal(split.point.provenance?.provider, 'p1');

console.log('SPECTRA radio consensus verification passed');
