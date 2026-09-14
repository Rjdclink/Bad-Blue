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

assert.match(prices, /const PRIMARY_PROVIDERS:[\s\S]*'coinmarketcap-keyless',[\s\S]*'dexscreener',[\s\S]*'defillama',[\s\S]*'coinlore',[\s\S]*\] as const;/, 'primary live-price hierarchy must be CMC Keyless + DEX Screener + DefiLlama + CoinLore');
assert.doesNotMatch(prices, /coinpaprika/i, 'CoinPaprika must not be inserted into the agreed price hierarchy');
assert.doesNotMatch(prices, /fetchCoinCapByCoinIds|fetchCoinbaseByCoinIds/, 'retired CoinCap/Coinbase price paths must not remain in the canonical four-provider mesh');
assert.match(prices, /PRIMARY_PROVIDERS\.map\(provider => this\.fetchPrimaryProvider\(provider, coinIds, vsCurrency\)/, 'all four primary providers must start each pass through one concurrent provider mesh');
assert.match(prices, /Promise\.allSettled\(tracked\)/, 'primary provider failures must settle independently');
assert.match(prices, /const passOne = await this\.runPrimaryPass\(coinIds, vsCurrency\);/, 'live price requests must execute primary pass one');
assert.match(prices, /if \(missing\.length > 0\) \{\s*const passTwo = await this\.runPrimaryPass\(missing, vsCurrency\);/, 'missing live prices must receive a complete second primary pass before CoinGecko');
assert.match(prices, /if \(missing\.length > 0\) \{\s*const emergency = await this\.fetchCoinGeckoByCoinIds\(missing, vsCurrency\);/, 'CoinGecko must be emergency-only after both primary passes');
assert.match(prices, /private providerState = new Map<LivePriceProvider, ProviderRuntimeState>\(\)/, 'provider health, rate state, and cooldowns must be provider-local');
assert.match(prices, /tokens: config\.capacity/, 'each provider must have an independent token bucket');
assert.match(prices, /state\.cooldownUntil = Date\.now\(\) \+ cooldownMs/, 'provider failures must establish only provider-local cooldown state');
assert.match(prices, /recoveryProbes \+= 1/, 'expired provider cooldowns must automatically probe for recovery');
assert.match(prices, /maxRetries: 0/, 'mesh-level retry must remain the explicit second provider pass rather than hidden request retries');
assert.match(prices, /const byChain = new Map/, 'DEX Screener requests must batch compatible token addresses by chain');
assert.match(prices, /requested\.map\(entry => entry\.key\)\.join\(','\)/, 'DefiLlama must batch compatible coin keys');
assert.match(prices, /requested\.map\(entry => entry\.coinLoreId\)\)\.join\(','\)/, 'CoinLore must batch compatible asset ids');
assert.match(prices, /requested\.map\(entry => entry\.cmcId\)\)\.join\(','\)/, 'CoinMarketCap must batch compatible asset ids');
assert.match(prices, /private inFlight = new Map<string, Promise<PriceFetchResult>>\(\)/, 'identical price requests must share in-flight work');
assert.match(prices, /this\.recordAttributedTelemetry\(result\.canonicalProviderByCoinId, 'coalescedRequests'\)/, 'coalesced price requests must be observable');
assert.match(prices, /const DEFAULT_LIVE_CACHE_TTL_MS = Math\.max\([\s\S]*Math\.min\(15_000/, 'live-price cache must remain short lived');
assert.match(prices, /const complete = dedupedIds\.every\(coinId => result\.pricesByCoinId\[coinId\] !== undefined\)/, 'price-cache completeness must be explicit');
assert.match(prices, /if \(complete\) \{[\s\S]{0,400}this\.cache\.set\(cacheKey, \{/, 'partial price evidence must never receive the normal cache TTL');
assert.match(prices, /rateLimitedResponses:/, 'per-provider telemetry must track 429s');
assert.match(prices, /cacheHits:/, 'per-provider telemetry must track cache hits');
assert.match(prices, /coalescedRequests:/, 'per-provider telemetry must track coalesced requests');
assert.match(prices, /batchedRequests:/, 'per-provider telemetry must track batched requests');
assert.match(prices, /canonicalEvidenceSelections:/, 'per-provider telemetry must identify canonical evidence suppliers');
assert.match(prices, /coinGeckoRequests: providers\.coingecko\.requestsSent/, 'telemetry must expose an explicit CoinGecko request count');
assert.match(prices, /\[live-price-mesh-telemetry\]/, 'live price provider behavior must be emitted as runtime telemetry');
assert.match(prices, /export function normalizeCoinMarketCapQuotes/, 'CoinMarketCap parser must remain independently regression-testable');
assert.match(prices, /data && typeof data === 'object'[\s\S]*Object\.values\(data as Record<string, unknown>\)/, 'CoinMarketCap object/dictionary payloads must be parsed rather than discarded');
assert.match(prices, /export function mergeLivePriceEvidence/, 'parallel price evidence must normalize through one shared merge');
assert.match(prices, /Math\.abs\(value - median\) \/ median <= 0\.2/, 'price consensus must discard material multi-provider outliers');
assert.doesNotMatch(prices, /merged\[coinId\] = primary/, 'no single provider may override canonical consensus by fixed precedence');
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

console.log('[market-evidence-kalshi-capability] PASS: four-provider double-pass live pricing, CoinGecko emergency-only isolation, short complete-only caching, coalescing/batching/telemetry, exact-positive Kalshi evidence, and truthful runtime readiness preserve capability');
