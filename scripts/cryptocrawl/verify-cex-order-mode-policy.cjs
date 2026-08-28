'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/execution/cex-order-mode-policy.ts'), 'utf8');
const checks = [
  ['Maker and taker modes defined', source.includes("export type CexOrderMode = 'maker' | 'taker'")],
  ['Stablecoin pair detection present', source.includes('isStablecoinPair') && source.includes("'USDG'") && source.includes("'RLUSD'"))],
  ['Authenticated fee evidence required', source.includes("evidence.source !== 'configured_override'")],
  ['Maker fee evidence used', source.includes('makerFeeBps') && source.includes('makerRebateBps')],
  ['No hard-coded stablecoin fee discount', !source.includes('stablecoinFeeBps') && !source.includes('makerFeeBps: 0')],
  ['Negative fee edge rejected', source.includes("reason: 'fees_consume_gross_spread'")],
  ['No maker-to-taker timeout fallback', !source.includes('timeout') && !source.includes('fallbackToTaker')],
  ['No live execution mutation', !source.includes('CRYPTO_ARBITRAGE_LIVE_EXECUTION') && !source.includes('/api/v5/trade/order')],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('CEX order-mode policy verification passed.');
