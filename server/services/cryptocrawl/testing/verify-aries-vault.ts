import assert from 'node:assert/strict';
import {
  assessAriesVault,
  chooseAriesRobustRoute,
  computeAriesCounterfactualRegret,
  computeAriesExpectedValueOfInformation,
  computeAriesLiquidityEventHorizon,
  computeAriesNovelty,
  evaluateAriesExecutionEconomics,
  isAriesMakerRecoveryPath,
  projectAriesTierState,
  rankAriesBeam,
  scoreAriesCapitalLocations,
  walkAriesBook,
} from '../intelligence/aries-vault.js';
import { computeCexEconomicBarrier } from '../discovery/cex-economic-barrier-policy.js';

// Live regression class: 68.49 gross / 115 taker / 60 maker.
assert.equal(isAriesMakerRecoveryPath('TRUMPUSDT', 'kraken', 'okx'), true);
const barrier = computeCexEconomicBarrier({
  observedAt: Date.now(), symbol: 'TRUMPUSDT', buyVenue: 'kraken', sellVenue: 'okx',
  grossSpreadBps: 68.49315068493073, buyTakerFeeBps: 65, sellTakerFeeBps: 50,
  netSpreadAfterFeesBps: -46.506849315069275, coverageFraction: 1,
  buyEffectiveMakerFeeBps: 30, sellEffectiveMakerFeeBps: 30,
});
assert.equal(barrier.status, 'fee_blocked');
assert.equal(barrier.makerObservation.economicallyPositive, true);
assert.equal(barrier.makerObservation.candidatePathAvailable, true);
assert.equal(barrier.makerObservation.executable, false);

// Tier acceleration is economic-value gated, never tier-label gated.
const tier = projectAriesTierState({
  rollingNotionalUsd: 90_000, windowDays: 30, expectedFutureNotionalUsd: 1_000_000,
  horizonDays: 30, intentionalCurrentLossUsd: 100, uncertaintyHaircut: 0.10,
  tiers: [
    { name: 'base', minRollingNotionalUsd: 0, makerFeeBps: 30, takerFeeBps: 50 },
    { name: 'vip1', minRollingNotionalUsd: 100_000, makerFeeBps: 10, takerFeeBps: 20 },
  ],
});
assert.equal(tier.projectedTier?.name, 'vip1');
assert.equal(tier.mayEconomicallyAccelerateTier, true);
assert.ok(tier.expectedValueOfTierTransitionUsd > 0);

// Crossover routing is continuous; post-only remains hard zero-taker.
const economicsBase = {
  grossSpreadBps: 90, makerFeeBps: 20, takerFeeBps: 35, makerFillProbability: 0.45,
  adverseSelectionBps: 4, makerOpportunityCostBps: 20, takerImpactBps: 3,
  latencyMs: 20, spreadHalfLifeMs: 250, urgency: 0.8,
};
const hybrid = evaluateAriesExecutionEconomics({ ...economicsBase, allowTaker: true });
const postOnly = evaluateAriesExecutionEconomics({ ...economicsBase, allowTaker: false });
assert.ok(hybrid.crossoverTakerShare > 0 && hybrid.crossoverTakerShare < 1);
assert.equal(postOnly.crossoverTakerShare, 0);

// Walking-book capacity sees price impact beyond top-of-book.
const walk = walkAriesBook([{ price: 100, quantity: 1 }, { price: 101, quantity: 2 }], 2, 100);
assert.equal(walk.complete, true);
assert.ok(walk.averagePrice > 100 && walk.impactBps > 0);

// Event-driven novelty spikes on structural changes.
const novelty = computeAriesNovelty(
  { spreadBps: 80, bidDepthUsd: 10_000, askDepthUsd: 8_000, imbalance: 0.7, cancelRate: 0.6, providerDispersionBps: 50, mempoolPressure: 0.8, observedAt: 1_100 },
  { spreadBps: 20, bidDepthUsd: 50_000, askDepthUsd: 48_000, imbalance: 0.1, cancelRate: 0.1, providerDispersionBps: 10, mempoolPressure: 0.1, observedAt: 1_000 },
);
assert.equal(novelty.spike, true);

// Beam selection prices future value and risks rather than headline BPS alone.
const beam = rankAriesBeam([
  { id: 'headline', expectedRealizedBps: 30, expectedProfitUsd: 30, tailRiskUsd: 25 },
  { id: 'horizon', expectedRealizedBps: 20, expectedProfitUsd: 25, futureFeeTierValueUsd: 10, tailRiskUsd: 2 },
], 1);
assert.equal(beam[0].id, 'horizon');

// Marginal capital efficiency can prefer the lower headline-yield venue.
const capital = scoreAriesCapitalLocations([
  { venue: 'A', expectedOpportunityYieldBps: 80, feeDragBps: 30, rebalanceCostBps: 10, transferLatencyCostBps: 5, idleCapitalPenaltyBps: 2 },
  { venue: 'B', expectedOpportunityYieldBps: 70, feeDragBps: 10, rebalanceCostBps: 2, transferLatencyCostBps: 1, idleCapitalPenaltyBps: 1 },
]);
assert.equal(capital[0].venue, 'B');

// Robust routing rejects a higher-average route with severe downside/regret.
const robust = chooseAriesRobustRoute([
  { routeId: 'fragile', scenarioNetBps: [100, -100, 110] },
  { routeId: 'robust', scenarioNetBps: [35, 30, 40] },
]);
assert.equal(robust?.routeId, 'robust');

assert.equal(computeAriesCounterfactualRegret(20, [10, 35, 15]), 15);
assert.equal(computeAriesExpectedValueOfInformation(20, 40, 0.5), 10);
assert.equal(computeAriesLiquidityEventHorizon({
  candidateNotionalsUsd: [10, 100, 1_000, 10_000],
  expectedNetBpsAtNotional: notional => notional <= 1_000 ? 15 : -2,
}), 1_000);

// Unknown critical costs fail closed; Aries recommendations are never execution authority.
const unknown = assessAriesVault({
  symbol: 'TRUMPUSDT', notionalUsd: 100,
  execution: {
    grossSpreadBps: 68.49, makerFeeBps: 60, takerFeeBps: 115, makerFillProbability: 0.8,
    adverseSelectionBps: 0, makerOpportunityCostBps: 0, takerImpactBps: 0,
    latencyMs: 0, spreadHalfLifeMs: 1_000, urgency: 0, allowTaker: false,
  },
  criticalUnknownCostBps: null,
});
assert.equal(unknown.action, 'abort');
assert.equal(unknown.executionAuthority, false);

console.log(JSON.stringify({
  ariesVault: 'verified',
  volatileMakerBarrierRegressionFixed: true,
  dynamicTierState: true,
  crossoverTakerShare: true,
  walkingBookCapacity: true,
  eventDrivenNovelty: true,
  evolutionaryBeam: true,
  marginalCapitalEfficiency: true,
  robustRouting: true,
  counterfactualLearning: true,
  valueOfInformation: true,
  liquidityEventHorizon: true,
  criticalUnknownCostsFailClosed: true,
  executionAuthority: false,
}, null, 2));
