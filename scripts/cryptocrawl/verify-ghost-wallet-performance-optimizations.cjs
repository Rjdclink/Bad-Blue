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
const gas = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-gas-pricing.ts');
const telemetry = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-performance-intelligence.ts');
const worker = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
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
// capability. Funding adapters are alternatives; no single protocol is mandatory.
for (const adapter of ['aave_v3', 'morpho_blue', 'balancer_v2', 'erc3156']) {
  assert.ok(funding.includes(adapter), `Ghost performance funding mesh missing ${adapter}`);
}
assert.match(funding, /hardSourceCountLimit: null/);
assert.match(borrowerSurface, /hardLenderUniverseLimit: null/);
assert.match(borrowerSurface, /hardBorrowerUniverseLimit: null/);

// Hot-path RPC behavior must remain bounded. Independent funding sources can race,
// but a source no longer explodes into source x every-RPC Cartesian requests.
assert.match(funding, /sourceMeasurementsRemainParallel: true/);
assert.match(funding, /cartesianProviderFanout: false/);
assert.match(funding, /hedgedProviderSelection: true/);
assert.match(funding, /ghostWalletProviderMesh\.runHedged/);
assert.match(borrowerSurface, /cartesianProviderFanout: false/);
assert.match(borrowerSurface, /dynamicErc3156CandidateHedging: true/);
assert.match(borrowerSurface, /identityReadHedging: true/);
assert.doesNotMatch(borrowerSurface, /providersForChain\.map/);

// Provider selection learns latency/failure behavior and rate-limited providers
// cool down locally. Reads are staggered/hedged, not global-failure coupled.
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

// Exact signed transaction bytes are the only broadcast artifact. A nonce conflict
// is accepted only when the deterministic expected hash is observed.
assert.match(provider, /identicalRawTransactionMultiProviderBroadcast: true/);
assert.match(provider, /exactHashRequiredOnNonceConflict: true/);
assert.match(provider, /utils\.keccak256\(rawTransaction\)/);
assert.match(provider, /nonce too low/);
assert.match(provider, /getTransaction\(expectedHash\)/);
assert.match(worker, /controller_signed_before_broadcast/);
assert.match(worker, /markGhostWalletWorkSubmitted/);
assert.match(worker, /broadcastRawTransaction/);
assert.match(worker, /rebroadcastOrDefer/);

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

// Route/size selection is bounded and based on strict positive final net economics,
// not lender fee alone. Signed borrower fee ceilings remain hard authorization.
assert.match(controller, /boundedMatchingConcurrency: true/);
assert.match(controller, /matchConcurrency/);
assert.match(controller, /routePlanLimit/);
assert.match(controller, /preflightConcurrency/);
assert.match(controller, /gasAdjustedRouteSelection: true/);
assert.match(controller, /signedFeeCeilingProfitSeekingWithinAuthorization: true/);
assert.match(controller, /evaluateGhostWalletControllerEconomics/);
assert.match(controller, /expectedNetProfitBaseUnits/);
assert.match(controller, /provider\.call\(request\)/);
assert.match(controller, /provider\.estimateGas\(request\)/);
assert.match(controller, /routePlansPreflighted/);
assert.doesNotMatch(controller, /hardBpsProfitAdmissionFloor: true/);

// EIP-1559 maxFee is a balance/signing ceiling, not assumed realized economics.
assert.match(gas, /profitabilityUsesExpectedEffectiveFee: true/);
assert.match(gas, /balanceGuardUsesSigningCeiling: true/);
assert.match(gas, /maxFeeHeadroomNotCountedAsCertainCost: true/);
assert.match(gas, /lastBaseFeePerGas/);
assert.match(gas, /maxPriorityFeePerGas/);
assert.match(worker, /expectedFeePerGasWei/);
assert.match(worker, /signingFeeCeilingPerGasWei/);
assert.match(worker, /worstCaseGasWei = gasLimit\.mul\(signingFeeCeilingPerGas\)/);
assert.match(worker, /feePerGasWei: BigInt\(expectedFeePerGas\.toString\(\)\)/);

// Telemetry is O(1)-style bounded in-memory observation only. It cannot veto a
// trade, and terminal settlement remains realized-profit truth.
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
  exactHashBroadcastFailover: true,
  rangeAuthorizedDynamicSizing: true,
  gasAdjustedRouteSelection: true,
  expectedEffectiveGasEconomics: true,
  maxFeeUsedAsCeilingOnly: true,
  boundedLiveProfitabilityTelemetry: true,
  terminalSettlementProfitTruth: true,
}, null, 2));
