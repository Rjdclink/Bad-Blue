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
const execution = read('server/services/cryptocrawl/execution/index.ts');
const parallelLanes = read('server/services/cryptocrawl/intelligence/parallel-lanes.ts');
const envExample = read('.env.railway.example');

requireText(telemetry, "alchemyIntegration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'])", 'Alchemy enhanced telemetry starts on supported networks');
requireText(telemetry, "ethereum: 'https://rpc.ankr.com/eth'", 'keyless Ankr Ethereum fallback is registered');
requireText(telemetry, "polygon: 'https://rpc.ankr.com/polygon'", 'keyless Ankr Polygon fallback is registered');
requireText(telemetry, 'multiProviderRpcManager.initialize(TELEMETRY_CHAINS)', 'shared RPC manager initializes before optional providers');
requireText(telemetry, 'Ankr fallback probe completed', 'Ankr health outcome is visible without exposing secrets');
requireText(telemetry, 'probeReadOnlyZeroX()', '0x authentication and price path is actively health-probed');
requireText(telemetry, 'CoinStats credential resolution', 'CoinStats credential-name resolution is observable without logging the key');
requireText(telemetry, "COIN_STATS_API_KEY", 'CoinStats legacy environment alias is normalized');

requireText(gates, 'const evaluation = super.evaluate(enrichedContext, config);', 'deterministic gate evaluates before AI/ML evidence');
requireText(gates, 'signals: [...evaluation.signals, mlAssessment.signal]', 'AI/ML score is appended as evidence only');
requireText(gates, ': arbitrageVerifier.getBestCrossVenueFeeContext();', 'generic Stage 1 market-cycle gate consumes fresh measured cross-venue fee evidence');
requireText(gates, 'timeOfDay: context.timeOfDay ?? { utcHour: new Date().getUTCHours() }', 'known UTC time is not reported as unknown');
requireText(ml, 'advisoryOnly: true', 'AI/ML signal is explicitly advisory');
requireText(progression, 'reevaluateLastMarketGate()', 'Stage 1 stale fee evidence is reevaluated');
requireText(progression, 'stageManager.getState().currentStage !== 1', 'Stage 1 reevaluation is scoped to bootstrap stage');
requireText(progression, 'opportunityMlRanker.observeExecution', 'AI/ML learns only from terminal execution feedback path');

requireText(faucet, 'stageManager.canExecuteTrades()', 'canonical stage execution gate remains present');
requireText(faucet, 'netProfitUsd', 'verified net-profit economics remain present');
requireText(execution, "process.env.NO_EXECUTION === 'true'", 'emergency NO_EXECUTION kill switch remains available');
requireText(envExample, 'NO_EXECUTION=false', 'authorized production template does not permanently disable execution');
requireText(envExample, 'CRYPTO_ARBITRAGE_LIVE_EXECUTION=false', 'repository example does not silently authorize live orders');

// The legacy parallel intelligence implementation still contains simulated/random
// observations. Keep it disconnected from authoritative execution until those producers
// are replaced by measured CEX/RPC/mempool inputs.
requireText(parallelLanes, 'Math.random()', 'legacy parallel lanes are recognized as synthetic and must not be treated as measured evidence');
forbidText(telemetry, 'sixCaneSystem.start()', 'telemetry bootstrap must not activate synthetic Six-Cane intelligence');
forbidText(gates, 'decision: mlAssessment', 'AI/ML cannot replace the deterministic market-gate decision');
forbidText(ml, 'executeVerifiedArbitragePlan', 'AI/ML model has no execution authority');

console.log('Telemetry / AI-ML / three-pass non-regression verification passed.');
