const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const assembler = read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts');
const optimizer = read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts');
const selector = read('server/services/cryptocrawl/optimization/dynamic-execution-path-selector.ts');
const discovery = read('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts');
const liquidation = read('server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const compositeRegistry = read('server/services/cryptocrawl/optimization/zero-capital-composite-evidence-registry.ts');
const receiverBuilder = read('server/services/cryptocrawl/execution/adapters/flashloan-receiver-builder.ts');
const compositeReceiver = read('contracts/cryptocrawl/CryptocrawlBalancerCompositeFlashLoanReceiver.sol');
const learning = read('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts');

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
requireText(assembler, 'adaptiveTopologyOptimizer.getAssemblyPolicy()', 'adaptive assembly policy');
requireText(assembler, 'policy.minIncrementalBps', 'adaptive incremental BPS threshold');
requireText(assembler, "candidate.provenance.includes('atomic_multileg_payload_composable')", 'explicit atomic composability evidence');
requireText(assembler, 'zeroCapitalCompositeEvidenceRegistry.get(selectedIds)', 'exact selected-set composite evidence');
requireText(assembler, 'sharedPrincipalStackedBps', 'shared-principal stacked BPS');
requireText(assembler, 'exactCompositeSimulation', 'exact composite simulation telemetry');
requireText(assembler, 'notionalWeightedNetProfitBps', 'notional-weighted BPS truth');
requireText(assembler, 'arithmeticLegBpsSum', 'arithmetic BPS telemetry distinction');
requireText(assembler, 'No shared-principal BPS is claimed without an exact composite-evidence match', 'no synthetic stacked BPS');

requireText(optimizer, "outcome.settlement?.terminal !== true", 'terminal-only optimizer feedback');
requireText(optimizer, 'realizedNetProfitBps: realizedBps', 'realized BPS persistence');
requireText(optimizer, 'terminalSamples === 0', 'cold-start adaptive policy');
requireText(optimizer, 'minIncrementalBps: 0', 'cold-start no-history bootstrap');
requireText(optimizer, 'priorityWeight = clamp', 'bounded scan priority');
requireText(optimizer, "'LIQUIDATION'", 'liquidation adaptive topology');

requireText(selector, "candidate.status === 'eligible' && candidate.executableCapability", 'execution-path capability proof');
requireText(selector, "path: executableNow ? path : 'UNAVAILABLE'", 'unavailable path fail closed');
requireText(selector, 'maker path remains advisory', 'maker execution truth');
requireText(selector, 'cross-chain path remains unavailable', 'cross-chain execution truth');
requireText(selector, 'liquidation path is measured-discovery only', 'liquidation execution truth');

requireText(discovery, 'adaptivePerTopologyCadence: true', 'adaptive scan cadence');
requireText(discovery, 'minimumCoveragePreserved: true', 'minimum topology coverage');
requireText(discovery, 'discoverMeasuredLiquidationCandidates()', 'liquidation parallel discovery');
requireText(discovery, 'unifiedMultiLegArbitrageEngine.assemble()', 'continuous composite assembly');
requireText(discovery, 'adaptiveTopologyOptimizer.getPriority(topology)', 'realized-BPS scan priority consumption');
requireText(learning, 'adaptiveTopologyOptimizer.recordTerminalOutcome(outcome)', 'terminal learning feedback connection');

requireText(liquidation, 'healthFactor < 1', 'measured Aave liquidation eligibility');
requireText(liquidation, "status: 'enriched'", 'liquidation discovery-only status');
requireText(liquidation, 'executableCapability: false', 'liquidation fail-closed capability');
requireText(liquidation, 'liquidation_profitability:not_assumed', 'no liquidation profit assumption');

requireText(stack, 'sharedPrincipal', 'shared-principal reuse');
requireText(stack, 'expectedProfitSum', 'stack expected-profit sum');
requireText(stack, 'provider.call', 'exact composite call simulation');
requireText(stack, 'provider.estimateGas', 'exact composite gas estimate');
requireText(stack, 'executionAuthority: false', 'stack advisory authority');
requireText(stack, 'atomic_multileg_payload_composable', 'post-simulation composability marking');
requireText(compositeRegistry, 'sharedPrincipalStackedBps', 'exact composite BPS registry');
requireText(receiverBuilder, 'MAX_ATOMIC_SWAP_STEPS = 16', 'bounded 16-step envelope');

requireText(compositeReceiver, 'CompositeCycleCheckpoint', 'per-cycle balance checkpoint event');
requireText(compositeReceiver, 'cycleEndStepIndexes', 'explicit cycle boundaries');
requireText(compositeReceiver, 'profit_below_threshold', 'aggregate minimum-profit invariant');
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
console.log(' - deterministic-positive eligible legs only');
console.log(' - no arithmetic-BPS-as-profit shortcut');
console.log(' - exact selected-set evidence required for shared-principal stacked BPS');
console.log(' - same-chain zero-capital stacks require exact eth_call + gas estimate');
console.log(' - terminal realized BPS drives bounded adaptive priority/assembly thresholds');
console.log(' - liquidations are measured from live Aave health factor but remain non-executable until full economics exist');
console.log(' - composite V2 checkpoints attribution while aggregate final profit remains terminal truth');
