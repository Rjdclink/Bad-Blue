const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const coinbase = read('server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.ts');

function requirePattern(pattern, message) {
  if (!pattern.test(coinbase)) throw new Error(`[cross-venue-asset-identity] ${message}`);
}

requirePattern(/VERIFIED_COINBASE_ASSET_ALIASES[\s\S]*VELO:\s*'VELODROME'/, 'Coinbase VELO transport identity must remain canonically distinct from OKX Velo Protocol');
requirePattern(/const\s+transportBaseAsset\s*=\s*canonicalAsset\(parts\[0\]\)/, 'exchange transport base identity must be preserved independently');
requirePattern(/const\s+baseAsset\s*=\s*canonicalCoinbaseAsset\(parts\[0\]\)/, 'canonical Coinbase asset identity must consume the verified venue alias');
requirePattern(/productId:\s*`\$\{transportBaseAsset\}-\$\{transportQuoteAsset\}`/, 'live Coinbase product id must retain the exchange transport label');
requirePattern(/symbol:\s*`\$\{baseAsset\}\$\{quoteAsset\}`/, 'cross-venue matching must use collision-free canonical identity');

console.log('[cross-venue-asset-identity] Coinbase transport/canonical identity separation invariants passed');
