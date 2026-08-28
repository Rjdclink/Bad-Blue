'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bootstrap = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/integration/telemetry-bootstrap.ts'), 'utf8');

const checks = [
  ['Core remains topology-independent', bootstrap.includes('const coreStart = ensureCryptoCrawlerCoreRuntime();') && bootstrap.indexOf('await coreStart;') < bootstrap.indexOf('await multiProviderRpcManager.initialize(TELEMETRY_CHAINS);')],
  ['Ankr fallback defaults available unless explicitly disabled', bootstrap.includes("CRYPTOCRAWL_ALLOW_PUBLIC_ANKR_FALLBACK !== 'false'")],
  ['Authenticated Ankr key aliases supported', bootstrap.includes('ANKR_API_KEY') && bootstrap.includes('ANKR_KEY')],
  ['Per-chain authenticated Ankr endpoint derivation supported', bootstrap.includes('https://rpc.ankr.com/${ANKR_SLUGS[chain]}/${ankrKey}')],
  ['BSC recovery route present', bootstrap.includes("bsc: 'bsc'") && bootstrap.includes("bsc: 'https://rpc.ankr.com/bsc'" )],
  ['Fallback registration stays best-effort', bootstrap.includes('Promise.all(TELEMETRY_CHAINS.map(async chain =>')),
  ['No live-execution enablement mutation', !bootstrap.includes("process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION = 'true'" )],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) {
  console.error(`Native RPC fallback mesh verification failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exit(1);
}
console.log('Native RPC fallback mesh verification passed.');
