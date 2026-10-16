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
  // No new report is not evidence that the previous map context became invalid.
  if (!incoming.length) return previous;
  const latest = new Map<string, T>();
  for (const candidate of incoming) {
    const key = [candidate.latitude, candidate.longitude, candidate.basis, candidate.label].join('|');
    const existing = latest.get(key);
    if (!existing || candidate.confidence >= existing.confidence) latest.set(key, candidate);
  }
  const ranked = [...latest.values()].sort((a, b) => b.confidence - a.confidence);
  const previousBest = previous.reduce((best, candidate) =>
    Math.max(best, Number.isFinite(candidate.confidence) ? candidate.confidence : -Infinity), -Infinity);
  const nextBest = ranked[0]?.confidence ?? -Infinity;
  // A degraded supplemental refresh must not replace stronger earlier evidence.
  // An equally or more strongly supported canonical update replaces the old
  // candidate snapshot, rather than retaining obsolete alternative map choices.
  // Full evidence remains in the independently persisted source archive.
  return Number.isFinite(nextBest) && nextBest >= previousBest ? ranked : previous;
}
