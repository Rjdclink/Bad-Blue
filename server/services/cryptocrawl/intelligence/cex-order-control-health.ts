export type CexOrderControlVenue = 'coinbase' | 'kraken' | 'okx';
export type CexOrderControlOperation = 'submit' | 'query' | 'cancel';

export interface CexOrderControlLatencyObservation {
  venue: CexOrderControlVenue;
  operation: CexOrderControlOperation;
  clientRoundTripMs: number;
  gatewayProcessingMs?: number | null;
  observedAt?: number;
}

export interface CexOrderControlVenueHealth {
  venue: CexOrderControlVenue;
  sampleCount: number;
  submitSamples: number;
  querySamples: number;
  cancelSamples: number;
  clientP50Ms: number | null;
  clientP95Ms: number | null;
  gatewayP95Ms: number | null;
  lastObservedAt: number | null;
}

export interface CexOrderControlHealthSnapshot {
  observedAt: number;
  coverageVenues: number;
  totalSamples: number;
  worstClientP95Ms: number | null;
  venues: CexOrderControlVenueHealth[];
  authority: 'measured_order_control_revalidation_scheduling_only';
  executionAuthority: false;
  economicBpsAuthority: false;
  settlementAuthority: false;
  syntheticLatencyAllowed: false;
}

interface StoredObservation {
  operation: CexOrderControlOperation;
  clientRoundTripMs: number;
  gatewayProcessingMs: number | null;
  observedAt: number;
}

const VENUES: readonly CexOrderControlVenue[] = ['coinbase', 'kraken', 'okx'];
const MAX_SAMPLES_PER_VENUE = 96;
const observations = new Map<CexOrderControlVenue, StoredObservation[]>(
  VENUES.map(venue => [venue, []]),
);

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const bounded = Math.max(0, Math.min(1, fraction));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * bounded) - 1));
  return sorted[index];
}

export function recordCexOrderControlLatency(input: CexOrderControlLatencyObservation): void {
  if (!VENUES.includes(input.venue)) return;
  const clientRoundTripMs = finiteNonNegative(input.clientRoundTripMs);
  if (clientRoundTripMs === null) return;
  const gatewayProcessingMs = finiteNonNegative(input.gatewayProcessingMs);
  const observedAt = finiteNonNegative(input.observedAt) ?? Date.now();
  const venueRows = observations.get(input.venue)!;
  venueRows.push({
    operation: input.operation,
    clientRoundTripMs,
    gatewayProcessingMs,
    observedAt,
  });
  if (venueRows.length > MAX_SAMPLES_PER_VENUE) {
    venueRows.splice(0, venueRows.length - MAX_SAMPLES_PER_VENUE);
  }
}

export function getCexOrderControlHealthSnapshot(): CexOrderControlHealthSnapshot {
  const venues = VENUES.map<CexOrderControlVenueHealth>(venue => {
    const rows = observations.get(venue) || [];
    const client = rows.map(row => row.clientRoundTripMs);
    const gateway = rows
      .map(row => row.gatewayProcessingMs)
      .filter((value): value is number => value !== null);
    return {
      venue,
      sampleCount: rows.length,
      submitSamples: rows.filter(row => row.operation === 'submit').length,
      querySamples: rows.filter(row => row.operation === 'query').length,
      cancelSamples: rows.filter(row => row.operation === 'cancel').length,
      clientP50Ms: percentile(client, 0.50),
      clientP95Ms: percentile(client, 0.95),
      gatewayP95Ms: percentile(gateway, 0.95),
      lastObservedAt: rows.length > 0 ? Math.max(...rows.map(row => row.observedAt)) : null,
    };
  });
  const p95 = venues
    .map(venue => venue.clientP95Ms)
    .filter((value): value is number => value !== null);
  return {
    observedAt: Date.now(),
    coverageVenues: venues.filter(venue => venue.sampleCount > 0).length,
    totalSamples: venues.reduce((sum, venue) => sum + venue.sampleCount, 0),
    worstClientP95Ms: p95.length > 0 ? Math.max(...p95) : null,
    venues,
    authority: 'measured_order_control_revalidation_scheduling_only',
    executionAuthority: false,
    economicBpsAuthority: false,
    settlementAuthority: false,
    syntheticLatencyAllowed: false,
  };
}
