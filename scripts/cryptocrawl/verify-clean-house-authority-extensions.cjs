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

// Profit magnitude must never be an execution ceiling.
requireText(riskGovernor, 'profitCeilingAuthority: false', 'RiskGovernor declares no profit-ceiling authority');
forbidText(riskGovernor, 'currentDailyProfit >=', 'RiskGovernor cannot block after a daily profit ceiling');
forbidText(riskGovernor, 'Trade would exceed daily profit limit', 'RiskGovernor cannot reject profitable trades for exceeding a target');
forbidText(riskGovernor, 'profitRatio > 0.5', 'RiskGovernor cannot impose a hidden 50% ROI ceiling');
forbidText(riskGovernor, 'positionRatio > 0.95', 'RiskGovernor cannot add a hidden position-size ceiling below the configured maximum');
requireText(riskGovernor, 'proposal.positionSizeUSD > stageConfig.maxPositionSizeUSD', 'configured position limit remains authoritative');
requireText(riskGovernor, "this.circuitBreakers.set('daily-loss'", 'loss-side safety circuit breaker remains');
requireText(riskGovernor, 'evidence!.expectedProfit > 0', 'Monte Carlo risk still requires positive expected economics');

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

console.log('CryptoCrawler clean-house authority extension verification passed.');
