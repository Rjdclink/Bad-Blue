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

const canonicalIndex = read('server/services/cryptocrawl/index.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const masterShim = read('server/services/cryptocrawl/integration/master-orchestrator-measured-wiring.ts');
const quarantine = read('server/services/cryptocrawl/integration/legacy-intelligence-quarantine.ts');
const killSwitch = read('server/services/cryptocrawl/governance/kill-switch.ts');
const enhancedMicro = read('server/services/cryptocrawl/agents/enhanced-micro-crawler.ts');
const swarm = read('server/services/cryptocrawl/agents/swarm-orchestrator.ts');
const starburst = read('server/services/cryptocrawl/agents/starburst-replication.ts');
const snake = read('server/services/cryptocrawl/agents/starburst-snake.ts');
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
for (const forbidden of [
  'SixCaneSystem',
  'sixCaneSystem',
  'DivineOptimizationEngine',
  'StarburstEngine',
  'MasterOrchestrator',
  'LuxSwarm',
  'EdenStorage',
  'ELITE_STRATEGIES',
  'MARKET_CONDITIONS',
  'swarmIntelligence',
]) {
  forbidText(canonicalIndex, forbidden, `root barrel must not export legacy authority ${forbidden}`);
}

// Canonical lifecycle must not load the historical orchestrator/swarm architecture.
forbidText(canonicalRuntime, 'master-orchestrator', 'canonical runtime must not import historical MasterOrchestrator');
forbidText(canonicalRuntime, 'lux-swarm', 'canonical runtime must not import LuxSwarm');
forbidText(canonicalRuntime, 'eden/service', 'canonical runtime must not import Eden service');
forbidText(canonicalRuntime, 'starburst', 'canonical runtime must not start Starburst');
requireText(canonicalRuntime, 'executionAuthorityGranted: false', 'runtime lifecycle does not grant execution authority');
requireText(masterShim, 'ensureCanonicalCryptoCrawlerRuntimeWiring()', 'historical master wiring is a compatibility shim');
forbidText(masterShim, '../core/master-orchestrator', 'master compatibility shim must not load old orchestrator');

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
