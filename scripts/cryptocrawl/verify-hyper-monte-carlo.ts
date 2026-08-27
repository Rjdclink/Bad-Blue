import assert from 'node:assert/strict';
import {
  HYPER_MONTE_CARLO_MODEL_VERSION,
  runHyperMonteCarlo,
  shutdownHyperMonteCarloWorkers,
  type HyperMonteCarloRequest,
} from '../../server/services/cryptocrawl/validation/monte-carlo-hyper-engine.js';
import { RuntimeConfidenceBootstrapCounter } from '../../server/services/cryptocrawl/validation/runtime-confidence-bootstrap.js';
import type { CryptaraExecutionFeedback } from '../../server/services/cryptara/index.js';

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

function feedback(
  index: number,
  options: { success?: boolean; realizedProfitUsd?: number; settlementConfirmed?: boolean } = {},
): CryptaraExecutionFeedback {
  const success = options.success ?? true;
  const realizedProfitUsd = options.realizedProfitUsd ?? 0.25;
  const settlementConfirmed = options.settlementConfirmed ?? true;
  return {
    source: 'master_pipeline',
    opportunityId: `confidence-${index}`,
    chain: 'ethereum',
    symbol: 'ETHUSDT',
    strategy: 'verified-arbitrage-hyper-bootstrap',
    success,
    expectedProfitUsd: 0.3,
    realizedProfitUsd,
    feeUsd: 0.01,
    slippageBps: 1,
    latencyMs: 25 + index,
    usedZeroCapital: false,
    timestamp: 1_787_800_000_000 + index,
    settlementStatus: 'filled',
    settlementConfirmed,
    settlement: {
      status: 'filled',
      terminal: true,
      settlementConfirmed,
      submittedAt: 1_787_799_999_000 + index,
      settledAt: 1_787_800_000_000 + index,
      venueOrRoute: 'kraken-okx',
      chain: 'ethereum',
      predicted: { profitUsd: 0.3, feeUsd: 0.01, slippageBps: 1 },
      realized: {
        acquisitionCostUsd: 100,
        proceedsUsd: 100 + realizedProfitUsd,
        exchangeFeeUsd: 0.01,
        gasUsd: 0,
        gasUsed: null,
        effectiveGasPriceWei: null,
        slippageBps: 1,
        netProfitUsd: realizedProfitUsd,
      },
      provenance: ['verification'],
      transactionHash: `0x${index.toString(16).padStart(64, '0')}`,
    },
  };
}

function verifyRuntimeConfidenceBootstrap(): void {
  const counter = new RuntimeConfidenceBootstrapCounter(10);
  for (let index = 1; index <= 9; index += 1) counter.record(feedback(index));

  assert.equal(counter.getStatus().successfulTrades, 9);
  assert.equal(counter.getStatus().confidenceEnabled, false, 'confidence must remain disabled through nine successful settled trades');
  assert.equal(counter.getStatus().state, 'bootstrap');

  counter.record(feedback(1));
  counter.record(feedback(40, { success: false, realizedProfitUsd: -0.2 }));
  counter.record(feedback(41, { success: true, realizedProfitUsd: -0.1 }));
  counter.record(feedback(42, { success: true, settlementConfirmed: false }));
  assert.equal(counter.getStatus().successfulTrades, 9, 'duplicates, losses and unconfirmed settlements must not advance confidence');

  counter.record(feedback(10));
  const calibrated = counter.getStatus();
  assert.equal(calibrated.successfulTrades, 10);
  assert.equal(calibrated.confidenceEnabled, true, 'confidence must become authoritative at the tenth successful settled trade');
  assert.equal(calibrated.remainingSuccessfulTrades, 0);
  assert.equal(calibrated.state, 'calibrated');

  const restarted = new RuntimeConfidenceBootstrapCounter(10);
  assert.equal(restarted.getStatus().successfulTrades, 0, 'restart bootstrap counter must not be hydrated from historical execution data');
  assert.equal(restarted.getStatus().confidenceEnabled, false, 'confidence must restart disabled');
}

async function main(): Promise<void> {
  verifyRuntimeConfidenceBootstrap();

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
    runtimeConfidenceThreshold: 10,
    restartConfidenceReset: true,
  });
}

void main().catch(async error => {
  console.error(error);
  await shutdownHyperMonteCarloWorkers();
  process.exitCode = 1;
});
