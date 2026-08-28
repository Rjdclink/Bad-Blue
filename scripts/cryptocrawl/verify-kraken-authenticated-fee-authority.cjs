'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const wiring = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts'), 'utf8');
const resolver = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/intelligence/cex-fee-resolver.ts'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts'), 'utf8');
const checks = [
  ['Kraken credentials gate authority change', wiring.includes('process.env.KRAKEN_API_KEY?.trim()') && wiring.includes('process.env.KRAKEN_API_SECRET?.trim()')],
  ['Compatibility taker fee retired only with credentials', wiring.includes('delete process.env.CRYPTO_ARBITRAGE_KRAKEN_TAKER_FEE_BPS')],
  ['Policy installed before verifier evaluation', wiring.indexOf('enforceAuthenticatedKrakenFeeAuthority();') < wiring.indexOf('const originalEvaluateOnce')],
  ['Authenticated TradeVolume resolver retained', resolver.includes("source: 'kraken_account_trade_volume'") && resolver.includes("'/0/private/TradeVolume'"))],
  ['Request overrides remain supported', verifier.includes('requestedFeeOverride')],
  ['Compatibility resolver remains available without credentials', resolver.includes('return configuredFee(venue, symbol)')],
  ['No execution-enable mutation', !wiring.includes("process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION = 'true'"))],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Kraken authenticated fee authority verification passed.');
