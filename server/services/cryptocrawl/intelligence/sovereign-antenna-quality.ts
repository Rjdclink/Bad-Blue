import type { CexStreamVenue } from './cex-order-book-stream.js';

export interface AntennaProviderQualitySnapshot {
  venue: CexStreamVenue;
  requests: number;
  usableQuotes: number;
  misses: number;
  failures: number;
  averageLatencyMs: number;
  p95LatencyMs: number | null;
  hitRate: number;
  failureRate: number;
  lastObservedAt: number | null;
  observationAgeMs: number | null;
  recencyScore: number;
  qualityScore: number;
  executionAuthority: false;
}

type MutableVenueQuality = {
  requests: number;
  usableQuotes: number;
  misses: number;
  failures: number;
  latenciesMs: number[];
  lastObservedAt: number | null;
};

const MAX_LATENCY_SAMPLES = Math.max(32, Math.min(2048, Number(process.env.CRYPTOCRAWL_ANTENNA_LATENCY_SAMPLES || 256)));
const states = new Map<CexStreamVenue, MutableVenueQuality>();

function stateFor(venue: CexStreamVenue): MutableVenueQuality {
  const existing = states.get(venue);
  if (existing) return existing;
  const created: MutableVenueQuality = {
    requests: 0,
    usableQuotes: 0,
    misses: 0,
    failures: 0,
    latenciesMs: [],
    lastObservedAt: null,
  };
  states.set(venue, created);
  return created;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

function recencyHalfLifeMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_ANTENNA_RECENCY_HALF_LIFE_MS || 15_000);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(5 * 60_000, parsed)) : 15_000;
}

export function recordAntennaProviderObservation(input: {
  venue: CexStreamVenue;
  latencyMs: number;
  outcome: 'quote' | 'miss' | 'failure';
  observedAt?: number;
}): void {
  const state = stateFor(input.venue);
  state.requests += 1;
  if (input.outcome === 'quote') state.usableQuotes += 1;
  else if (input.outcome === 'miss') state.misses += 1;
  else state.failures += 1;
  if (Number.isFinite(input.latencyMs) && input.latencyMs >= 0) {
    state.latenciesMs.push(input.latencyMs);
    if (state.latenciesMs.length > MAX_LATENCY_SAMPLES) {
      state.latenciesMs.splice(0, state.latenciesMs.length - MAX_LATENCY_SAMPLES);
    }
  }
  state.lastObservedAt = input.observedAt ?? Date.now();
}

function snapshot(venue: CexStreamVenue, state: MutableVenueQuality): AntennaProviderQualitySnapshot {
  const averageLatencyMs = state.latenciesMs.length > 0
    ? state.latenciesMs.reduce((sum, value) => sum + value, 0) / state.latenciesMs.length
    : 0;
  const p95LatencyMs = percentile(state.latenciesMs, 0.95);
  const hitRate = state.requests > 0 ? state.usableQuotes / state.requests : 0;
  const failureRate = state.requests > 0 ? state.failures / state.requests : 0;
  const latencyBasis = p95LatencyMs ?? averageLatencyMs;
  const latencyScore = state.latenciesMs.length === 0
    ? 0
    : 1 / (1 + latencyBasis / 100);
  const observationAgeMs = state.lastObservedAt === null ? null : Math.max(0, Date.now() - state.lastObservedAt);
  const recencyScore = observationAgeMs === null
    ? 0
    : Math.pow(0.5, observationAgeMs / recencyHalfLifeMs());
  const baseQuality = Math.max(0, Math.min(1,
    hitRate * 0.60 + latencyScore * 0.25 + (1 - failureRate) * 0.15,
  ));
  // A provider with historically good data but stale observations must not stay
  // artificially dominant. Recency only affects advisory ranking; it grants no
  // quote, economic, or execution authority.
  const qualityScore = Number((baseQuality * recencyScore).toFixed(4));
  return {
    venue,
    requests: state.requests,
    usableQuotes: state.usableQuotes,
    misses: state.misses,
    failures: state.failures,
    averageLatencyMs: Number(averageLatencyMs.toFixed(2)),
    p95LatencyMs,
    hitRate: Number(hitRate.toFixed(4)),
    failureRate: Number(failureRate.toFixed(4)),
    lastObservedAt: state.lastObservedAt,
    observationAgeMs,
    recencyScore: Number(recencyScore.toFixed(4)),
    qualityScore,
    executionAuthority: false,
  };
}

export function getAntennaProviderQuality(venue: CexStreamVenue): AntennaProviderQualitySnapshot {
  return snapshot(venue, stateFor(venue));
}

export function getAntennaProviderQualitySummary(): AntennaProviderQualitySnapshot[] {
  return [...states.entries()]
    .map(([venue, state]) => snapshot(venue, state))
    .sort((left, right) => right.qualityScore - left.qualityScore || left.venue.localeCompare(right.venue));
}
