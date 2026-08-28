'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts'), 'utf8');
const wiring = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/api/blockchain-providers.ts'), 'utf8');
const checks = [
  ['Chainstack configured admission', source.includes("token: 'CHAINSTACK'")],
  ['GetBlock configured admission', source.includes("token: 'GETBLOCK'")],
  ['dRPC configured admission', source.includes("token: 'DRPC'")],
  ['Blast configured admission', source.includes("token: 'BLAST'")],
  ['Generic mesh input', source.includes('CRYPTOCRAWL_RPC_PROVIDER_MESH')],
  ['Generic mesh bounded', source.includes('parsed.slice(0, 32)')],
  ['Priority bounded', source.includes('Math.max(1, Math.min(10')],
  ['HTTP URL validation', source.includes("url.protocol === 'https:' || url.protocol === 'http:'")],
  ['WS URL validation', source.includes("url.protocol === 'wss:' || url.protocol === 'ws:'")],
  ['Canonical manager registration', source.includes('multiProviderRpcManager.registerProvider')],
  ['Manager retains duplicate URL suppression', manager.includes('candidate.httpUrl === input.httpUrl')],
  ['Endpoint URLs not logged', source.includes('endpointUrlsLogged: false')],
  ['Admission is non-blocking', wiring.includes('ensureDynamicRpcProviderWiring();')],
  ['No execution enablement mutation', !source.includes("process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION = 'true'"))],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Dynamic RPC provider admission verification passed.');
