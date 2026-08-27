import assert from 'node:assert/strict';
import {
  computeCexEconomicBarrier,
  unknownCexEconomicBarrier,
} from '../../server/services/cryptocrawl/discovery/cex-economic-barrier-policy.js';

const devastating = computeCexEconomicBarrier({
  observedAt: Date.now(),
  symbol: 'BTCUSDT',
  buyVenue: 'kraken',
  sellVenue: 'okx',
  grossSpreadBps: 7,
  buyTakerFeeBps: 80,
  sellTakerFeeBps: 35,
  netSpreadAfterFeesBps: -108,
  coverageFraction: 1,
  buyEffectiveMakerFeeBps: 20,
  sellEffectiveMakerFeeBps: 10,
});
assert.equal(devastating.status, 'fee_blocked');
assert.equal(devastating.combinedTakerFeeBps, 115);
assert.equal(devastating.netSpreadAfterTakerFeesBps, -108);
assert.equal(devastating.feeReductionNeededBps, 108);
assert.equal(devastating.maxCombinedTakerFeeForFeeOnlyBreakEvenBps, 7);
assert.equal(devastating.executionFeeMode, 'taker_ioc');
assert.equal(devastating.makerObservation.available, true);
assert.equal(devastating.makerObservation.combinedEffectiveMakerFeeBps, 30);
assert.equal(devastating.makerObservation.executable, false);
assert.match(devastating.makerObservation.reason, /settlement-proven/);

const clear = computeCexEconomicBarrier({
  observedAt: Date.now(),
  symbol: 'ETHUSDT',
  buyVenue: 'okx',
  sellVenue: 'kraken',
  grossSpreadBps: 20,
  buyTakerFeeBps: 4,
  sellTakerFeeBps: 6,
  netSpreadAfterFeesBps: 10,
  coverageFraction: 0.5,
  buyEffectiveMakerFeeBps: null,
  sellEffectiveMakerFeeBps: null,
});
assert.equal(clear.status, 'fee_clear');
assert.equal(clear.combinedTakerFeeBps, 10);
assert.equal(clear.feeReductionNeededBps, 0);
assert.equal(clear.makerObservation.available, false);
assert.equal(clear.makerObservation.executable, false);

const invalid = computeCexEconomicBarrier({
  observedAt: Date.now(),
  symbol: 'ETHUSDT',
  buyVenue: 'kraken',
  sellVenue: 'okx',
  grossSpreadBps: Number.NaN,
  buyTakerFeeBps: 80,
  sellTakerFeeBps: 35,
  netSpreadAfterFeesBps: Number.NaN,
  coverageFraction: 2,
  buyEffectiveMakerFeeBps: null,
  sellEffectiveMakerFeeBps: null,
});
assert.equal(invalid.status, 'unknown');
assert.equal(invalid.grossSpreadBps, null);
assert.equal(invalid.coverageFraction, 1);

const unknown = unknownCexEconomicBarrier(-1, Date.now());
assert.equal(unknown.status, 'unknown');
assert.equal(unknown.coverageFraction, 0);
assert.equal(unknown.executionFeeMode, 'taker_ioc');

console.log('CEX economic barrier policy verification passed');
