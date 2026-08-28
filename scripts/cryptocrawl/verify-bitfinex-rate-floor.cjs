'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/discovery/public-cex-discovery.ts'), 'utf8');
const checks = [
  ['Venue-specific cache TTL', source.includes('function snapshotTtlMs(venue: PublicDiscoveryVenue)')],
  ['Bitfinex 2500ms floor', source.includes("venue === 'bitfinex' ? Math.max(2_500, base) : base")],
  ['Other venues retain shared cache', source.includes("CRYPTOCRAWL_PUBLIC_BBO_CACHE_MS || 1_500")],
  ['Cache applies per venue', source.includes('snapshotTtlMs(venue)')],
  ['Nine-venue simultaneous fan-out retained', source.includes('Promise.allSettled(VENUES.map')),
  ['Bitfinex remains all-ticker batched', source.includes('https://api-pub.bitfinex.com/v2/tickers?symbols=ALL')],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Bitfinex discovery rate-floor verification passed.');
