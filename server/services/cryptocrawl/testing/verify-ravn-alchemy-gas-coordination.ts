import assert from 'node:assert/strict';
import {
  getRavnExactCallSponsorshipCapability,
  selectExactCallGasProvider,
  type RavnExactCallSponsorshipCapability,
} from '../execution/adapters/ravn-alchemy-gas-coordinator.js';

const current = getRavnExactCallSponsorshipCapability();
assert.equal(current.provider, 'ravn');
assert.equal(current.supportsArbitrarySponsoredCall, false);
assert.equal(current.operatorMonetaryGasCostProvenZero, false);
assert.equal(current.requiresNetworkProbe, false);

const fallback = selectExactCallGasProvider({ alchemyReady: true });
assert.equal(fallback.provider, 'alchemy-gas-manager');
assert.equal(fallback.preferredProvider, 'ravn');
assert.equal(fallback.fallbackUsed, true);
assert.equal(fallback.networkProbeAddedBeforeFallback, false);

const unavailable = selectExactCallGasProvider({ alchemyReady: false });
assert.equal(unavailable.provider, 'unavailable');
assert.equal(unavailable.fallbackUsed, false);
assert.equal(unavailable.networkProbeAddedBeforeFallback, false);

const futureProvenRavn: RavnExactCallSponsorshipCapability = {
  provider: 'ravn',
  supportsArbitrarySponsoredCall: true,
  operatorMonetaryGasCostProvenZero: true,
  requiresNetworkProbe: false,
  reason: 'test-only proven exact-call capability',
};
const preferred = selectExactCallGasProvider({ alchemyReady: true, ravnCapability: futureProvenRavn });
assert.equal(preferred.provider, 'ravn');
assert.equal(preferred.fallbackUsed, false);

const billedRavn: RavnExactCallSponsorshipCapability = {
  ...futureProvenRavn,
  operatorMonetaryGasCostProvenZero: false,
  reason: 'test-only billed RAVN lane',
};
const billedFallsBack = selectExactCallGasProvider({ alchemyReady: true, ravnCapability: billedRavn });
assert.equal(billedFallsBack.provider, 'alchemy-gas-manager');
assert.equal(billedFallsBack.fallbackUsed, true);

console.log('RAVN_ALCHEMY_GAS_COORDINATION_VERIFIED');
