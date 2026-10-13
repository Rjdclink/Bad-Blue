const fs = require('node:fs');
const assert = require('node:assert/strict');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const gasFunding = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const systemCapital = read('server/services/cryptocrawl/runtime/system-capital-provenance.ts');
const sponsorship = read('server/services/cryptocrawl/strategies/gas-sponsorship.ts');

// Exercise the current funding contract, including both zero-initial-capital
// sponsorship and the explicitly configured lifetime-zero-operator-cost mode.
const esbuild = require('esbuild');
const compiled = esbuild.transformSync(gasFunding, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const loaded = { exports: {} };
Function('require', 'module', 'exports', compiled)(name => {
  if (name === 'ethers') return require('ethers');
  throw new Error(`Unexpected funding dependency: ${name}`);
}, loaded, loaded.exports);
const choose = loaded.exports.chooseGasFundingMode;
const chain = { id: 'ethereum', nativeAsset: 'ETH', sponsoredBootstrap: true };
const saved = process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST;
try {
  process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST = 'false';
  const billed = choose(chain, 0n, true);
  assert.equal(billed.mode, 'sponsored');
  assert.equal(billed.providerBillingLiability, true);
  assert.equal(billed.sponsorOperatorMonetaryCostProvenZero, false);
  assert.equal(billed.operatorMonetaryInputRequired, false);
  process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST = 'true';
  assert.equal(choose(chain, 0n, true).mode, 'unavailable');
  assert.equal(choose(chain, 0n, true, { sponsorOperatorMonetaryCostProvenZero: true }).mode, 'sponsored');
  assert.equal(choose(chain, 10n ** 18n, false).mode, 'unavailable');
  assert.equal(choose(chain, 10n ** 18n, false, { nativeSystemOwnedProven: true }).mode, 'native');
} finally {
  if (saved === undefined) delete process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST;
  else process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST = saved;
}
assert.match(sponsorship, /pm_sponsorUserOperation/);
assert.match(sponsorship, /sponsorshipPolicyId: this\.policyId/);
assert.doesNotMatch(sponsorship, /alchemy\.com|alchemyapi/);

assert.doesNotMatch(
  systemCapital,
  /zeroMonetaryGasVerified:\s*true[\s\S]*zeroExternalNativeCapitalVerified:\s*true[\s\S]*zeroExternalInputCapitalVerified:\s*true/,
  'durable bootstrap capital must never manufacture all three zero-capital proofs',
);
assert.match(
  systemCapital,
  /const gasTruthVerified = proof\.zeroOperatorMonetaryGasVerified === true \|\| proof\.providerGasLiabilityAccounted === true/,
  'bootstrap credit must require either proven zero gas cost or an accounted provider liability',
);
assert.match(
  systemCapital,
  /zeroExternalNativeCapitalVerified\s*!==\s*true/,
  'bootstrap credit must fail closed without zero external native capital evidence',
);
assert.match(
  systemCapital,
  /zeroExternalInputCapitalVerified\s*!==\s*true/,
  'bootstrap credit must fail closed without zero external input-capital evidence',
);

assert.match(systemCapital, /!gasTruthVerified/);
console.log('[zero-capital-gas-truth] PASS: billed sponsorship is not free gas; strict zero-cost mode rejects unproven sponsorship; native gas requires system ownership; Pimlico remains the sponsor');
