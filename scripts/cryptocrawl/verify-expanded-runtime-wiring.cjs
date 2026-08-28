const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const requireText = (source, text, description) => {
  if (!source.includes(text)) throw new Error(`Missing invariant: ${description}`);
};
const forbidText = (source, text, description) => {
  if (source.includes(text)) throw new Error(`Unsafe invariant: ${description}`);
};

const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const bootstrap = read('server/services/cryptocrawl/integration/cryptara-bootstrap-wiring.ts');
const canonical = read('server/services/cryptocrawl/intelligence/canonical-opportunity-state.ts');
const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const scaling = read('server/services/cryptocrawl/scaling/dynamic-scale-physics.ts');
const concurrent = read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts');
const telemetry = read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
const runtime = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const masterCompatibility = read('server/services/cryptocrawl/integration/master-orchestrator-measured-wiring.ts');
const evolution = read('server/services/cryptocrawl/evolution/measured-execution-feedback.ts');
const lifecycle = read('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts');
const quarantine = read('server/services/cryptocrawl/integration/legacy-intelligence-quarantine.ts');
const execution = read('server/services/cryptocrawl/execution/index.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');

requireText(progression, 'ensureCryptaraAssessmentWiring()', 'Cryptara canonical assessment/bootstrap wiring is installed on the governed path');
requireText(progression, 'ensureMasterOrchestratorMeasuredWiring()', 'historical import remains wired through the compatibility shim');
requireText(progression, 'ensureTelemetryBootstrap()', 'provider telemetry bootstrap is installed on the governed path');
requireText(masterCompatibility, 'ensureCanonicalCryptoCrawlerRuntimeWiring()', 'legacy master wiring delegates to canonical runtime wiring');
forbidText(masterCompatibility, '../core/master-orchestrator', 'legacy MasterOrchestrator must not be imported by canonical runtime startup');
requireText(canonicalRuntime, 'ensureCryptoRuntimeObservability()', 'runtime observability is installed from canonical runtime wiring');
requireText(canonicalRuntime, 'legacyMasterOrchestratorRequired: false', 'canonical runtime declares legacy master orchestrator unnecessary');
requireText(canonicalRuntime, 'executionAuthorityGranted: false', 'runtime lifecycle wiring does not grant execution authority');
requireText(bootstrap, "mode: 'pretrade_bootstrap'", 'Monte Carlo has an explicit measured pre-trade bootstrap mode');
requireText(bootstrap, "mode: 'posttrade_calibrated'", 'Monte Carlo preserves a post-trade calibrated mode');
requireText(bootstrap, "const requiresOnchainTelemetry = context?.plan?.crossVenueCostModel === 'bridge'", 'CEX bootstrap does not falsely require blockchain telemetry');
requireText(bootstrap, 'requiresOnchainTelemetry && (!mempool', 'mempool gas evidence remains mandatory for on-chain/bridge routes');
requireText(bootstrap, 'mempoolMonitoring: requiresOnchainTelemetry', 'CEX simulation does not claim mempool monitoring when it is not required');
requireText(bootstrap, 'Canonical opportunity decision', 'complete canonical per-opportunity telemetry is emitted');

requireText(graph, 'getBoundTechnicalEvidence({', 'technical evidence is bound to each opportunity observation');
requireText(graph, 'symbol: plan.symbol', 'technical evidence uses the same candidate symbol');
requireText(graph, 'tradingView: technicalEvidence.analysis', 'same-symbol technical evidence reaches Cryptara assessment');
requireText(graph, 'arbitrageVerifier.evaluateOnce(', 'deterministic verified economics remain upstream of assessment');
requireText(graph, 'canonicalOpportunityState', 'measured graph publishes/observes canonical opportunity state');

requireText(canonical, 'VerifiedArbitragePlan', 'canonical state owns the verified arbitrage economics plan');
requireText(canonical, 'CanonicalOracleEvidence', 'canonical state carries oracle evidence');
requireText(canonical, 'settlement: NormalizedRealizedExecution | null', 'canonical state carries normalized terminal settlement');
requireText(scaling, 'canonicalOpportunityState.getMetrics(60_000)', 'DynamicScale consumes canonical opportunity density');
requireText(scaling, "'verified_pretrade'", 'DynamicScale can consume verified pre-trade profitability');

requireText(scheduler, 'canonicalOpportunityState.getRecent(512)', 'bounded canonical scheduler consumes canonical candidates');
requireText(scheduler, "snapshot.status === 'eligible'", 'scheduler accepts only eligible canonical candidates');
requireText(scheduler, 'snapshot.plan.netProfitUsd > 0', 'scheduler preserves strictly positive deterministic economics');
requireText(scheduler, 'isLiveExecutionPosture()', 'scheduler preserves explicit live execution posture');
requireText(scheduler, 'stageManager.isMarketOperationsAllowed()', 'scheduler preserves canonical stage gating');
requireText(scheduler, 'executeVerifiedArbitragePlan', 'scheduler delegates to guarded verified executor');
requireText(concurrent, 'Legacy faucet concurrency patch retired', 'legacy faucet concurrency layer is inert');
forbidText(concurrent, 'target.makeOpenDecision', 'legacy layer cannot patch execution decisions');
requireText(faucet, 'canonicalExecutionScheduler.start()', 'faucet compatibility lifecycle converges on canonical scheduler');
forbidText(faucet, 'makeCloseDecision(', 'faucet no longer owns execution close decisions');

requireText(telemetry, 'Ankr fallback probe completed', 'Ankr/shared RPC health remains observable');
requireText(telemetry, 'Alchemy telemetry initialized', 'Alchemy readiness remains observable');
requireText(runtime, 'Authoritative runtime heartbeat', 'full runtime heartbeat is emitted');
requireText(runtime, 'alchemyIntegration.readinessCheck', 'heartbeat exposes live Alchemy readiness');
requireText(runtime, 'blockchainProviderSnapshot()', 'heartbeat exposes shared RPC/Ankr state');
requireText(runtime, 'workloadRouter.getSystemStatus()', 'heartbeat exposes Beam/QuantiComp workload state');
requireText(runtime, 'canonicalOpportunityState.getMetrics(60_000)', 'heartbeat exposes canonical opportunity throughput');
requireText(evolution, 'feedback.settlement.terminal !== true', 'measured evolution path rejects non-terminal evidence');
requireText(lifecycle, 'isLongTermMemoryAllowed()', 'long-term learning remains governance gated');
requireText(quarantine, 'Legacy synthetic intelligence quarantine active', 'legacy randomized intelligence is explicitly quarantined');
requireText(execution, "process.env.NO_EXECUTION === 'true'", 'NO_EXECUTION emergency guard is preserved');
requireText(execution, 'settlementConfirmed', 'execution preserves terminal settlement semantics');

forbidText(scheduler, 'NO_EXECUTION = false', 'scheduler must not mutate emergency execution configuration');
forbidText(runtime, 'process.env.WALLET_PRIVATE_KEY', 'runtime heartbeat must not log or consume wallet private-key values');
forbidText(runtime, 'process.env.KRAKEN_API_SECRET', 'runtime heartbeat must not expose Kraken secrets');
forbidText(runtime, 'process.env.OKX_API_SECRET', 'runtime heartbeat must not expose OKX secrets');

console.log('Expanded CryptoCrawler runtime wiring verification passed.');
