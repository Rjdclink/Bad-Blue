'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');

const controller = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-autonomous-controller.ts');
const mandate = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-mandate.ts');
const borrowerSurface = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-surface.ts');
const funding = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-funding-mesh.ts');
const provider = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const bridge = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-external-bridge.ts');
const telemetry = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-performance-intelligence.ts');
const worker = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
const sponsor = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-pimlico-sponsor.ts');
const mandateGuard = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-mandate-runtime-guard.ts');
const settlement = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const routes = read('server/routes/cryptoWiring.routes.ts');
const zeroCapital = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');

// Ghost remains an independent authority. Performance work must never migrate
// scheduling or execution into the zero-capital/APE path.
assert.match(controller, /zeroCapitalIntegration: false/);
assert.match(controller, /intermediaryRole: 'middleman_only'/);
assert.match(worker, /zeroCapitalExecutionAuthority: false/);
assert.doesNotMatch(controller, /zeroCapitalEngine|AtomicProfitabilityEngine|APE/);
assert.doesNotMatch(worker, /zeroCapitalEngine|AtomicProfitabilityEngine|assessGhostWalletWithQuantiMonteCarlo/);
assert.match(zeroCapital, /executeFlashCanonicalZeroCapitalOpportunity|executeAlternativePreparedWithinCanonicalExecutor/);

// Counterparties remain open-ended but executable routes require measured live
// capability. Funding adapters are alternatives; no single capital protocol is mandatory.
for (const adapter of ['aave_v3', 'morpho_blue', 'balancer_v2', 'erc3156']) {
  assert.ok(funding.includes(adapter), `Ghost performance funding mesh missing ${adapter}`);
}
assert.match(funding, /hardSourceCountLimit: null/);
assert.match(borrowerSurface, /hardLenderUniverseLimit: null/);
assert.match(borrowerSurface, /hardBorrowerUniverseLimit: null/);

// Hot-path RPC behavior remains bounded and route-local.
assert.match(funding, /sourceMeasurementsRemainParallel: true/);
assert.match(funding, /cartesianProviderFanout: false/);
assert.match(funding, /hedgedProviderSelection: true/);
assert.match(funding, /ghostWalletProviderMesh\.runHedged/);
assert.match(borrowerSurface, /cartesianProviderFanout: false/);
assert.match(borrowerSurface, /dynamicErc3156CandidateHedging: true/);
assert.match(borrowerSurface, /identityReadHedging: true/);
assert.doesNotMatch(borrowerSurface, /providersForChain\.map/);

assert.match(provider, /adaptiveLatencyRanking: true/);
assert.match(provider, /hedgedReadFailover: true/);
assert.match(provider, /providerCircuitBreaking: true/);
assert.match(provider, /providerFailureCooldownMs/);
assert.match(provider, /429\|rate limit\|too many requests/);
assert.match(provider, /ewmaLatencyMs/);
assert.match(provider, /runHedged/);
assert.match(provider, /hedgeDelayMs/);
assert.match(bridge, /hedgedProviderReads: true/);
assert.match(bridge, /providerCircuitBreakerAware: true/);

// New Ghost controller submissions are exclusively Pimlico EIP-7702/ERC-4337.
// The exact signed UserOperation is persisted before submission and exact hash is verified.
assert.match(worker, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(worker, /nativeControllerGasFallback: false/);
assert.match(worker, /controller_signed_user_operation_before_submission/);
assert.match(worker, /submissionKind: 'pimlico_user_operation'/);
assert.match(worker, /pimlicoUserOperation: prepared\.userOperation/);
assert.match(worker, /submitGhostWalletPimlicoSponsoredTransaction/);
assert.match(worker, /ensureGhostWalletPimlicoSubmission/);
assert.match(worker, /billableGasUnitsWithSurcharge/);
assert.doesNotMatch(worker, /GHOST_WALLET_CONTROLLER_NATIVE_GAS_UNAVAILABLE/);
assert.doesNotMatch(worker, /wallet\.signTransaction\(unsigned\)/);
assert.match(sponsor, /requiredForGhostControllerTransactions: true/);
assert.match(sponsor, /nativeGasFallbackAllowed: false/);
assert.match(sponsor, /operatorNativePrefundRequired: false/);
assert.match(sponsor, /eth_sendUserOperation/);
assert.match(sponsor, /eth_getUserOperationReceipt/);
assert.match(sponsor, /eth_getUserOperationByHash/);
assert.match(sponsor, /GHOST_WALLET_PIMLICO_USER_OPERATION_HASH_MISMATCH/);
assert.match(sponsor, /staticCapabilityCacheMs/);
assert.match(sponsor, /gasPriceCacheMs/);
assert.match(sponsor, /boostedFastPathOptional: true/);
assert.match(sponsor, /boostedFallback: 'standard_pimlico_only'/);
assert.match(sponsor, /mainnetBillingSurchargeBpsDefault: 1_000/);
assert.match(sponsor, /billingSurchargeIncludedInCanonicalEconomics: true/);

// Final mandate cancellation/version/expiry is rechecked at the signing boundary.
assert.match(worker, /assertGhostWalletMandateStillExecutable\(work\.payload\)/);
assert.match(mandateGuard, /cancellationFailsClosed: true/);
assert.match(mandateGuard, /replacementDigestMustMatchQueuedScope: true/);
assert.match(mandateGuard, /expiryRecheckedAtSubmission: true/);

// Existing exact-amount signatures stay valid. Dynamic sizing is only enabled by
// an explicit signed min/preferred/max range and never inferred from an exact mandate.
assert.match(mandate, /BorrowerMandate:/);
assert.match(mandate, /BorrowerRangeMandate:/);
assert.match(mandate, /minAmountBaseUnits/);
assert.match(mandate, /preferredAmountBaseUnits/);
assert.match(mandate, /maxAmountBaseUnits/);
assert.match(mandate, /exactAmountMandatesRemainBackwardCompatible: true/);
assert.match(mandate, /rangeAuthorizedDynamicSizing: true/);
assert.match(controller, /rangeAuthorizedDynamicSizing: true/);
assert.match(controller, /amountCandidates/);
assert.match(controller, /sizeCandidateLimit/);

// Route/size selection remains bounded. Native preflight is functional/advisory only;
// exact sponsored UserOperation economics is the final strict-positive execution gate.
assert.match(controller, /boundedMatchingConcurrency: true/);
assert.match(controller, /matchConcurrency/);
assert.match(controller, /routePlanLimit/);
assert.match(controller, /preflightConcurrency/);
assert.match(controller, /nativeEstimateBeforeQueue: 'functional_preflight_and_spread_hint_only'/);
assert.match(controller, /nativeGasEconomicsVetoAuthority: false/);
assert.match(controller, /pimlicoSponsoredUserOperationFinalEconomicsAuthority: true/);
assert.match(controller, /strictPositiveAllInNetBeforeSubmission: true/);
assert.match(controller, /signedFeeCeilingProfitSeekingWithinAuthorization: true/);
assert.match(controller, /evaluateGhostWalletControllerEconomics/);
assert.match(controller, /expectedNetProfitBaseUnits/);
assert.doesNotMatch(controller, /provider\.call\(request\)/);
assert.match(controller, /provider\.estimateGas\(request\)/);
assert.match(controller, /routePlansPreflighted/);
assert.doesNotMatch(controller, /hardBpsProfitAdmissionFloor: true/);
assert.match(worker, /feePerGasWei: prepared\.billingFeePerGasWei/);
assert.match(worker, /gasUnits: prepared\.billableGasUnitsWithSurcharge/);
assert.match(worker, /GHOST_WALLET_CONTROLLER_NET_NOT_POSITIVE_AFTER_PIMLICO/);

// Telemetry remains advisory and bounded; terminal settlement remains profit truth.
assert.match(telemetry, /MAX_METRICS = 512/);
assert.match(telemetry, /EWMA_ALPHA = 0\.2/);
assert.match(telemetry, /executionAuthority: false/);
assert.match(telemetry, /advisoryRankingOnly: true/);
assert.match(telemetry, /constantTimeHotPathObservation: true/);
assert.match(telemetry, /realizedSettlementRemainsTruthAuthority: true/);
assert.match(settlement, /recordGhostWalletPerformance/);
assert.match(settlement, /realizedProfitBaseUnits/);
assert.match(routes, /\/ghost-wallet\/telemetry/);
assert.match(routes, /authority: 'telemetry_only_terminal_settlement_remains_profit_truth'/);

console.log(JSON.stringify({
  ok: true,
  ghostPerformanceOptimization: 'verified',
  zeroCapitalAuthorityCrossed: false,
  cartesianProviderFanout: false,
  hedgedProviderReads: true,
  providerCircuitBreaking: true,
  exclusivePimlicoExecutionGas: true,
  nativeWalletGasRequired: false,
  signedUserOperationPersistedBeforeSubmission: true,
  exactUserOperationHashRequired: true,
  boostedPimlicoFastPathReady: true,
  standardPimlicoFallbackOnly: true,
  sponsoredCostIncludedInProfitability: true,
  finalMandateRaceGuard: true,
  rangeAuthorizedDynamicSizing: true,
  boundedLiveProfitabilityTelemetry: true,
  terminalSettlementProfitTruth: true,
}, null, 2));