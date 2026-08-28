'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bootstrapPath = path.join(root, 'server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
const providerPath = path.join(root, 'server/services/cryptocrawl/api/blockchain-providers.ts');
const corePath = path.join(root, 'server/services/cryptocrawl/runtime/core-runtime.ts');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const providers = fs.readFileSync(providerPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');

const checks = [
  ['Coinbase CDP key-name alias', bootstrap.includes("'CDP_API_KEY_NAME'")],
  ['Coinbase CDP key-id alias', bootstrap.includes("'CDP_API_KEY_ID'")],
  ['Coinbase CDP private-key alias', bootstrap.includes("'CDP_API_KEY_PRIVATE_KEY'")],
  ['Coinbase generic key-name alias', bootstrap.includes("'KEY_NAME'")],
  ['Coinbase generic key-secret alias', bootstrap.includes("'KEY_SECRET'")],
  ['Native provider manager already supports Ankr API key', providers.includes('ANKR_API_KEY') && providers.includes('https://rpc.ankr.com/${ankrSlug[chain]}/${ankrKey}')],
  ['BSC is in native Ankr provider map', providers.includes("bsc: 'bsc'" )],
  ['Core preserves topology independence', core.includes('optionalProviderFailureBlocksCore: false')],
  ['Core startup remains topology-independent', core.includes('Provider/topology-specific monitors initialize separately and may degrade')],
  ['Bootstrap does not enable live execution', !bootstrap.includes("process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION = 'true'")],
  ['Bootstrap must not block core startup behind provider initialization', bootstrap.indexOf('const coreStart = ensureCryptoCrawlerCoreRuntime();') < bootstrap.indexOf('await multiProviderRpcManager.initialize(TELEMETRY_CHAINS);')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) {
  console.error(`Provider foundation reliability verification failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log('Provider foundation reliability verification passed.');
