const fs = require('node:fs');
const assert = require('node:assert/strict');

const sponsorship = fs.readFileSync('server/services/cryptocrawl/strategies/gas-sponsorship.ts', 'utf8');
const funding = fs.readFileSync('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts', 'utf8');
const proof = fs.readFileSync('server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts', 'utf8');

assert.match(sponsorship, /ready:\s*false/, 'retired hosted sponsorship must never report ready');
assert.match(sponsorship, /HOSTED_GAS_SPONSORSHIP_RETIRED_USE_PROVEN_CANONICAL_FUNDING_ROUTE/, 'legacy sponsorship execution must fail closed');
assert.match(sponsorship, /operatorBillingLiability:\s*false/, 'retired lane itself creates no new billing liability');
assert.match(sponsorship, /zeroOperatorCostProven:\s*false/, 'retirement must not masquerade as zero-cost sponsorship proof');
assert.doesNotMatch(sponsorship, /ALCHEMY_API_KEY/, 'retired sponsorship must not read an Alchemy API key');
assert.doesNotMatch(sponsorship, /ALCHEMY_GAS_POLICY_ID/, 'retired sponsorship must not read an Alchemy gas policy');
assert.doesNotMatch(sponsorship, /api\.g\.alchemy\.com/, 'retired sponsorship must not call Alchemy Wallet API');
assert.doesNotMatch(sponsorship, /wallet_prepareCalls/, 'retired sponsorship must not prepare provider-billed calls');
assert.doesNotMatch(sponsorship, /wallet_sendPreparedCalls/, 'retired sponsorship must not submit provider-billed calls');

assert.match(funding, /strictZeroOperatorCostRequired\(\): boolean \{\s*return true;/s, 'hard zero-operator-cost rule must remain non-configurable');
assert.match(funding, /sponsorOperatorMonetaryCostProvenZero === true/, 'sponsorship can qualify only with independent zero-cost proof');
assert.match(funding, /providerBillingLiability:\s*chain\.sponsoredBootstrap && sponsorReady && !sponsorCostProvenZero/, 'billed provider sponsorship must remain an explicit liability');
assert.match(proof, /sponsorOperatorMonetaryCostProvenZero:\s*false/, 'canonical proof must not promote generic hosted sponsorship to zero-cost evidence');

console.log(JSON.stringify({
  hostedProviderSponsorshipAuthority: 'retired_fail_closed',
  providerBilledGasAdmittedAsZeroCapital: false,
  strictZeroOperatorCostPreserved: true,
  systemOwnedNativeProofPreserved: true,
  alternativeCanonicalFundingRoutesPreserved: true,
}, null, 2));
