'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const prices = read('server/services/cryptocrawl/bridge/coingecko-client.ts');
const runtimeObservability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const eventFees = read('server/services/cryptocrawl/intelligence/kalshi-event-fee-authority.ts');
const prediction = read('server/services/cryptocrawl/intelligence/kalshi-prediction-market-authority.ts');
const generator = read('server/services/cryptocrawl/discovery/kalshi-event-opportunity-generator.ts');
const lifecycle = read('server/services/cryptocrawl/execution/kalshi-event-lifecycle.ts');

assert.match(prices, /const alternateTasks = \[[\s\S]*fetchCoinMarketCapKeylessByCoinIds[\s\S]*fetchCoinCapByCoinIds[\s\S]*fetchCoinbaseByCoinIds[\s\S]*\];/, 'independent live price providers must start concurrently');
assert.match(prices, /const tracked = alternateTasks\.map/, 'parallel provider tasks must be tracked independently');
assert.match(prices, /Promise\.race\(\[firstUsable, allSettled\]\)/, 'one slow provider must not bottleneck usable parallel evidence');
assert.match(prices, /const missing = coinIds\.filter/, 'the fallback path must identify only symbols missing from the alternate mesh');
assert.match(prices, /fetchCoinGeckoByCoinIds\(missing, vsCurrency\)/, 'CoinGecko must be queried only as last-resort redundancy for missing live symbols');
assert.match(prices, /enqueueCoinGeckoRequest/, 'CoinGecko must retain its own rate queue');
assert.doesNotMatch(prices, /const requestPromise = this\.enqueue/, 'CoinGecko pacing must not serialize the alternate provider mesh');
assert.match(prices, /export function mergeLivePriceEvidence/, 'parallel price evidence must normalize through one shared merge');
assert.match(prices, /Math\.abs\(value - median\) \/ median <= 0\.2/, 'price consensus must discard material multi-provider outliers');
assert.doesNotMatch(prices, /merged\[coinId\] = primary/, 'no single provider may override median consensus by fixed precedence');
assert.match(prices, /const complete = dedupedIds\.every\(coinId => normalized\[coinId\] !== undefined\)/, 'price-cache completeness must be explicit');
assert.match(prices, /if \(complete\) \{[\s\S]{0,300}const ttlMs = cacheClass === 'live' \? DEFAULT_LIVE_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS;[\s\S]{0,300}this\.cache\.set\(cacheKey, \{/, 'only complete evidence may be cached with the class-specific TTL');
assert.match(runtimeObservability, /usableMarketUniverseProviders/, 'runtime readiness must consume the parallel market-universe provider mesh');
assert.match(runtimeObservability, /directCexMarketEvidenceReady/, 'fresh direct CEX evidence must remain a CoinGecko-independent readiness path');
assert.match(runtimeObservability, /coinGeckoRequiredForCoreCexDiscovery: false/, 'CoinGecko must never be a global core-CEX discovery requirement');
assert.doesNotMatch(runtimeObservability, /requiredForCoreCexDiscovery:\s*status\.provider\s*===\s*['"]coingecko['"]/, 'provider telemetry must not reintroduce CoinGecko as a required authority');

// Runtime readiness must report the capability that the canonical Kalshi adapters
// can actually use. Omitting either of these inputs makes the pure readiness policy
// correctly default them to false/zero and produces a misleading heartbeat even
// though the exchange integration itself is installed.
assert.match(runtimeObservability, /import \{ kalshiCredentialsPresent \} from ['"]\.\.\/intelligence\/kalshi-authenticated-authority\.js['"];/, 'runtime observability must reuse the canonical scoped Kalshi credential authority');
assert.match(runtimeObservability, /const kalshiEventConfigured = kalshiCredentialsPresent\(['"]event['"]\);/, 'event credentials must be measured through the canonical authority');
assert.match(runtimeObservability, /const kalshiPerpsConfigured = kalshiCredentialsPresent\(['"]perps['"]\);/, 'perps credentials must be measured separately through the canonical authority');
assert.match(runtimeObservability, /kalshiExecutionConfigured: execution\.kalshiExecutionConfigured/, 'Kalshi credential capability must be passed into readiness instead of defaulting false');
assert.match(runtimeObservability, /eligibleKalshiCandidates: candidateMetrics\.byTopology\.PREDICTION_EVENT\.eligible/, 'canonical prediction-event eligible count must be passed into readiness instead of defaulting zero');
assert.doesNotMatch(runtimeObservability, /kalshiExecutionConfigured:\s*false/, 'runtime telemetry must not hard-code Kalshi execution configuration false');

for (const [name, source] of [['event fee authority', eventFees], ['prediction intelligence', prediction]]) {
  assert.match(source, /\/trade-api\/v2\/events\/fee_changes/, `${name} must use the documented event fee-change endpoint`);
  assert.doesNotMatch(source, /\/trade-api\/v2\/series\/fee_changes/, `${name} must not call the removed series fee-change endpoint`);
  assert.match(source, /event_fee_changes/, `${name} must parse the documented response schema`);
  assert.match(source, /2 \*\* attempt/, `${name} must exponentially back off request-local 429s`);
}
assert.match(eventFees, /fee_type_override/, 'event fee overrides must layer over parent series fees');
assert.match(eventFees, /resourceCache/, 'event and series evidence must be shared across market tickers');
assert.match(eventFees, /resourceInFlight/, 'event and series refreshes must be single-flight');

assert.match(generator, /expectedNetProfitUsd > 0/, 'Kalshi admission must use exact strictly-positive all-in economics');
assert.doesNotMatch(generator, /minExpectedNetUsd/, 'Kalshi discovery must not impose an arbitrary profit magnitude floor');
assert.doesNotMatch(lifecycle, /minimumExpectedNetUsd/, 'Kalshi execution must not reintroduce an arbitrary profit magnitude floor');
assert.match(lifecycle, /currentExpectedNetProfitUsd > requiredNet/, 'fresh execution economics must remain strictly positive after route-specific costs');

console.log('[market-evidence-kalshi-capability] PASS: alternate providers run concurrently, CoinGecko is missing-symbol fallback only, complete-only cache semantics, exact-positive Kalshi evidence, and truthful runtime Kalshi readiness preserve capability');