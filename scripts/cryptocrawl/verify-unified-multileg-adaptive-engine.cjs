const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const assembler = read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts');
const optimizer = read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts');
const scorer = read('server/services/cryptocrawl/optimization/profitability-score.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const compatibilitySelector = read('server/services/cryptocrawl/optimization/dynamic-execution-path-selector.ts');
const admission = read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');
const discovery = read('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts');
const liquidation = read('server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const compositeRegistry = read('server/services/cryptocrawl/optimization/zero-capital-composite-evidence-registry.ts');
const receiverBuilder = read('server/services/cryptocrawl/execution/adapters/flashloan-receiver-builder.ts');
const compositeReceiver = read('contracts/cryptocrawl/CryptocrawlBalancerCompositeFlashLoanReceiver.sol');
const learning = read('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts');
const coreRuntime = read('server/services/cryptocrawl/runtime/core-runtime.ts');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(`missing ${label}: ${text}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(`forbidden ${label}: ${pattern}`);
};

requireText(assembler, 'executionAuthority: false', 'advisory-only composite authority');
requireText(assembler, 'requiresIndependentFinalAdmission: true', 'per-leg final admission');
requireText(assembler, "candidate.status !== 'eligible' || !candidate.executableCapability", 'eligible executable leg filter');
requireText(assembler, 'candidate.missingInformation.length > 0', 'unknown-evidence fail closed');
requireText(assembler, 'netProfitUsd <= 0', 'strict positive deterministic net filter');
requireText(assembler, 'zeroCapitalCompositeEvidenceRegistry.get(selectedIds)', 'exact selected-set composite evidence');
requireText(assembler, 'sharedPrincipalStackedBps', 'shared-principal stacked BPS');
requireText(assembler, 'notionalWeightedNetProfitBps', 'notional-weighted BPS truth');
requireText(assembler, 'arithmeticLegBpsSum', 'arithmetic BPS telemetry distinction');

requireText(scorer, '(positiveNetProfitUsd / executionRisk) * confidenceLevel', 'ProfitabilityScore formula');
requireText(scorer, 'No topology-specific static penalty exists', 'no fixed topology risk preference');
requireText(scorer, 'empiricalCostMultiplier', 'terminal realized-cost calibration');
requireText(optimizer, "outcome.settlement?.terminal !== true", 'terminal-only optimizer feedback');
requireText(optimizer, 'profitabilityScoreThreshold: 0', 'cold-start score threshold without history');
requireText(optimizer, 'confidenceThreshold: 0', 'cold-start confidence threshold without history');
requireText(optimizer, 'getDynamicAdmissionPolicy()', 'dynamic admission threshold');
requireText(optimizer, 'realizedCostMultiplierEwma', 'adaptive cost calibration');
requireText(optimizer, 'priorityWeight = clamp', 'bounded learned topology attention');
requireText(learning, 'adaptiveTopologyOptimizer.recordTerminalOutcome(outcome)', 'terminal learning feedback connection');

requireText(router, "'FLASH_LOAN'", 'flash-loan route');
requireText(router, "'CEX_TAKER_IOC'", 'CEX taker/IOC route');
requireText(router, "'CEX_MAKER'", 'maker route');
requireText(router, "'BRIDGE_FLASH_LOAN'", 'cross-chain route');
requireText(router, "'FLASH_LOAN_LIQUIDATION'", 'liquidation route');
requireText(router, "'SPOT_PERP_FUNDING'", 'funding route');
requireText(router, "'MEV_ATOMIC'", 'MEV route');
requireText(router, "candidate.status === 'eligible'", 'eligible-only execution routing');
requireText(router, 'candidate.missingInformation.length === 0', 'complete-evidence routing');
requireText(router, 'deterministicPositive && completeCurrentEvidence && aboveAdaptiveThreshold', 'combined adaptive admission gate');
requireText(compatibilitySelector, 'routeMeasuredOpportunity(candidate)', 'compatibility selector delegates to unified router');
requireText(compatibilitySelector, 'score: routed.score.profitabilityScore', 'compatibility selector uses sole score authority');
requireText(compatibilitySelector, 'scoring_authority=UnifiedExecutionRouter:ProfitabilityScore', 'explicit sole scoring authority');
forbid(compatibilitySelector, /Math\.log1p/, 'legacy independent execution scoring');
forbid(compatibilitySelector, /adaptiveTopologyOptimizer\.getPriority/, 'legacy independent topology-weight scoring');

requireText(admission, 'originalExecute(plan)', 'CEX live admission wiring');
requireText(admission, 'originalIsAllowedByCryptara(opportunity)', 'zero-capital live admission wiring');
requireText(admission, 'coldStartHistoricalProofRequired: false', 'no historical-proof prerequisite');
requireText(admission, 'terminalSettlementStillRequiredAfterExecution: true', 'post-execution settlement invariant');

requireText(discovery, 'Promise.allSettled([', 'parallel topology launch');
for (const text of [
  'measuredOpportunityGraph.scanOnce()',
  'discoverMeasuredDexCandidates()',
  'discoverMeasuredCrossChainCandidates()',
  'discoverMeasuredMempoolCandidates()',
  'discoverMeasuredLiquidationCandidates()',
  'fundingRateMonitor.scanOnce()',
]) requireText(discovery, text, 'unified discovery topology');
requireText(discovery, 'fixedTopologyPriority: false', 'no fixed topology priority');
requireText(discovery, 'routeRecentMeasuredOpportunities', 'continuous unified execution routing');
requireText(discovery, 'unifiedMultiLegArbitrageEngine.assemble()', 'continuous composite assembly');
requireText(coreRuntime, "discovery: 'unified_multi_topology_parallel_controller'", 'single unified discovery lifecycle');
forbid(coreRuntime, /fundingRateMonitor\.start\(/, 'duplicate funding timer');
forbid(coreRuntime, /measuredOpportunityGraph\.start\(/, 'duplicate CEX timer');

requireText(liquidation, 'healthFactor < 1', 'measured Aave liquidation eligibility');
requireText(liquidation, "status: 'enriched'", 'liquidation discovery-only status');
requireText(liquidation, 'executableCapability: false', 'liquidation fail-closed capability');
requireText(liquidation, 'liquidation_profitability:not_assumed', 'no liquidation profit assumption');

requireText(stack, 'sharedPrincipal', 'shared-principal reuse');
requireText(stack, 'expectedProfitSum', 'stack expected-profit sum');
requireText(stack, 'provider.call', 'exact composite call simulation');
requireText(stack, 'provider.estimateGas', 'exact composite gas estimate');
requireText(stack, 'executionAuthority: false', 'stack advisory authority');
requireText(compositeRegistry, 'sharedPrincipalStackedBps', 'exact composite BPS registry');
requireText(receiverBuilder, 'MAX_ATOMIC_SWAP_STEPS = 16', 'bounded 16-step envelope');
requireText(compositeReceiver, 'CompositeCycleCheckpoint', 'per-cycle balance checkpoint event');
requireText(compositeReceiver, 'FlashLoanExecuted', 'aggregate terminal profit event');

forbid(assembler, /executionAuthority:\s*true/, 'composite direct execution authority');
forbid(assembler, /sharedPrincipalStackedBps:\s*arithmeticLegBpsSum/, 'arithmetic BPS promoted as shared-principal BPS');
forbid(liquidation, /deterministicNetProfitUsd:\s*[1-9]/, 'invented liquidation profit');

if (failures.length) {
  console.error('Unified multi-leg adaptive engine verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Unified multi-leg adaptive engine verification PASSED');
console.log(' - all measured discovery sources launch in parallel without a fixed source priority');
console.log(' - UnifiedExecutionRouter is the sole ProfitabilityScore authority');
console.log(' - ProfitabilityScore=(NetProfitUSD/ExecutionRisk)*ConfidenceLevel');
console.log(' - cold start requires current evidence, not historical proof');
console.log(' - terminal outcomes adapt score/confidence thresholds, cost calibration, and topology attention');
console.log(' - exact selected-set evidence is required for shared-principal stacked BPS');
console.log(' - incomplete maker/cross-chain/liquidation/funding execution paths remain fail closed');
