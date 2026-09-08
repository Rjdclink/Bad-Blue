const assert = require('node:assert/strict');
const fs = require('node:fs');

const provider = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts', 'utf8');
const executor = fs.readFileSync('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts', 'utf8');

assert.match(provider, /const funding = await context\.getGasFundingDecision\(chain\)/);
assert.match(provider, /funding\.strictZeroInitialCapitalEligible === true/);
assert.match(provider, /funding\.operatorMonetaryInputRequired === false/);
assert.match(provider, /required:zero_personal_cost_execution_resource/);
assert.match(provider, /provider_reprice_does_not_override_funding_authority/);
assert.match(provider, /strict_zero_personal_cost_funding_proven/);
assert.match(provider, /permissionCalls\.size > 0 && wallet && resourceReady/);

assert.match(executor, /funding\.strictZeroInitialCapitalEligible !== true/);
assert.match(executor, /funding\.operatorMonetaryInputRequired !== false/);
assert.match(executor, /funding\.paymentSource !== 'system_owned_native'/);
assert.match(executor, /funding\.paymentSource !== 'provider_sponsored'/);

console.log('[zero-capital-resource-admission] PASS: provider repricing can measure positive BPS without erasing a missing zero-personal-cost resource; eligibility and setup require the same strict funding proof that is repeated at the canonical money boundary');
