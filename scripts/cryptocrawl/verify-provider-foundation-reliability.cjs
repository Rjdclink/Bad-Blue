'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bootstrapPath = path.join(root, 'server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
const source = fs.readFileSync(bootstrapPath, 'utf8');

const checks = [
  ['Coinbase CDP key-name alias', source.includes("'CDP_API_KEY_NAME'")],
  ['Coinbase CDP key-id alias', source.includes("'CDP_API_KEY_ID'")],
  ['Coinbase CDP private-key alias', source.includes("'CDP_API_KEY_PRIVATE_KEY'")],
  ['Coinbase documented generic key-name alias', source.includes("'KEY_NAME'")],
  ['Coinbase documented generic key-secret alias', source.includes("'KEY_SECRET'")],
  ['Ankr API-key-derived RPC support', source.includes('ANKR_API_KEY') && source.includes('https://rpc.ankr.com/${ANKR_SLUGS[chain]}/${ankrKey}')],
  ['BSC included in Ankr slug map', source.includes("bsc: 'bsc'")],
  ['Provider mesh initialized before core runtime', source.indexOf('await multiProviderRpcManager.initialize(TELEMETRY_CHAINS);') < source.indexOf('const coreStart = ensureCryptoCrawlerCoreRuntime();')],
  ['Ankr fallbacks registered before core runtime', source.indexOf('await registerBestEffortAnkrFallbacks();') < source.indexOf('const coreStart = ensureCryptoCrawlerCoreRuntime();')],
  ['No execution-enable flag changed in bootstrap', !source.includes("process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION = 'true'")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
}

if (failed.length) {
  console.error(`Provider foundation reliability verification failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}

console.log('Provider foundation reliability verification passed.');
