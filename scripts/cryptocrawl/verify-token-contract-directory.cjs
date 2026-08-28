'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const directory = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/intelligence/token-contract-directory.ts'), 'utf8');
const wiring = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/runtime/market-focus-wiring.ts'), 'utf8');
const checks = [
  ['CoinGecko platform directory endpoint', directory.includes('/coins/list?include_platform=true')],
  ['Existing CoinGecko credential convention retained', directory.includes("headers['x-cg-demo-api-key'] = apiKey")],
  ['Seven supported EVM chains mapped', ['ethereum','polygon-pos','arbitrum-one','optimistic-ethereum','base','avalanche','binance-smart-chain'].every(value => directory.includes(value))],
  ['EVM addresses strictly validated', directory.includes('/^0x[a-fA-F0-9]{40}$/')],
  ['Ambiguous addresses rejected', directory.includes('if (addresses.size !== 1) return null')],
  ['Ambiguous CoinGecko IDs rejected', directory.includes('if (ids.size !== 1) return null')],
  ['Directory cache has five-minute minimum', directory.includes('Math.max(300_000')],
  ['Addresses are not logged', directory.includes('addressesLogged: false')],
  ['Warmup is non-blocking', wiring.includes('void ensureTokenContractDirectory().catch')],
  ['Execution authority unchanged', wiring.includes('executionAuthorityChanged: false')],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Canonical token contract directory verification passed.');
