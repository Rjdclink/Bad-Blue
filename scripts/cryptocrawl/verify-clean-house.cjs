const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const requireText = (source, text, description) => {
  if (!source.includes(text)) throw new Error(`Missing clean-house invariant: ${description}`);
};
const forbidText = (source, text, description) => {
  if (source.includes(text)) throw new Error(`Clean-house violation: ${description}`);
};
const requireAbsent = (relativePath, description) => {
  if (fs.existsSync(path.join(root, relativePath))) throw new Error(`Clean-house violation: ${description}`);
};

const canonicalIndex = read('server/services/cryptocrawl/index.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const masterShim = read('server/services/cryptocrawl/integration/master-orchestrator-measured-wiring.ts');
const masterPipeline = read('server/services/cryptocrawl/integration/master-pipeline.ts');
const quarantine = read('server/services/cryptocrawl/integration/legacy-intelligence-quarantine.ts');
const killSwitch = read('server/services/cryptocrawl/governance/kill-switch.ts');
const enhancedMicro = read('server/services/cryptocrawl/agents/enhanced-micro-crawler.ts');
const swarm = read('server/services/cryptocrawl/agents/swarm-orchestrator.ts');
const starburst = read('server/services/cryptocrawl/agents/starburst-replication.ts');
const snake = read('server/services/cryptocrawl/agents/starburst-snake.ts');
const agentBarrel = read('server/services/cryptocrawl/agents/index.ts');
const edenBarrel = read('server/services/cryptocrawl/eden/index.ts');
const aiBarrel = read('server/services/cryptocrawl/ai/index.ts');
const optimizationBarrel = read('server/services/cryptocrawl/optimization/index.ts');
const evolutionBarrel = read('server/services/cryptocrawl/evolution/index.ts');
const trainingBarrel = read('server/services/cryptocrawl/training/index.ts');
const capitalFreeBarrel = read('server/services/cryptocrawl/capital-free/index.ts');
const faucetBarrel = read('server/services/cryptocrawl/faucet/index.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
const faucetConcurrency = read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts');
const higherOrderMesh = read('server/services/cryptocrawl/faucet/higher-order-mesh.ts');
const dashboardIndex = read('server/services/cryptocrawl/api/index.ts');
const legacyDashboard = read('server/services/cryptocrawl/api/dashboard-api.ts');
const canonicalDashboard = read('server/services/cryptocrawl/api/canonical-dashboard-api.ts');
const truthfulAdmin = read('server/services/cryptocrawl/api/truthful-admin-diagnostics.ts');
const wallet = read('server/services/cryptocrawl/core/wallet.ts');
const bridgeBarrel = read('server/services/cryptocrawl/bridge/index.ts');
const riskShield = read('server/services/cryptocrawl/risk/mandatory-risk-shield.ts');
const legacyCircuit = read('server/services/cryptocrawl/risk/circuit-breaker.ts');
const legacyFlashloan = read('server/services/cryptocrawl/core/flashloan-atomic-engine.ts');
const executionReadiness = read('server/services/cryptocrawl/execution/execution-readiness.ts');
const multiRelay = read('server/services/cryptocrawl/execution/multi-relay-submitter.ts');
const authoritativeMc = read('server/services/cryptocrawl/integration/authoritative-monte-carlo-wiring.ts');
const assessment = read('server/services/cryptocrawl/integration/cryptara-assessment-wiring.ts');
const beam = read('server/services/cryptocrawl/integration/cryptara-beam-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const authorityDoc = read('server/services/cryptocrawl/CANONICAL_AUTHORITIES.md');

// Public entry point must represent only the canonical system.
requireText(canonicalIndex, 'CryptoCrawler canonical public surface', 'root barrel declares canonical-only purpose');
requireText(canonicalIndex, 'ensureCanonicalCryptoCrawlerRuntimeWiring', 'root barrel exports canonical runtime');
requireText(canonicalIndex, 'ensureAuthoritativeMonteCarloWiring', 'root barrel exports authoritative MC wiring');
requireText(canonicalIndex, 'canonicalExecutionScheduler', 'root barrel exports canonical scheduler');
requireText(canonicalIndex, 'assessCanonicalExecutionEnvironment', 'root barrel exports canonical topology-specific readiness');
forbidText(canonicalIndex, 'assessSharedExecutionEnvironment', 'root barrel must not expose stale shared readiness');
forbidText(canonicalIndex, 'getSharedExecutionCapabilities', 'root barrel must not expose stale shared capability naming');
for (const forbidden of [
  'SixCaneSystem', 'sixCaneSystem', 'DivineOptimizationEngine', 'StarburstEngine',
  'EdenStorage', 'ELITE_STRATEGIES', 'MARKET_CONDITIONS', 'swarmIntelligence',
  'CryptocrawlerAIHarmony',
]) {
  forbidText(canonicalIndex, forbidden, `root barrel must not export legacy authority ${forbidden}`);
}
forbidText(canonicalIndex, "from './core/lux-swarm", 'root barrel must not import/export LuxSwarm authority');
forbidText(canonicalIndex, "from './core/master-orchestrator", 'root barrel must not import/export historical MasterOrchestrator authority');

// Canonical lifecycle must not load historical orchestrator/swarm architecture.
forbidText(canonicalRuntime, 'master-orchestrator', 'canonical runtime must not import historical MasterOrchestrator');
forbidText(canonicalRuntime, 'lux-swarm', 'canonical runtime must not import LuxSwarm');
forbidText(canonicalRuntime, 'eden/service', 'canonical runtime must not import Eden service');
forbidText(canonicalRuntime, 'starburst', 'canonical runtime must not start Starburst');
requireText(canonicalRuntime, 'executionAuthorityGranted: false', 'runtime lifecycle does not grant execution authority');
requireText(masterShim, 'ensureCanonicalCryptoCrawlerRuntimeWiring()', 'historical master wiring is a compatibility shim');
forbidText(masterShim, '../core/master-orchestrator', 'master compatibility shim must not load old orchestrator');
forbidText(masterPipeline, "from '../core/lux-swarm", 'MasterPipeline compatibility facade must not import LuxSwarm authority');
forbidText(masterPipeline, 'StealthSuperiority', 'MasterPipeline compatibility facade must not retain Stealth execution');
forbidText(masterPipeline, 'TripleDipExtractor', 'MasterPipeline compatibility facade must not retain TripleDip execution');
forbidText(masterPipeline, 'ReinforcementLearningBidder', 'MasterPipeline compatibility facade must not retain RL execution authority');
requireText(masterPipeline, 'canonicalExecutionScheduler', 'MasterPipeline lifecycle delegates to canonical scheduler');
requireText(masterPipeline, 'assessCanonicalExecutionEnvironment', 'MasterPipeline diagnostics use canonical readiness authority');
forbidText(masterPipeline, 'assessSharedExecutionEnvironment', 'MasterPipeline must not use stale shared readiness');

// Canonical execution readiness is topology-specific and private relays are optional.
requireText(executionReadiness, 'normalizePrivateKey(process.env.FLASHBOTS_AUTH_KEY)', 'Flashbots readiness checks the explicit auth key');
forbidText(executionReadiness, 'flashbotsAuthConfigured = rpcConfigured', 'RPC presence cannot impersonate Flashbots auth');
requireText(executionReadiness, 'privateRelayOptional: true', 'private relay is explicitly optional');
requireText(executionReadiness, '[krakenConfigured, okxConfigured, coinbaseConfigured].filter(Boolean).length >= 2', 'CEX readiness accepts any two configured supported venues');
requireText(executionReadiness, '!noExecutionGuardEnabled && liveExecutionEnabled && liveExecutionConfirmed', 'live readiness preserves execution posture guards');
requireText(multiRelay, 'direct broadcast remains authoritative', 'private relay initialization cannot own direct broadcast readiness');
requireText(multiRelay, "process.env.FLASHBOTS_AUTH_KEY?.trim()", 'private relay consumes explicit Flashbots auth only');
requireText(multiRelay, 'providers.size === 0', 'private relay submission skips cleanly when unavailable');
forbidText(multiRelay, 'randomBytes', 'private relay must not fabricate an auth identity');

// Emergency halt must be independent of legacy systems.
forbidText(killSwitch, '../eden/', 'kill switch must not depend on legacy Eden');
forbidText(killSwitch, '../agents/swarm-orchestrator', 'kill switch must not depend on simulated swarm');
requireText(killSwitch, 'stageManager.pause', 'kill switch pauses canonical stage manager first');
requireText(killSwitch, 'riskGovernor.exportState', 'kill switch snapshots canonical risk state');

// Legacy simulation shells must be inert and unable to fabricate outcomes.
for (const [name, source] of [
  ['EnhancedMicroCrawler', enhancedMicro],
  ['SwarmOrchestrator', swarm],
  ['StarburstReplication', starburst],
  ['StarburstSnake', snake],
]) {
  requireText(source, 'COMPATIBILITY SHELL', `${name} is explicitly compatibility-only`);
  forbidText(source, 'Math.random', `${name} must not fabricate randomized runtime evidence`);
  forbidText(source, 'simulateExecution', `${name} must not retain simulated execution`);
}
requireText(enhancedMicro, 'profitGenerated: 0', 'legacy micro crawler cannot report synthetic profit');
requireText(starburst, 'success: false', 'legacy Starburst cannot report synthetic success');
requireText(starburst, 'replicasCreated: 0', 'legacy Starburst cannot claim spawned execution agents');

// Production subsystem barrels must not advertise retired architecture.
for (const [name, source, forbidden] of [
  ['agents', agentBarrel, ['CainCrawler', 'CainTwinHybrid', 'ConjoinedTwinCrawler', 'SwarmOrchestrator']],
  ['eden', edenBarrel, ['EdenService', 'EdenDeploymentManager', 'edenCainStates']],
  ['ai', aiBarrel, ['CryptocrawlerAIHarmony', 'cryptocrawlerAIHarmony']],
  ['optimization', optimizationBarrel, ['DivineOptimizationEngine', 'getDivineEngine']],
  ['training', trainingBarrel, ['scheduledMonteCarloTraining', 'ScheduledMonteCarloTraining']],
  ['evolution', evolutionBarrel, ['HyperEvolutionEngine', 'SwarmIntelligenceEngine', 'FrontierResearchEngine']],
  ['faucet', faucetBarrel, ['FacetSimulationEngine', 'HighRiskSimulationEngine', 'runComplianceSimulation']],
  ['capital-free', capitalFreeBarrel, ['BarterSystem', 'PartnershipFormationSystem', 'StarburstScalingSystem', 'NexGenProtocolLayer']],
]) {
  for (const token of forbidden) forbidText(source, token, `${name} production barrel must not export ${token}`);
}
requireText(evolutionBarrel, 'recordMeasuredEvolutionFeedback', 'evolution barrel exposes terminal measured feedback only');
requireText(capitalFreeBarrel, 'AlchemyIntegration', 'capital-free barrel retains measured Alchemy telemetry');
forbidText(bridgeBarrel, 'withdraw-deposit', 'dormant arbitrary withdrawal manager must not be exported by production bridge barrel');
forbidText(bridgeBarrel, 'withdrawDepositManager', 'dormant withdrawal manager must not be reachable through bridge barrel');

// Legacy faucet state machine and synthetic business caps are retired.
requireText(faucet, 'Canonical CryptoCrawler lifecycle compatibility facade', 'faucet is a canonical compatibility facade');
requireText(faucet, 'canonicalExecutionScheduler.start()', 'faucet lifecycle delegates to canonical scheduler');
requireText(faucet, 'maxHourlyProfit: Number.POSITIVE_INFINITY', 'legacy hourly profit cap cannot halt execution');
requireText(faucet, 'dailyTarget: 0', 'legacy daily profit target has no authority');
forbidText(faucet, 'makeCloseDecision(', 'faucet must not own a second close-decision authority');
forbidText(faucet, 'executeWithStealth(', 'faucet must not own a stealth execution authority');
forbidText(faucet, 'Math.random', 'faucet facade must not fabricate runtime evidence');
requireText(faucetConcurrency, 'Legacy faucet concurrency patch retired', 'old monkey-patch wiring is inert');
forbidText(faucetConcurrency, 'target.makeOpenDecision', 'concurrency compatibility layer must not patch faucet decisions');
requireText(higherOrderMesh, 'Legacy compatibility surface only', 'higher-order synthetic mesh is retired');
forbidText(higherOrderMesh, 'Math.random', 'higher-order mesh cannot generate synthetic runtime evidence');

// Dashboard must be side-effect-free and canonical.
requireText(dashboardIndex, './canonical-dashboard-api.js', 'production API barrel mounts canonical dashboard');
requireText(legacyDashboard, "from './canonical-dashboard-api.js'", 'legacy dashboard direct imports re-export canonical dashboard');
forbidText(legacyDashboard, 'setTimeout(', 'legacy dashboard import cannot auto-start runtime');
forbidText(legacyDashboard, 'DivineOptimizer', 'legacy dashboard import cannot start Divine optimizer');
requireText(canonicalDashboard, 'canonicalOpportunityState', 'dashboard opportunities come from canonical state');
requireText(canonicalDashboard, 'canonicalExecutionScheduler', 'dashboard control targets canonical scheduler');
requireText(canonicalDashboard, 'canonical_terminal_settlement', 'dashboard profit/trade truth comes from terminal settlement');
forbidText(canonicalDashboard, 'Math.random', 'dashboard cannot fabricate runtime numbers');
requireText(truthfulAdmin, 'mutableHere: false', 'admin diagnostics do not expose decorative config as live authority');
requireText(truthfulAdmin, 'diagnostics-only', 'admin config mutations are rejected');

// Wallet surface must not expose or pretend to persist secret material.
forbidText(wallet, 'encryptedKey', 'WalletManager must not return encrypted private-key material');
forbidText(wallet, 'mnemonic', 'WalletManager must not return mnemonic material');
forbidText(wallet, 'loadFromDB', 'WalletManager must not claim nonexistent DB persistence');
forbidText(wallet, 'saveToDB', 'WalletManager must not claim nonexistent DB persistence');
requireText(wallet, 'direct wallet withdrawal is disabled', 'direct dashboard withdrawal remains fail-closed');

// Duplicate risk engines must fail closed; retired synthetic execution orchestrator must be absent.
requireText(riskShield, 'retired', 'mock MandatoryRiskShield is retired');
requireText(legacyCircuit, 'retired', 'standalone legacy circuit breaker is retired');
requireAbsent('server/services/cryptocrawl/orchestrator', 'retired synthetic execution orchestrator directory must be deleted');
requireText(legacyFlashloan, 'Legacy compatibility surface only', 'synthetic flash-loan engine is retired');
forbidText(legacyFlashloan, 'Math.random', 'legacy flash-loan engine cannot fabricate success');
requireText(legacyFlashloan, 'success: false', 'legacy flash-loan engine fails closed');

// Authoritative MC must be downstream of deterministic positive economics and measured evidence.
requireText(assessment, 'context.plan.netProfitUsd > 0', 'deterministic positive gate precedes MC');
requireText(assessment, 'ensureCryptaraBeamWiring()', 'assessment uses authoritative Beam/QuantiComp MC route');
requireText(beam, 'ensureAuthoritativeMonteCarloWiring()', 'Beam route wraps authoritative MC');
requireText(authoritativeMc, 'runProfitabilityMonteCarlo', 'authoritative MC uses canonical profitability model');
requireText(authoritativeMc, 'monteCarloCalibrationStore.getSamples', 'authoritative MC consumes terminal calibration evidence');
forbidText(authoritativeMc, 'ELITE_STRATEGIES', 'authoritative MC must not use canned elite strategies');
forbidText(authoritativeMc, 'MARKET_CONDITIONS', 'authoritative MC must not use canned market presets');

// Canonical scheduling consumes canonical eligible snapshots and positive economics.
requireText(scheduler, "snapshot.status === 'eligible'", 'scheduler consumes canonical eligibility');
requireText(scheduler, 'snapshot.plan.netProfitUsd > 0', 'scheduler requires positive deterministic economics');
requireText(scheduler, 'executeVerifiedArbitragePlan', 'scheduler delegates to verified execution path');

// The quarantine inventory and authority map must remain operator-visible.
requireText(quarantine, 'LEGACY_NON_AUTHORITATIVE_COMPONENTS', 'legacy quarantine has explicit inventory');
requireText(authorityDoc, 'One authority per responsibility', 'canonical authority doctrine is documented');
requireText(authorityDoc, 'Settlement precedes learning', 'settlement-before-learning doctrine is documented');

console.log('CryptoCrawler clean-house verification passed.');