const fs = require('node:fs');
const assert = require('node:assert/strict');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const gasFunding = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const systemCapital = read('server/services/cryptocrawl/runtime/system-capital-provenance.ts');
const sponsorship = read('server/services/cryptocrawl/strategies/gas-sponsorship.ts');

assert.match(
  gasFunding,
  /function strictZeroOperatorCostRequired\(\): boolean \{\s*return true;\s*\}/,
  'ZERO_CAPITAL_ATOMIC zero-operator-cost gas policy must be unconditional and not environment-weakenable',
);
assert.match(
  gasFunding,
  /sponsorOperatorMonetaryCostProvenZero\s*===\s*true/,
  'hosted sponsorship must require independent zero-operator-monetary-cost proof',
);
assert.match(
  gasFunding,
  /nativeSystemOwnedProven\s*===\s*true/,
  'native gas must require durable system-ownership proof',
);
assert.match(
  gasFunding,
  /not admissible without proof of zero operator billing liability/,
  'hosted sponsorship billed to the operator/application must fail the zero-cost boundary',
);
assert.match(
  gasFunding,
  /providerBillingLiability:\s*chain\.sponsoredBootstrap && sponsorReady && !sponsorCostProvenZero/,
  'rejected hosted sponsorship must preserve its provider-billing liability truth',
);
assert.match(
  gasFunding,
  /native balance exists but SELF_FUNDED system ownership is not proven/,
  'raw wallet native balance must not silently become system-owned gas capital',
);

assert.match(
  sponsorship,
  /paymasterService:\s*\{\s*policyId:\s*this\.policyId\s*\}/,
  'Alchemy sponsorship must remain identified as a hosted paymaster policy',
);

assert.doesNotMatch(
  systemCapital,
  /zeroMonetaryGasVerified:\s*true[\s\S]*zeroExternalNativeCapitalVerified:\s*true[\s\S]*zeroExternalInputCapitalVerified:\s*true/,
  'durable bootstrap capital must never manufacture all three zero-capital proofs',
);
assert.match(
  systemCapital,
  /zeroOperatorMonetaryGasVerified\s*!==\s*true/,
  'bootstrap credit must fail closed without zero operator monetary gas evidence',
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

console.log('[zero-capital-gas-truth] PASS: ZERO_CAPITAL_ATOMIC rejects operator/application gas liabilities and requires evidence-backed system-owned native provenance');
