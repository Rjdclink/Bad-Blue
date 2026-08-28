'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../server/services/cryptocrawl/discovery/public-cex-discovery.ts'), 'utf8');
const checks = [
  ['Venue-specific TTL', source.includes('function snapshotTtlMs(venue: PublicDiscoveryVenue)')],
  ['Bitfinex floor', source.includes("venue === 'bitfinex' ? Math.max(2_500, base) : base")],
  ['Per-venue cache expiry', source.includes('snapshotTtlMs(venue)')],
  ['Nine-venue fan-out retained', source.includes('Promise.allSettled(VENUES.map')],
  ['Bitfinex all-ticker endpoint retained', source.includes('https://api-pub.bitfinex.com/v2/tickers?symbols=ALL')],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Bitfinex discovery rate-floor verification passed.');
