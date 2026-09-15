'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

// APE V3 is now the canonical active-rescue implementation. Reuse its dedicated
// verifier here instead of duplicating retired V2 source-shape assumptions.
require('./verify-nix-gen-atomic-bps-single-pipeline.cjs');

const files = {
  policy: 'server/services/cryptocrawl/optimization/adaptive-profitability-search-policy.ts',
  cex: 'server/services/cryptocrawl/integration/cex-four-mode-observability-wiring.ts',
  core: 'server/services/cryptocrawl/core/zero-capital-engine.ts',
  executor: 'server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts',
  flashExecutor: 'server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts',
  dailyBudget: 'server/services/cryptocrawl/governance/profit-ladder-daily-profit-budget.ts',
  maker: 'server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts',
  transform: 'server/services/cryptocrawl/optimization/economic-transformation-engine.ts',
  transformWiring: 'server/services/cryptocrawl/integration/economic-transformation-wiring.ts',
  venue: 'server/services/cryptocrawl/discovery/venue-capability-registry.ts',
  canonical: 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts',
};

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

// Batch 9 retains its independent non-APE behavior checks. Active APE rescue is
// verified above by the canonical V3 verifier, which covers shared pass-level
// provider races, quote/provider parallelism, provider-capacity resizing, verified
// Aave+Balancer stacking, targeted route/size transformations, strict-improvement
// recursion, Stage-One immutability, and downstream-only execution authority.
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

if (behaviors.length !== 31) {
  throw new Error(`[substantial-profitability-batch9] expected exactly 31 independent non-APE behavior checks, got ${behaviors.length}`);
}
for (const [fileKey, pattern, name] of behaviors) {
  if (!source[fileKey].includes(pattern)) {
    throw new Error(`[substantial-profitability-batch9] missing behavior: ${name} (${pattern})`);
  }
}

if (!source.cex.includes('function scheduleNext') ||
    !source.cex.includes('setTimeout(() =>') ||
    !source.cex.includes('observeFailClosed().finally(scheduleNext)')) {
  throw new Error('[substantial-profitability-batch9] adaptive CEX rescheduling must remain one-shot, recursive, and failure-resilient');
}

if (!source.core.includes('duplicateAtomicRescuePass: false')) {
  throw new Error('[substantial-profitability-batch9] core scan must remain measurement-only with no duplicate Atomic rescue pass');
}

if (source.canonical.includes('ensureZeroCapitalProfitabilityRescueV2') ||
    source.canonical.includes('ensureZeroCapitalProfitabilityRescueV3')) {
  throw new Error('[substantial-profitability-batch9] retired installer-style zero-capital rescue wiring must not return');
}

if (!source.core.includes('tokenUnitEqualsUsdAssumption: false') ||
    !source.executor.includes("import { livePriceMesh } from '../bridge/live-price-mesh.js';") ||
    !source.executor.includes('livePriceMesh.getLiveSymbolPrices([...new Set(symbols)])') ||
    !source.executor.includes('inputTokenUsdPrice: prices.get(input.opportunity.inputAssetSymbol) ?? null') ||
    !source.flashExecutor.includes("missingInformation: ['live_input_token_usd_price_for_builder_realized_profit']")) {
  throw new Error('[substantial-profitability-batch9] canonical zero-capital execution must retain live input-token USD valuation without restoring parallel execution authority');
}

if (!source.dailyBudget.includes("authority: 'profit_ladder_daily_realized_profit_only'") ||
    !source.dailyBudget.includes('borrowingNotionalAuthority: false') ||
    !source.dailyBudget.includes('expectedProfitFitsDailyBudget') ||
    !source.executor.includes('void observeDailyProfitBudget(opportunity);') ||
    !source.executor.includes('expectedProfitFitsDailyBudget') ||
    !source.executor.includes('executionVetoAuthority: false') ||
    source.executor.includes('dailyProfitBudgetFailure')) {
  throw new Error('[substantial-profitability-batch9] Profit Ladder must remain realized-profit telemetry/accounting while borrowing and strict-positive execution remain independently governed');
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

console.log('[substantial-profitability-batch9] PASS: canonical APE V3 verification is reused without stale V2 source-shape assumptions; independent CEX, maker, transformation, execution-valuation, Profit Ladder, venue, and duplicate-wrapper invariants remain build-locked');
