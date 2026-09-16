const fs = require('node:fs');
const assert = require('node:assert/strict');

const sponsorship = fs.readFileSync('server/services/cryptocrawl/strategies/gas-sponsorship.ts', 'utf8');
const funding = fs.readFileSync('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts', 'utf8');
const proof = fs.readFileSync('server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts', 'utf8');

// Alchemy Wallet API is a real zero-upfront-capital submission lane. Configuration
// alone never proves zero lifetime cost: provider-fronted gas remains a canonical
// economic liability unless independent billing evidence proves otherwise.
assert.match(sponsorship, /ALCHEMY_API_KEY/, 'canonical sponsorship must read the configured Alchemy API key');
assert.match(sponsorship, /ALCHEMY_GAS_POLICY_ID/, 'canonical sponsorship must read the configured Alchemy gas policy');
assert.match(sponsorship, /api\.g\.alchemy\.com/, 'canonical sponsorship must use the Alchemy Wallet API');
assert.match(sponsorship, /wallet_prepareCalls/, 'canonical sponsorship must prepare provider-sponsored calls');
assert.match(sponsorship, /wallet_sendPreparedCalls/, 'canonical sponsorship must submit prepared provider-sponsored calls');
assert.match(sponsorship, /paymasterService/, 'configured gas policy must be attached through paymasterService capability');

assert.match(funding, /strictZeroOperatorCostRequired/, 'optional stronger lifetime zero-cost policy must remain explicit');
assert.match(funding, /sponsorOperatorMonetaryCostProvenZero === true/, 'zero-gas-cost accounting can qualify only with independent zero-cost proof');
assert.match(funding, /providerBillingLiability:\s*true/, 'billed provider sponsorship must remain an explicit canonical liability');
const sponsorPrimary = funding.indexOf('if (sponsorConfiguredAndReady && !requireZeroOperatorCost)');
const nativeFallback = funding.indexOf("if (nativeBalance >= reserveFloor && proof.nativeSystemOwnedProven === true)");
assert.ok(sponsorPrimary >= 0 && nativeFallback > sponsorPrimary, 'ready Alchemy/provider sponsorship must precede system-owned native fallback for zero-initial-capital execution');
assert.match(proof, /sponsorOperatorMonetaryCostProvenZero:\s*false/, 'canonical proof must not promote generic hosted sponsorship to zero-cost evidence');

console.log(JSON.stringify({
  hostedProviderSponsorshipAuthority: 'primary_zero_initial_capital_lane',
  providerBilledGasAdmittedAsZeroInitialCapital: true,
  providerBillingChargedByCanonicalEconomics: true,
  zeroLifetimeOperatorCostAssumed: false,
  systemOwnedNativeFallbackPreserved: true,
}, null, 2));
