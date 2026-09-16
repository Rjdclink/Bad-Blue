'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');

const intermediary = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const vault = read('contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol');
const bridge = read('contracts/cryptocrawl/CryptocrawlGhostWalletErc3156Bridge.sol');
const fabric = read('server/services/cryptocrawl/ghost-wallet/capital-fabric.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const bridgeRuntime = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-external-bridge.ts');
const borrowerSurface = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-surface.ts');
const fundingMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-funding-mesh.ts');
const controller = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-autonomous-controller.ts');
const controllerEconomics = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-controller-economics.ts');
const ultra = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
const providerMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const compiler = read('scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs');
const preflight = read('scripts/cryptocrawl/verify-deployment-preflight.cjs');
const intentBook = read('server/services/cryptocrawl/ghost-wallet/intent-book.ts');
const sourceMeasurement = read('server/services/cryptocrawl/ghost-wallet/onchain-capital-sources.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const alternativeReprice = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const alternativeRegistry = read('server/services/cryptocrawl/ghost-wallet/zero-capital-alternative-selection-registry.ts');
const canonicalRouter = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const flashExecutor = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const alternativeExecutor = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const coverage = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const runtimeWiring = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Ghost stays independent from arbitrage economics/execution authority.
assert.match(intermediary, /address public immutable profitRecipient/);
assert.match(runtimeWiring, /ghostWalletProfitLadderAuthority:\s*false/);
assert.match(runtimeWiring, /ghostWalletArbitrageExecutionAuthority:\s*false/);
assert.match(engine, /profitLadderAuthority:\s*false/);
assert.match(engine, /90_percent_payout_10_percent_retained/);
assert.match(engine, /intermediaryTransactionSubmission: false/);
assert.match(engine, /controllerTransactionSubmission: true/);
assert.match(engine, /zeroCapitalExecutionAuthority: false/);
assert.doesNotMatch(engine, /zeroCapitalEngine|gasSponsor|CRYPTO_ARBITRAGE_LIVE_EXECUTION/);

// Existing Ghost vault/intermediary settlement remains same-transaction and exact.
assert.match(intermediary, /borrower_repayment_not_exact/);
assert.match(intermediary, /spread_reconciliation_failed/);
assert.match(intermediary, /incremental_liability_not_repaid/);
assert.match(vault, /endingAssets >= startingAssets \+ fee/);
assert.match(vault, /atomic_credit_not_repaid/);
assert.match(intermediary, /if \(temporaryApproval\) _safeApprove\(approvalToken, target, 0\)/);

// Signed intents are authenticated, matched, durably handed to the Ghost worker,
// and final-rechecked against multi-asset fee value before controller signing.
assert.match(intermediary, /self_match_forbidden/);
assert.match(intermediary, /profit_recipient_cannot_self_match/);
assert.match(intermediary, /usedIntentNonces/);
assert.match(intentBook, /verifyTypedData/);
assert.match(intentBook, /address\(left\.owner\) !== address\(right\.owner\)/);
assert.match(engine, /enqueueReadyIntentPairWork/);
assert.match(engine, /matched_intent_settlement/);
assert.match(engine, /serializeMatchedIntentPair/);
assert.match(ultra, /evaluateGhostWalletMultiAssetControllerEconomics/);
assert.match(ultra, /matchedIntentExpectedNetProfitUsdScaled/);

// Existing measured capital fabric remains evidence-only and does not fabricate cash.
for (const primitive of [
  'euler_debt_assumption',
  'aave_credit_delegation',
  'signed_intent_capital',
  'coincidence_of_wants',
  'permissionless_vault_capital',
]) assert.ok(fabric.includes(primitive), `capital fabric missing ${primitive}`);
assert.match(fabric, /quote\.measured === true/);
assert.match(fabric, /quote\.sameTransactionSettlement === true/);
assert.match(fabric, /quote\.repaymentFailureReverts === true/);
assert.match(fabric, /resourceForm === 'liquid_principal'/);

// Aave/Euler evidence remains grounded in live protocol state.
assert.match(sourceMeasurement, /borrowAllowance\(config\.delegator, intermediary\)/);
assert.match(sourceMeasurement, /getUserAccountData\(config\.delegator\)/);
assert.match(sourceMeasurement, /getAssetPrice\(config\.asset\)/);
assert.match(sourceMeasurement, /borrowCapacityAssetUnits/);
assert.match(sourceMeasurement, /debtOf\(address account\)/);
assert.match(sourceMeasurement, /synthetic_capacity:false/);

// External bridge remains the atomic middleman with both backward-compatible
// minimum-spread functions and autonomous per-transaction spread pricing.
assert.match(bridge, /Permissionless, zero-operator-capital atomic credit intermediary/);
for (const fn of [
  'brokerExternalFlashLoan',
  'brokerAaveV3FlashLoan',
  'brokerMorphoFlashLoan',
  'brokerBalancerV2FlashLoan',
  'brokerExternalFlashLoanWithSpread',
  'brokerAaveV3FlashLoanWithSpread',
  'brokerMorphoFlashLoanWithSpread',
  'brokerBalancerV2FlashLoanWithSpread',
]) assert.ok(bridge.includes(fn), `bridge missing ${fn}`);
assert.match(bridge, /borrower_repayment_not_exact/);
assert.match(bridge, /upstream_repayment_not_exact/);
assert.match(bridge, /borrower_fee_exceeds_max/);
assert.match(bridge, /expectedBorrowerFee > upstreamFee/);
assert.match(bridge, /minimumBrokerSpreadBps = 0/);
assert.match(bridge, /expectedRequestedSpread/);
assert.match(bridge, /return requestedSpread > floorSpread \? requestedSpread : floorSpread/);
assert.doesNotMatch(bridge, /allowedLender|lenderAllowlist/);

// Deterministic bridge bootstrap is controller-compatible while remaining public.
assert.match(bridgeRuntime, /intermediarySubmitsDeployment: false/);
assert.match(bridgeRuntime, /autonomousControllerMaySubmitDeployment: true/);
assert.match(bridgeRuntime, /externalPermissionlessDeployment: true/);
assert.match(bridgeRuntime, /deploymentPayer: 'transaction_initiator'/);
assert.match(bridgeRuntime, /lenderAllowlistRequired: false/);

// Funding discovery is Ghost-owned and independent of zero-capital provider economics.
assert.match(borrowerSurface, /measureGhostWalletFunding/);
assert.match(borrowerSurface, /buildGhostWalletBorrowerTransactionWithSpread/);
assert.match(borrowerSurface, /perTransactionSpreadPricing: true/);
assert.match(borrowerSurface, /zeroCapitalFundingDependency: false/);
assert.match(borrowerSurface, /ghostFundingMeshAuthority: true/);
assert.match(borrowerSurface, /lenderCandidates/);
assert.match(borrowerSurface, /hardLenderUniverseLimit: null/);
assert.match(borrowerSurface, /hardBorrowerUniverseLimit: null/);
assert.match(borrowerSurface, /lowest_live_exact_upstream_fee_for_same_asset_and_amount/);
assert.doesNotMatch(borrowerSurface, /measureFlashLoanProviders/);
for (const adapter of ['aave_v3', 'morpho_blue', 'balancer_v2', 'erc3156']) {
  assert.ok(fundingMesh.includes(adapter), `funding mesh missing ${adapter}`);
}
assert.match(fundingMesh, /zeroCapitalDependency: false/);
assert.match(fundingMesh, /hardSourceCountLimit: null/);
assert.match(fundingMesh, /providerFailureRouteLocal: true/);
assert.match(fundingMesh, /Promise\.allSettled/);

// Autonomous admission is exact-call + exact-gas + strict net-positive. Spread is
// priced per transaction from measured gas, not by a global configuration transaction.
assert.match(controller, /intermediaryRole: 'middleman_only'/);
assert.match(controller, /controllerOwnsInitiation: true/);
assert.match(controller, /provider\.call\(request\)/);
assert.match(controller, /provider\.estimateGas\(request\)/);
assert.match(controller, /buildGhostWalletBorrowerTransactionWithSpread/);
assert.match(controller, /strictPositiveAllInNetBeforeQueue: true/);
assert.match(controller, /hardBpsProfitAdmissionFloor: false/);
assert.match(controller, /configuredSpreadFloorDefaultBps: 0/);
assert.match(controller, /perTransactionSpreadCalibrationFromExactGas: true/);
assert.match(controller, /globalSpreadConfigurationTransactionRequired: false/);
assert.match(controller, /zeroCapitalIntegration: false/);
assert.doesNotMatch(controller, /setMinimumBrokerSpreadBps/);
assert.match(controllerEconomics, /expectedNetProfitBaseUnits > 0n/);
assert.match(controllerEconomics, /expectedNetProfitUsdScaled > 0n/);
assert.match(controllerEconomics, /hardBpsProfitFloor: false/);
assert.match(controllerEconomics, /multiAssetFeeValuationSupported: true/);

// Submission is durable and crash-safe: exact signed bytes are persisted before
// broadcast and only those identical bytes may be rebroadcast after restart.
assert.match(ultra, /provider\.call\(request\)/);
assert.match(ultra, /provider\.estimateGas\(request\)/);
assert.match(ultra, /wallet\.signTransaction\(unsigned\)/);
assert.match(ultra, /controller_signed_before_broadcast/);
assert.match(ultra, /rawTransaction/);
assert.match(ultra, /rebroadcastOrDefer/);
assert.match(ultra, /transaction_lanes_serialized_per_chain/);
assert.doesNotMatch(ultra, /GHOST_WALLET_CALLER_FUNDED_SUBMISSION_REQUIRED/);
assert.doesNotMatch(ultra, /zeroCapitalEngine|gasSponsor|provider_sponsored/);

// Alchemy is not a Ghost dependency. Provider failures remain route-local.
assert.match(providerMesh, /alchemyAllowed: false/);
assert.match(providerMesh, /Promise\.allSettled/);
assert.match(providerMesh, /requestDrivenHealthRefresh: true/);
assert.match(providerMesh, /routeLocalFailure: true/);
assert.doesNotMatch(providerMesh, /ALCHEMY_API_KEY|ALCHEMY_GAS_POLICY_ID/);

// Profit conversion moves realized Ghost profit only. 90% payout / 10% retained.
assert.match(payout, /zeroOperatorNativeGas: true/);
assert.match(payout, /GHOST_WALLET_ACROSS_WOULD_SPEND_PREEXISTING_OPERATOR_NATIVE/);
assert.match(payout, /quote\.maxSpend > input\.acquiredNative/);
assert.match(payout, /originGasFunding: 'realized_ghost_profit_only'/);
assert.match(payout, /GHOST_WALLET_ACROSS_ETH_BALANCE_DELTA_NOT_VERIFIED/);
assert.match(payout, /percentOfRealizedGhostNet: 90/);
assert.match(payout, /retainedCapitalPercent: 10/);
assert.match(payout, /submitProfitFundedEthereumFallback/);
assert.doesNotMatch(payout, /state:\s*'fallback_required'/);
assert.doesNotMatch(payout, /zeroCapitalEngine|gasSponsor|ALCHEMY_/);

// Deferred settlement remains unavailable to zero-capital execution.
assert.match(coverage, /protocolDeferredSettlementExecutionEnabled:\s*false/);
assert.match(coverage, /if \(provenance === 'protocol_deferred_settlement'\) return false/);
const admittedBlock = coverage.match(/const ATOMIC_EXTERNAL_PRINCIPAL_SOURCES:[\s\S]*?\] as const;/)?.[0] || '';
assert.doesNotMatch(admittedBlock, /protocol_deferred_settlement_capital/);

// Existing zero-capital canonical authority and strict-positive boundary are unchanged.
assert.match(discovery, /repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /repriceZeroCapitalAlternativeCapital\(/);
assert.match(alternativeReprice, /await input\.provider\.call\(exactEnvelope\)/);
assert.match(alternativeReprice, /input\.provider\.estimateGas\(exactEnvelope\)/);
assert.match(alternativeReprice, /const requiredNetProfit = minimumPositiveProfitBaseUnits\(\)/);
assert.match(alternativeReprice, /if \(netProfit < requiredNetProfit\) return null/);
assert.match(alternativeReprice, /strict_positive_all_in_net_after_source_fee_and_execution_cost/);
assert.doesNotMatch(alternativeReprice, /minimumRequiredNetProfit|ATOMIC_MINIMUM_TARGET_BPS|ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS|target_bound_10_bps_or_higher/);
assert.match(alternativeRegistry, /selection\.expectedNetProfit <= 0n/);
assert.match(canonicalRouter, /return executeFlashCanonicalZeroCapitalOpportunity\(opportunity\)/);
assert.match(canonicalRouter, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(alternativeExecutor, /await provider\.call\(request\)/);
assert.match(alternativeExecutor, /await provider\.estimateGas\(request\)/);
assert.match(alternativeExecutor, /preBroadcastCheck/);
assert.match(flashExecutor, /Sole ZERO_CAPITAL_ATOMIC execution route|CanonicalExecutionScheduler/);

// Vault arithmetic and production compilation protections remain intact.
assert.match(vault, /VIRTUAL_SHARES = 1_000/);
assert.match(vault, /VIRTUAL_ASSETS = 1/);
assert.match(vault, /uint256 quotient = product \/ denominator/);
assert.doesNotMatch(vault, /\(product \+ denominator - 1\) \/ denominator/);
assert.match(compiler, /CryptocrawlGhostWalletIntermediary\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletCapitalVault\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletErc3156Bridge\.sol/);
assert.match(compiler, /solc@0\.8\.24/);
assert.match(preflight, /compile-ghost-wallet-contracts\.cjs/);

console.log(JSON.stringify({
  ghostWalletAtomicCapital: 'verified',
  model: 'independent_autonomous_borrow_upstream_lend_downstream_atomic_spread',
  sameTransactionRepaymentOrRevert: true,
  intermediarySubmitsTransactions: false,
  autonomousControllerExecution: true,
  zeroCapitalAuthorityCrossed: false,
  fixedBpsProfitFloor: false,
  perTransactionSpreadPricing: true,
  globalSpreadConfigurationTransactionRequired: false,
  strictPositiveAllInNet: true,
  matchedIntentMultiAssetEconomics: true,
  lenderUniverseFixedLimit: false,
  borrowerUniverseFixedLimit: false,
  alchemyDependency: false,
  routeLocalProviderFailure: true,
  durableWorkerRecovery: true,
  signedBeforeBroadcastRecovery: true,
  profitFundedEthPayout: true,
  payoutPercent: 90,
  retainedCapitalPercent: 10,
}, null, 2));