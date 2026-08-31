'use strict';
// Diagnostic isolation only. Do not merge this branch.
const { read, requirePattern, forbidPattern } = require('./lib/pr482-canonical-contract.cjs');
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const arbVerifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const inventoryReadiness = read('server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts');
requirePattern(feeResolver, /getSpotProductConstraints/, 'fee resolver canonical product authority');
forbidPattern(feeResolver, /const\s+quotes\s*=\s*\['USDT'|\(USDT\|USDC\|USD\)/, 'fee resolver quote parser');
requirePattern(arbVerifier, /getSpotProductConstraints\('kraken',\s*symbol\)/, 'Kraken depth exact product');
requirePattern(arbVerifier, /getSpotProductConstraints\('okx',\s*symbol\)/, 'OKX depth exact product');
forbidPattern(arbVerifier, /function\s+okxInstId|\(USDT\|USDC\|USD\)/, 'arb verifier duplicate product parser');
requirePattern(inventoryReadiness, /positiveBalanceAssets/, 'positive balance semantics');
requirePattern(inventoryReadiness, /inventoryAssetCount:\s*metrics\.positiveBalanceAssetCount/, 'funded asset readiness');
requirePattern(inventoryReadiness, /syntheticBalancesAllowed:\s*false/, 'no synthetic balances');
console.log('[deployment-preflight][diagnostic] fee/arbitrage/inventory canonical assertions passed; continuing to downstream build');
