import assert from 'node:assert/strict';

process.env.CRYPTARA_HYPER_MC_WORKERS = '2';
process.env.CRYPTARA_HYPER_MC_MIN_SAMPLES = '64';
process.env.CRYPTARA_HYPER_MC_MAX_SAMPLES = '64';
process.env.CRYPTARA_HYPER_MC_BATCH_SIZE = '64';

const {
  estimateHyperMonteCarloParallelism,
  runHyperMonteCarlo,
  shutdownHyperMonteCarloWorkers,
} = await import('./monte-carlo-hyper-engine.js');
const { quantiParallelismGovernor } = await import('../../quantiComp/index.js');

function request(observedAt = Date.now()) {
  return {
    opportunityId: 'verify-hyper-quanti',
    observedAt,
    symbol: 'ETHUSDT',
    mode: 'live' as const,
    notionalUsd: 100,
    requestedNotionalUsd: 100,
    executableNotionalUsd: 100,
    netProfitUsd: 1,
    grossProfitUsd: 2,
    totalCostsUsd: 1,
    gasUsd: 0,
    expectedSlippageBps: 1,
    expectedPriceImpactBps: 1,
    quoteAgeMs: 0,
    quoteMaxAgeMs: 5_000,
    liquidityScore: 1,
    annualizedVolatility: 0.5,
    gasVolatility: 0,
    successPrior: 0.8,
    calibrationSamples: 3,
    measuredLatenciesMs: [10, 12, 11],
    measuredSlippageBps: [1, 1.1, 0.9],
    technicalProvenance: 'live',
    technicalAgeMs: 10,
    technicalMaxAgeMs: 300_000,
    feeEvidenceMeasured: true,
    liquidityMeasured: true,
    priceHistoryMeasured: true,
    onchainTelemetryRequired: false,
    onchainTelemetryMeasured: true,
  };
}

assert.equal(estimateHyperMonteCarloParallelism('live'), 1);
const result = await runHyperMonteCarlo(request());
assert.equal(result.iterations, 64);
assert.equal(result.workersUsed, 1);
assert.equal(result.modelVersion, 'cryptara-hyper-mc-1.1.0');
assert.equal(quantiParallelismGovernor.getStatus().activeUnits, 0);
assert.ok(quantiParallelismGovernor.getStatus().grantedReservations >= 1);

await assert.rejects(
  runHyperMonteCarlo(request(Date.now() - 6_000)),
  /EVIDENCE_INCOMPLETE: fresh_verified_quote/,
);

await shutdownHyperMonteCarloWorkers();
console.log('Hyper Monte Carlo Quanti admission verification passed');
