const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`required source missing: ${relativePath}`);
  return fs.readFileSync(fullPath, 'utf8');
}

function requireAll(relativePath, requiredFragments) {
  const source = read(relativePath);
  const missing = requiredFragments.filter(fragment => !source.includes(fragment));
  if (missing.length > 0) {
    throw new Error(`${relativePath} is missing required invariant(s): ${missing.join(' | ')}`);
  }
  return source;
}

function forbid(relativePath, forbiddenFragments) {
  const source = read(relativePath);
  const found = forbiddenFragments.filter(fragment => source.includes(fragment));
  if (found.length > 0) {
    throw new Error(`${relativePath} contains forbidden regression marker(s): ${found.join(' | ')}`);
  }
}

// 1) Unified execution preserves canonical economics. There is no fixed +10 BPS
// execution gate: Stage One may feed APE above -10 BPS, while execution requires
// strictly-positive authoritative all-in economics plus fresh executable evidence.
const unifiedRouter = requireAll('server/services/cryptocrawl/execution/unified-execution-router.ts', [
  'export interface AdvisoryEvidenceScores',
  'advisoryOnly: true',
  'const deterministicPositive = Number.isFinite(deterministicNet) && deterministicNet > 0;',
  'const deterministicNegative = Number.isFinite(deterministicNet) && deterministicNet < 0;',
  'const fundingProjectedPositive = isFunding && projectedFunding !== null && projectedFunding > 0;',
  'const fundingProjectedNegative = isFunding && projectedFunding !== null && projectedFunding < 0;',
  'const predictionProjectedPositive = isPredictionEvent && projectedPredictionEvent !== null && projectedPredictionEvent > 0;',
  'const predictionProjectedNegative = isPredictionEvent && projectedPredictionEvent !== null && projectedPredictionEvent < 0;',
  'const stageThreeTargetSatisfied = isFunding',
  '? fundingProjectedPositive',
  ': isPredictionEvent',
  '? predictionProjectedPositive',
  ': deterministicPositive && netBps !== null && netBps > 0;',
  'const stageThreeRescueRequired = stageTwoBoundaryCrossed && !stageThreeTargetSatisfied;',
  "if (!isFunding && !isPredictionEvent && deterministicNegative) hardVetoReasons.push('blocked:verified_negative_all_in_net');",
  "if (fundingProjectedNegative) hardVetoReasons.push('blocked:verified_negative_projected_funding_net');",
  "if (predictionProjectedNegative) hardVetoReasons.push('blocked:verified_negative_calibrated_prediction_event_net');",
  "if (isPredictionEvent && !predictionEventAuthority(candidate)) hardVetoReasons.push('blocked:prediction_event_canonical_authority_incomplete');",
  "hardVetoReasons.push('blocked:no_authoritative_execution_path')",
  'const evidenceReacquisitionRequired = economicsMissing',
  '|| (!isFunding && !isPredictionEvent && deterministicZero)',
  '|| !stageThreeTargetSatisfied',
  'candidate.missingInformation.length > 0;',
  "'reacquire:strict_positive_execution_economics_not_met'",
  "'advisory:adaptive_profitability_or_confidence_below_ranking_threshold'",
  'const economicsAdmitted = isFunding',
  '? fundingProjectedPositive',
  ': isPredictionEvent',
  '? predictionProjectedPositive',
  ': deterministicPositive;',
  'const admitted = economicsAdmitted',
  '&& stageThreeTargetSatisfied',
  '&& pathAvailable',
  '&& candidate.executableCapability',
  '&& fresh',
  '&& depthReady',
  '&& hardVetoReasons.length === 0;',
  'stage3_target=strict_positive_authoritative_all_in_economics',
  'funding_projected_profit_is_not_deterministic_profit',
  'prediction_event_expected_profit_is_calibrated_not_deterministic',
  'raw_market_probability_execution_authority=false',
]);
for (const forbidden of [
  'const STAGE_THREE_MINIMUM_TARGET_BPS = 10;',
  'stageThreeTargetBps()',
  'ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS',
  'ZERO_CAPITAL_RESCUE_TARGET_NET_BPS',
  'ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = 5',
  'stage3_target_not_met',
  "admitted: deterministicPositive && completeCurrentEvidence && aboveAdaptiveThreshold && path !== 'UNAVAILABLE'",
  "admitted: deterministicPositive && completeCurrentEvidence && path !== 'UNAVAILABLE'",
  'candidate.missingInformation.length === 0',
  'const economicsAdmitted = isFunding ? true : deterministicPositive;',
  'const economicsAdmitted = isFunding ? projectedFunding !== null : deterministicPositive;',
]) {
  if (unifiedRouter.includes(forbidden)) {
    throw new Error(`unified execution router reintroduced a duplicate/advisory/fixed-profit execution veto: ${forbidden}`);
  }
}

// 1b) Runtime safety may quarantine non-positive economics, but must not recreate
// a +10 BPS magnitude gate that can kill a smaller profitable trade.
const invariantMonitor = requireAll('server/services/cryptocrawl/runtime/runtime-invariant-monitor.ts', [
  'stageThreeNetBps === null || stageThreeNetBps <= 0',
  'requires strictly-positive canonical all-in net BPS',
  "push('ELIGIBLE_WITHOUT_POSITIVE_NET'",
]);
for (const forbidden of [
  'const STAGE_THREE_MINIMUM_TARGET_BPS = 10;',
  'ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS',
  'ZERO_CAPITAL_RESCUE_TARGET_NET_BPS',
  'Math.max(STAGE_THREE_MINIMUM_TARGET_BPS',
]) {
  if (invariantMonitor.includes(forbidden)) throw new Error(`runtime invariant reintroduced fixed +10 BPS execution magnitude: ${forbidden}`);
}

// 1c) APE is an anytime optimizer: a positive incumbent remains resident while
// optional tactics continue, and the optimizer yields before the execution reserve.
requireAll('server/services/cryptocrawl/integration/ape-profitable-snapshot-lease.ts', [
  'bestProfit: highest proven live absolute all-in profit',
  "export type ApeProfitLeaseMode = 'none' | 'optimize' | 'refresh_shadow' | 'dispatch_now';",
  'export function observeApeProfitableSnapshot',
  'export function getApeBestExecutableSnapshot',
  'export function capApeOptimizationDeadline',
  'bestSnapshotOverwriteByWorseAttempt: false',
  'strictPositiveStopsOptimization: false',
]);
requireAll('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts', [
  'observeApeProfitableSnapshot(candidate);',
  'getApeProfitLeaseDecision',
  'scheduleProfitEscape();',
  'capApeOptimizationDeadline',
  'getApeBestExecutableSnapshot',
]);

// 2) Cryptara CEX topology correction is limited to implemented execution venues.
requireAll('server/services/cryptocrawl/integration/cryptara-cex-evidence-wiring.ts', [
  "const CEX_EXECUTION_VENUES = new Set(['coinbase', 'kraken', 'okx']);",
  "'not_applicable:mempool_evidence'",
  'canonicalMonteCarloPreserved: true',
  'economicsChanged: false',
]);
forbid('server/services/cryptocrawl/integration/cryptara-cex-evidence-wiring.ts', [
  "new Set(['binance'",
  "new Set(['kucoin'",
  "new Set(['bybit'",
]);

// 3) Antenna/provider auction remains measured advisory intelligence, not execution authority.
requireAll('server/services/cryptocrawl/intelligence/sovereign-antenna-quality.ts', [
  'observationAgeMs',
  'recencyScore',
  'p95LatencyMs',
  'executionAuthority: false',
]);
requireAll('server/services/cryptocrawl/intelligence/provider-quality-auction.ts', [
  "authority: 'provider_priority_advisory_only'",
  'executionAuthority: false',
  'quality.failureRate',
  'quality.observationAgeMs',
]);
const orderBookSource = requireAll('server/services/cryptocrawl/integration/order-book-evolution-wiring.ts', [
  'allExecutableVenuesStillObservedSimultaneously: true',
  "providerAuction: 'measured_quality_weighted_attention_advisory_only'",
  'executionAuthority: false',
]);
const legacySimultaneousShape = orderBookSource.includes('Promise.all(venues.flatMap(venue => symbols.map(async symbol => {');
const interleavedSimultaneousShape = orderBookSource.includes('symbols.flatMap(symbol => venues.map')
  && orderBookSource.includes('Promise.allSettled')
  && orderBookSource.includes('getActiveExecutableQuoteVenues()');
if (!legacySimultaneousShape && !interleavedSimultaneousShape) {
  throw new Error('server/services/cryptocrawl/integration/order-book-evolution-wiring.ts is missing simultaneous executable-venue observation invariant');
}

// 4) BPS rescue remains a bounded search scheduler and requires exact re-quote.
requireAll('server/services/cryptocrawl/integration/economic-transformation-wiring.ts', [
  'maxPerTopologyDriver()',
  "portfolioDiversityAuthority: 'search_scheduling_only'",
  'exactRequoteRequired: true',
  'executionAuthority: false',
]);
requireAll('server/services/cryptocrawl/optimization/economic-transformation-engine.ts', [
  "authority: 'optimization_advisory_only'",
  'executionAuthority: false',
  "'exact_requote_required'",
  "'synthetic_profit:false'",
]);

// 5) Settlement calibration learns only from terminal confirmed realized outcomes.
requireAll('server/services/cryptocrawl/learning/settlement-profit-calibrator.ts', [
  'outcome.settlement?.terminal',
  'outcome.settlement.settlementConfirmed',
  "authority: 'learning_only'",
  'executionAuthority: false',
]);
requireAll('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts', [
  'recordSettlementProfitCalibration(outcome);',
  "settlementProfitCalibration: 'terminal_confirmed_expected_vs_realized_only'",
  'settlementCalibrationExecutionAuthority: false',
]);

// 6) Zero-capital provider repricing keeps strict positivity for every measured
// provider shape (single or dual). Provider capability/fee/liquidity evidence
// remains mandatory before downstream canonical admission.
requireAll('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts', [
  'if (values.netProfit <= 0n)',
  "'strict_positive_repriced_net'",
  'nonPositiveProviderRepriceExecutable: false',
]);

// 7) Runtime heartbeat preserves actionable routing evidence without serializing
// every full candidate decision through console and file transports.
const runtimeObservability = requireAll('server/services/cryptocrawl/integration/runtime-observability.ts', [
  'function summarizeMultiTopologyCycle(',
  'blockedReasonCounts',
  'highestScoring: cycle.routedOpportunities.slice(0, 12)',
  'cycle: summarizeMultiTopologyCycle(multiTopology)',
  'fullCandidateDecisionsLogged: false',
  'boundedMultiTopologyHeartbeat: true',
]);
if (/\n\s+multiTopology,\n/.test(runtimeObservability)) {
  throw new Error('runtime heartbeat contains unbounded multi-topology candidate telemetry');
}

// 8) Candidate eligibility uses semantic venue-asset identity, not ticker text
// alone, before unrelated products can become a profitable CEX plan.
requireAll('server/services/cryptocrawl/execution/cex-spot-product-policy.ts', [
  'const VERIFIED_VENUE_ASSET_ALIASES',
  "kraken: Object.freeze({ LUNA: 'LUNC', UST: 'USTC' })",
  "okx: Object.freeze({ LIT: 'LIGHTER', LUNA: 'WLUNA' })",
  'function canonicalVenueAsset(',
  "canonicalPair(row.base, row.quote, 'kraken')",
  "canonicalPair(raw.baseCcy, raw.quoteCcy, 'okx')",
]);
forbid('server/services/cryptocrawl/execution/cex-spot-product-policy.ts', [
  'canonicalPair(row.base, row.quote, true)',
  'canonicalPair(raw.baseCcy, raw.quoteCcy);',
]);

console.log('[runtime-safety-invariants] PASS: canonical execution uses strict-positive all-in economics with no +10 BPS magnitude gate; APE preserves a positive incumbent while optimizing until its dispatch reserve; advisory scoring, active reacquisition, implemented CEX topology, governance boundaries, terminal settlement learning, zero-capital repricing, bounded observability, and semantic venue-asset identity invariants preserved');
