import assert from 'node:assert/strict';
import {
  orderMeasuredMarketUniverse,
  rankMeasuredMarketUniverse,
  resetMarketUniverseRotationForTest,
  setMarketUniversePerformanceProvider,
} from '../../server/services/cryptocrawl/discovery/market-universe-controller.js';
import { recommendedCexScanIntervalMs } from '../../server/services/cryptocrawl/discovery/scan-capacity-policy.js';

const observedAt = Date.now();
const assets = [
  { symbol: 'ETHUSDT', volume24hUsd: 1_000_000, marketCapUsd: 10_000_000, marketCapRank: 10, observedAt },
  { symbol: 'SOLUSDT', volume24hUsd: 1_000_000, marketCapUsd: 10_000_000, marketCapRank: 10, observedAt },
  { symbol: 'AVAXUSDT', volume24hUsd: 1_000_000, marketCapUsd: 10_000_000, marketCapRank: 10, observedAt },
  { symbol: 'LINKUSDT', volume24hUsd: 1_000_000, marketCapUsd: 10_000_000, marketCapRank: 10, observedAt },
];

setMarketUniversePerformanceProvider(() => new Map([
  ['ETHUSDT', {
    symbol: 'ETHUSDT',
    sampleCount: 20,
    successRate: 0.9,
    averageRealizedProfitUsd: 3,
    averageSlippageBps: 2,
  }],
  ['SOLUSDT', {
    symbol: 'SOLUSDT',
    sampleCount: 20,
    successRate: 0.2,
    averageRealizedProfitUsd: -2,
    averageSlippageBps: 18,
  }],
]));

const ranked = rankMeasuredMarketUniverse(assets);
assert.equal(ranked.length, 4, 'performance focus must never delete exploration symbols');
assert.equal(ranked[0].symbol, 'ETHUSDT', 'terminal-positive pair should win an otherwise equal quality tie');
assert.ok(ranked.some(asset => asset.symbol === 'SOLUSDT'), 'historically weak pair must remain discoverable');
assert.ok(ranked.some(asset => asset.symbol === 'AVAXUSDT'), 'unseen pair must remain discoverable');

resetMarketUniverseRotationForTest();
const rotatedOne = orderMeasuredMarketUniverse(assets);
const rotatedTwo = orderMeasuredMarketUniverse(assets);
assert.deepEqual(new Set(rotatedOne.map(asset => asset.symbol)), new Set(assets.map(asset => asset.symbol)));
assert.deepEqual(new Set(rotatedTwo.map(asset => asset.symbol)), new Set(assets.map(asset => asset.symbol)));
assert.equal(rotatedOne[0].symbol, 'ETHUSDT', 'best terminal performer should remain in the bounded focus prefix');
assert.equal(rotatedTwo[0].symbol, 'ETHUSDT', 'focus prefix should remain stable while the exploration tail rotates');
assert.notDeepEqual(rotatedOne.slice(1).map(asset => asset.symbol), rotatedTwo.slice(1).map(asset => asset.symbol), 'non-focus pairs must continue rotating');

const cadenceInput = {
  configuredMinimum: 12,
  configuredMaximum: 96,
  minimumIntervalMs: 2_000,
  baseIntervalMs: 5_000,
  maximumIntervalMs: 15_000,
};
assert.equal(recommendedCexScanIntervalMs({
  ...cadenceInput,
  positiveDensity: 1,
  eligibleDensity: 0,
  searchDensity: 50,
  feeBlockedWithCoverage: false,
}), 2_000, 'verified-positive flow should use the fastest bounded discovery cadence');
assert.equal(recommendedCexScanIntervalMs({
  ...cadenceInput,
  positiveDensity: 0,
  eligibleDensity: 0,
  searchDensity: 5,
  feeBlockedWithCoverage: false,
}), 3_000, 'poor coverage should speed discovery without exceeding the minimum cadence');
assert.equal(recommendedCexScanIntervalMs({
  ...cadenceInput,
  positiveDensity: 0,
  eligibleDensity: 0,
  searchDensity: 50,
  feeBlockedWithCoverage: true,
}), 10_000, 'a measured fee-blocked regime should conserve discovery compute but never stop scanning');
assert.equal(recommendedCexScanIntervalMs({
  ...cadenceInput,
  positiveDensity: 0,
  eligibleDensity: 0,
  searchDensity: 250,
  feeBlockedWithCoverage: false,
}), 7_500, 'already-high search density should reduce repeated polling pressure');

setMarketUniversePerformanceProvider(null);
resetMarketUniverseRotationForTest();
console.log('market-focus-and-cadence:pass');
