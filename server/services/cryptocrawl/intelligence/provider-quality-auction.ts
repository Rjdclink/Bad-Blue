import type { CexStreamVenue } from './cex-order-book-stream.js';
import {
  getAntennaProviderQualitySummary,
  type AntennaProviderQualitySnapshot,
} from './sovereign-antenna-quality.js';

export interface ProviderAuctionBid {
  venue: CexStreamVenue;
  qualityScore: number;
  auctionWeight: number;
  sampleCount: number;
  observationAgeMs: number | null;
  p95LatencyMs: number | null;
  hitRate: number;
  failureRate: number;
  temporarilyDeprioritized: boolean;
  reasons: string[];
  authority: 'provider_priority_advisory_only';
  executionAuthority: false;
}

export interface ProviderQualityAuctionSnapshot {
  observedAt: number;
  bids: ProviderAuctionBid[];
  leader: ProviderAuctionBid | null;
  authority: 'provider_priority_advisory_only';
  executionAuthority: false;
}

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function bidFromQuality(quality: AntennaProviderQualitySnapshot): ProviderAuctionBid {
  const minimumSamples = Math.trunc(bounded(process.env.CRYPTOCRAWL_PROVIDER_AUCTION_MIN_SAMPLES, 8, 1, 1_000));
  const failureDeprioritizeRate = bounded(process.env.CRYPTOCRAWL_PROVIDER_AUCTION_FAILURE_RATE, 0.5, 0.05, 1);
  const staleMs = bounded(process.env.CRYPTOCRAWL_PROVIDER_AUCTION_STALE_MS, 30_000, 1_000, 10 * 60_000);
  const enoughEvidence = quality.requests >= minimumSamples;
  const stale = quality.observationAgeMs === null || quality.observationAgeMs > staleMs;
  const failurePressure = enoughEvidence && quality.failureRate >= failureDeprioritizeRate;
  const temporarilyDeprioritized = stale || failurePressure;

  // The auction never manufactures accuracy/capacity evidence. It uses only
  // measured quote usability, latency, failures and recency already collected by
  // the Antenna. Deprioritization changes attention ordering only, never market
  // truth, economics, venue eligibility or execution authority.
  const evidenceConfidence = Math.min(1, quality.requests / Math.max(minimumSamples, 1));
  const availability = Math.max(0, 1 - quality.failureRate);
  const auctionWeight = temporarilyDeprioritized
    ? 0
    : quality.qualityScore * (0.5 + 0.5 * evidenceConfidence) * availability;

  return {
    venue: quality.venue,
    qualityScore: quality.qualityScore,
    auctionWeight: Number(auctionWeight.toFixed(8)),
    sampleCount: quality.requests,
    observationAgeMs: quality.observationAgeMs,
    p95LatencyMs: quality.p95LatencyMs,
    hitRate: quality.hitRate,
    failureRate: quality.failureRate,
    temporarilyDeprioritized,
    reasons: [
      ...(stale ? ['stale_provider_observation'] : []),
      ...(failurePressure ? ['measured_failure_rate_pressure'] : []),
      ...(!enoughEvidence ? ['limited_provider_quality_samples'] : []),
    ],
    authority: 'provider_priority_advisory_only',
    executionAuthority: false,
  };
}

export function getProviderQualityAuctionSnapshot(): ProviderQualityAuctionSnapshot {
  const bids = getAntennaProviderQualitySummary()
    .map(bidFromQuality)
    .sort((left, right) =>
      Number(left.temporarilyDeprioritized) - Number(right.temporarilyDeprioritized)
      || right.auctionWeight - left.auctionWeight
      || right.qualityScore - left.qualityScore
      || left.venue.localeCompare(right.venue),
    );
  return {
    observedAt: Date.now(),
    bids,
    leader: bids.find(bid => !bid.temporarilyDeprioritized) ?? null,
    authority: 'provider_priority_advisory_only',
    executionAuthority: false,
  };
}
