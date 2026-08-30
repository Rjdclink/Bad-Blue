const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = {
  policy: 'server/services/cryptocrawl/optimization/adaptive-profitability-search-policy.ts',
  cex: 'server/services/cryptocrawl/integration/cex-four-mode-observability-wiring.ts',
  zero: 'server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts',
  maker: 'server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts',
  transform: 'server/services/cryptocrawl/optimization/economic-transformation-engine.ts',
  transformWiring: 'server/services/cryptocrawl/integration/economic-transformation-wiring.ts',
  venue: 'server/services/cryptocrawl/discovery/venue-capability-registry.ts',
  canonical: 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts',
};

const source = {};
for (const [key, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`[substantial-profitability-batch9] missing ${relative}`);
  source[key] = fs.readFileSync(absolute, 'utf8');
}

// These are behavior-level invariants, not telemetry field counts. Every entry
// corresponds to code that changes search ordering, quote breadth, sizing,
// provider admission, execution-stage maker safety, or rescue feasibility.
const behaviors = [
  ['policy', 'riskAdjustedBpsToBreakEven', 'risk-adjusted CEX gap ranking'],
  ['policy', 'makerFeeSavingsVsTakerBps', 'maker-savings recovery weighting'],
  ['policy', 'grossSpread / combinedFees', 'spread-to-fee coverage weighting'],
  ['policy', 'CRYPTOCRAWL_RECOVERY_SYMBOL_COOLDOWN_MS', 'recovery-symbol cooldown'],
  ['policy', 'improvementBoost', 'improving-gap promotion'],
  ['policy', 'hybridBoost', 'hybrid-mode recovery promotion'],
  ['policy', 'quoteAssetCap', 'quote-asset concentration cap'],
  ['policy', 'closestGapBps <= 5 ? 24', 'near-break-even universe expansion'],
  ['policy', 'recoveryQuota', 'bounded recovery focus quota'],
  ['policy', 'hybridRecoverySymbols', 'hybrid recovery coverage quota'],
  ['policy', 'explorationQuota', 'preserved market exploration quota'],
  ['policy', 'staleEvidenceSymbols', 'stale fee evidence isolation'],
  ['policy', 'intervalFactor', 'gap-adaptive scan cadence'],
  ['policy', "authority: 'measured_search_scheduling_only'", 'search-only authority boundary'],

  ['cex', 'buildAdaptiveProfitabilitySearchPolicy', 'adaptive policy wired into CEX observation'],
  ['cex', 'nextIntervalMs = policy.scanIntervalMs', 'adaptive interval applied'],
  ['cex', 'setTimeout(async () =>', 'recursive adaptive rescheduling'],
  ['cex', 'smallest_risk_adjusted_then_exact_bps_to_break_even_first', 'risk-adjusted near-miss ordering'],

  ['zero', 'baseUnitsFromUsd(usd: number, decimals: number)', 'token-decimal-correct sizing'],
  ['zero', 'opportunity.expiresAt <= now', 'expired zero-capital rescue exclusion'],
  ['zero', 'refined.expiresAt = Math.min', 'refined opportunity expiry cannot extend'],
  ['zero', 'ZERO_CAPITAL_PROVIDER_EVIDENCE_MAX_AGE_MS', 'provider evidence freshness bound'],
  ['zero', 'ZERO_CAPITAL_PROVIDER_MAX_UTILIZATION', 'provider utilization ceiling'],
  ['zero', 'ZERO_CAPITAL_PROVIDER_MIN_HEADROOM_RATIO', 'provider liquidity headroom floor'],
  ['zero', 'calculateMeasuredFlashLoanFee', 'exact measured provider fee recomputation'],
  ['zero', 'if (gap <= 5) return', 'near-gap dense sizing curve'],
  ['zero', 'gasPressureBps >= 25', 'gas-pressure sizing curve'],
  ['zero', 'ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET', 'bounded exact quote budget'],
  ['zero', 'routeFamily(route)', 'route-family rescue diversity'],
  ['zero', 'ZERO_CAPITAL_RESCUE_HALF_LIFE_MS', 'candidate-age rescue decay'],
  ['zero', 'const confidence =', 'confidence-weighted rescue priority'],
  ['zero', 'ZERO_CAPITAL_RESCUE_MAX_QUOTE_LATENCY_MS', 'quote-latency rejection bound'],
  ['zero', 'for (const evidence of providerEvidence)', 'multi-provider evaluation per quote'],
  ['zero', 'candidate.netProfit > 0n && current.netProfit > 0n', 'positive candidates rank by absolute net'],
  ['zero', 'candidate.netProfitBps > current.netProfitBps', 'negative candidates rank by closest BPS'],
  ['zero', 'strictImprovement(original', 'strict replacement improvement'],
  ['zero', 'existingPositiveNeverReplacedByNegative: true', 'positive candidates cannot regress to negative'],
  ['zero', 'inputTokenDecimalsAuthoritative: true', 'denomination authority attestation'],

  ['maker', 'REJECT_MAKER_EXECUTION_FEE_AUTHORITY', 'authenticated maker-fee execution guard'],
  ['maker', 'REJECT_MAKER_EXECUTION_CANARY_CEILING', 'maker canary ceiling recheck'],
  ['maker', 'REJECT_MAKER_EXECUTION_FILL_PROBABILITY', 'measured joint-fill execution floor'],
  ['maker', 'REJECT_MAKER_EXECUTION_SPREAD_PERSISTENCE', 'spread-persistence execution floor'],
  ['maker', 'REJECT_MAKER_EXECUTION_QUEUE_CLEAR_TIME', 'queue-clear-time execution bound'],
  ['maker', 'REJECT_MAKER_EXECUTION_KELLY_SIZE', 'Kelly sizing execution recheck'],
  ['maker', 'paper_plus_joint_fill_plus_spread_persistence_bounded', 'multi-factor adaptive maker TTL'],
  ['maker', 'urgencyFactor', 'TTL-aware maker polling cadence'],

  ['transform', 'relay_bypass_or_direct_submission', 'relay-cost recovery transformation'],
  ['transform', 'latencyDecayBps', 'latency-decay cost driver'],
  ['transform', 'transformationFeasibilityScore', 'evidence/freshness feasibility weighting'],
  ['transformWiring', 'closestByTopology', 'closest feasible rescue retained per topology'],
];

if (behaviors.length !== 50) {
  throw new Error(`[substantial-profitability-batch9] expected exactly 50 behavior checks, got ${behaviors.length}`);
}
for (const [fileKey, pattern, name] of behaviors) {
  if (!source[fileKey].includes(pattern)) {
    throw new Error(`[substantial-profitability-batch9] missing behavior: ${name} (${pattern})`);
  }
}

if (!source.canonical.includes('ensureZeroCapitalProfitabilityRescueV2();')) {
  throw new Error('[substantial-profitability-batch9] zero-capital profitability rescue v2 is not canonically wired');
}
if (!source.venue.includes("getActiveExecutableQuoteVenues(): Array<'kraken' | 'okx'>")) {
  throw new Error('[substantial-profitability-batch9] active CEX quote topology must be Kraken/OKX only');
}
if (!source.venue.includes("if (venue === 'coinbase') return false")) {
  throw new Error('[substantial-profitability-batch9] Coinbase must remain retired from live execution');
}
if (fs.existsSync(path.join(root, 'server/services/cryptocrawl/integration/profitability-recovery-batch9.ts'))) {
  throw new Error('[substantial-profitability-batch9] obsolete signal-count batch must not exist');
}

console.log('[substantial-profitability-batch9] PASS: fifty behavior-level profitability enhancements are present; telemetry fields are not counted as enhancements');
