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
const stageRetirement = read('server/services/cryptocrawl/governance/stage-profit-cap-retirement.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const genie = read('server/services/genie-controller/index.ts');
const beam = read('server/services/cryptocrawl/integration/cryptara-beam-wiring.ts');
const stageManager = read('server/services/cryptocrawl/governance/stage-management.ts');
const executionIndex = read('server/services/cryptocrawl/execution/index.ts');
const cexExecutor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
const cexSettlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const cexSerialization = read('server/services/cryptocrawl/execution/cex-order-serialization.ts');

// Profit magnitude must never be an execution ceiling or arbitrary floor.
requireText(riskGovernor, 'profitCeilingAuthority: false', 'RiskGovernor declares no profit-ceiling authority');
forbidText(riskGovernor, 'currentDailyProfit >=', 'RiskGovernor cannot block after a daily profit ceiling');
forbidText(riskGovernor, 'Trade would exceed daily profit limit', 'RiskGovernor cannot reject profitable trades for exceeding a target');
forbidText(riskGovernor, 'profitRatio > 0.5', 'RiskGovernor cannot impose a hidden 50% ROI ceiling');
forbidText(riskGovernor, 'positionRatio > 0.95', 'RiskGovernor cannot add a hidden position-size ceiling below the configured maximum');
requireText(riskGovernor, 'proposal.positionSizeUSD > stageConfig.maxPositionSizeUSD', 'configured position limit remains authoritative');
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

// Genie/4JI must not instantiate a second Cryptara Monte Carlo authority.
requireText(genie, "ensureCryptaraBeamWiring", 'Genie imports canonical Cryptara Beam wiring');
requireText(genie, 'this.cryptara = ensureCryptaraBeamWiring();', 'Genie initializes Cryptara through canonical Beam/QuantiComp authority');
forbidText(genie, 'this.cryptara = getCryptara();', 'Genie cannot initialize an un-wired Cryptara singleton');
requireText(beam, 'ensureAuthoritativeMonteCarloWiring()', 'Beam route remains backed by authoritative MC');
requireText(beam, 'EVIDENCE_INCOMPLETE: verified_opportunity_context', 'direct MC without verified opportunity context fails closed');

// Legacy shared readiness must remain truthful even when reached by compatibility callers.
requireText(executionIndex, 'normalizePrivateKey(process.env.FLASHBOTS_AUTH_KEY)', 'Flashbots readiness requires explicit auth material');
forbidText(executionIndex, 'flashbotsAuthConfigured = rpcConfigured', 'RPC configuration cannot impersonate Flashbots authentication');
requireText(executionIndex, 'const liveCentralizedReady = !noExecutionGuardEnabled', 'centralized readiness honors the execution kill guard');
requireText(executionIndex, '!noExecutionGuardEnabled &&\n    liveExecutionEnabled', 'on-chain readiness honors the execution kill guard');

// Canonical CEX execution must preserve venue-legal precision through one settlement authority.
requireText(cexExecutor, 'createProductionCexSettlementAdapters()', 'canonical executor instantiates the single production CEX settlement authority');
forbidText(cexExecutor, 'constrained-production-cex-adapters', 'canonical executor cannot depend on a duplicate CEX submit wrapper');
requireText(cexSettlement, "from './cex-order-serialization.js'", 'production CEX settlement consumes the canonical decimal serializer');
requireText(cexSettlement, 'cexDecimalString(request.price)', 'production CEX order prices use canonical decimal serialization');
requireText(cexSettlement, 'cexDecimalString(request.quantity)', 'production CEX order quantities use canonical decimal serialization');
forbidText(cexSettlement, 'toFixed(12)', 'production CEX submission cannot reintroduce a hidden 12-decimal cap');
forbidText(cexSerialization, 'toFixed(', 'canonical CEX decimal serialization cannot impose a fixed precision cap');

console.log('CryptoCrawler clean-house authority extension verification passed.');
