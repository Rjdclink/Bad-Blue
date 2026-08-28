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

const telemetry = read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
const runtimeObservability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const gates = read('server/services/cryptara/marketGates/index.ts');
const ml = read('server/services/cryptara/opportunity-ml-ranker.ts');
const mlPersistence = read('server/services/cryptocrawl/integration/cryptara-ml-persistence.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
const concurrentExecution = read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const resources = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const execution = read('server/services/cryptocrawl/execution/index.ts');
const cexExecutor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
const canonical = read('server/services/cryptocrawl/intelligence/canonical-opportunity-state.ts');
const cryptaraBootstrap = read('server/services/cryptocrawl/integration/cryptara-bootstrap-wiring.ts');
const cryptaraAssessment = read('server/services/cryptocrawl/integration/cryptara-assessment-wiring.ts');
const cryptaraBeam = read('server/services/cryptocrawl/integration/cryptara-beam-wiring.ts');
const measuredEvolution = read('server/services/cryptocrawl/evolution/measured-execution-feedback.ts');
const learningLifecycle = read('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts');
const primaryLearning = read('server/services/cryptocrawl/integration/primary-learning-persistence.ts');
const dynamicScale = read('server/services/cryptocrawl/scaling/dynamic-scale-physics.ts');
const legacyQuarantine = read('server/services/cryptocrawl/integration/legacy-intelligence-quarantine.ts');
const parallelLanes = read('server/services/cryptocrawl/intelligence/parallel-lanes.ts');
const envExample = read('.env.railway.example');

requireText(telemetry, "alchemyIntegration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'])", 'Alchemy enhanced telemetry starts on supported networks');
requireText(telemetry, "ethereum: 'https://rpc.ankr.com/eth'", 'keyless Ankr Ethereum fallback is registered');
requireText(telemetry, "polygon: 'https://rpc.ankr.com/polygon'", 'keyless Ankr Polygon fallback is registered');
requireText(telemetry, 'multiProviderRpcManager.initialize(TELEMETRY_CHAINS)', 'shared RPC manager initializes before optional providers');
requireText(telemetry, 'Ankr fallback probe completed', 'Ankr health outcome is visible without exposing secrets');
requireText(telemetry, 'probeReadOnlyZeroX()', '0x authentication and price path is actively health-probed');
requireText(telemetry, 'CoinStats credential resolution', 'CoinStats credential-name resolution is observable without logging the key');
requireText(telemetry, 'COIN_STATS_API_KEY', 'CoinStats legacy environment alias is normalized');
requireText(telemetry, 'Production execution posture', 'non-secret production execution posture is visible for deployment verification');
requireText(telemetry, "process.env.NO_EXECUTION === 'true'", 'runtime reports the emergency NO_EXECUTION guard without mutating it');

requireText(runtimeObservability, '[CryptoRuntime] Authoritative runtime heartbeat', 'provider and decision diagnostics remain visible after startup');
requireText(runtimeObservability, 'alchemyIntegration.readinessCheck', 'runtime heartbeat includes live Alchemy readiness');
requireText(runtimeObservability, 'multiProviderRpcManager.getHealth(chain)', 'runtime heartbeat includes shared RPC/Ankr provider state');
requireText(runtimeObservability, 'canonicalOpportunityState.getMetrics(60_000)', 'runtime heartbeat reports current opportunity throughput');
requireText(runtimeObservability, 'workloadRouter.getSystemStatus()', 'runtime heartbeat reports Beam/QuantiComp workload state');

requireText(gates, 'const evaluation = super.evaluate(enrichedContext, config);', 'deterministic gate evaluates before AI/ML evidence');
requireText(gates, 'signals: [...evaluation.signals, mlAssessment.signal]', 'AI/ML score is appended as evidence only');
requireText(gates, ': arbitrageVerifier.getBestCrossVenueFeeContext();', 'generic Stage 1 market-cycle gate consumes fresh measured cross-venue fee evidence');
requireText(gates, 'timeOfDay: context.timeOfDay ?? { utcHour: new Date().getUTCHours() }', 'known UTC time is not reported as unknown');
requireText(ml, 'advisoryOnly: true', 'AI/ML signal is explicitly advisory');
requireText(ml, 'exportState()', 'Cryptara ranker exposes bounded versioned persistence state');
requireText(mlPersistence, 'isLongTermMemoryAllowed()', 'Cryptara ranker persistence honors stage memory governance');

requireText(progression, 'reevaluateLastMarketGate()', 'Stage 1 stale fee evidence is reevaluated');
requireText(progression, 'stageManager.getState().currentStage !== 1', 'Stage 1 reevaluation is scoped to bootstrap stage');
requireText(progression, 'opportunityMlRanker.observeExecution', 'AI/ML learns only from terminal execution feedback path');
requireText(progression, 'Execution evidence requires a terminal normalized settlement', 'learning/governance feedback rejects non-terminal executions');
requireText(progression, 'Concurrent Faucet execution wiring failed to install', 'compatibility wiring failures cannot disappear silently');

requireText(cryptaraBootstrap, "mode: 'pretrade_bootstrap' | 'posttrade_calibrated'", 'Monte Carlo explicitly separates bootstrap and calibrated modes');
requireText(cryptaraBootstrap, 'posttradeCalibrated = measuredExecutionHistory.length >= 3', 'real settlement history calibrates rather than bootstraps first execution');
requireText(cryptaraBootstrap, 'marketData: { ...assessment.marketData }', 'canonical state retains provider market data');
requireText(cryptaraAssessment, 'shouldEmitIncompleteWarning', 'incomplete Monte Carlo warning spam is transition/rate limited');
requireText(cryptaraBeam, 'TaskType.MONTE_CARLO', 'Cryptara Monte Carlo uses the Beam/QuantiComp workload router');

requireText(canonical, 'matchingOracleEvidence(input.symbol)', 'oracle evidence is bound to the matching candidate asset');
requireText(canonical, 'verifiedPositiveOpportunities', 'canonical stream exposes verified opportunity density');
requireText(dynamicScale, 'canonicalOpportunityState.getMetrics(60_000)', 'DynamicScale consumes canonical current opportunity density');
requireText(dynamicScale, 'canonical.expectedNetProfitUsd', 'DynamicScale consumes verified expected profitability before settlement history exists');

// Execution concurrency belongs to canonical scheduler/resource leases. Profit caps are forbidden.
requireText(scheduler, 'executionResourceScheduler', 'canonical scheduler owns resource admission');
requireText(scheduler, 'executeVerifiedArbitragePlan', 'canonical scheduler delegates to verified executor');
requireText(resources, 'CRYPTOCRAWL_MAX_CONCURRENT_PER_VENUE', 'resource scheduler applies per-venue backpressure');
requireText(resources, 'cex:nonce:kraken-account', 'Kraken account remains a serialized resource domain');
requireText(resources, 'cex:inventory:', 'inventory reservations prevent double-spend across concurrent plans');
forbidText(concurrentExecution, 'DAILY_TARGET_CONFIG.dailyTarget', 'legacy concurrency shim must not preserve a daily profit cap');
forbidText(concurrentExecution, 'STEALTH_CONFIG.maxHourlyProfit', 'legacy concurrency shim must not preserve an hourly profit cap');
forbidText(faucet, 'makeCloseDecision(', 'faucet cannot close execution because a profit target was reached');
requireText(faucet, 'maxHourlyProfit: Number.POSITIVE_INFINITY', 'legacy hourly cap is neutralized');
requireText(faucet, 'dailyTarget: 0', 'legacy daily target is neutralized');
requireText(cexExecutor, 'createProductionCexSettlementAdapters()', 'concurrent CEX plans share authenticated adapter state');
requireText(cexExecutor, 'const productionCexAdapters', 'CEX authenticated adapter state is process-shared');

requireText(measuredEvolution, 'feedback.settlement.terminal !== true', 'evolution consumes terminal measured settlements only');
requireText(measuredEvolution, 'isLongTermMemoryAllowed()', 'measured evolution persistence honors stage memory governance');
requireText(learningLifecycle, 'deep.isInitialized = false', 'Stage 1-3 deferral does not permanently poison later learning initialization');
requireText(primaryLearning, 'getExecutionOutcomeKey(outcome)', 'persisted execution outcomes restore idempotency keys');

requireText(scheduler, 'stageManager.isMarketOperationsAllowed()', 'canonical stage execution gate remains present');
requireText(scheduler, 'snapshot.plan.netProfitUsd > 0', 'verified net-profit economics remain present');
requireText(execution, "process.env.NO_EXECUTION === 'true'", 'emergency NO_EXECUTION kill switch remains available');
requireText(envExample, 'NO_EXECUTION=false', 'authorized production template does not permanently disable execution');
requireText(envExample, 'CRYPTO_ARBITRAGE_LIVE_EXECUTION=false', 'repository example does not silently authorize live orders');

requireText(parallelLanes, 'Math.random()', 'legacy parallel lanes are recognized as synthetic and must not be treated as measured evidence');
requireText(legacyQuarantine, 'quarantined_not_authoritative', 'legacy randomized intelligence is explicitly quarantined');
forbidText(telemetry, 'sixCaneSystem.start()', 'telemetry bootstrap must not activate synthetic Six-Cane intelligence');
forbidText(gates, 'decision: mlAssessment', 'AI/ML cannot replace the deterministic market-gate decision');
forbidText(ml, 'executeVerifiedArbitragePlan', 'AI/ML model has no execution authority');
forbidText(cryptaraBootstrap, "mode: 'posttrade_calibrated' : 'posttrade_calibrated'", 'bootstrap mode cannot masquerade as calibrated history');

console.log('CryptoCrawler canonical runtime / telemetry / AI-ML non-regression verification passed.');
