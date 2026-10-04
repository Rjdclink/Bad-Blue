import type { GPSPoint } from '../geoconsole/types';

export interface SpectraRadioConsensusResult {
  point: GPSPoint;
  agreeingProviderCount: number;
  candidateCount: number;
  excludedProviderCount: number;
  maximumDisagreementMeters: number;
}

function haversineMeters(a: GPSPoint, b: GPSPoint): number {
  const radius = 6_371_008.8;
  const phi1 = a.latitude * Math.PI / 180;
  const phi2 = b.latitude * Math.PI / 180;
  const dPhi = (b.latitude - a.latitude) * Math.PI / 180;
  const dLambda = (b.longitude - a.longitude) * Math.PI / 180;
  const value =
    Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(value)));
}

function accuracy(point: GPSPoint): number {
  const value = Number(point.accuracy);
  return Number.isFinite(value) && value > 0
    ? Math.min(5_000_000, value)
    : 5_000;
}

function provider(point: GPSPoint): string {
  return String(point.provenance?.provider || point.source || 'unknown').slice(0, 200);
}

function agreementRadius(a: GPSPoint, b: GPSPoint): number {
  const claimed = Math.max(accuracy(a), accuracy(b));
  // Permit realistic overlap between broad cell/Wi-Fi estimates without
  // allowing country-scale points to be treated as corroborating evidence.
  return Math.max(125, Math.min(25_000, claimed * 2 + 75));
}

function candidateQuality(point: GPSPoint): number {
  const confidence = Math.max(0.05, Math.min(1, Number(point.confidence) || 0.05));
  return confidence / Math.max(25, accuracy(point));
}

function clusterAround(
  center: GPSPoint,
  candidates: GPSPoint[],
): GPSPoint[] {
  return candidates.filter(candidate =>
    candidate === center
    || haversineMeters(center, candidate) <= agreementRadius(center, candidate)
  );
}

function clusterSupport(cluster: GPSPoint[]): number {
  return cluster.reduce((sum, point) => sum + candidateQuality(point), 0);
}

function uniqueByProvider(points: GPSPoint[]): GPSPoint[] {
  const best = new Map<string, GPSPoint>();
  for (const point of points) {
    const key = provider(point).toLowerCase();
    const current = best.get(key);
    if (
      !current
      || accuracy(point) < accuracy(current)
      || (
        accuracy(point) === accuracy(current)
        && point.confidence > current.confidence
      )
    ) {
      best.set(key, point);
    }
  }
  return [...best.values()];
}

function weightedCentroid(points: GPSPoint[]): {
  latitude: number;
  longitude: number;
  rmsSpreadMeters: number;
} {
  let totalWeight = 0;
  let latitudeTotal = 0;
  let longitudeTotal = 0;

  for (const point of points) {
    const confidence = Math.max(0.1, Math.min(1, Number(point.confidence) || 0.1));
    const sigma = Math.max(25, accuracy(point));
    const weight = (confidence * confidence) / (sigma * sigma);
    totalWeight += weight;
    latitudeTotal += point.latitude * weight;
    longitudeTotal += point.longitude * weight;
  }

  const latitude = latitudeTotal / Math.max(Number.EPSILON, totalWeight);
  const longitude = longitudeTotal / Math.max(Number.EPSILON, totalWeight);
  const centroidPoint = {
    ...points[0],
    latitude,
    longitude,
  };

  const rmsSpreadMeters = Math.sqrt(
    points.reduce((sum, point) => {
      const distance = haversineMeters(centroidPoint, point);
      return sum + distance * distance;
    }, 0) / Math.max(1, points.length),
  );

  return { latitude, longitude, rmsSpreadMeters };
}

export function resolveSpectraRadioConsensus(
  rawCandidates: readonly GPSPoint[],
): SpectraRadioConsensusResult | null {
  const candidates = uniqueByProvider(
    rawCandidates.filter(point =>
      Number.isFinite(point.latitude)
      && Number.isFinite(point.longitude)
      && point.latitude >= -90 && point.latitude <= 90
      && point.longitude >= -180 && point.longitude <= 180
    ),
  );
  if (!candidates.length) return null;

  const rankedCenters = candidates
    .map(center => ({
      center,
      cluster: clusterAround(center, candidates),
    }))
    .sort((left, right) =>
      right.cluster.length - left.cluster.length
      || clusterSupport(right.cluster) - clusterSupport(left.cluster)
      || accuracy(left.center) - accuracy(right.center)
      || right.center.confidence - left.center.confidence
    );

  const selectedCluster = rankedCenters[0].cluster;
  const bestMember = [...selectedCluster].sort((left, right) =>
    accuracy(left) - accuracy(right)
    || right.confidence - left.confidence
  )[0];

  const excluded = candidates.filter(point => !selectedCluster.includes(point));
  const maximumDisagreementMeters = excluded.length
    ? Math.max(...excluded.map(point => haversineMeters(bestMember, point)))
    : 0;

  if (selectedCluster.length === 1) {
    return {
      point: {
        ...bestMember,
        metadata: {
          ...(bestMember.metadata || {}),
          radioConsensusMethod: 'single-best-candidate',
          radioConsensusProviders: [provider(bestMember)],
          radioExcludedProviders: excluded.map(provider),
          radioAgreementClusterSize: 1,
          radioCandidateCount: candidates.length,
          radioMaximumDisagreementMeters: Math.round(maximumDisagreementMeters),
        },
      },
      agreeingProviderCount: 1,
      candidateCount: candidates.length,
      excludedProviderCount: excluded.length,
      maximumDisagreementMeters,
    };
  }

  const centroid = weightedCentroid(selectedCluster);
  const bestClaimedAccuracy = Math.min(...selectedCluster.map(accuracy));
  // Do not manufacture precision better than the strongest contributing
  // provider. Disagreement can only widen the reported uncertainty.
  const consensusAccuracy = Math.max(
    bestClaimedAccuracy,
    centroid.rmsSpreadMeters,
    10,
  );
  const confidenceBoost = Math.min(0.12, (selectedCluster.length - 1) * 0.035);
  const confidence = Math.min(
    0.96,
    Math.max(...selectedCluster.map(point => point.confidence)) + confidenceBoost,
  );

  return {
    point: {
      ...bestMember,
      latitude: centroid.latitude,
      longitude: centroid.longitude,
      accuracy: consensusAccuracy,
      confidence,
      correlationGroup: 'radio:consensus',
      provenance: {
        ...bestMember.provenance,
        provider: 'SPECTRA radio consensus',
        capturedAt: bestMember.timestamp,
        transformedBy: [
          ...(bestMember.provenance?.transformedBy || []),
          'spectra_radio_consensus',
        ],
      },
      metadata: {
        ...(bestMember.metadata || {}),
        radioConsensusMethod: 'robust-provider-cluster-weighted-centroid',
        radioConsensusProviders: selectedCluster.map(provider),
        radioExcludedProviders: excluded.map(provider),
        radioAgreementClusterSize: selectedCluster.length,
        radioCandidateCount: candidates.length,
        radioConsensusRmsSpreadMeters: Math.round(centroid.rmsSpreadMeters),
        radioMaximumDisagreementMeters: Math.round(maximumDisagreementMeters),
        radioBestClaimedAccuracyMeters: bestClaimedAccuracy,
      },
    },
    agreeingProviderCount: selectedCluster.length,
    candidateCount: candidates.length,
    excludedProviderCount: excluded.length,
    maximumDisagreementMeters,
  };
}
