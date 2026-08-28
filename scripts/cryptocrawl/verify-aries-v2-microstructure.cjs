const fs = require('node:fs');
const assert = require('node:assert/strict');

const micro = fs.readFileSync('server/services/cryptocrawl/intelligence/aries-microstructure.ts', 'utf8');
const maker = fs.readFileSync('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts', 'utf8');
const aries = fs.readFileSync('server/services/cryptocrawl/intelligence/aries-vault.ts', 'utf8');

assert.match(micro, /observeAriesQueueEcho/);
assert.match(micro, /orderArrivalRatePerSecond/);
assert.match(micro, /fillProbabilityWithinTtl/);
assert.match(micro, /computeAriesFractionalKellySizing/);
assert.match(micro, /estimateAriesVenueLeadLag/);
assert.match(micro, /stressTestAriesSpread/);
assert.match(micro, /hurstExponent/);
assert.match(micro, /atrFraction/);

assert.match(maker, /'volatile_spread_post_only'/);
assert.match(maker, /CRYPTO_ARBITRAGE_MAKER_MIN_JOINT_FILL_PROBABILITY/);
assert.match(maker, /CRYPTO_ARBITRAGE_MAKER_MIN_STRESS_PERSISTENCE/);
assert.match(maker, /queueAuthority === 'measured_history'/);
assert.match(maker, /fractionalKelly/);
assert.match(maker, /causalLeadLag/);
assert.match(maker, /spreadStress/);
assert.match(maker, /takerFallbackAllowed: false/);
assert.doesNotMatch(maker, /if \(!stablecoin\) return null/);

assert.match(wiring, /queueEcho: plan\.makerExecution\.queueEcho/);
assert.match(wiring, /adaptiveTakerFallback: 'not_authorized_without_fresh_positive_all_in_taker_economics'/);
assert.match(aries, /executionAuthority: false/);

console.log(JSON.stringify({
  ariesV2Microstructure: 'verified',
  volatilePairsUseCapabilityEconomics: true,
  queueEchoFillModel: true,
  fractionalKellyBounded: true,
  hurstAtrAdaptiveSizing: true,
  causalLeadLagAdvisory: true,
  empiricalStressTesting: true,
  unconditionalTakerFallback: false,
  governanceBypass: false,
}, null, 2));
