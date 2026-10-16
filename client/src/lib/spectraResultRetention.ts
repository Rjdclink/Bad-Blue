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

export function retainSpectraCandidates<T extends LocationCandidate>(
  previous: T[], incoming: T[], canonicalSubjectUpdate = false,
): T[] {
  if (!incoming.length) return previous;
  const merged = new Map<string, T>();
  const rows = canonicalSubjectUpdate ? incoming : [...previous, ...incoming];
  for (const candidate of rows) {
    const key = [candidate.latitude, candidate.longitude, candidate.basis, candidate.label].join('|');
    const existing = merged.get(key);
    if (!existing || candidate.confidence >= existing.confidence) merged.set(key, candidate);
  }
  const ranked = [...merged.values()].sort((a, b) => b.confidence - a.confidence);
  if (canonicalSubjectUpdate) {
    const previousBest = previous.reduce((best, candidate) =>
      Math.max(best, Number.isFinite(candidate.confidence) ? candidate.confidence : -Infinity), -Infinity);
    const newBest = ranked[0]?.confidence ?? -Infinity;
    // Replace a subject's obsolete map estimate only if newly assembled
    // evidence is at least as strong. Keep weaker supplemental refreshes.
    if (!Number.isFinite(newBest) || newBest < previousBest) return previous;
  }
  // Public places and other non-canonical views preserve additive evidence.
  return ranked;
}
