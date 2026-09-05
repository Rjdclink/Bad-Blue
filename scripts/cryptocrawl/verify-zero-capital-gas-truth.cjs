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
  /ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST[\s\S]*!== 'false'/,
  'strict zero-operator-cost gas policy must be enabled by default',
);
assert.match(
  gasFunding,
  /sponsorOperatorMonetaryCostProvenZero\s*===\s*true/,
  'hosted sponsorship must require independent zero-operator-monetary-cost proof',
);
assert.match(
  gasFunding,
  /nativeSystemOwnedProven\s*===\s*true/,
  'native gas must require durable system-ownership proof in strict mode',
);
assert.match(
  gasFunding,
  /configured hosted sponsorship does not prove zero operator monetary cost/,
  'strict rejection must preserve the distinction between wallet gas abstraction and operator monetary cost',
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

console.log('[zero-capital-gas-truth] PASS: strict cold-start gas and SELF_FUNDED credit require evidence-backed zero-operator-cost provenance');
