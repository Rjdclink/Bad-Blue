import assert from 'node:assert/strict';
import {
  assessAriesVault,
  chooseAriesRobustRoute,
  computeAriesCounterfactualRegret,
  computeAriesExpectedValueOfInformation,
  computeAriesLiquidityEventHorizon,
  computeAriesNovelty,
  evaluateAriesExecutionEconomics,
  evaluateAriesStateLattice,
  isAriesMakerRecoveryPath,
  projectAriesTierState,
  rankAriesBeam,
  scoreAriesCapitalLocations,
  walkAriesBook,
} from '../intelligence/aries-vault.js';
import { computeCexEconomicBarrier } from '../discovery/cex-economic-barrier-policy.js';

// 1. Regression found in live diagnostics: a volatile Kraken/OKX route must be
// recognized as an installed maker-recovery candidate, not stablecoin-only.
assert.equal(isAriesMakerRecoveryPath('TRUMPUSDT', 'kraken', 'okx'), true);
assert.equal(isAriesMakerRecoveryPath('TRUMPUSDT', 'coinbase', 'okx'), false);
const barrier = computeCexEconomicBarrier({
  observedAt: Date.now(),
  symbol: 'TRUMPUSDT',
  buyVenue: 'kraken',
  sellVenue: 'okx',
  grossSpreadBps: 68.49315068493073,
  buyTakerFeeBps: 65,
  sellTakerFeeBps: 50,
  netSpreadAfterFeesBps: -46.506849315069275,
  coverageFraction: 1,
  buyEffectiveMakerFeeBps: 30,
  sellEffectiveMakerFeeBps: 30,
});
assert.equal(barrier.status, 'fee_blocked');
assert.equal(barrier.makerObservation.economicallyPositive, true);
assert.equal(barrier.makerObservation.candidatePathAvailable, true);
assert.ok((barrier.makerObservation.grossMinusMakerFeesBps || 0) > 8.49);
assert.equal(barrier.makerObservation.executable, false);

// 2. Dynamic tier state: no intentional loss unless conservative future savings
// actually exceed the loss and the projected volume can cross the boundary.
const tierNo = projectAriesTierState({
  rollingNotionalUsd: 90_000,
  windowDays: 30,
  expectedFutureNotionalUsd: 20_000,
  horizonDays: 5,
  intentionalCurrentLossUsd: 100,
  uncertaintyHaircut: 0.25,
  tiers: [
    { name: 'base', minRollingNotionalUsd: 0, makerFeeBps: 30, takerFeeBps: 50 },
    { name: 'vip1', minRollingNotionalUsd: 100_000, makerFeeBps: 20, takerFeeBps: 40 },
  ],
});
assert.equal(tierNo.projectedTier?.name, 'vip1');
assert.equal(tierNo.mayEconomicallyAccelerateTier, false);

const tierYes = projectAriesTierState({
  rollingNotionalUsd: 90_000,
  windowDays: 30,
  expectedFutureNotionalUsd: 1_000_000,
  horizonDays: 30,
  intentionalCurrentLossUsd: 100,
  uncertaintyHaircut: 0.10,
  tiers: [
    { name: 'base', minRollingNotionalUsd: 0, makerFeeBps: 30, takerFeeBps: 50 },
    { name: 'vip1', minRollingNotionalUsd: 100_000, makerFeeBps: 10, takerFeeBps: 20 },
  ],
});
assert.equal(tierYes.mayEconomicallyAccelerateTier, true);
assert.ok(tierYes.expectedValueOfTierTransitionUsd > 0);

// 3. Adaptive hybrid routing remains continuous when taker participation is
// allowed, but hard post-only constraints force taker share to zero.
const hybrid = evaluateAriesExecutionEconomics({
  grossSpreadBps: 90,
  makerFeeBps: 20,
  takerFeeBps: 35,
  makerFillProbability: 0.45,
  adverseSelectionBps: 4,
  makerOpportunityCostBps: 20,
  takerImpactBps: 3,
  latencyMs: 20,
  spreadHalfLifeMs: 250,
  urgency: 0.8,
  allowTaker: true,
});
assert.ok(hybrid.crossoverTakerShare > 0 && hybrid.crossoverTakerShare < 1);
const postOnly = evaluateAriesExecutionEconomics({ ...{
  grossSpreadBps: 90,
  makerFeeBps: 20,
  takerFeeBps: 35,
  makerFillProbability: 0.45,
  adverseSelectionBps: 4,
  makerOpportunityCostBps: 20,
  takerImpactBps: 3,
  latencyMs: 20,
  spreadHalfLifeMs: 250,
  urgency: 0.8,
}, allowTaker: false });
assert.equal(postOnly.crossoverTakerShare, 0);

// 4. Walking the book measures real capacity/impact rather than top-of-book only.
const walk = walkAriesBook([
  { price: 100, quantity: 1 },
  { price: 101, quantity: 2 },
], 2, 100);
assert.equal(walk.complete, true);
assert.equal(walk.filledQuantity, 2);
assert.ok(walk.averagePrice > 100);
assert.ok(walk.impactBps > 0);

// 5. Event-driven attention/topology proxy reacts to structural change.
const novelty = computeAriesNovelty(
  { spreadBps: 80, bidDepthUsd: 10_000, askDepthUsd: 8_000, imbalance: 0.7, cancelRate: 0.6, providerDispersionBps: 50, mempoolPressure: 0.8, observedAt: 1_100 },
  { spreadBps: 20, bidDepthUsd: 50_000, askDepthUsd: 48_000, imbalance: 0.1, cancelRate: 0.1, providerDispersionBps: 10, mempoolPressure: 0.1, observedAt: 1_000 },
);
assert.equal(novelty.spike, true);
assert.ok(novelty.topologyProxy > 0);

// 6. Probabilistic state lattice, evolutionary beam, capital efficiency and
// game-theoretic minimax-regret routing are deterministic and conservative.
const lattice = evaluateAriesStateLattice([
  { probability: 0.7, payoffBps: 40 },
  { probability: 0.3, payoffBps: -20, tailLossBps: 20 },
]);
assert.ok(lattice.expectedBps > 0);
assert.ok(lattice.riskAdjustedBps < lattice.expectedBps);

const beam = rankAriesBeam([
  { id: 'a', expectedRealizedBps: 30, expectedProfitUsd: 30, tailRiskUsd: 25 },
  { id: 'b', expectedRealizedBps: 20, expectedProfitUsd: 25, futureFeeTierValueUsd: 10, tailRiskUsd: 2 },
], 1);
assert.equal(beam[0].id, 'b');

const capital = scoreAriesCapitalLocations([
  { venue: 'A', expectedOpportunityYieldBps: 80, feeDragBps: 30, rebalanceCostBps: 10, transferLatencyCostBps: 5, idleCapitalPenaltyBps: 2 },
  { venue: 'B', expectedOpportunityYieldBps: 70, feeDragBps: 10, rebalanceCostBps: 2, transferLatencyCostBps: 1, idleCapitalPenaltyBps: 1 },
]);
assert.equal(capital[0].venue, 'B');

const robust = chooseAriesRobustRoute([
  { routeId: 'fragile', scenarioNetBps: [100, -50, 110] },
  { routeId: 'robust', scenarioNetBps: [35, 30, 40] },
]);
assert.equal(robust?.routeId, 'robust');

// 7. Counterfactual regret and value of information remain measurable.
assert.equal(computeAriesCounterfactualRegret(20, [10, 35, 15]), 15);
assert.equal(computeAriesExpectedValueOfInformation(20, 40, 0.5), 10);

// 8. Liquidity event horizon stops at the first marginally unprofitable size.
assert.equal(computeAriesLiquidityEventHorizon({
  candidateNotionalsUsd: [10, 100, 1_000, 10_000],
  expectedNetBpsAtNotional: notional => notional <= 1_000 ? 15 : -2,
}), 1_000);

// 9. Critical unknown costs fail closed and Aries never grants execution authority.
const unknown = assessAriesVault({
  symbol: 'TRUMPUSDT',
  notionalUsd: 100,
  execution: {
    grossSpreadBps: 68.49,
    makerFeeBps: 60,
    takerFeeBps: 115,
    makerFillProbability: 0.8,
    adverseSelectionBps: 0,
    makerOpportunityCostBps: 0,
    takerImpactBps: 0,
    latencyMs: 0,
    spreadHalfLifeMs: 1_000,
    urgency: 0,
    allowTaker: false,
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
  probabilisticStateLattice: true,
  evolutionaryBeam: true,
  marginalCapitalEfficiency: true,
  minimaxRegretRouting: true,
  counterfactualLearning: true,
  valueOfInformation: true,
  liquidityEventHorizon: true,
  criticalUnknownCostsFailClosed: true,
  executionAuthority: false,
}, null, 2));
