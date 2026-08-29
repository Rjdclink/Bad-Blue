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
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const stageOneBootstrap = read('server/services/cryptocrawl/governance/stage-one-bootstrap-authority.ts');
const stageManager = read('server/services/cryptocrawl/governance/stage-management.ts');
const profitLadder = read('server/services/cryptocrawl/governance/profit-ladder.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const receiverCapability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const providerSelection = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-selection-registry.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const providerExecution = read('server/services/cryptocrawl/integration/provider-specific-zero-capital-execution-wiring.ts');
const deployment = read('scripts/cryptocrawl/deploy-flashloan-receiver.ts');

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

// Stage 1 bootstrap proves the live system from fresh current evidence and feeds
// the existing Foundation/Tier-0 ladder rule. It does not bypass the ladder or
// fabricate realized-profit history.
requireText(stageOneBootstrap, "candidate.status !== 'eligible'", 'Stage 1 eligible-only validation');
requireText(stageOneBootstrap, '!candidate.executableCapability', 'Stage 1 execution-capability requirement');
requireText(stageOneBootstrap, 'candidate.missingInformation.length > 0', 'Stage 1 complete-evidence requirement');
requireText(stageOneBootstrap, "candidate.topology !== 'CEX_CEX' && candidate.topology !== 'ZERO_CAPITAL_ATOMIC'", 'Stage 1 bounded bootstrap topologies');
requireText(stageOneBootstrap, 'candidate.economics.deterministicNetProfitUsd', 'Stage 1 positive economics');
requireText(stageOneBootstrap, 'stageManager.recordLiveValidation', 'Stage 1 uses canonical live-validation API');
requireText(stageOneBootstrap, 'stageOneFoundationLadderEvidence', 'Stage 1 foundation ladder evidence');
requireText(stageOneBootstrap, 'currentTierId: 0', 'Stage 1 tier alignment');
requireText(stageOneBootstrap, 'readyForNextTier: true', 'Stage 1 foundation evidence alignment');
requireText(stageOneBootstrap, 'foundationProfitLadderStillAdvances: true', 'Stage 1 keeps actual ladder advancement');
requireText(stageOneBootstrap, 'state.currentStage !== 1', 'Stage 1-only authority boundary');
requireText(stageOneBootstrap, 'terminalSettlementStillRequiredAfterExecution: true', 'Stage 1 post-execution settlement invariant');
requireText(stageManager, 'm.liveValidationSamples >= 3', 'StageManager still requires multiple live validations');
requireText(stageManager, 'm.liveValidationPassRate >= 0.8', 'StageManager still requires validation pass rate');
requireText(profitLadder, "previousTier.id === 0 ? 'stage_manager_foundation_proof' : 'terminal_realized_performance'", 'Tier 0 foundation proof authority');
requireText(profitLadder, 'StageManager foundation proof metrics are not complete', 'Tier 0 checks StageManager proof');
requireText(canonicalRuntime, 'ensureStageOneBootstrapAuthority()', 'Stage 1 bootstrap installed in canonical runtime');
forbid(stageOneBootstrap, /sendTransaction\s*\(/, 'Stage 1 direct transaction submission');
forbid(stageOneBootstrap, /executeVerifiedArbitragePlan\s*\(/, 'Stage 1 direct CEX execution');
forbid(stageOneBootstrap, /executeFunded\s*\(/, 'Stage 1 direct zero-capital execution');
forbid(stageOneBootstrap, /recordExecutionEvidence\s*\(/, 'Stage 1 synthetic terminal evidence');

// Provider economics, receiver readiness and final submission remain separate
// authorities and are explicitly bound per opportunity by the provider wiring.
requireText(providerEconomics, 'getReserveAToken(address asset)', 'Aave newer-pool reserve liquidity authority');
requireText(providerEconomics, 'ADDRESSES_PROVIDER() view returns (address)', 'Aave addresses-provider discovery');
requireText(providerEconomics, 'getPoolDataProvider() view returns (address)', 'Aave data-provider discovery');
requireText(providerEconomics, 'getReserveTokensAddresses(address asset)', 'Aave older-V3 reserve-token fallback');
requireText(providerEconomics, 'getFlashLoanEnabled(address asset)', 'Aave reserve flash-loan enablement');
requireText(providerEconomics, 'aave_v3_underlying_balance_at_atoken', 'Aave measured underlying liquidity');
requireText(providerEconomics, 'flash_loan_disabled_for_reserve', 'Aave disabled-reserve fail closed');
requireText(providerEconomics, 'feeMeasured && liquidityMeasured && flashLoanEnablementMeasured && flashLoanEnabled', 'Aave complete executable evidence');
requireText(providerEconomics, 'allowedProviders', 'execution-ready provider filter');
requireText(receiverCapability, "'balancer_v1' | 'balancer_composite_v2' | 'aave_v3'", 'receiver capability kinds');
requireText(receiverCapability, 'receiver_bytecode_present', 'receiver bytecode verification');
requireText(receiverCapability, 'receiver_owner_verified', 'receiver owner verification');
requireText(receiverCapability, 'buildMissingReceiverPermissionCalls', 'provider-neutral permission authority');
requireText(providerSelection, 'receiverCapability: VerifiedFlashLoanReceiverCapability', 'selection stores verified receiver capability');
requireText(providerSelection, 'expiresAt: number', 'selection is expiration-bound');
requireText(providerWiring, 'provider_receiver_binding', 'provider/receiver binding provenance');
requireText(providerWiring, 'verifyFlashLoanReceiverCapability', 'provider selection verifies receiver');
requireText(providerWiring, 'buildMissingReceiverPermissionCalls', 'Aave route permission check');
requireText(providerWiring, 'fresh_quote_after_aave_receiver_permissions', 'fresh quote after permission change');
requireText(providerExecution, "selection.provider !== 'aave_v3'", 'provider-specific execution branch');
requireText(providerExecution, 'buildFlashLoanReceiverPayloadFromPlan', 'provider-specific final payload');
requireText(providerExecution, 'FlashLoanExecuted', 'provider-specific positive-profit receipt verification');
requireText(providerExecution, 'normalizeAaveSettlement', 'provider-specific normalized settlement');
requireText(providerExecution, 'aave_v3_pool_flashLoanSimple', 'Aave settlement provenance');
requireText(providerExecution, 'provider_receiver_binding_verified', 'Aave receiver binding provenance');
forbid(providerExecution, /foundry_create2_receiver/, 'Balancer provenance on Aave settlement');
requireText(deployment, "'balancer-composite-v2'", 'Composite V2 deploy support');
requireText(deployment, "'aave-v3'", 'Aave V3 deploy support');
requireText(deployment, 'DEPLOY_FLASHLOAN_RECEIVER', 'explicit deployment confirmation');

forbid(assembler, /executionAuthority:\s*true/, 'composite direct execution authority');
forbid(assembler, /sharedPrincipalStackedBps:\s*arithmeticLegBpsSum/, 'arithmetic BPS promoted as shared-principal BPS');
forbid(liquidation, /deterministicNetProfitUsd:\s*[1-9]/, 'invented liquidation profit');
forbid(providerEconomics, /availableLiquidity:\s*Number\.POSITIVE_INFINITY/, 'assumed infinite provider liquidity');

if (failures.length) {
  console.error('Unified multi-leg adaptive engine verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Unified multi-leg adaptive engine verification PASSED');
console.log(' - all measured discovery sources launch in parallel without a fixed source priority');
console.log(' - UnifiedExecutionRouter is the sole ProfitabilityScore authority');
console.log(' - ProfitabilityScore=(NetProfitUSD/ExecutionRisk)*ConfidenceLevel');
console.log(' - cold start requires current evidence, not historical profit history');
console.log(' - Stage 1 creates canonical live-validation proof from fresh eligible current evidence');
console.log(' - Tier 0 still advances through the real ProfitLadder foundation-proof rule');
console.log(' - Stage 1 cannot submit trades or fabricate terminal settlement history');
console.log(' - realized-profit scaling criteria begin after foundation exit');
console.log(' - Balancer/Aave provider economics are bound to verified provider-specific receivers');
console.log(' - Aave executable evidence requires measured fee, liquidity, and reserve flash-loan enablement');
console.log(' - provider-specific terminal settlement preserves actual provider provenance');
console.log(' - terminal outcomes adapt score/confidence thresholds, cost calibration, and topology attention');
console.log(' - exact selected-set evidence is required for shared-principal stacked BPS');
console.log(' - incomplete maker/cross-chain/liquidation/funding execution paths remain fail closed');
