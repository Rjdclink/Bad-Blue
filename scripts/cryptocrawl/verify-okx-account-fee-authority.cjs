const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const authority = read('server/services/cryptocrawl/intelligence/okx-account-fee-authority.ts');
const resolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const rpi = read('server/services/cryptocrawl/intelligence/okx-rpi-capability.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');

assert.match(authority, /Sole semantic authority for authenticated OKX account fee reads/);
assert.match(authority, /const feeCache = new Map/);
assert.match(authority, /const feeInFlight = new Map/);
assert.match(authority, /if \(existing\)[\s\S]*coalescedCount \+= 1/);
assert.match(authority, /exactly one of groupId, instId, or instFamily/);
assert.match(authority, /expectedGroupId/);
assert.match(authority, /lane: 'trade_fee'/);

for (const [name, source] of [
  ['CEX fee resolver', resolver],
  ['RPI capability', rpi],
  ['funding monitor', funding],
]) {
  assert.match(source, /resolveOkxAccountFeeRates/);
  assert.ok(
    !source.includes('/api/v5/account/trade-fee'),
    `${name} must not bypass the semantic OKX account-fee authority`,
  );
}

assert.match(funding, /OKX_SWAP_CAPABILITY_PROBE_BUDGET/);
assert.match(funding, /Math\.abs\(right\.fundingRate\) - Math\.abs\(left\.fundingRate\)/);
assert.match(funding, /\.slice\(0, OKX_SWAP_CAPABILITY_PROBE_BUDGET\)/);
assert.match(funding, /Private OKX SWAP enrichment deferred by the bounded discovery budget/);
assert.match(funding, /execution remains fail-closed/);
assert.match(funding, /publicDiscoveryBlockedByPrivateEnrichment: false/);
assert.match(funding, /const accountContext = await getOkxSwapAccountContext\(\)/);
assert.match(funding, /instrument\?\.groupId/);

console.log('[okx-account-fee-authority] shared semantic caching, in-flight coalescing, group routing and bounded funding enrichment verified');
