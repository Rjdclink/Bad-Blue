'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const discovery = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/discovery/public-cex-discovery.ts'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/discovery/venue-capability-registry.ts'), 'utf8');

const checks = [
  ['MEXC discovery source wired', discovery.includes("'mexc'") && discovery.includes('https://api.mexc.com/api/v3/ticker/bookTicker')],
  ['Bitfinex discovery source wired', discovery.includes("'bitfinex'") && discovery.includes('https://api-pub.bitfinex.com/v2/tickers?symbols=ALL')],
  ['Crypto.com discovery source wired', discovery.includes("'cryptocom'") && discovery.includes('https://api.crypto.com/exchange/v1/public/get-tickers')],
  ['Nine-venue fan-out retained', discovery.includes("'coinbase'") && discovery.includes("'huobi'") && discovery.includes("'cryptocom'")],
  ['Simultaneous all-settled fan-out retained', discovery.includes('Promise.allSettled(VENUES.map')],
  ['Snapshot cache retained', discovery.includes('snapshotCache') && discovery.includes('snapshotInFlight')],
  ['Bitfinex USDT normalization present', discovery.includes("compact.endsWith('UST')")],
  ['MEXC remains discovery only', registry.includes("venue: 'mexc', enabled: true, publicDiscovery: true, executableQuotes: false")],
  ['Bitfinex remains discovery only', registry.includes("venue: 'bitfinex', enabled: true, publicDiscovery: true, executableQuotes: false")],
  ['Crypto.com remains discovery only', registry.includes("venue: 'cryptocom', enabled: true, publicDiscovery: true, executableQuotes: false")],
  ['Executable venue set unchanged', registry.includes("return (['coinbase', 'kraken', 'okx'] as const)")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Public CEX beam expansion verification passed.');
