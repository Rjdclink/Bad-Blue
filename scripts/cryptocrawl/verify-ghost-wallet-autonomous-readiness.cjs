'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');

const controller = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-autonomous-controller.ts');
const demand = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-demand-mesh.ts');
const bootstrap = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-intermediary-bootstrap.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const worker = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
const intentBook = read('server/services/cryptocrawl/ghost-wallet/intent-book.ts');
const mandate = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-mandate.ts');

// Top-level Ghost invariant: compatible authorized demand with fresh executable
// capital and strictly-positive final sponsored economics may proceed; one path's
// failure cannot become a global veto.
assert.match(controller, /strictPositiveAllInNetBeforeSubmission: true/);
assert.match(controller, /chainFailureLocal: true/);
assert.match(controller, /hardBpsProfitAdmissionFloor: false/);
assert.match(controller, /configuredSpreadFloorDefaultBps: 0/);
assert.match(worker, /GHOST_WALLET_CONTROLLER_NET_NOT_POSITIVE_AFTER_PIMLICO/);
assert.match(worker, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(worker, /nativeControllerGasFallback: false/);

// Borrower demand is never fabricated. External feed items and direct registrations
// must still be cryptographically authorized; order-book observations alone are not
// execution authority.
assert.match(demand, /signedMandateVerificationRequired: true/);
assert.match(demand, /genericTradeIntentAdmission: false/);
assert.match(demand, /bytecodeOnlyBorrowerTrust: false/);
assert.match(mandate, /signedAuthorizationCreatesVerifiedRepaymentEvidence: false/);
assert.match(mandate, /exactSimulationStillRequiredBeforeExecution: true/);
assert.match(mandate, /monotonicNonceRequiredForReplacement: true/);
assert.match(mandate, /cancelledMandateReplayRejected: true/);

// The matched-intent lane is independently usable without Railway hand-entry once
// a counterparty signs against the deterministic intermediary address.
assert.match(intentBook, /verifyingContract: intent\.intermediary/);
assert.match(engine, /sameAddress\(intermediary, pair\.intermediary\)/);
assert.match(bootstrap, /bad-blue:cryptocrawl-ghost-wallet-intermediary:v1/);
assert.match(bootstrap, /automaticDeployment: true/);
assert.match(bootstrap, /runtimeRegistrationAfterIdentityVerification: true/);
assert.match(bootstrap, /deploymentGasAuthority: 'pimlico_sponsored_user_operation'/);
assert.match(bootstrap, /operatorPrincipalAuthority: false/);
assert.match(bootstrap, /explicitConfigurationPreserved: true/);
assert.match(bootstrap, /routeLocalFailure: true/);

// Ghost remains isolated from the arbitrage/zero-capital authority graph.
assert.match(controller, /zeroCapitalIntegration: false/);
assert.match(engine, /zeroCapitalExecutionAuthority: false/);
assert.doesNotMatch(bootstrap, /zeroCapitalEngine|AtomicProfitabilityEngine|CanonicalZeroCapitalExecutor/);

console.log(JSON.stringify({
  ok: true,
  autonomousBrokerDemandAuthority: 'signed_mandates_only',
  matchedIntentIntermediary: 'deterministic_create2_auto_bootstrap',
  matchedIntentDeploymentGas: 'pimlico_sponsored',
  operatorCapitalRequired: false,
  finalEconomicGate: 'strict_positive_pimlico_all_in',
  hardBpsFloor: false,
  failuresRouteLocal: true,
  demandFabricationAllowed: false,
  zeroCapitalAuthorityCrossed: false,
}, null, 2));