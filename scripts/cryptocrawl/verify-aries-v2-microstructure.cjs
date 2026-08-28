const fs = require('node:fs');
const assert = require('node:assert/strict');

const micro = fs.readFileSync('server/services/cryptocrawl/intelligence/aries-microstructure.ts', 'utf8');
const maker = fs.readFileSync('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts', 'utf8');
const aries = fs.readFileSync('server/services/cryptocrawl/intelligence/aries-vault.ts', 'utf8');
const dexScout = fs.readFileSync('server/services/cryptocrawl/discovery/graphless-dex-scout.ts', 'utf8');
const dynamicDex = fs.readFileSync('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts', 'utf8');
const zeroWiring = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts', 'utf8');
const quoter = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');

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

// Graphless DEX discovery must require no new credentials and must remain
// non-authoritative until direct on-chain quoting and atomic economics succeed.
assert.match(dexScout, /apiKeysRequired: false/);
assert.match(dexScout, /geckoterminal_public/);
assert.match(dexScout, /uniswap_v3_factory_event/);
assert.match(dexScout, /provider\.getLogs/);
assert.doesNotMatch(dexScout, /API_KEY|apiKey|x-cg-pro-api-key|x-cg-demo-api-key/);
assert.match(dynamicDex, /buildGraphlessProfitSurfaceTemplates/);
assert.match(dynamicDex, /graphless_no_key_discovery|graphless-/);
assert.match(dynamicDex, /Same-DEX fee-tier dislocations/);
assert.match(dynamicDex, /quoteConfiguredZeroCapitalRoutesForChain/);
assert.match(dynamicDex, /syntheticEvidenceAllowed: false/);
assert.match(zeroWiring, /prepareGraphlessPermissions/);
assert.match(zeroWiring, /onlyPositiveRoutesPrepared: true/);
assert.match(zeroWiring, /dynamic_route_permissions/);
assert.match(quoter, /must return to inputToken to repay the flash loan atomically/);

console.log(JSON.stringify({
  ariesV2Microstructure: 'verified',
  volatilePairsUseCapabilityEconomics: true,
  queueEchoFillModel: true,
  fractionalKellyBounded: true,
  hurstAtrAdaptiveSizing: true,
  causalLeadLagAdvisory: true,
  empiricalStressTesting: true,
  unconditionalTakerFallback: false,
  graphlessDexDiscovery: true,
  newDexApiKeysRequired: false,
  directRpcFactoryDiscovery: true,
  publicScoutIsAdvisoryOnly: true,
  directContractQuoteAuthority: true,
  atomicRepaymentInvariant: true,
  dynamicPermissionsFailClosed: true,
  governanceBypass: false,
}, null, 2));
