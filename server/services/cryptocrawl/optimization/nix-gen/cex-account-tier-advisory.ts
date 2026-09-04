import {
  getAuthenticatedFeeTierSnapshot,
  getAuthenticatedFeeTierTrajectory,
} from '../../integration/authenticated-fee-tier-optimization-wiring.js';
import type { CexFeeVenue } from '../../intelligence/cex-fee-resolver.js';

export interface CexAccountTierAdvisory {
  venue: CexFeeVenue;
  authenticatedFeeEvidenceCount: number;
  freshestAuthenticatedFeeObservedAt: number | null;
  feeEvidenceAgeMs: number | null;
  makerFeeEvidenceAvailable: boolean;
  makerRebateEvidenceAvailable: boolean;
  trajectorySamples: number;
  bestObservedOrganicFeeImprovementBps: number;
  evidenceConfidence: number;
  authority: 'authenticated_account_tier_advisory_only';
  canonicalFeeAuthority: 'cex_fee_resolver_only';
  productConstraintAuthority: 'live_cex_product_policy_only';
  rateLimitPressureAuthority: 'existing_exchange_backoff_and_terminal_outcome_learning';
  staticFreeTierAssumption: false;
  publishedTierTableEconomicAuthority: false;
  futureSavingsEconomicAuthority: false;
  planRepricingAuthority: false;
  executionAuthority: false;
  capitalMovementAuthority: false;
}

const VENUES: readonly CexFeeVenue[] = ['coinbase', 'kraken', 'okx'];

function evidenceConfidence(samples: number, freshestObservedAt: number | null, now: number): number {
  if (samples <= 0 || freshestObservedAt === null) return 0;
  // This is confidence in the presence of authenticated account evidence only.
  // It is not a fee estimate or profitability input. Evidence older than the
  // cache-only observer's normal six-scan horizon naturally decays toward zero.
  const sampleConfidence = Math.min(1, samples / 4);
  const ageMs = Math.max(0, now - freshestObservedAt);
  const ageConfidence = 1 / (1 + ageMs / (30 * 60_000));
  return Math.max(0, Math.min(1, sampleConfidence * ageConfidence));
}

export function getCexAccountTierAdvisory(nowInput = Date.now()): CexAccountTierAdvisory[] {
  const now = Number.isFinite(nowInput) ? Number(nowInput) : Date.now();
  const snapshots = getAuthenticatedFeeTierSnapshot();
  const trajectories = getAuthenticatedFeeTierTrajectory();

  return VENUES.map(venue => {
    const venueSnapshots = snapshots.filter(item => item.venue === venue);
    const venueTrajectories = trajectories.filter(item => item.venue === venue);
    const freshestAuthenticatedFeeObservedAt = venueSnapshots.length > 0
      ? Math.max(...venueSnapshots.map(item => item.observedAt))
      : null;
    const trajectorySamples = venueTrajectories.reduce((sum, item) => sum + Math.max(0, item.samples), 0);
    const bestObservedOrganicFeeImprovementBps = venueTrajectories.reduce(
      (best, item) => Math.max(best, Math.max(0, item.bestObservedImprovementBps)),
      0,
    );

    return {
      venue,
      authenticatedFeeEvidenceCount: venueSnapshots.length,
      freshestAuthenticatedFeeObservedAt,
      feeEvidenceAgeMs: freshestAuthenticatedFeeObservedAt === null
        ? null
        : Math.max(0, now - freshestAuthenticatedFeeObservedAt),
      makerFeeEvidenceAvailable: venueSnapshots.some(item => item.makerFeeBps !== null),
      makerRebateEvidenceAvailable: venueSnapshots.some(item => (item.makerRebateBps ?? 0) > 0),
      trajectorySamples,
      bestObservedOrganicFeeImprovementBps,
      evidenceConfidence: evidenceConfidence(venueSnapshots.length, freshestAuthenticatedFeeObservedAt, now),
      authority: 'authenticated_account_tier_advisory_only' as const,
      canonicalFeeAuthority: 'cex_fee_resolver_only' as const,
      productConstraintAuthority: 'live_cex_product_policy_only' as const,
      rateLimitPressureAuthority: 'existing_exchange_backoff_and_terminal_outcome_learning' as const,
      staticFreeTierAssumption: false as const,
      publishedTierTableEconomicAuthority: false as const,
      futureSavingsEconomicAuthority: false as const,
      planRepricingAuthority: false as const,
      executionAuthority: false as const,
      capitalMovementAuthority: false as const,
    };
  });
}
