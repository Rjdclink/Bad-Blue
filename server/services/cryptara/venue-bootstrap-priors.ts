import type { CryptaraVenue, CryptaraVenueRole } from './venue-specialization-learning.js';

export interface CryptaraVenueBootstrapPrior {
  venue: CryptaraVenue;
  role: CryptaraVenueRole;
  score: number;
  confidence: number;
  observedAt: number;
  expiresAt: number;
  sourceAuthority: 'public_exchange_documentation_bootstrap_only';
  rationale: string[];
  caveats: string[];
  executionAuthority: false;
  canonicalEconomicsAuthority: false;
  capitalMovementAuthority: false;
  terminalEvidenceAuthority: false;
}

const DAY_MS = 24 * 60 * 60_000;
const RESEARCHED_AT = Date.UTC(2026, 8, 4, 22, 45, 0);
const EXPIRES_AT = RESEARCHED_AT + 14 * DAY_MS;

// These values are intentionally weak priors, not fee tables and not economics.
// They give Cryptara a small cold-start hint from current public documentation,
// then decay rapidly toward neutral. Authenticated account fee tiers, live quotes,
// and terminal realized outcomes remain the only trustworthy venue-specific truth.
const PRIORS: readonly CryptaraVenueBootstrapPrior[] = Object.freeze([
  Object.freeze({
    venue: 'coinbase',
    role: 'execution',
    score: 0.51,
    confidence: 0.05,
    observedAt: RESEARCHED_AT,
    expiresAt: EXPIRES_AT,
    sourceAuthority: 'public_exchange_documentation_bootstrap_only',
    rationale: [
      'advanced_trade_has_no_subscription_fee',
      'authenticated_api_exposes_current_fee_tier_and_fills',
      'websocket_or_authenticated_market_data_available_for_execution_freshness',
    ],
    caveats: [
      'actual_account_fee_tier_is_runtime_truth',
      'public_rest_market_data_may_be_cached_for_one_second',
      'regional_product_and_transfer_availability_must_be_runtime_verified',
    ],
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    capitalMovementAuthority: false,
    terminalEvidenceAuthority: false,
  }),
  Object.freeze({
    venue: 'kraken',
    role: 'execution',
    score: 0.46,
    confidence: 0.05,
    observedAt: RESEARCHED_AT,
    expiresAt: EXPIRES_AT,
    sourceAuthority: 'public_exchange_documentation_bootstrap_only',
    rationale: [
      'spot_api_supports_programmatic_order_management',
      'fee_tier_can_improve_with_rolling_volume_or_assets_on_platform',
      'public_private_and_trading_rate_limits_are_documented_separately',
    ],
    caveats: [
      'entry_spot_fee_tier_can_be_expensive_relative_to_other_venues',
      'rate_limit_budget_must_be_respected_per_api_class_and_pair',
      'deposit_minimums_and_network-specific_rules_must_be_runtime_verified',
    ],
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    capitalMovementAuthority: false,
    terminalEvidenceAuthority: false,
  }),
  Object.freeze({
    venue: 'okx',
    role: 'execution',
    score: 0.56,
    confidence: 0.05,
    observedAt: RESEARCHED_AT,
    expiresAt: EXPIRES_AT,
    sourceAuthority: 'public_exchange_documentation_bootstrap_only',
    rationale: [
      'published_regular_spot_fee_schedule_is_currently_cost_competitive',
      'spot_api_supports_limit_post_only_fok_ioc_and_batch_order_flows',
      'documented_order_rate_limits_are_high_enough_for_current_low-frequency_strategy',
    ],
    caveats: [
      'regional_fee_and_product_rules_must_be_runtime_verified',
      'live_api_trading_requires_current_account_eligibility_and_kyc',
      'instrument_and_quote-currency migrations_can create breaking api changes',
    ],
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    capitalMovementAuthority: false,
    terminalEvidenceAuthority: false,
  }),
]);

function decayWeight(prior: CryptaraVenueBootstrapPrior, now: number): number {
  if (now >= prior.expiresAt) return 0;
  const age = Math.max(0, now - prior.observedAt);
  const halfLifeMs = 3 * DAY_MS;
  return Math.pow(0.5, age / halfLifeMs);
}

export function getCryptaraVenueBootstrapPrior(
  venue: CryptaraVenue,
  role: CryptaraVenueRole,
  now = Date.now(),
): CryptaraVenueBootstrapPrior | null {
  const prior = PRIORS.find(item => item.venue === venue && item.role === role);
  if (!prior) return null;
  const freshness = decayWeight(prior, now);
  if (!(freshness > 0)) return null;
  return {
    ...prior,
    confidence: Math.max(0, Math.min(0.05, prior.confidence * freshness)),
    rationale: [...prior.rationale],
    caveats: [...prior.caveats],
  };
}

export function getCryptaraVenueBootstrapPriors(now = Date.now()): CryptaraVenueBootstrapPrior[] {
  return PRIORS
    .map(prior => getCryptaraVenueBootstrapPrior(prior.venue, prior.role, now))
    .filter((prior): prior is CryptaraVenueBootstrapPrior => prior !== null);
}
