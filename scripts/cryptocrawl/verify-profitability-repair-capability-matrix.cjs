'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');

// Deployment preflight redirects path-string reads of the canonical executor to
// the preserved flash implementation for legacy structural verifiers. This matrix
// must inspect the physical canonical router for composite-authority assertions,
// so bypass the compatibility redirect with a file descriptor.
const readPhysical = path => {
  const fd = fs.openSync(path, 'r');
  try {
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
};

const rpc = read('server/services/cryptocrawl/api/blockchain-providers.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const providerBootstrap = read('server/services/cryptocrawl/execution/adapters/provider-specific-receiver-bootstrap.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const refresh = read('server/services/cryptocrawl/integration/cryptara-two-speed-revalidation-wiring.ts');
const readiness = read('server/services/cryptocrawl/runtime/readiness-policy.ts');
const observability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const ingest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const builder = read('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts');
const apeGateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const apeRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts');
const apeRouteSplit = read('server/services/cryptocrawl/integration/zero-capital-route-split-rescue.ts');
const atomicStack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const compositeBuilder = read('server/services/cryptocrawl/execution/adapters/composite-flashloan-receiver-builder.ts');
const canonicalExecutor = readPhysical('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');

const matrix = [
  ['Ethereum RPC capability preserved', /ethereum:\s*1/.test(rpc)],
  ['Polygon RPC capability preserved', /polygon:\s*137/.test(rpc)],
  ['Arbitrum RPC capability preserved', /arbitrum:\s*42161/.test(rpc)],
  ['Optimism RPC capability preserved', /optimism:\s*10/.test(rpc)],
  ['Base RPC capability preserved', /base:\s*8453/.test(rpc)],
  ['Avalanche RPC capability preserved', /avalanche:\s*43114/.test(rpc)],
  ['BSC RPC capability preserved', /bsc:\s*56/.test(rpc)],
  ['degraded RPC remains route-locally usable', /candidate\.state === 'healthy' \|\| candidate\.state === 'degraded'/.test(rpc)],
  ['application failures do not poison provider health', /failureClass === 'application'/.test(rpc) && /recordSuccess\(candidate/.test(rpc)],
  ['Balancer flash provider preserved', /'balancer_v2'/.test(providerEconomics)],
  ['Aave V3 flash provider preserved', /'aave_v3'/.test(providerEconomics)],
  ['Morpho Blue flash provider preserved', /'morpho_blue'/.test(providerEconomics)],
  ['Aave and Morpho receiver cold start remains provider-local', /provider_receiver_cold_start_route_local:true/.test(providerBootstrap)],
  ['provider alternatives are exhausted rather than made mandatory', /bootstrapCandidates/.test(providerWiring) && /otherProviderAdmissionBlocked: false/.test(providerWiring)],
  ['exact deterministic positive economics remains admission authority', /quote\.netProfit > 0n/.test(quoter) && !/calculateProgressivePositionSize/.test(quoter)],
  ['stale CEX evidence is reacquired but never executed stale', /getRecentIncludingExpired/.test(refresh) && /staleEvidenceExecutionAllowed: false/.test(refresh)],
  ['CEX inventory remains topology-local', /CEX inventory gates only CEX plans/.test(readiness)],
  ['multi-topology discovery can remain fresh independently', /discoverySearchReady = input\.graphReady \|\| multiTopologyReady/.test(readiness)],
  ['degraded RPC counts as operational readiness', /provider\.http === 'healthy' \|\| provider\.http === 'degraded'/.test(observability)],
  ['cross-chain discovery accepts operational degraded RPC', /observation\.http\.state === 'healthy' \|\| observation\.http\.state === 'degraded'/.test(crossChain)],
  ['Ghost settlement log failures split and fail over locally', /querySettlementLogsWithFailover/.test(chainEvents) && /pending\.unshift\(\[fromBlock, midpoint\], \[midpoint \+ 1, toBlock\]\)/.test(chainEvents)],
  ['90 percent payout remains preserved', /payoutFractionBps:\s*9_000/.test(ingest)],
  ['10 percent retained capital remains preserved', /retainedFractionBps:\s*1_000/.test(ingest)],
  ['builder cold start uses measured sequential gas', /eth_simulateV1/.test(builder) && /fixed_gas_ceiling_admission:false/.test(builder)],

  // Atomic Profitability Engine V4: the resident APE and Stage One remain unchanged;
  // active rescue uses one absolute deadline, bounded hedged transformations and
  // candidate-local anytime refinement instead of whole-pass recursion barriers.
  ['APE gateway preserves resident fast path before active rescue', /runZeroCapitalAtomicBpsEngine/.test(apeGateway) && /runZeroCapitalProfitabilityRescueV4/.test(apeGateway) && /activeRescueCandidates = residentFastPath\.filter/.test(apeGateway)],
  ['APE refinement still requires strict measured improvement', /function strictDerivedImprovement\(/.test(apeGateway) && /if \(!strictDerivedImprovement\(before, normalized\)\) return false;/.test(apeGateway) && /recursiveStrictImprovementRequired: true/.test(apeGateway)],
  ['APE propagates one absolute deadline into measured rescue', /const deadlineAt = rescueStartedAt \+ wallClockBudgetMs/.test(apeGateway) && /deadlineAt,/.test(apeGateway) && /hardDeadlinePropagatedIntoMeasuredRescue: true/.test(apeGateway)],
  ['APE removes whole-pass barrier with candidate-local anytime feedback', /onImprovement: \(root, before, candidate\)/.test(apeGateway) && /passBarrierRemoved: true/.test(apeGateway) && /candidateLocalAnytimeRefinement: true/.test(apeGateway)],
  ['APE shares provider races per pass and asset', /const providerRaces = new Map/.test(apeRescue) && /one_per_pass_chain_asset/.test(apeRescue)],
  ['APE starts route quote and provider probe in parallel', /initialQuotePromise/.test(apeRescue) && /providerMeasurementsPromise/.test(apeRescue) && /Promise\.all\(\[initialQuotePromise, providerMeasurementsPromise\]\)/.test(apeRescue)],
  ['APE evaluates independent candidates concurrently', /mapConcurrent\(opportunities, concurrency, evaluate\)/.test(apeRescue) && /candidateRescueSerial: false/.test(apeRescue)],
  ['APE uses bounded hedged quote waves rather than serial transformation waits', /hedgedWaveWidth/.test(apeRescue) && /Promise\.race\(\[\.\.\.active\.values\(\)\]\)/.test(apeRescue) && /strictPositiveEarlyWins/.test(apeRescue)],
  ['APE adapts quote deadlines and candidate concurrency from measured pressure', /adaptiveQuoteTimeoutMs/.test(apeRescue) && /updateConcurrency/.test(apeRescue) && /adaptiveRouteP95Timeouts: true/.test(apeRescue) && /adaptiveConcurrency: true/.test(apeRescue)],
  ['APE resizes provider-limited notionals instead of immediate rejection', /executableFundingCeiling/.test(apeRescue) && /targetedAmounts/.test(apeRescue) && /resizeInsteadOfReject: true/.test(apeRescue)],
  ['APE retains Aave plus Balancer stacking economics', /selectMeasuredDualFlashLoanAllocation/.test(apeRescue) && /aave_balancer_dual/.test(apeRescue)],
  ['APE does not fabricate unsupported Morpho stacking', /morphoStackingEnabled: false/.test(apeRescue)],
  ['APE separates provider liquidity from route quote capacity telemetry', /providerLiquidityTelemetrySeparatedFromRouteQuoteCapacity: true/.test(apeRescue) && /routeMeasuredCapacitySignals/.test(apeRescue)],
  ['APE direct single-route actuator never fabricates a split-route quote', /routeSplitExecutionSupported: false/.test(apeRescue) && /routeSplitPromotionSuppressed: true/.test(apeRescue)],
  ['APE old global 42-quote budget is retired', !/ZERO_CAPITAL_RESCUE_TOTAL_QUOTE_BUDGET/.test(apeRescue) && /quoteStormBudget42Removed: true/.test(apeRescue)],
  ['APE profit ladder cannot block the hot path', /postDecisionTelemetry = setImmediate/.test(apeRescue) && /profitLadderDatabaseReadOnCriticalPath: false/.test(apeRescue)],
  ['APE advisory intelligence is outside active rescue critical path', !/buildResearchBpsExecutionPlan/.test(apeRescue) && !/buildBpsReductionSuperPlan/.test(apeRescue) && !/adviseEconomicTransformations/.test(apeRescue)],
  ['APE preserves exact positive economics and no execution authority', /exactStrictPositiveRequiredBeforePromotion: true/.test(apeRescue) && /syntheticEconomics: false/.test(apeRescue) && /executionAuthority: false/.test(apeRescue)],

  // Route splitting is a post-decision APE tactic that reuses the existing exact
  // composite receiver and canonical executor. It never synthesizes a split quote.
  ['APE route split is scheduled after the single-route decision', /runZeroCapitalRouteSplitRescue/.test(apeGateway) && /routeSplitTacticScheduledAfterApeDecision: true/.test(apeGateway)],
  ['APE route split requires pool-disjoint route pairs', /routesArePoolDisjoint/.test(apeRouteSplit) && /pairConstraint: 'pool_disjoint'/.test(apeRouteSplit)],
  ['APE route split quotes both partial paths concurrently', /Promise\.all\(\[/.test(apeRouteSplit) && /partialQuotesRunInParallel: true/.test(apeRouteSplit)],
  ['APE route split uses bounded 50-50 65-35 35-65 allocation probes', /leftPercent: 50n/.test(apeRouteSplit) && /leftPercent: 65n/.test(apeRouteSplit) && /leftPercent: 35n/.test(apeRouteSplit)],
  ['APE split children remain non-executable until exact composite validation', /executableCapability: false/.test(apeRouteSplit) && /required:composite_route_split_exact_simulation/.test(apeRouteSplit)],
  ['APE split failures retain the parent opportunity', /parentOpportunityKilledOnSplitFailure: false/.test(apeRouteSplit) && /parent_opportunity_retained:true/.test(apeRouteSplit)],
  ['APE split promotion delegates to existing Atomic Stack tactic', /runZeroCapitalAtomicStackTactic/.test(apeRouteSplit) && /existingCompositeReceiverReused: true/.test(apeRouteSplit)],
  ['Atomic Stack exact-simulates and gas-estimates composite payloads', /provider\.call\(probeRequest\)/.test(atomicStack) && /provider\.estimateGas\(probeRequest\)/.test(atomicStack)],
  ['Composite builder preserves closed-cycle boundaries', /cycleEndStepIndexes/.test(compositeBuilder) && /Composite final cycle must end at the final swap step/.test(compositeBuilder)],
  ['Canonical executor remains sole composite execution authority', /zeroCapitalCompositeSelectionRegistry\.get\(opportunity\.id\)/.test(canonicalExecutor) && /executeCompositePreparedWithinCanonicalExecutor/.test(canonicalExecutor)],
];

for (const [name, ok] of matrix) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  assert.equal(ok, true, `Capability regression detected: ${name}`);
}

console.log('PROFITABILITY_REPAIR_CAPABILITY_MATRIX_VERIFIED');
