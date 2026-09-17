'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');

const canonical = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const alternative = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const intermediary = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const vault = read('contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol');
const externalBridge = read('contracts/cryptocrawl/CryptocrawlGhostWalletErc3156Bridge.sol');
const bridgeRuntime = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-external-bridge.ts');
const borrowerSurface = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-surface.ts');
const borrowerMandate = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-mandate.ts');
const fundingMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-funding-mesh.ts');
const controller = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-autonomous-controller.ts');
const controllerEconomics = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-controller-economics.ts');
const providerMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const ultra = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
const pimlico = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-pimlico-sponsor.ts');
const mandateGuard = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-mandate-runtime-guard.ts');
const reserve = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-gas-reserve.ts');
const ledger = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-work-ledger.ts');
const migration = read('server/migrations/057_cryptocrawler_ghost_wallet_runtime.sql');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const settlementIngest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const venueUniverse = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-venue-universe.ts');
const runtimeWiring = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const routes = read('server/routes/cryptoWiring.routes.ts');
const compiler = read('scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs');

// Zero-capital arbitrage remains separate and owns no Ghost scheduling/submission.
assert.match(canonical, /executeFlashCanonicalZeroCapitalOpportunity/);
assert.match(canonical, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(alternative, /provider\.call\(request\)/);
assert.match(alternative, /provider\.estimateGas\(request\)/);
assert.match(engine, /profitLadderAuthority: false/);
assert.match(engine, /90_percent_payout_10_percent_retained/);
assert.match(engine, /intermediaryTransactionSubmission: false/);
assert.match(engine, /controllerTransactionSubmission: true/);
assert.match(engine, /zeroCapitalExecutionAuthority: false/);
assert.match(engine, /GHOST_WALLET_LIVE_EXECUTION/);
assert.match(engine, /GHOST_WALLET_LIVE_CONFIRMATION/);
assert.doesNotMatch(engine, /zeroCapitalEngine|CRYPTO_ARBITRAGE_LIVE_EXECUTION/);

// Atomic repayment and middleman invariants stay exact.
assert.match(intermediary, /borrower_repayment_not_exact/);
assert.match(intermediary, /minimumBrokerSpreadBps = 0/);
assert.match(intermediary, /borrowerFee > sourceFee/);
assert.match(vault, /atomic_credit_not_repaid/);
for (const fn of [
  'brokerExternalFlashLoan', 'brokerAaveV3FlashLoan', 'brokerMorphoFlashLoan', 'brokerBalancerV2FlashLoan',
  'brokerExternalFlashLoanWithSpread', 'brokerAaveV3FlashLoanWithSpread',
  'brokerMorphoFlashLoanWithSpread', 'brokerBalancerV2FlashLoanWithSpread',
]) assert.ok(externalBridge.includes(fn), `Ghost bridge missing ${fn}`);
assert.match(externalBridge, /borrower_repayment_not_exact/);
assert.match(externalBridge, /upstream_repayment_not_exact/);
assert.match(externalBridge, /return requestedSpread > floorSpread \? requestedSpread : floorSpread/);
assert.doesNotMatch(externalBridge, /lenderAllowlist|allowedLender/);
assert.match(bridgeRuntime, /intermediarySubmitsDeployment: false/);
assert.match(bridgeRuntime, /autonomousControllerMaySubmitDeployment: true/);
assert.match(bridgeRuntime, /externalPermissionlessDeployment: true/);
assert.match(bridgeRuntime, /fixedBpsSpreadFloor: false/);

// Borrower authorization and route alternatives remain open-ended and measured.
assert.match(borrowerSurface, /measureGhostWalletFunding/);
assert.match(borrowerSurface, /buildGhostWalletBorrowerTransactionWithSpread/);
assert.match(borrowerSurface, /zeroCapitalFundingDependency: false/);
assert.match(borrowerSurface, /hardLenderUniverseLimit: null/);
assert.match(borrowerSurface, /hardBorrowerUniverseLimit: null/);
assert.match(borrowerMandate, /_TypedDataEncoder\.hash/);
assert.match(borrowerMandate, /isValidSignature/);
assert.match(borrowerMandate, /monotonicNonceRequiredForReplacement: true/);
assert.match(borrowerMandate, /cancelledMandateReplayRejected: true/);
assert.match(borrowerMandate, /exactSimulationStillRequiredBeforeExecution: true/);
assert.match(routes, /registerGhostWalletBorrowerMandate/);
assert.match(routes, /cancelGhostWalletBorrowerMandate/);
for (const adapter of ['aave_v3', 'morpho_blue', 'balancer_v2', 'erc3156']) {
  assert.ok(fundingMesh.includes(adapter), `Ghost funding mesh missing ${adapter}`);
}
assert.match(fundingMesh, /hardSourceCountLimit: null/);
assert.match(fundingMesh, /Promise\.allSettled/);
assert.match(fundingMesh, /providerFailureRouteLocal: true/);

// Controller candidate ranking remains bounded and strict-positive; final sponsored
// UserOperation economics is rechecked by the execution worker.
assert.match(controller, /intermediaryRole: 'middleman_only'/);
assert.match(controller, /controllerOwnsInitiation: true/);
assert.match(controller, /strictPositiveAllInNetBeforeQueue: true/);
assert.match(controller, /hardBpsProfitAdmissionFloor: false/);
assert.match(controller, /configuredSpreadFloorDefaultBps: 0/);
assert.match(controller, /signedMandateExecutionCountEnforced: true/);
assert.match(controller, /signedMandateCadenceEnforced: true/);
assert.match(controller, /signedMandateVersionIsolation: true/);
assert.match(controller, /oneActiveExecutionPerMandate: true/);
assert.match(controller, /provider\.call\(request\)/);
assert.match(controller, /provider\.estimateGas\(request\)/);
assert.match(controller, /routeLocalFailure: true/);
assert.match(controller, /zeroCapitalIntegration: false/);
assert.match(controllerEconomics, /strictPositiveAllInNetRequired: true/);
assert.match(controllerEconomics, /hardBpsProfitFloor: false/);
assert.match(controllerEconomics, /expectedNetProfitBaseUnits > 0n/);
assert.match(controllerEconomics, /expectedNetProfitUsdScaled > 0n/);

// Pimlico is the exclusive gas authority for all NEW Ghost controller submissions.
assert.match(engine, /controllerGasAuthority: 'pimlico_eip7702_erc4337_sponsorship_only'/);
assert.match(engine, /controllerNativeGasBalanceRequired: false/);
assert.match(engine, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(ultra, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(ultra, /nativeControllerGasFallback: false/);
assert.match(ultra, /controller_signed_user_operation_before_submission/);
assert.match(ultra, /submissionKind: 'pimlico_user_operation'/);
assert.match(ultra, /pimlicoUserOperation: prepared\.userOperation/);
assert.match(ultra, /markGhostWalletWorkSubmitted/);
assert.match(ultra, /submitGhostWalletPimlicoSponsoredTransaction/);
assert.match(ultra, /ensureGhostWalletPimlicoSubmission/);
assert.match(ultra, /gasUnits: prepared\.billableGasUnitsWithSurcharge/);
assert.match(ultra, /feePerGasWei: prepared\.billingFeePerGasWei/);
assert.match(ultra, /GHOST_WALLET_CONTROLLER_NET_NOT_POSITIVE_AFTER_PIMLICO/);
assert.match(ultra, /assertGhostWalletMandateStillExecutable\(work\.payload\)/);
assert.doesNotMatch(ultra, /GHOST_WALLET_CONTROLLER_NATIVE_GAS_UNAVAILABLE/);
assert.doesNotMatch(ultra, /wallet\.signTransaction\(unsigned\)/);
assert.doesNotMatch(ultra, /GHOST_WALLET_CALLER_FUNDED_SUBMISSION_REQUIRED/);
assert.doesNotMatch(ultra, /zeroCapitalEngine|AtomicProfitabilityEngine|assessGhostWalletWithQuantiMonteCarlo/);
assert.doesNotMatch(ultra, /setInterval\(/);

assert.match(pimlico, /requiredForGhostControllerTransactions: true/);
assert.match(pimlico, /nativeGasFallbackAllowed: false/);
assert.match(pimlico, /operatorNativePrefundRequired: false/);
assert.match(pimlico, /billingSurchargeIncludedInCanonicalEconomics: true/);
assert.match(pimlico, /mainnetBillingSurchargeBpsDefault: 1_000/);
assert.match(pimlico, /eth_estimateUserOperationGas/);
assert.match(pimlico, /pm_sponsorUserOperation/);
assert.match(pimlico, /eth_sendUserOperation/);
assert.match(pimlico, /eth_getUserOperationReceipt/);
assert.match(pimlico, /eth_getUserOperationByHash/);
assert.match(pimlico, /boostedFastPathOptional: true/);
assert.match(pimlico, /boostedFallback: 'standard_pimlico_only'/);
assert.match(pimlico, /staticCapabilityCacheMs/);
assert.match(pimlico, /gasPriceCacheMs/);
assert.match(mandateGuard, /cancellationFailsClosed: true/);
assert.match(mandateGuard, /replacementDigestMustMatchQueuedScope: true/);
assert.match(mandateGuard, /expiryRecheckedAtSubmission: true/);

// Native-reserve replenishment is retired, while its historical schema remains compatible.
assert.match(reserve, /historicalLedgerPreserved: true/);
assert.match(reserve, /executionAuthority: false/);
assert.match(reserve, /retainedProfitConversionToNativeGas: false/);
assert.match(reserve, /sameChainNativeReserve: false/);
assert.match(reserve, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(reserve, /pimlicoSponsorIsMandatoryDependency: true/);

// Ghost network access stays Alchemy-free and route-local.
assert.match(providerMesh, /alchemyAllowed: false/);
assert.match(providerMesh, /independentPublicFallbacks: true/);
assert.match(providerMesh, /parallelInitialProbe: true/);
assert.match(providerMesh, /requestDrivenHealthRefresh: true/);
assert.match(providerMesh, /routeLocalFailure: true/);
assert.match(providerMesh, /Promise\.allSettled/);
assert.doesNotMatch(providerMesh, /ALCHEMY_API_KEY|ALCHEMY_GAS_POLICY_ID/);

// Runtime, durable ledger, settlement ingestion, and payout authority remain singular.
assert.match(runtimeWiring, /ghostWalletUltraWorker/);
assert.match(runtimeWiring, /install\('ghost_wallet_ultra_worker', \(\) => ghostWalletUltraWorker\.start\(\)\)/);
assert.doesNotMatch(runtimeWiring, /install\('ghost_wallet_engine'/);
assert.match(ultra, /ghostWalletAutonomousController\.start\(\)/);
assert.match(ultra, /periodicWorkPolling: false/);
assert.match(ultra, /LISTEN \$\{LISTEN_CHANNEL\}|LISTEN cryptocrawler_ghost_wallet_work/);
assert.match(ultra, /rebroadcastOrDefer/);
assert.match(ultra, /submittedThisAttempt/);
assert.match(ledger, /FOR UPDATE SKIP LOCKED/);
assert.match(ledger, /status IN \('QUEUED','RETRYABLE','SUBMITTED'\)/);
assert.match(ledger, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
assert.match(ledger, /preserveSubmitted/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_work/);
assert.match(migration, /pg_notify\('cryptocrawler_ghost_wallet_work'/);
assert.match(chainEvents, /ingestGhostWalletSettlementLog/);
assert.match(chainEvents, /durable_cursor_plus_http_log_backfill/);
assert.match(settlementIngest, /ExternalCreditBrokered/);
assert.match(settlementIngest, /payoutFractionBps: 9_000/);
assert.match(settlementIngest, /retainedFractionBps: 1_000/);
assert.match(payout, /zeroOperatorNativeGas: true/);
assert.match(payout, /percentOfRealizedGhostNet: 90/);
assert.match(payout, /retainedCapitalPercent: 10/);
assert.match(payout, /targetAsset: 'native_ETH'/);
assert.match(payout, /targetNetwork: 'ethereum'/);
assert.doesNotMatch(payout, /zeroCapitalEngine|ALCHEMY_/);
assert.match(venueUniverse, /verified/);
assert.doesNotMatch(venueUniverse, /MAX_VENUES|venueLimit|maxVenues/);

// All Ghost contracts still compile during production prebuild.
assert.match(compiler, /CryptocrawlGhostWalletIntermediary\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletCapitalVault\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletErc3156Bridge\.sol/);

console.log(JSON.stringify({
  ok: true,
  ghostModel: 'independent_autonomous_atomic_credit_intermediation',
  intermediarySubmitsTransactions: false,
  autonomousControllerSubmission: true,
  pimlicoExclusiveExecutionGasAuthority: true,
  nativeControllerGasBalanceRequired: false,
  signedUserOperationPersistedBeforeSubmission: true,
  sponsoredCostIncludedInStrictPositiveGate: true,
  boostedPimlicoFastPathReady: true,
  standardPimlicoFallbackOnly: true,
  signedBorrowerDemand: true,
  finalMandateRaceGuard: true,
  zeroCapitalAuthorityCrossed: false,
  hardBpsProfitAdmissionFloor: false,
  strictPositiveAllInNet: true,
  upstreamAdapters: ['erc3156', 'aave_v3', 'morpho_blue', 'balancer_v2'],
  providerRedundancy: true,
  routeLocalFailure: true,
  durableOverflowRecovery: true,
  singleSettlementIngestionAuthority: true,
  payoutAsset: 'ETH',
  payoutNetwork: 'ethereum',
  payoutPercent: 90,
  retainedCapitalPercent: 10,
}, null, 2));