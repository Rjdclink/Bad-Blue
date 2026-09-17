const fs = require('node:fs');
const assert = require('node:assert/strict');

const sponsorship = fs.readFileSync('server/services/cryptocrawl/strategies/gas-sponsorship.ts', 'utf8');
const funding = fs.readFileSync('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts', 'utf8');
const proof = fs.readFileSync('server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts', 'utf8');

// Pimlico ERC-4337/EIP-7702 is the sole APE bootstrap gas lane. Sponsorship removes
// the upfront native-capital requirement, while provider billing remains canonical
// economic cost unless independently proven zero.
assert.match(sponsorship, /APE_PIMLICO_API_KEY|PIMLICO_API_KEY/, 'canonical APE sponsorship must read Pimlico credentials');
assert.match(sponsorship, /api\.pimlico\.io\/v2\//, 'canonical APE sponsorship must use Pimlico v2 RPC');
assert.match(sponsorship, /pimlico_getUserOperationGasPrice/, 'canonical APE sponsorship must read Pimlico gas-price evidence');
assert.match(sponsorship, /eth_estimateUserOperationGas/, 'canonical APE sponsorship must estimate the exact UserOperation gas');
assert.match(sponsorship, /pm_sponsorUserOperation/, 'canonical APE sponsorship must obtain Pimlico paymaster data');
assert.match(sponsorship, /eth_sendUserOperation/, 'canonical APE sponsorship must submit the sponsored UserOperation');
assert.match(sponsorship, /eth_getUserOperationReceipt/, 'canonical APE sponsorship must reconcile the UserOperation receipt');
assert.match(sponsorship, /APE_PIMLICO_STAGE_ONE_OVERHEAD_GAS_UNITS/, 'Stage One must include sponsored UserOperation overhead');
assert.match(sponsorship, /APE_PIMLICO_SURCHARGE_BPS/, 'Pimlico billing surcharge must remain explicit');

assert.match(funding, /strictZeroOperatorCostRequired/, 'optional stronger lifetime zero-cost policy must remain explicit');
assert.match(funding, /sponsorOperatorMonetaryCostProvenZero === true/, 'zero-gas-cost accounting can qualify only with independent zero-cost proof');
assert.match(funding, /providerBillingLiability:\s*true/, 'billed provider sponsorship must remain an explicit canonical liability');
assert.match(proof, /Pimlico sponsorship is the only executable gas source/, 'Pimlico must be the sole APE bootstrap gas authority');
assert.match(proof, /if \(selfFundedAuthority\)/, 'native gas may replace Pimlico only after durable SELF_FUNDED authority exists');
assert.match(proof, /APE_SELF_FUNDED_GAS_RUNWAY_MULTIPLIER/, 'Pimlico retirement must require a durable retained-profit gas runway');
assert.match(proof, /Pimlico is the sole APE bootstrap gas provider and is unavailable/, 'bootstrap must fail closed when Pimlico is unavailable');
assert.match(proof, /sponsorOperatorMonetaryCostProvenZero:\s*false/, 'canonical proof must not promote generic hosted sponsorship to zero-cost evidence');

console.log(JSON.stringify({
  hostedProviderSponsorshipAuthority: 'pimlico_only_during_bootstrap',
  providerBilledGasAdmittedAsZeroInitialCapital: true,
  providerBillingChargedByCanonicalEconomics: true,
  stageOneUsesPimlicoGasPriceAndOverhead: true,
  zeroLifetimeOperatorCostAssumed: false,
  selfFundedNativeReplacementRequiresDurableRunway: true,
  operatorNativeFallbackDuringBootstrap: false,
}, null, 2));
