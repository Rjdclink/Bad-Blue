import assert from 'node:assert/strict';
import { evaluateFundingArbitrage } from '../../server/services/cryptocrawl/discovery/funding-arbitrage-policy.js';

const complete = evaluateFundingArbitrage({
  fundingRate: 0.002,
  notionalUsd: 1000,
  spotEntryFeeBps: 1,
  spotExitFeeBps: 1,
  perpEntryFeeBps: 2,
  perpExitFeeBps: 2,
  entryBasisBps: 1,
  exitBasisReserveBps: 2,
  expectedSlippageBps: 1,
  borrowCostUsd: 0,
  fundingRateLocked: true,
  shortSpotCapability: false,
});
assert.equal(complete.direction, 'long_spot_short_perp');
assert.equal(complete.supportedDirection, true);
assert.ok(complete.expectedFundingUsd !== null && complete.expectedFundingUsd > 0);
assert.ok(complete.deterministicNetProfitUsd !== null && complete.deterministicNetProfitUsd > 0);
assert.equal(complete.deterministicPositive, true);

const unlocked = evaluateFundingArbitrage({
  fundingRate: 0.002,
  notionalUsd: 1000,
  spotEntryFeeBps: 1,
  spotExitFeeBps: 1,
  perpEntryFeeBps: 2,
  perpExitFeeBps: 2,
  entryBasisBps: 1,
  exitBasisReserveBps: 2,
  expectedSlippageBps: 1,
  fundingRateLocked: false,
  shortSpotCapability: false,
});
assert.ok(unlocked.projectedNetProfitUsd !== null && unlocked.projectedNetProfitUsd > 0);
assert.equal(unlocked.deterministicNetProfitUsd, null);
assert.equal(unlocked.deterministicPositive, false);
assert.ok(unlocked.missingInformation.includes('locked_applicable_funding_rate'));

const negativeWithoutShortSpot = evaluateFundingArbitrage({
  fundingRate: -0.002,
  notionalUsd: 1000,
  spotEntryFeeBps: 1,
  spotExitFeeBps: 1,
  perpEntryFeeBps: 2,
  perpExitFeeBps: 2,
  entryBasisBps: 1,
  exitBasisReserveBps: 2,
  expectedSlippageBps: 1,
  borrowCostUsd: 0,
  fundingRateLocked: true,
  shortSpotCapability: false,
});
assert.equal(negativeWithoutShortSpot.direction, 'long_perp_short_spot');
assert.equal(negativeWithoutShortSpot.supportedDirection, false);
assert.equal(negativeWithoutShortSpot.deterministicNetProfitUsd, null);
assert.ok(negativeWithoutShortSpot.missingInformation.includes('short_spot_execution_capability'));

const unknownExitCost = evaluateFundingArbitrage({
  fundingRate: 0.01,
  notionalUsd: 1000,
  spotEntryFeeBps: 1,
  spotExitFeeBps: 1,
  perpEntryFeeBps: 1,
  perpExitFeeBps: 1,
  entryBasisBps: 0,
  exitBasisReserveBps: null,
  expectedSlippageBps: 0,
  fundingRateLocked: true,
  shortSpotCapability: false,
});
assert.equal(unknownExitCost.projectedNetProfitUsd, null);
assert.equal(unknownExitCost.deterministicNetProfitUsd, null);
assert.ok(unknownExitCost.missingInformation.includes('exit_basis_reserve_bps'));

console.log('funding-arbitrage-policy:pass');
