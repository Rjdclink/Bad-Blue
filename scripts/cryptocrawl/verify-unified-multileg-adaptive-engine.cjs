const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const source = {
  assembler: read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts'),
  optimizer: read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts'),
  scorer: read('server/services/cryptocrawl/optimization/profitability-score.ts'),
  router: read('server/services/cryptocrawl/execution/unified-execution-router.ts'),
  compatibility: read('server/services/cryptocrawl/optimization/dynamic-execution-path-selector.ts'),
  admission: read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts'),
  discovery: read('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts'),
  cexGraph: read('server/services/cryptocrawl/discovery/opportunity-graph.ts'),
  cexPositiveRevalidation: read('server/services/cryptocrawl/integration/cex-four-mode-observability-wiring.ts'),
  cexTimingGuard: read('server/services/cryptocrawl/integration/cross-venue-timing-guard-wiring.ts'),
  arbitrageVerifier: read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts'),
  riskGovernor: read('server/services/cryptocrawl/governance/risk-governor.ts'),
  liquidation: read('server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts'),
  stack: read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts'),
  compositeRegistry: read('server/services/cryptocrawl/optimization/zero-capital-composite-evidence-registry.ts'),
  receiverBuilder: read('server/services/cryptocrawl/execution/adapters/flashloan-receiver-builder.ts'),
  compositeReceiver: read('contracts/cryptocrawl/CryptocrawlBalancerCompositeFlashLoanReceiver.sol'),
  learning: read('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts'),
  coreRuntime: read('server/services/cryptocrawl/runtime/core-runtime.ts'),
  canonicalRuntime: read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts'),
  stageOneBootstrap: read('server/services/cryptocrawl/governance/stage-one-bootstrap-authority.ts'),
  stageManager: read('server/services/cryptocrawl/governance/stage-management.ts'),
  profitLadder: read('server/services/cryptocrawl/governance/profit-ladder.ts'),
  providerEconomics: read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts'),
  receiverCapability: read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts'),
  providerSelection: read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-selection-registry.ts'),
  providerWiring: read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts'),
  providerExecution: read('server/services/cryptocrawl/integration/provider-specific-zero-capital-execution-wiring.ts'),
  deployment: read('scripts/cryptocrawl/deploy-flashloan-receiver.ts'),
};

const failures = [];
const normalizeRequiredText = value => value.replace(/\s+/g, ' ').trim();
const requireText = (key, text, label) => {
  if (!normalizeRequiredText(source[key]).includes(normalizeRequiredText(text))) failures.push(`missing ${label}: ${text}`);
};
const forbid = (key, pattern, label) => {
  if (pattern.test(source[key])) failures.push(`forbidden ${label}: ${pattern}`);
};

const required = [
  ['assembler', 'executionAuthority: false', 'advisory-only composite authority'],
  ['assembler', 'requiresIndependentFinalAdmission: true', 'per-leg final admission'],
  ['assembler', "candidate.status !== 'eligible' || !candidate.executableCapability", 'eligible executable leg filter'],
  ['assembler', 'candidate.missingInformation.length > 0', 'unknown-evidence fail closed'],
  ['assembler', 'netProfitUsd <= 0', 'strict positive deterministic net filter'],
  ['assembler', 'zeroCapitalCompositeEvidenceRegistry.get(selectedIds)', 'exact selected-set composite evidence'],
  ['assembler', 'sharedPrincipalStackedBps', 'shared-principal stacked BPS'],
  ['assembler', 'notionalWeightedNetProfitBps', 'notional-weighted BPS truth'],
  ['assembler', 'arithmeticLegBpsSum', 'arithmetic BPS telemetry distinction'],

  ['scorer', '(positiveNetProfitUsd / executionRisk) * confidenceLevel', 'ProfitabilityScore formula'],
  ['scorer', 'No topology-specific static penalty exists', 'no fixed topology risk preference'],
  ['scorer', 'empiricalCostMultiplier', 'terminal realized-cost calibration'],
  ['optimizer', "outcome.settlement?.terminal !== true", 'terminal-only optimizer feedback'],
  ['optimizer', 'profitabilityScoreThreshold: 0', 'cold-start score threshold without history'],
  ['optimizer', 'confidenceThreshold: 0', 'cold-start confidence threshold without history'],
  ['optimizer', 'getDynamicAdmissionPolicy()', 'dynamic admission threshold'],
  ['optimizer', 'realizedCostMultiplierEwma', 'adaptive cost calibration'],
  ['optimizer', 'priorityWeight = clamp', 'bounded learned topology attention'],
  ['learning', 'adaptiveTopologyOptimizer.recordTerminalOutcome(outcome)', 'terminal learning feedback connection'],

  ['router', "'FLASH_LOAN'", 'flash-loan route'],
  ['router', "'CEX_TAKER_IOC'", 'CEX taker/IOC route'],
  ['router', "'CEX_MAKER'", 'maker route'],
  ['router', "'BRIDGE_FLASH_LOAN'", 'cross-chain route'],
  ['router', "'FLASH_LOAN_LIQUIDATION'", 'liquidation route'],
  ['router', "'SPOT_PERP_FUNDING'", 'funding route'],
  ['router', "'MEV_ATOMIC'", 'MEV route'],
  ['router', 'export interface AdvisoryEvidenceScores', 'advisory evidence score surface'],
  ['router', 'advisoryOnly: true', 'evidence scoring cannot execute or veto independently'],
  ['router', 'const deterministicPositive = Number.isFinite(deterministicNet) && deterministicNet > 0;', 'strict positive deterministic admission floor'],
  ['router', 'const evidenceReacquisitionRequired = deterministicZero', 'unknown/zero evidence is reacquired'],
  ['router', 'const admitted = deterministicPositive', 'positive-net canonical router admission'],
  ['router', '&& pathAvailable', 'authoritative path requirement'],
  ['router', '&& candidate.executableCapability', 'execution capability requirement'],
  ['router', '&& fresh', 'freshness requirement'],
  ['router', '&& depthReady;', 'depth readiness requirement'],
  ['router', 'advisory:adaptive_profitability_or_confidence_below_ranking_threshold', 'adaptive threshold advisory-only telemetry'],
  ['compatibility', 'routeMeasuredOpportunity(candidate)', 'compatibility selector delegates to unified router'],
  ['compatibility', 'score: routed.score.profitabilityScore', 'compatibility selector uses sole score authority'],
  ['compatibility', 'scoring_authority=UnifiedExecutionRouter:ProfitabilityScore', 'explicit sole scoring authority'],

  ['admission', 'originalExecute(plan)', 'CEX live admission wiring'],
  ['admission', 'zeroCapitalAdmissionMonkeyPatchInstalled: false', 'zero-capital duplicate admission authority removed'],
  ['stageOneBootstrap', 'terminalHistoryRequired: false', 'no historical-profit prerequisite for Stage 1 live validation'],
  ['admission', 'terminalSettlementStillRequiredAfterExecution: true', 'post-execution settlement invariant'],

  ['cexPositiveRevalidation', 'triggerCanonicalPositiveRevalidation(positive)', 'positive CEX observation revalidation trigger'],
  ['cexPositiveRevalidation', 'measuredOpportunityGraph.revalidateSymbols(symbols)', 'exact-symbol canonical revalidation'],
  ['cexPositiveRevalidation', 'canonicalRevalidationRequired: true', 'positive observation requires canonical revalidation'],
  ['cexPositiveRevalidation', "authority: 'scheduling_trigger_only'", 'advisory observation cannot execute directly'],
  ['cexGraph', "trigger: 'positive_observation_revalidation'", 'bounded positive-observation revalidation cycle'],
  ['cexGraph', 'arbitrageVerifier.evaluateMany({', 'canonical revalidation uses exact arbitrage verifier'],
  ['cexGraph', 'authenticated_fee_evidence', 'canonical revalidation requires authenticated fees'],
  ['cexGraph', 'depth_aware_notional_search', 'canonical revalidation requires measured depth-aware size'],
  ['cexTimingGuard', 'synchronized executable books are unavailable', 'execution fails closed without synchronized books'],
  ['cexTimingGuard', 'fullEconomicsRequoteStillDownstream: true', 'fresh synchronized edge still receives full economic requote'],
  ['arbitrageVerifier', 'if (!bestPlan || candidate.netProfitUsd > bestPlan.netProfitUsd) bestPlan = candidate;', 'highest verified positive net plan is retained'],
  ['riskGovernor', 'Profit magnitude is never an execution ceiling', 'risk governor has no profit magnitude ceiling'],
  ['riskGovernor', 'reject high profit merely * for being high', 'anomaly detection cannot reject high profit by magnitude'],

  ['discovery', 'Promise.allSettled([', 'parallel topology launch'],
  ['discovery', 'measuredOpportunityGraph.scanOnce()', 'unified CEX discovery topology'],
  ['discovery', 'discoverMeasuredDexCandidates()', 'unified DEX discovery topology'],
  ['discovery', 'discoverMeasuredCrossChainCandidates()', 'unified cross-chain discovery topology'],
  ['discovery', 'discoverMeasuredMempoolCandidates()', 'unified mempool discovery topology'],
  ['discovery', 'discoverMeasuredLiquidationCandidates()', 'unified liquidation discovery topology'],
  ['discovery', 'fundingRateMonitor.scanOnce()', 'unified funding discovery topology'],
  ['discovery', 'fixedTopologyPriority: false', 'no fixed topology priority'],
  ['discovery', 'routeRecentMeasuredOpportunities', 'continuous unified execution routing'],
  ['discovery', 'unifiedMultiLegArbitrageEngine.assemble()', 'continuous composite assembly'],
  ['coreRuntime', "discovery: 'unified_multi_topology_parallel_controller'", 'single unified discovery lifecycle'],

  ['liquidation', 'healthFactor < 1', 'measured Aave liquidation eligibility'],
  ['liquidation', "status: 'enriched'", 'liquidation discovery-only status'],
  ['liquidation', 'executableCapability: false', 'liquidation fail-closed capability'],
  ['liquidation', 'liquidation_profitability:not_assumed', 'no liquidation profit assumption'],

  ['stack', 'sharedPrincipal', 'shared-principal reuse'],
  ['stack', 'expectedProfitSum', 'stack expected-profit sum'],
  ['stack', 'provider.call', 'exact composite call simulation'],
  ['stack', 'provider.estimateGas', 'exact composite gas estimate'],
  ['stack', 'executionAuthority: false', 'stack advisory authority'],
  ['compositeRegistry', 'sharedPrincipalStackedBps', 'exact composite BPS registry'],
  ['receiverBuilder', 'MAX_ATOMIC_SWAP_STEPS = 16', 'bounded 16-step envelope'],
  ['compositeReceiver', 'CompositeCycleCheckpoint', 'per-cycle balance checkpoint event'],
  ['compositeReceiver', 'FlashLoanExecuted', 'aggregate terminal profit event'],

  ['stageOneBootstrap', "candidate.status !== 'eligible'", 'Stage 1 eligible-only validation'],
  ['stageOneBootstrap', '!candidate.executableCapability', 'Stage 1 execution-capability requirement'],
  ['stageOneBootstrap', "candidate.depth.status === 'unavailable'", 'Stage 1 measured-depth requirement'],
  ['stageOneBootstrap', 'candidate.rawQuotes.some(quote => quote.executable === false)', 'Stage 1 executable-quote requirement'],
  ['stageOneBootstrap', "candidate.topology !== 'CEX_CEX' && candidate.topology !== 'MAKER_CEX' && candidate.topology !== 'ZERO_CAPITAL_ATOMIC'", 'Stage 1 bounded bootstrap topologies include fully measured maker CEX'],
  ['stageOneBootstrap', 'candidate.economics.deterministicNetProfitUsd', 'Stage 1 positive economics'],
  ['stageOneBootstrap', 'stageManager.recordLiveValidation', 'Stage 1 uses canonical live-validation API'],
  ['stageOneBootstrap', 'stageOneFoundationLadderEvidence', 'Stage 1 foundation ladder evidence'],
  ['stageOneBootstrap', 'currentTierId: 0', 'Stage 1 tier alignment'],
  ['stageOneBootstrap', 'readyForNextTier: true', 'Stage 1 foundation evidence alignment'],
  ['stageOneBootstrap', 'foundationProfitLadderStillAdvances: true', 'Stage 1 keeps actual ladder advancement'],
  ['stageOneBootstrap', 'state.currentStage !== 1', 'Stage 1-only authority boundary'],
  ['stageOneBootstrap', 'terminalSettlementRequiredAfterExecution: true', 'Stage 1 post-execution settlement invariant'],
  ['stageManager', 'm.liveValidationSamples >= 3', 'StageManager still requires multiple live validations'],
  ['stageManager', 'm.liveValidationPassRate >= 0.8', 'StageManager still requires validation pass rate'],
  ['profitLadder', "previousTier.id === 0 ? 'stage_manager_foundation_proof' : 'terminal_realized_performance'", 'Tier 0 foundation proof authority'],
  ['profitLadder', 'StageManager foundation proof metrics are not complete', 'Tier 0 checks StageManager proof'],
  ['canonicalRuntime', 'ensureStageOneBootstrapAuthority()', 'Stage 1 bootstrap installed in canonical runtime'],

  ['providerEconomics', 'getReserveAToken(address asset)', 'Aave newer-pool reserve liquidity authority'],
  ['providerEconomics', 'ADDRESSES_PROVIDER() view returns (address)', 'Aave addresses-provider discovery'],
  ['providerEconomics', 'getPoolDataProvider() view returns (address)', 'Aave data-provider discovery'],
  ['providerEconomics', 'getReserveTokensAddresses(address asset)', 'Aave older-V3 reserve-token fallback'],
  ['providerEconomics', 'getFlashLoanEnabled(address asset)', 'Aave reserve flash-loan enablement'],
  ['providerEconomics', 'aave_v3_underlying_balance_at_atoken', 'Aave measured underlying liquidity'],
  ['providerEconomics', 'flash_loan_disabled_for_reserve', 'Aave disabled-reserve fail closed'],
  ['providerEconomics', 'feeMeasured && liquidityMeasured && flashLoanEnablementMeasured && flashLoanEnabled', 'Aave complete executable evidence'],
  ['providerEconomics', 'allowedProviders', 'execution-ready provider filter'],
  ['receiverCapability', "'balancer_v1' | 'balancer_composite_v2' | 'aave_v3'", 'receiver capability kinds'],
  ['receiverCapability', 'receiver_bytecode_present', 'receiver bytecode verification'],
  ['receiverCapability', 'receiver_owner_verified', 'receiver owner verification'],
  ['receiverCapability', 'buildMissingReceiverPermissionCalls', 'provider-neutral permission authority'],
  ['providerSelection', 'receiverCapability: VerifiedFlashLoanReceiverCapability', 'selection stores verified receiver capability'],
  ['providerSelection', 'expiresAt: number', 'selection is expiration-bound'],
  ['providerWiring', 'provider_receiver_binding', 'provider/receiver binding provenance'],
  ['providerWiring', 'verifyFlashLoanReceiverCapability', 'provider selection verifies receiver'],
  ['providerWiring', 'verifyDualFlashLoanReceiverCapability', 'dual provider selection verifies receiver'],
  ['providerWiring', 'buildMissingReceiverPermissionCalls', 'provider-neutral route permission check'],
  ['providerWiring', 'fresh_quote_after_provider_receiver_permissions', 'fresh quote after any provider receiver permission change'],
  ['providerExecution', "selection.provider !== 'aave_v3'", 'provider-specific execution branch'],
  ['providerExecution', 'buildFlashLoanReceiverPayloadFromPlan', 'provider-specific final payload'],
  ['providerExecution', 'FlashLoanExecuted', 'provider-specific positive-profit receipt verification'],
  ['providerExecution', 'normalizeAaveSettlement', 'provider-specific normalized settlement'],
  ['providerExecution', 'aave_v3_pool_flashLoanSimple', 'Aave settlement provenance'],
  ['providerExecution', 'provider_receiver_binding_verified', 'Aave receiver binding provenance'],
  ['deployment', "'balancer-composite-v2'", 'Composite V2 deploy support'],
  ['deployment', "'aave-v3'", 'Aave V3 deploy support'],
  ['deployment', 'DEPLOY_FLASHLOAN_RECEIVER', 'explicit deployment confirmation'],
];

for (const [key, text, label] of required) requireText(key, text, label);

forbid('compatibility', /Math\.log1p/, 'legacy independent execution scoring');
forbid('compatibility', /adaptiveTopologyOptimizer\.getPriority/, 'legacy independent topology-weight scoring');
forbid('coreRuntime', /fundingRateMonitor\.start\(/, 'duplicate funding timer');
forbid('coreRuntime', /measuredOpportunityGraph\.start\(/, 'duplicate CEX timer');
forbid('stageOneBootstrap', /sendTransaction\s*\(/, 'Stage 1 direct transaction submission');
forbid('stageOneBootstrap', /executeVerifiedArbitragePlan\s*\(/, 'Stage 1 direct CEX execution');
forbid('stageOneBootstrap', /executeFunded\s*\(/, 'Stage 1 direct zero-capital execution');
forbid('stageOneBootstrap', /recordExecutionEvidence\s*\(/, 'Stage 1 synthetic terminal evidence');
forbid('admission', /originalIsAllowedByCryptara/, 'zero-capital duplicate admission monkey-patch');
forbid('providerExecution', /foundry_create2_receiver/, 'Balancer provenance on Aave settlement');
forbid('assembler', /executionAuthority:\s*true/, 'composite direct execution authority');
forbid('assembler', /sharedPrincipalStackedBps:\s*arithmeticLegBpsSum/, 'arithmetic BPS promoted as shared-principal BPS');
forbid('liquidation', /deterministicNetProfitUsd:\s*[1-9]/, 'invented liquidation profit');
forbid('providerEconomics', /availableLiquidity:\s*Number\.POSITIVE_INFINITY/, 'assumed infinite provider liquidity');
forbid('router', /candidate\.missingInformation\.length\s*===\s*0/, 'missing-information registry veto');
forbid('router', /admitted:\s*deterministicPositive\s*&&\s*completeCurrentEvidence/, 'duplicate complete-evidence execution authority');
forbid('router', /admitted:\s*deterministicPositive\s*&&\s*completeCurrentEvidence\s*&&\s*aboveAdaptiveThreshold/, 'adaptive threshold independent execution veto');
forbid('arbitrageVerifier', /MAX_(?:NET_)?PROFIT|MAX_PROFIT_BPS|MAX_SPREAD_BPS|UNREALISTIC_(?:PROFIT|SPREAD)/i, 'profit/spread magnitude execution ceiling');
forbid('riskGovernor', /estimatedProfitUSD\s*>\s*[1-9][0-9]*/, 'risk rejection based on high estimated profit magnitude');

if (failures.length) {
  console.error('Unified multi-leg adaptive engine verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Unified multi-leg adaptive engine verification PASSED');
console.log(' - all measured discovery sources launch in parallel without a fixed source priority');
console.log(' - UnifiedExecutionRouter remains the sole ProfitabilityScore authority');
console.log(' - cold start requires current executable evidence, not historical profit history');
console.log(' - Cryptara/TradingView scoring and optional missing evidence remain ranking/reacquisition telemetry, not independent execution vetoes');
console.log(' - rare/high-profit CEX observations trigger canonical fresh revalidation instead of a profit-magnitude veto');
console.log(' - canonical CEX revalidation still requires synchronized books, authenticated fees, measured depth and all-in positive economics');
console.log(' - Stage 1 can execute only through canonical executors and cannot directly submit trades or fabricate terminal settlement history');
console.log(' - terminal outcomes remain the learning and realized-profit authority');
console.log(' - Balancer, Aave and dual-provider permission changes invalidate stale quotes and require immediate fresh re-quote');
console.log(' - provider economics remain bound to verified provider-specific receivers');
console.log(' - incomplete hard execution paths remain fail closed');