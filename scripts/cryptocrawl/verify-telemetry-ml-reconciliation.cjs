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
const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const gates = read('server/services/cryptara/marketGates/index.ts');
const ml = read('server/services/cryptara/opportunity-ml-ranker.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');

requireText(telemetry, "alchemyIntegration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'])", 'Alchemy enhanced telemetry starts on supported networks');
requireText(telemetry, "ethereum: 'https://rpc.ankr.com/eth'", 'keyless Ankr Ethereum fallback is registered');
requireText(telemetry, "polygon: 'https://rpc.ankr.com/polygon'", 'keyless Ankr Polygon fallback is registered');
requireText(telemetry, 'multiProviderRpcManager.initialize(TELEMETRY_CHAINS)', 'shared RPC manager initializes before optional providers');
requireText(telemetry, 'probeReadOnlyZeroX()', '0x authentication and price path is actively health-probed');
requireText(telemetry, "COIN_STATS_API_KEY", 'CoinStats legacy environment alias is normalized');

requireText(gates, 'const evaluation = super.evaluate(enrichedContext, config);', 'deterministic gate evaluates before AI/ML evidence');
requireText(gates, 'signals: [...evaluation.signals, mlAssessment.signal]', 'AI/ML score is appended as evidence only');
requireText(ml, 'advisoryOnly: true', 'AI/ML signal is explicitly advisory');
requireText(progression, 'reevaluateLastMarketGate()', 'Stage 1 stale fee evidence is reevaluated');
requireText(progression, 'stageManager.getState().currentStage !== 1', 'Stage 1 reevaluation is scoped to bootstrap stage');
requireText(progression, 'opportunityMlRanker.observeExecution', 'AI/ML learns only from terminal execution feedback path');

requireText(faucet, 'stageManager.canExecuteTrades()', 'canonical stage execution gate remains present');
requireText(faucet, 'netProfitUsd', 'verified net-profit economics remain present');
forbidText(gates, 'decision: mlAssessment', 'AI/ML cannot replace the deterministic market-gate decision');
forbidText(ml, 'executeVerifiedArbitragePlan', 'AI/ML model has no execution authority');

console.log('Telemetry / AI-ML reconciliation verification passed.');
