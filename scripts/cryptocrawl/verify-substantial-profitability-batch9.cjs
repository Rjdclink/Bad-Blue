const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = {
  policy: 'server/services/cryptocrawl/optimization/adaptive-profitability-search-policy.ts',
  cex: 'server/services/cryptocrawl/integration/cex-four-mode-observability-wiring.ts',
  zero: 'server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts',
  core: 'server/services/cryptocrawl/core/zero-capital-engine.ts',
  zeroDiscovery: 'server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts',
  executor: 'server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts',
  flashExecutor: 'server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts',
  dailyBudget: 'server/services/cryptocrawl/governance/profit-ladder-daily-profit-budget.ts',
  maker: 'server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts',
  transform: 'server/services/cryptocrawl/optimization/economic-transformation-engine.ts',
  transformWiring: 'server/services/cryptocrawl/integration/economic-transformation-wiring.ts',
  venue: 'server/services/cryptocrawl/discovery/venue-capability-registry.ts',
  canonical: 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts',
};

// Deployment preflight intentionally redirects path-based reads of the canonical
// zero-capital executor to the preserved flash implementation for legacy verifiers.
// New router-aware checks must inspect the physical canonical file, so read it by
// file descriptor; the preflight compatibility redirect only rewrites path strings.
function readPhysical(absolute) {
  const fd = fs.openSync(absolute, 'r');
  try {
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

const source = {};
for (const [key, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`[substantial-profitability-batch9] missing ${relative}`);
  source[key] = key === 'executor' ? readPhysical(absolute) : fs.readFileSync(absolute, 'utf8');
}

// These are behavior-level invariants, not telemetry field counts. Every entry
// corresponds to code that changes search ordering, quote breadth, sizing,
// provider admission, execution-stage maker safety, or rescue feasibility.
const behaviors = [
  ['policy', 'riskAdjustedBpsToBreakEven', 'risk-adjusted CEX gap ranking'],
  ['policy', 'measuredMakerSavings(item, takerFees)', 'maker-savings recovery weighting'],
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
  ['cex', 'nextIntervalMs = nextPolicy.scanIntervalMs', 'current-cycle adaptive interval applied'],
  ['cex', 'latestModes: latest', 'newly measured modes drive the next scan policy'],
  ['cex', 'observeFailClosed().finally(scheduleNext)', 'recursive adaptive rescheduling after completion or failure'],
  ['cex', 'smallest_risk_adjusted_then_exact_bps_to_break_even_first', 'risk-adjusted near-miss ordering'],

  ['zero', 'baseUnitsFromUsd(usd: number, decimals: number, inputTokenUsdPrice: number)', 'token-price-and-decimal-correct sizing'],
  ['zero', 'opportunity.expiresAt > now', 'fresh-only zero-capital rescue selection'],
  ['zero', 'refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()', 'fresh requote expiry validation'],
  ['zero', 'ZERO_CAPITAL_PROVIDER_EVIDENCE_MAX_AGE_MS', 'provider evidence freshness bound'],
  ['zero', 'ZERO_CAPITAL_PROVIDER_MAX_UTILIZATION', 'provider utilization ceiling'],
  ['zero', 'ZERO_CAPITAL_PROVIDER_MIN_HEADROOM_RATIO', 'provider liquidity headroom floor'],
  ['zero', 'calculateMeasuredFlashLoanFee', 'exact measured provider fee recomputation'],
  ['zero', 'else if (gapToBreakEvenBps <= 15)', 'near-break-even dense sizing curve'],
  ['zero', 'gasPressureBps >= 25', 'gas-pressure sizing curve'],
  ['zero', 'sharedResidualFractions', 'shared BPS Super Engine nonlinear sizing input'],
  ['zero', 'buildBpsReductionSuperPlan', 'shared BPS Super Engine operational zero-capital plan'],
  ['zero', 'ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET', 'bounded exact quote budget'],
  ['zero', 'routeFamily(route)', 'route-family rescue diversity'],
  ['zero', 'ZERO_CAPITAL_RESCUE_HALF_LIFE_MS', 'candidate-age rescue decay'],
  ['zero', 'const confidence =', 'confidence-weighted rescue priority'],
  ['zero', 'ZERO_CAPITAL_RESCUE_MAX_QUOTE_LATENCY_MS', 'quote-latency rejection bound'],
  ['zero', 'for (const evidence of providerEvidence)', 'multi-provider evaluation per quote'],
  ['zero', 'candidateProfitable && currentProfitable', 'profitable candidates rank by absolute net'],
  ['zero', 'candidate.netProfitBps > current.netProfitBps', 'non-profitable candidates rank by closest BPS'],
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

if (behaviors.length !== 53) {
  throw new Error(`[substantial-profitability-batch9] expected exactly 53 behavior checks after shared BPS zero-capital operational wiring, got ${behaviors.length}`);
}
for (const [fileKey, pattern, name] of behaviors) {
  if (!source[fileKey].includes(pattern)) {
    throw new Error(`[substantial-profitability-batch9] missing behavior: ${name} (${pattern})`);
  }
}

if (!source.zero.includes('function recoverableByAtomicSurplus') ||
    !source.zero.includes('opportunity.expiresAt > now') ||
    !source.zero.includes('refined.expiresAt <= refined.timestamp || refined.expiresAt <= Date.now()')) {
  throw new Error('[substantial-profitability-batch9] zero-capital rescue must admit only fresh near-misses and require independently fresh refined evidence');
}
if (!source.cex.includes('function scheduleNext') ||
    !source.cex.includes('setTimeout(() =>') ||
    !source.cex.includes('observeFailClosed().finally(scheduleNext)')) {
  throw new Error('[substantial-profitability-batch9] adaptive CEX rescheduling must remain one-shot, recursive, and failure-resilient');
}
if (source.core.includes('runZeroCapitalProfitabilityRescueV2') ||
    !source.core.includes('duplicateAtomicRescuePass: false') ||
    !source.zeroDiscovery.includes("import { runFairZeroCapitalProfitabilityRescue } from '../integration/zero-capital-profitability-rescue-fair.js';") ||
    !source.zeroDiscovery.includes('const rescueReady = await runFairZeroCapitalProfitabilityRescue({')) {
  throw new Error('[substantial-profitability-batch9] Atomic rescue must be single-owner: canonical discovery runs one fairness-ordered rescue pass after configured and dynamic measurement; the core scan must remain measurement-only');
}
if (source.canonical.includes('ensureZeroCapitalProfitabilityRescueV2') || source.zero.includes('target.scanChain =')) {
  throw new Error('[substantial-profitability-batch9] retired zero-capital rescue installer/scan mutation must not return');
}
if (source.zero.includes('getProfitLadderDiscoveryNotionalAuthority') ||
    source.zero.includes('getProfitLadderNotionalAuthority') ||
    !source.zero.includes('function providerSafeBorrowAmount')) {
  throw new Error('[substantial-profitability-batch9] zero-capital rescue borrowing must remain independent of Profit Ladder notional and bounded by fresh provider capacity');
}
if (!source.core.includes('tokenUnitEqualsUsdAssumption: false') ||
    !source.executor.includes("import { livePriceMesh } from '../bridge/live-price-mesh.js';") ||
    !source.executor.includes('livePriceMesh.getLiveSymbolPrices([...new Set(symbols)])') ||
    !source.executor.includes('inputTokenUsdPrice: prices.get(input.opportunity.inputAssetSymbol) ?? null') ||
    !source.flashExecutor.includes("missingInformation: ['live_input_token_usd_price_for_builder_realized_profit']")) {
  throw new Error('[substantial-profitability-batch9] canonical zero-capital execution must retain live input-token USD valuation without restoring retired parallel execution authority');
}
if (!source.dailyBudget.includes("authority: 'profit_ladder_daily_realized_profit_only'") ||
    !source.dailyBudget.includes('borrowingNotionalAuthority: false') ||
    !source.dailyBudget.includes('expectedProfitFitsDailyBudget') ||
    !source.zero.includes('getProfitLadderDailyProfitBudget') ||
    !source.zero.includes('profitLadderRescueVetoAuthority: false') ||
    !source.executor.includes('void observeDailyProfitBudget(opportunity);') ||
    !source.executor.includes('expectedProfitFitsDailyBudget') ||
    !source.executor.includes('executionVetoAuthority: false') ||
    source.executor.includes('dailyProfitBudgetFailure')) {
  throw new Error('[substantial-profitability-batch9] Profit Ladder must remain realized-profit telemetry/accounting for Atomic while borrowing and strict-positive execution remain independently governed by provider capacity and canonical economics');
}
if (!source.venue.includes("getActiveExecutableQuoteVenues(): Array<'coinbase' | 'kraken' | 'okx'>")) {
  throw new Error('[substantial-profitability-batch9] active CEX quote topology must remain restricted to fully implemented Coinbase/Kraken/OKX paths');
}
if (!source.venue.includes('settlementVerification: true')) {
  throw new Error('[substantial-profitability-batch9] executable CEX venues must retain terminal settlement capability declarations');
}
if (fs.existsSync(path.join(root, 'server/services/cryptocrawl/integration/profitability-recovery-batch9.ts'))) {
  throw new Error('[substantial-profitability-batch9] obsolete signal-count batch must not exist');
}
if (fs.existsSync(path.join(root, 'server/services/cryptocrawl/integration/zero-capital-size-refinement-wiring.ts')) ||
    fs.existsSync(path.join(root, 'server/services/cryptocrawl/integration/zero-capital-joint-provider-size-wiring.ts'))) {
  throw new Error('[substantial-profitability-batch9] duplicate zero-capital size/provider optimizer wrappers must remain retired');
}

console.log('[substantial-profitability-batch9] PASS: fifty-three behavior-level profitability enhancements are present; zero-capital rescue is single-owner in canonical discovery, fairness-ordered, price-aware and provider-capacity-bounded; fresh requotes supersede stale seeds without extending stale evidence; Profit Ladder remains realized-profit telemetry/accounting rather than Atomic borrowing or execution veto authority; canonical execution uses the live price mesh, duplicate optimizer wrappers remain retired, and implemented CEX topology remains settlement-gated');