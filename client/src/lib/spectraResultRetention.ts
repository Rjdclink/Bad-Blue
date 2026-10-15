import type { GPSPoint, LocationCandidate } from '@shared/geoconsoleTypes';

// Retain evidence only within the current target. Empty supplemental passes
// are not evidence that a previously displayed result has become invalid.
export function retainSpectraObservations(previous: GPSPoint[], incoming: GPSPoint[]): GPSPoint[] {
  const merged = new Map<string, GPSPoint>();
  for (const point of [...previous, ...incoming]) {
    const time = new Date(point.timestamp).getTime();
    if (!Number.isFinite(time)) continue;
    const group = point.correlationGroup || point.provenance?.recordId
      || `${point.source}:${point.provenance?.provider || 'unknown'}`;
    merged.set([point.latitude, point.longitude, time, point.source, group].join('|'), point);
  }
  return [...merged.values()].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function retainSpectraCandidates<T extends LocationCandidate>(previous: T[], incoming: T[]): T[] {
  if (!incoming.length) return previous;
  const merged = new Map<string, T>();
  for (const candidate of [...previous, ...incoming]) {
    const key = [candidate.latitude, candidate.longitude, candidate.basis, candidate.label].join('|');
    const existing = merged.get(key);
    if (!existing || candidate.confidence >= existing.confidence) merged.set(key, candidate);
  }
  // Preserve existing alternatives; a weaker pass must not displace the best
  // supported estimate. Scores are retained as supplied, never inflated.
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence);
}
