const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertContains(source, pattern, description) {
  if (!source.includes(pattern)) throw new Error(`Missing invariant: ${description}`);
}

function assertNotContains(source, pattern, description) {
  if (source.includes(pattern)) throw new Error(`Unsafe invariant: ${description}`);
}

const providers = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
const coingecko = read('server/services/cryptocrawl/bridge/coingecko-client.ts');
const providerMesh = read('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts');
const pending = read('server/services/cryptocrawl/capital-free/provider-mesh-pending-stream.ts');
const pressure = read('server/services/cryptocrawl/capital-free/provider-mesh-mempool-analysis.ts');
const compatibility = read('server/services/cryptocrawl/capital-free/alchemy-integration.ts');
const environment = read('.env.example');

assertContains(providers, 'process.env.COINCAP_API_KEY', 'CoinCap credential is environment-sourced');
assertContains(providers, "'coincap' | 'coingecko' | 'coinstats'", 'CoinCap has first-class market provenance');
assertContains(providers, "'https://rest.coincap.io/v3'", 'CoinCap uses the current v3 REST origin');
assertContains(providers, 'Authorization: `Bearer ${apiKey}`', 'CoinCap uses bearer-token authentication');
assertContains(providers, "this.fetchCoinCapUniverse(),\n      this.fetchCoinGeckoUniverse(),", 'CoinCap is queried as the primary canonical market feed');
assertContains(providers, "coincap: { provider: 'coincap'", 'CoinCap provider health is observable');
assertContains(providers, 'process.env.COINGECKO_API_KEY', 'CoinGecko credential is environment-sourced');
assertContains(providers, 'process.env.COINSTATS_API_KEY', 'CoinStats credential is environment-sourced');
assertContains(providers, 'process.env.ZEROX_API_KEY', '0x credential is environment-sourced');
assertContains(providers, "'x-cg-demo-api-key'", 'CoinGecko Demo authentication header');
assertContains(providers, "'X-API-KEY'", 'CoinStats authentication header');
assertContains(providers, "'0x-api-key'", '0x authentication header');
assertContains(providers, 'this.quoteCache', '0x quote cache');
assertContains(providers, 'this.inFlight', 'provider request deduplication');
assertNotContains(providers, 'console.log', 'provider credentials or payloads are not logged');

assertContains(graph, "from '../intelligence/market-data-providers.js'", 'canonical graph imports market providers');
assertContains(graph, 'marketDataProviders.discoverUniverse()', 'canonical graph consumes discovered assets');
assertContains(graph, 'arbitrageVerifier.evaluateOnce(', 'canonical graph retains deterministic live verification');
assertContains(graph, 'getCryptara()', 'canonical graph routes verified positive candidates into Cryptara');
assertContains(graph, 'syntheticEvidenceAllowed: false', 'canonical graph forbids synthetic market evidence');
assertNotContains(faucet, 'marketDataProviders.discoverUniverse()', 'retired faucet facade cannot own market discovery');
assertContains(coingecko, "'x-cg-demo-api-key'", 'existing CoinGecko price client uses Demo authentication');

assertContains(providerMesh, "provider: 'dRPCPublicStreaming'", 'provider mesh registers a no-key streaming replacement');
assertContains(providerMesh, 'alchemyOperationalAuthority: false', 'provider mesh denies Alchemy operational authority');
assertContains(pending, "params: ['drpc_pendingTransactions']", 'pending transaction evidence uses the dRPC full-pending replacement');
assertContains(pressure, "method: 'txpool_content'", 'mempool pressure is independently measured');
assertContains(pressure, 'mempool_pressure:measured_not_inferred', 'mempool pressure is never inferred from a filtered subset');
assertNotContains(compatibility, 'g.alchemy.com', 'legacy compatibility surface contains no Alchemy endpoint');
assertNotContains(compatibility, 'alchemy_pendingTransactions', 'legacy compatibility surface contains no Alchemy enhanced request');
assertNotContains(compatibility, 'process.env.ALCHEMY_API_KEY', 'legacy compatibility surface does not consume an Alchemy key');

for (const key of [
  'COINGECKO_API_KEY=',
  'COINSTATS_API_KEY=',
  'ZEROX_API_KEY=',
  'CRYPTOCRAWL_COST_SAFE_PUBLIC_RPC_ENABLED=true',
  'CRYPTOCRAWL_FREE_STREAMING_RPC_ENABLED=true',
  'CRYPTOCRAWL_PROVIDER_MESH_MEMPOOL_ENABLED=true',
]) {
  assertContains(environment, key, `${key} is documented in the environment template`);
}
assertNotContains(environment, 'ALCHEMY_API_KEY=', 'environment template must not reintroduce Alchemy');
assertNotContains(environment, 'ALCHEMY_GAS_POLICY_ID=', 'environment template must not reintroduce Alchemy gas sponsorship');

console.log('Canonical market-data / provider-mesh wiring verification passed.');
