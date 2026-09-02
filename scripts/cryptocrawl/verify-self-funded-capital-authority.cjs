const fs = require('node:fs');
const assert = require('node:assert/strict');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const hierarchy = read('server/services/cryptocrawl/core/capital-hierarchy.ts');
const hierarchyTest = read('server/services/cryptocrawl/testing/verify-capital-hierarchy.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');

assert.match(hierarchy, /CapitalSource\s*=\s*'self-funded'/, 'capital hierarchy must expose self-funded authority');
assert.doesNotMatch(hierarchy, /CapitalSource\s*=\s*[^;]*'wallet'/, 'raw wallet capital must not be an execution authority');
assert.match(hierarchy, /walletSufficient\s*&&\s*alternatives\.selfFundedEligible\s*===\s*true/, 'wallet location requires durable self-funded provenance');
assert.match(hierarchy, /external\/operator capital remains protected/, 'unproven external capital must be explicitly protected');
assert.match(hierarchyTest, /funded-wallet-without-provenance/, 'regression test must cover a funded external wallet');
assert.match(hierarchyTest, /verified-self-funded-capital/, 'regression test must cover verified self-funded capital');
assert.match(inventory, /if\s*\(venue\s*===\s*'coinbase'\)\s*return\s+Math\.max\(configuredMinimumReserve,\s*available\)/, 'Coinbase operator balance must remain non-spendable until durable provenance exists');

console.log('[self-funded-capital-authority] PASS: raw wallet authority removed, durable SELF_FUNDED provenance required, and operator Coinbase inventory protected');
