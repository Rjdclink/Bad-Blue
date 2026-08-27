import assert from 'node:assert/strict';

process.env.CRYPTARA_HYPER_MC_WORKERS = '2';
process.env.CRYPTARA_HYPER_MC_MIN_SAMPLES = '64';
process.env.CRYPTARA_HYPER_MC_MAX_SAMPLES = '64';
process.env.CRYPTARA_HYPER_MC_BATCH_SIZE = '64';

const {
  runHyperMonteCarlo,
  shutdownHyperMonteCarloWorkers,
} = await import('./monte-carlo-hyper-engine.js');
const { quantiDataFabric } = await import('../../quantiComp/index.js');

function request() {
  return {
    opportunityId: `verify-shared-${Date.now()}`,
    observedAt: Date.now(),
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

const first = await runHyperMonteCarlo(request());
assert.equal(first.iterations, 64);
assert.equal(quantiDataFabric.getStatus().activeLeases, 0);
const allocationsAfterFirst = quantiDataFabric.getStatus().allocations;

const second = await runHyperMonteCarlo(request());
assert.equal(second.iterations, 64);
const status = quantiDataFabric.getStatus();
assert.equal(status.activeLeases, 0);
assert.ok(status.reuses >= 1);
assert.equal(status.allocations, allocationsAfterFirst);

const controller = new AbortController();
controller.abort();
await assert.rejects(runHyperMonteCarlo(request(), controller.signal), /HYPER_ABORTED/);
assert.equal(quantiDataFabric.getStatus().activeLeases, 0);

await shutdownHyperMonteCarloWorkers();
console.log('Hyper shared Quanti data fabric verification passed');
