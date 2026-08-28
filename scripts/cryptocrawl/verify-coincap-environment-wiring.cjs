'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/runtime/coincap-environment-wiring.ts'), 'utf8');
const wiring = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts'), 'utf8');
const market = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/intelligence/market-data-providers.ts'), 'utf8');
const checks = [
  ['Production CoinCap aliases supported', source.includes('COINCAP_API_KEY_PROD') && source.includes('COINCAP_API_KEY_PRODUCTION')],
  ['Canonical CoinCap key adopted', source.includes('process.env.COINCAP_API_KEY = key.value')],
  ['CoinCap base URL aliases supported', source.includes('COINCAP_BASE_URL') && source.includes('COINCAP_API_URL')],
  ['Secret values are not logged', source.includes('secretValuesLogged: false')],
  ['CoinCap normalization runs before provider work', wiring.includes('ensureCoinCapEnvironmentWiring();')],
  ['Paid CoinCap remains primary', market.includes('CoinCap is intentionally first') && market.includes('authenticated CoinCap v3 market feed is primary')],
  ['Bearer authentication retained', market.includes('Authorization: `Bearer ${apiKey}`')],
  ['No live execution flag changed', !source.includes('CRYPTO_ARBITRAGE_LIVE_EXECUTION')],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
console.log('Paid CoinCap environment wiring verification passed.');
