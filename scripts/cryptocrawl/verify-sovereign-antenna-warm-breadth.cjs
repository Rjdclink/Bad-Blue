'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/integration/order-book-evolution-wiring.ts'), 'utf8');

const checks = [
  ['Dedicated antenna symbol control exists', source.includes('CRYPTOCRAWL_ANTENNA_SYMBOLS')],
  ['Compatibility control retained', source.includes('CRYPTOCRAWL_BOOK_EVOLUTION_SYMBOLS')],
  ['Warm set default increased to 32', source.includes('|| 32')],
  ['Warm set remains bounded', source.includes('Math.min(64') && source.includes('Math.max(8')],
  ['Persistent venue streams retained', source.includes('cexOrderBookStreams.getQuote')],
  ['All active executable venues are still used', source.includes('getActiveExecutableQuoteVenues()')],
  ['Parallel fan-out retained', source.includes('Promise.all(venues.flatMap')],
  ['Measured evolution store retained', source.includes('orderBookEvolutionStore.record(quote)')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Sovereign antenna warm-breadth verification passed.');
