import assert from 'node:assert/strict';
import { chooseMakerOrTaker } from '../../server/services/cryptocrawl/execution/maker-taker-policy.js';

const immediate = chooseMakerOrTaker({
  takerNetProfitUsd: 0.01,
  makerNetProfitUsd: 0.20,
  makerFillProbability: 0.9,
  makerAdverseSelectionReserveUsd: 0.01,
  postOnlySupported: true,
  hedgeOnFillSupported: true,
  makerFeeEvidenceAvailable: true,
  takerFeeEvidenceAvailable: true,
  executableDepthMeasured: true,
  spreadBps: 20,
  volatilityScore: 0.9,
});
assert.equal(immediate.style, 'taker_ioc');
assert.equal(immediate.authoritativeNetProfitUsd, 0.01);

const makerSalvage = chooseMakerOrTaker({
  takerNetProfitUsd: -0.02,
  makerNetProfitUsd: 0.10,
  makerFillProbability: 0.8,
  makerAdverseSelectionReserveUsd: 0.02,
  postOnlySupported: true,
  hedgeOnFillSupported: true,
  makerFeeEvidenceAvailable: true,
  takerFeeEvidenceAvailable: true,
  executableDepthMeasured: true,
  spreadBps: 8,
  volatilityScore: 0.2,
  recentSettledWinRate: 0.4,
});
assert.equal(makerSalvage.style, 'maker_then_taker_hedge');
assert.ok((makerSalvage.makerExpectedValueUsd || 0) > 0);

const unsafeMaker = chooseMakerOrTaker({
  takerNetProfitUsd: -0.02,
  makerNetProfitUsd: 1,
  makerFillProbability: 0.9,
  makerAdverseSelectionReserveUsd: 0.01,
  postOnlySupported: true,
  hedgeOnFillSupported: false,
  makerFeeEvidenceAvailable: true,
  takerFeeEvidenceAvailable: true,
  executableDepthMeasured: true,
  spreadBps: 5,
  volatilityScore: 0.1,
});
assert.equal(unsafeMaker.style, 'reject');
assert.ok(unsafeMaker.reasons.some(reason => reason.includes('hedge')));

const rankOrStreakCannotBlockProfit = chooseMakerOrTaker({
  takerNetProfitUsd: 100,
  makerNetProfitUsd: null,
  makerFillProbability: null,
  makerAdverseSelectionReserveUsd: null,
  postOnlySupported: false,
  hedgeOnFillSupported: false,
  makerFeeEvidenceAvailable: false,
  takerFeeEvidenceAvailable: true,
  executableDepthMeasured: true,
  spreadBps: 1,
  volatilityScore: 1,
  recentSettledWinRate: 0,
});
assert.equal(rankOrStreakCannotBlockProfit.style, 'taker_ioc');
assert.equal(rankOrStreakCannotBlockProfit.authoritativeNetProfitUsd, 100);

console.log('maker-taker-policy:pass');
