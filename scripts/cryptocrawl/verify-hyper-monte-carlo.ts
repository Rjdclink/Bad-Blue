import assert from 'node:assert/strict';
import {
  HYPER_MONTE_CARLO_MODEL_VERSION,
  runHyperMonteCarlo,
  shutdownHyperMonteCarloWorkers,
  type HyperMonteCarloRequest,
} from '../../server/services/cryptocrawl/validation/monte-carlo-hyper-engine.js';

const base: HyperMonteCarloRequest = {
  opportunityId: 'verify-ETHUSDT',
  observedAt: 1_787_791_631_000,
  symbol: 'ETHUSDT',
  mode: 'live',
  notionalUsd: 100,
  requestedNotionalUsd: 100,
  executableNotionalUsd: 100,
  netProfitUsd: 0.8,
  grossProfitUsd: 1.5,
  totalCostsUsd: 0.7,
  gasUsd: 0,
  expectedSlippageBps: 2,
  expectedPriceImpactBps: 1.5,
  quoteAgeMs: 150,
  quoteMaxAgeMs: 5_000,
  liquidityScore: 1,
  annualizedVolatility: 0.8,
  gasVolatility: 0,
  successPrior: 0.85,
  calibrationSamples: 12,
  measuredLatenciesMs: [35, 42, 30, 55, 38],
  measuredSlippageBps: [1.5, 2, 2.5, 1.8],
  technicalProvenance: 'cached',
  technicalAgeMs: 45_000,
  technicalMaxAgeMs: 300_000,
  feeEvidenceMeasured: true,
  liquidityMeasured: true,
  priceHistoryMeasured: true,
  onchainTelemetryRequired: false,
  onchainTelemetryMeasured: false,
};

async function main(): Promise<void> {
  const first = await runHyperMonteCarlo(base);
  const replay = await runHyperMonteCarlo(base);

  assert.equal(first.modelVersion, HYPER_MONTE_CARLO_MODEL_VERSION);
  assert.equal(first.seed, replay.seed, 'same snapshot must derive the same seed');
  assert.equal(first.iterations, replay.iterations, 'same snapshot must use the same adaptive path count');
  assert.equal(first.expectedProfitUsd, replay.expectedProfitUsd, 'same snapshot must replay deterministically');
  assert.ok(first.iterations >= 64 && first.iterations <= 2_048, 'live path budget must stay bounded');
  assert.ok(first.workersUsed >= 1, 'CPU worker execution must be active');
  assert.ok(!first.missingInformation.includes('live_technical_analysis'), 'cached technical data cannot be a binary availability failure');

  const [eth, btc, bnb] = await Promise.all([
    runHyperMonteCarlo({ ...base, opportunityId: 'verify-eth', observedAt: 101 }),
    runHyperMonteCarlo({ ...base, opportunityId: 'verify-btc', observedAt: 102, netProfitUsd: -0.2 }),
    runHyperMonteCarlo({
      ...base,
      opportunityId: 'verify-bnb',
      observedAt: 103,
      calibrationSamples: 0,
      measuredLatenciesMs: [],
      measuredSlippageBps: [],
      technicalProvenance: 'deterministic-fallback',
    }),
  ]);
  assert.notEqual(eth.seed, btc.seed, 'concurrent opportunities require independent deterministic streams');
  assert.notEqual(btc.seed, bnb.seed, 'concurrent opportunities require independent deterministic streams');
  assert.ok(btc.expectedProfitUsd < eth.expectedProfitUsd, 'negative verified economics must not be manufactured into stronger economics');
  assert.ok(bnb.missingInformation.includes('posttrade_calibration_pending'), 'cold-start calibration limitations must remain explicit');

  await assert.rejects(
    () => runHyperMonteCarlo({ ...base, quoteAgeMs: 6_000 }),
    /EVIDENCE_INCOMPLETE: fresh_verified_quote/,
    'stale executable quotes must fail closed',
  );

  const training = await runHyperMonteCarlo({ ...base, opportunityId: 'verify-training', observedAt: 104, mode: 'training' });
  assert.equal(training.mode, 'training');
  assert.ok(training.iterations >= first.iterations, 'deep/training mode must not use a smaller evidence budget than the live decision path');

  await shutdownHyperMonteCarloWorkers();

  console.log('Hyper Monte Carlo verification passed', {
    modelVersion: first.modelVersion,
    liveIterations: first.iterations,
    liveElapsedMs: first.elapsedMs,
    workersUsed: first.workersUsed,
    probabilityOfProfit: first.probabilityOfProfit,
    trainingIterations: training.iterations,
    cachedTechnicalAccepted: true,
    staleQuoteRejected: true,
    deterministicReplay: true,
    concurrentIsolation: true,
  });
}

void main().catch(async error => {
  console.error(error);
  await shutdownHyperMonteCarloWorkers();
  process.exitCode = 1;
});
