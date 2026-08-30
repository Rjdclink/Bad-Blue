const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const requireText = (source, text, description) => {
  if (!source.includes(text)) throw new Error(`Missing authority invariant: ${description}`);
};
const forbidText = (source, text, description) => {
  if (source.includes(text)) throw new Error(`Authority violation: ${description}`);
};

const riskGovernor = read('server/services/cryptocrawl/governance/risk-governor.ts');
const ladderNotional = read('server/services/cryptocrawl/governance/profit-ladder-notional-authority.ts');
const profitLadder = read('server/services/cryptocrawl/governance/profit-ladder.ts');
const stageRetirement = read('server/services/cryptocrawl/governance/stage-profit-cap-retirement.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const genie = read('server/services/genie-controller/index.ts');
const beam = read('server/services/cryptocrawl/integration/cryptara-beam-wiring.ts');
const stageManager = read('server/services/cryptocrawl/governance/stage-management.ts');
const automaticProgression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const executionIndex = read('server/services/cryptocrawl/execution/index.ts');
const executionReadiness = read('server/services/cryptocrawl/execution/execution-readiness.ts');
const ultraLowLatency = read('server/services/cryptocrawl/execution/ultra-low-latency-executor.ts');
const cexExecutor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
const cexSettlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const cexSerialization = read('server/services/cryptocrawl/execution/cex-order-serialization.ts');
const legacyMasterOrchestrator = read('server/services/cryptocrawl/core/master-orchestrator.ts');
const legacyIndex = read('server/services/cryptocrawl/legacy/index.ts');
const legacyQuarantine = read('server/services/cryptocrawl/integration/legacy-intelligence-quarantine.ts');
const unifiedReactor = read('server/reactor/unified.ts');

// Profit magnitude must never be an execution ceiling or arbitrary floor.
requireText(riskGovernor, 'profitCeilingAuthority: false', 'RiskGovernor declares no profit-ceiling authority');
forbidText(riskGovernor, 'currentDailyProfit >=', 'RiskGovernor cannot block after a daily profit ceiling');
forbidText(riskGovernor, 'Trade would exceed daily profit limit', 'RiskGovernor cannot reject profitable trades for exceeding a target');
forbidText(riskGovernor, 'profitRatio > 0.5', 'RiskGovernor cannot impose a hidden 50% ROI ceiling');
forbidText(riskGovernor, 'positionRatio > 0.95', 'RiskGovernor cannot add a hidden position-size ceiling below the configured maximum');
requireText(riskGovernor, 'proposal.positionSizeUSD > notionalAuthority.maxNotionalUsd', 'profit-ladder position limit remains authoritative');
requireText(riskGovernor, "positionSizeAuthority: 'profit_ladder_capital_allowance'", 'RiskGovernor reports Profit Ladder as position-size authority');
forbidText(riskGovernor, 'proposal.positionSizeUSD > stageConfig.maxPositionSizeUSD', 'legacy StageManager maxPositionSizeUSD cannot remain an execution ceiling');
requireText(ladderNotional, 'const configured = Number(tier.recommendedCapitalUSD);', 'current ladder rung recommended capital is the notional allowance');
requireText(ladderNotional, "authority: 'profit_ladder_capital_allowance'", 'central ladder notional authority is explicit');
requireText(ladderNotional, 'stagePositionCapAuthoritative: false', 'legacy stage position cap is explicitly non-authoritative');
requireText(ladderNotional, 'const aligned = Number(tier.stage) === Number(stage.stage);', 'stage/tier mismatch fails closed before sizing');
requireText(profitLadder, 'recommendedCapitalUSD: 10000', 'Tier 1 ladder allowance remains $10,000');
requireText(riskGovernor, "this.circuitBreakers.set('daily-loss'", 'loss-side safety circuit breaker remains');
requireText(riskGovernor, 'evidence!.expectedProfit > 0', 'Monte Carlo risk still requires positive expected economics');
forbidText(executionIndex, 'directive.minimumNetProfitUsd > 0', 'execution cannot impose an autonomous minimum-profit floor');
requireText(executionIndex, 'plan.netProfitUsd <= 0', 'verified execution still rejects non-positive all-in economics');

// Historical StageManager daily targets are compatibility/advancement metadata only.
requireText(stageRetirement, 'StageManager.recordTrade is retired', 'legacy StageManager accounting entry point fails closed');
requireText(stageRetirement, 'Number.POSITIVE_INFINITY', 'legacy maximum-profit getter cannot become an execution ceiling');
requireText(canonicalRuntime, 'ensureStageProfitCapRetirement()', 'canonical runtime installs StageManager profit-cap retirement before operations');
requireText(canonicalRuntime, 'profitCeilingAuthority: false', 'runtime attests no profit ceiling authority');
requireText(stageManager, 'recordExecutionEvidence', 'terminal evidence accounting path remains present');

// Terminal learning must remain exactly-once and independent of retired Faucet wiring.
requireText(automaticProgression, 'feedback.settlement.terminal !== true', 'non-terminal settlement evidence is rejected');
requireText(automaticProgression, 'terminalFeedbackAlreadyApplied(eventId)', 'persisted duplicate terminal feedback is rejected');
requireText(automaticProgression, 'terminalFeedbackInFlight.get(eventId)', 'concurrent duplicate terminal feedback is coalesced');
requireText(automaticProgression, 'terminalFeedbackApplied.add(eventId)', 'applied terminal feedback identity is recorded');
forbidText(automaticProgression, 'concurrent-execution-wiring', 'authoritative stage progression cannot import retired Faucet concurrency wiring');
forbidText(automaticProgression, 'ensureConcurrentExecutionWiring', 'authoritative stage progression cannot initialize retired Faucet compatibility wiring');

// Genie/4JI must not instantiate a second Cryptara Monte Carlo authority.
requireText(genie, "ensureCryptaraBeamWiring", 'Genie imports canonical Cryptara Beam wiring');
requireText(genie, 'this.cryptara = ensureCryptaraBeamWiring();', 'Genie initializes Cryptara through canonical Beam/QuantiComp authority');
forbidText(genie, 'this.cryptara = getCryptara();', 'Genie cannot initialize an un-wired Cryptara singleton');
requireText(beam, 'ensureAuthoritativeMonteCarloWiring()', 'Beam route remains backed by authoritative MC');
requireText(beam, 'EVIDENCE_INCOMPLETE: verified_opportunity_context', 'direct MC without verified opportunity context fails closed');

// Legacy shared names are compatibility shims only; execution-readiness.ts is the sole authority.
requireText(executionIndex, "from './execution-readiness.js'", 'legacy execution surface imports canonical readiness authority');
requireText(executionIndex, 'return getCanonicalExecutionCapabilities();', 'legacy capability API delegates to canonical authority');
requireText(executionIndex, 'return assessCanonicalExecutionEnvironment();', 'legacy readiness API delegates to canonical authority');
forbidText(executionIndex, 'const SHARED_EXECUTION_CAPABILITIES', 'legacy execution surface cannot own duplicate capability state');
forbidText(executionIndex, 'const centralizedExchangeConfigured = [krakenConfigured', 'legacy execution surface cannot recompute CEX readiness');
forbidText(executionIndex, 'const flashbotsAuthConfigured =', 'legacy execution surface cannot recompute Flashbots readiness');
requireText(executionReadiness, 'normalizePrivateKey(process.env.FLASHBOTS_AUTH_KEY)', 'canonical readiness requires explicit Flashbots auth material');
forbidText(executionReadiness, 'flashbotsAuthConfigured = rpcConfigured', 'RPC configuration cannot impersonate Flashbots authentication');
requireText(executionReadiness, 'const executionPostureOpen = !noExecutionGuardEnabled', 'canonical readiness honors the execution kill guard');

// Direct EVM broadcast and private relay submission must have one authority each.
requireText(ultraLowLatency, "configuredSubmissionPaths: ['direct']", 'low-latency executor owns direct broadcast only');
requireText(ultraLowLatency, "privateRelayAuthority: 'MultiRelaySubmitter'", 'low-latency executor declares private relay authority elsewhere');
forbidText(ultraLowLatency, 'FLASHBOTS_RPC', 'low-latency executor cannot create a second Flashbots submission path');
forbidText(ultraLowLatency, 'BLOXROUTE_RPC', 'low-latency executor cannot create a second Bloxroute submission path');
forbidText(ultraLowLatency, 'submitViaFlashbots', 'low-latency executor cannot submit directly to Flashbots');
forbidText(ultraLowLatency, 'submitViaBloxroute', 'low-latency executor cannot submit directly to Bloxroute');
forbidText(ultraLowLatency, "parseUnits('1', 'gwei')", 'gas prediction cannot fabricate a 1-gwei fallback');
requireText(ultraLowLatency, 'Provider did not return gas history or a current gas price', 'missing gas evidence fails closed');

// Canonical CEX execution must preserve venue-legal precision through one settlement authority.
requireText(cexExecutor, 'createProductionCexSettlementAdapters()', 'canonical executor instantiates the single production CEX settlement authority');
forbidText(cexExecutor, 'constrained-production-cex-adapters', 'canonical executor cannot depend on a duplicate CEX submit wrapper');
requireText(cexSettlement, "from './cex-order-serialization.js'", 'production CEX settlement consumes the canonical decimal serializer');
requireText(cexSettlement, 'cexDecimalString(request.price)', 'production CEX order prices use canonical decimal serialization');
requireText(cexSettlement, 'cexDecimalString(request.quantity)', 'production CEX order quantities use canonical decimal serialization');
forbidText(cexSettlement, 'toFixed(12)', 'production CEX submission cannot reintroduce a hidden 12-decimal cap');
forbidText(cexSerialization, 'toFixed(', 'canonical CEX decimal serialization cannot impose a fixed precision cap');

// Historical MasterOrchestrator must remain an inert compatibility shell.
requireText(legacyMasterOrchestrator, 'Legacy MasterOrchestrator compatibility shell', 'legacy MasterOrchestrator declares compatibility-only status');
requireText(legacyMasterOrchestrator, "authority: 'none'", 'legacy MasterOrchestrator declares no authority');
requireText(legacyMasterOrchestrator, 'legacyExecutionAuthority: false', 'legacy MasterOrchestrator cannot claim execution authority');
forbidText(legacyMasterOrchestrator, 'setInterval(', 'legacy MasterOrchestrator cannot create background loops');
forbidText(legacyMasterOrchestrator, 'setTimeout(', 'legacy MasterOrchestrator cannot create delayed side effects');
forbidText(legacyMasterOrchestrator, 'EdenStorage.startReplication', 'legacy MasterOrchestrator cannot start Eden replication');
forbidText(legacyMasterOrchestrator, 'CainManager.startAll', 'legacy MasterOrchestrator cannot start Cain agents');
forbidText(legacyMasterOrchestrator, 'TwinManager.startAll', 'legacy MasterOrchestrator cannot start Twin agents');
forbidText(legacyMasterOrchestrator, 'StarburstEngine.startMonitoring', 'legacy MasterOrchestrator cannot start Starburst monitoring');
forbidText(legacyMasterOrchestrator, 'LuxSwarm.observe()', 'legacy MasterOrchestrator cannot derive synthetic runtime metrics from LuxSwarm');

// Unified Reactor must not start or re-export the historical randomized CryptoCrawler executor.
forbidText(unifiedReactor, "from '../../services/cryptocrawler-executor/index'", 'Reactor cannot import historical CryptoCrawler executor');
forbidText(unifiedReactor, 'getCryptoExecutor()', 'Reactor cannot instantiate historical CryptoCrawler executor');
forbidText(unifiedReactor, 'CryptoCrawlerExecutor, getCryptoExecutor', 'Reactor cannot re-export historical CryptoCrawler executor authority');
requireText(unifiedReactor, "name: 'crypto-executor-legacy'", 'Reactor reports retired CryptoCrawler executor explicitly');
requireText(unifiedReactor, "authority: 'none'", 'Reactor reports no legacy CryptoCrawler execution authority');
requireText(unifiedReactor, 'Synthetic ActionResult generation is no longer permitted', 'legacy Reactor crypto integration fails closed instead of fabricating results');

// Every explicit legacy namespace must remain visibly non-authoritative and quarantined.
requireText(legacyIndex, "LEGACY_CRYPTOCRAWLER_AUTHORITY = 'none'", 'legacy public namespace declares no authority');
requireText(legacyIndex, 'LEGACY_CRYPTOCRAWLER_EXECUTION_ALLOWED = false', 'legacy public namespace forbids execution authority');
for (const legacyPath of [
  'core/eden-storage.ts',
  'core/cain-crawler.ts',
  'core/neurofusion.ts',
  'core/microtask-engine.ts',
  'core/light-communication.ts',
  'core/stealth-security.ts',
  'core/lux-swarm.ts',
  'agents/conjoined-twin-crawler.ts',
  'agents/cain-twin-hybrid.ts',
  'eden/deployment.ts',
  'intelligence/index.ts (legacy namespace only)',
  'capital-free/index.ts (legacy namespace only)',
  'ai/index.ts (legacy namespace only)',
  'evolution/index.ts (legacy namespace only)',
  'optimization/index.ts (legacy namespace only)',
  'config/maximum-profitability.ts (legacy compatibility config only)',
  'services/cryptocrawler-executor/index.ts (historical Reactor executor; not canonical)',
]) {
  requireText(legacyQuarantine, `'${legacyPath}'`, `legacy quarantine inventories ${legacyPath}`);
}

console.log('CryptoCrawler clean-house authority extension verification passed.');