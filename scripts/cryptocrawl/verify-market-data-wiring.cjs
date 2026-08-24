const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertContains(source, pattern, description) {
  if (!source.includes(pattern)) {
    throw new Error(`Missing invariant: ${description}`);
  }
}

function assertNotContains(source, pattern, description) {
  if (source.includes(pattern)) {
    throw new Error(`Unsafe invariant: ${description}`);
  }
}

const providers = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
const coingecko = read('server/services/cryptocrawl/bridge/coingecko-client.ts');
const alchemy = read('server/services/cryptocrawl/capital-free/alchemy-integration.ts');
const environment = read('.env.example');

assertContains(providers, "process.env.COINGECKO_API_KEY", 'CoinGecko credential is environment-sourced');
assertContains(providers, "process.env.COINSTATS_API_KEY", 'CoinStats credential is environment-sourced');
assertContains(providers, "process.env.ZEROX_API_KEY", '0x credential is environment-sourced');
assertContains(providers, "'x-cg-demo-api-key'", 'CoinGecko Demo authentication header');
assertContains(providers, "'X-API-KEY'", 'CoinStats authentication header');
assertContains(providers, "'0x-api-key'", '0x authentication header');
assertContains(providers, 'this.quoteCache', '0x quote cache');
assertContains(providers, 'this.inFlight', 'provider request deduplication');
assertNotContains(providers, 'console.log', 'provider credentials or payloads are not logged');

assertContains(faucet, "from '../intelligence/market-data-providers.js'", 'faucet imports market providers');
assertContains(faucet, 'marketDataProviders.discoverUniverse()', 'faucet consumes discovered assets');
assertContains(faucet, 'marketDataProviders.getDexQuote(', 'faucet consumes 0x observations');
assertContains(faucet, 'arbitrageVerifier.evaluateOnce(', 'faucet retains canonical live verification');
assertContains(faucet, 'stageManager.canExecuteTrades()', 'faucet retains automatic execution gating');
assertContains(coingecko, "'x-cg-demo-api-key'", 'existing CoinGecko price client uses Demo authentication');

assertContains(alchemy, "'alchemy_pendingTransactions'", 'Alchemy pending transaction subscription');
assertContains(alchemy, 'eth_subscribe', 'Alchemy WebSocket subscription transport');
assertContains(alchemy, 'pollPendingTransactions', 'Alchemy polling fallback');

for (const key of ['COINGECKO_API_KEY=', 'COINSTATS_API_KEY=', 'ZEROX_API_KEY=']) {
  assertContains(environment, key, `${key} is documented in the environment template`);
}

console.log('Market-data wiring verification passed.');