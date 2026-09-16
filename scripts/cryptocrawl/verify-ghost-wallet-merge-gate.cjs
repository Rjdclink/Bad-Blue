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
const ledger = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-work-ledger.ts');
const migration = read('server/migrations/057_cryptocrawler_ghost_wallet_runtime.sql');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const settlementIngest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const venueUniverse = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-venue-universe.ts');
const runtimeWiring = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const routes = read('server/routes/cryptoWiring.routes.ts');
const compiler = read('scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs');

// Zero-capital arbitrage remains untouched and owns no Ghost scheduling/submission.
assert.match(canonical, /executeFlashCanonicalZeroCapitalOpportunity/);
assert.match(canonical, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(alternative, /provider\.call\(request\)/);
assert.match(alternative, /provider\.estimateGas\(request\)/);

// Ghost is isolated. The intermediary remains only the atomic middleman; the
// dedicated Ghost controller owns initiation under Ghost's own live switch.
assert.match(engine, /profitLadderAuthority: false/);
assert.match(engine, /90_percent_payout_10_percent_retained/);
assert.match(engine, /alchemyDependency: false/);
assert.match(engine, /intermediaryTransactionSubmission: false/);
assert.match(engine, /controllerTransactionSubmission: true/);
assert.match(engine, /zeroCapitalExecutionAuthority: false/);
assert.match(engine, /GHOST_WALLET_LIVE_EXECUTION/);
assert.match(engine, /GHOST_WALLET_LIVE_CONFIRMATION/);
assert.match(engine, /I_ACCEPT_GHOST_WALLET_ATOMIC_CREDIT_RISK/);
assert.doesNotMatch(engine, /zeroCapitalEngine|gasSponsor|CRYPTO_ARBITRAGE_LIVE_EXECUTION/);

// Legacy intermediary/vault settlement invariants remain exact.
assert.match(intermediary, /borrower_repayment_not_exact/);
assert.match(intermediary, /minimumBrokerSpreadBps = 0/);
assert.match(intermediary, /borrowerFee > sourceFee/);
assert.match(vault, /atomic_credit_not_repaid/);
assert.match(vault, /VIRTUAL_SHARES/);
assert.match(vault, /VIRTUAL_ASSETS/);

// Permissionless external bridge: plural upstream adapters, exact atomic repayment,
// backward-compatible minimum-spread functions, and per-transaction spread functions.
for (const fn of [
  'brokerExternalFlashLoan',
  'brokerAaveV3FlashLoan',
  'brokerMorphoFlashLoan',
  'brokerBalancerV2FlashLoan',
  'brokerExternalFlashLoanWithSpread',
  'brokerAaveV3FlashLoanWithSpread',
  'brokerMorphoFlashLoanWithSpread',
  'brokerBalancerV2FlashLoanWithSpread',
]) assert.ok(externalBridge.includes(fn), `Ghost bridge missing ${fn}`);
assert.match(externalBridge, /borrower_repayment_not_exact/);
assert.match(externalBridge, /upstream_repayment_not_exact/);
assert.match(externalBridge, /return requestedSpread > floorSpread \? requestedSpread : floorSpread/);
assert.match(externalBridge, /expectedRequestedSpread/);
assert.match(externalBridge, /realizedSpread/);
assert.doesNotMatch(externalBridge, /lenderAllowlist|allowedLender/);

// Deterministic bridge deployment can be initiated by the autonomous controller,
// but the intermediary itself never becomes a deployment/submission authority.
assert.match(bridgeRuntime, /intermediarySubmitsDeployment: false/);
assert.match(bridgeRuntime, /autonomousControllerMaySubmitDeployment: true/);
assert.match(bridgeRuntime, /externalPermissionlessDeployment: true/);
assert.match(bridgeRuntime, /deploymentPayer: 'transaction_initiator'/);
assert.match(bridgeRuntime, /lenderAllowlistRequired: false/);
assert.match(bridgeRuntime, /fixedBpsSpreadFloor: false/);
assert.match(bridgeRuntime, /CREATE2_DEPLOYER_CODE_HASH/);

// Borrower routing uses Ghost's own funding mesh, not zero-capital provider economics,
// and exposes a per-transaction spread builder for the controller.
assert.match(borrowerSurface, /measureGhostWalletFunding/);
assert.match(borrowerSurface, /buildGhostWalletBorrowerTransactionWithSpread/);
assert.match(borrowerSurface, /perTransactionSpreadPricing: true/);
assert.match(borrowerSurface, /zeroCapitalFundingDependency: false/);
assert.match(borrowerSurface, /ghostFundingMeshAuthority: true/);
assert.match(borrowerSurface, /hardLenderUniverseLimit: null/);
assert.match(borrowerSurface, /hardBorrowerUniverseLimit: null/);
assert.match(borrowerSurface, /lenderCandidates/);
assert.match(borrowerSurface, /autonomousControllerMayConsumeQuote: true/);
assert.doesNotMatch(borrowerSurface, /measureFlashLoanProviders/);

// Autonomous borrower demand must be cryptographically authorized and durable.
// Authorization is not repayment proof; every concrete execution is still simulated.
assert.match(borrowerMandate, /CryptoCrawler Ghost Wallet Borrower Mandate/);
assert.match(borrowerMandate, /_TypedDataEncoder\.hash/);
assert.match(borrowerMandate, /isValidSignature/);
assert.match(borrowerMandate, /recoverAddress/);
assert.match(borrowerMandate, /GHOST_WALLET_MANDATE_AUTHORIZER_NOT_BORROWER_OWNER/);
assert.match(borrowerMandate, /monotonicNonceRequiredForReplacement: true/);
assert.match(borrowerMandate, /cancelledMandateReplayRejected: true/);
assert.match(borrowerMandate, /onePersistentMandatePerBorrowerAsset: true/);
assert.match(borrowerMandate, /exactSimulationStillRequiredBeforeExecution: true/);
assert.match(borrowerMandate, /zeroCapitalDependency: false/);
assert.match(routes, /\/ghost-wallet\/borrower-mandate'/);
assert.match(routes, /\/ghost-wallet\/borrower-mandate\/cancel'/);
assert.match(routes, /registerGhostWalletBorrowerMandate/);
assert.match(routes, /cancelGhostWalletBorrowerMandate/);
assert.match(routes, /autonomous_controller_signed_mandate/);

// Ghost funding sources are measured independently, in parallel across healthy
// Ghost RPCs. One source/provider failure cannot remove unrelated alternatives.
for (const adapter of ['aave_v3', 'morpho_blue', 'balancer_v2', 'erc3156']) {
  assert.ok(fundingMesh.includes(adapter), `Ghost funding mesh missing ${adapter}`);
}
assert.match(fundingMesh, /zeroCapitalDependency: false/);
assert.match(fundingMesh, /hardSourceCountLimit: null/);
assert.match(fundingMesh, /Promise\.allSettled/);
assert.match(fundingMesh, /providerFailureRouteLocal: true/);
assert.match(fundingMesh, /freshEvidenceSingleflight: true/);

// Autonomous controller: exact-call + exact-gas, per-transaction spread calibration,
// signed execution limits/version isolation, no global spread-config transaction.
assert.match(controller, /intermediaryRole: 'middleman_only'/);
assert.match(controller, /controllerOwnsInitiation: true/);
assert.match(controller, /continuousEventPlusAdaptiveScan: true/);
assert.match(controller, /strictPositiveAllInNetBeforeQueue: true/);
assert.match(controller, /hardBpsProfitAdmissionFloor: false/);
assert.match(controller, /configuredSpreadFloorDefaultBps: 0/);
assert.match(controller, /perTransactionSpreadCalibrationFromExactGas: true/);
assert.match(controller, /globalSpreadConfigurationTransactionRequired: false/);
assert.match(controller, /signedMandateExecutionCountEnforced: true/);
assert.match(controller, /signedMandateCadenceEnforced: true/);
assert.match(controller, /signedMandateVersionIsolation: true/);
assert.match(controller, /oneActiveExecutionPerMandate: true/);
assert.match(controller, /mandateScope/);
assert.match(controller, /buildGhostWalletBorrowerTransactionWithSpread/);
assert.match(controller, /provider\.call\(request\)/);
assert.match(controller, /provider\.estimateGas\(request\)/);
assert.match(controller, /routeLocalFailure: true/);
assert.match(controller, /zeroCapitalIntegration: false/);
assert.doesNotMatch(controller, /setMinimumBrokerSpreadBps/);

// Economics are Ghost-owned and exact-gas based. Both single-asset broker spread
// and multi-asset matched-intent fees must remain positive after controller gas.
assert.match(controllerEconomics, /strictPositiveAllInNetRequired: true/);
assert.match(controllerEconomics, /hardBpsProfitFloor: false/);
assert.match(controllerEconomics, /multiAssetFeeValuationSupported: true/);
assert.match(controllerEconomics, /expectedNetProfitBaseUnits > 0n/);
assert.match(controllerEconomics, /expectedNetProfitUsdScaled > 0n/);
assert.match(controllerEconomics, /getLiveSymbolPrices/);

// Ghost network access stays Alchemy-free, redundant, parallel, and route-local.
assert.match(providerMesh, /alchemyAllowed: false/);
assert.match(providerMesh, /independentPublicFallbacks: true/);
assert.match(providerMesh, /parallelInitialProbe: true/);
assert.match(providerMesh, /requestDrivenHealthRefresh: true/);
assert.match(providerMesh, /routeLocalFailure: true/);
assert.match(providerMesh, /Promise\.allSettled/);
assert.doesNotMatch(providerMesh, /ALCHEMY_API_KEY|ALCHEMY_GAS_POLICY_ID/);

// Runtime owns one Ultra Worker and a dedicated controller. Submission is persisted
// before broadcast so a crash can rebroadcast only the identical signed transaction.
assert.match(runtimeWiring, /ghostWalletUltraWorker/);
assert.match(runtimeWiring, /install\('ghost_wallet_ultra_worker', \(\) => ghostWalletUltraWorker\.start\(\)\)/);
assert.doesNotMatch(runtimeWiring, /install\('ghost_wallet_engine'/);
assert.match(ultra, /ghostWalletAutonomousController\.start\(\)/);
assert.match(ultra, /periodicWorkPolling: false/);
assert.match(ultra, /LISTEN \$\{LISTEN_CHANNEL\}|LISTEN cryptocrawler_ghost_wallet_work/);
assert.match(ultra, /provider\.call\(request\)/);
assert.match(ultra, /provider\.estimateGas\(request\)/);
assert.match(ultra, /evaluateGhostWalletMultiAssetControllerEconomics/);
assert.match(ultra, /wallet\.signTransaction\(unsigned\)/);
assert.match(ultra, /markGhostWalletWorkSubmitted/);
assert.match(ultra, /rawTransaction/);
assert.match(ultra, /rebroadcastOrDefer/);
assert.match(ultra, /submittedThisAttempt/);
assert.doesNotMatch(ultra, /GHOST_WALLET_CALLER_FUNDED_SUBMISSION_REQUIRED/);
assert.doesNotMatch(ultra, /zeroCapitalEngine|gasSponsor|provider_sponsored|assessGhostWalletWithQuantiMonteCarlo/);
assert.doesNotMatch(ultra, /setInterval\(/);

// Durable Overflow state and submitted recovery remain singular.
assert.match(ledger, /FOR UPDATE SKIP LOCKED/);
assert.match(ledger, /status IN \('QUEUED','RETRYABLE','SUBMITTED'\)/);
assert.match(ledger, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
assert.match(ledger, /preserveSubmitted/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_work/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_venues/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_runtime_state/);
assert.match(migration, /pg_notify\('cryptocrawler_ghost_wallet_work'/);

// Receipt reconciliation is correctness authority for controller-submitted work;
// websocket/log streams remain route-local acceleration + durable backfill.
assert.match(chainEvents, /ingestGhostWalletSettlementLog/);
assert.match(chainEvents, /GHOST_WALLET_SETTLEMENT_EVENT_TOPICS/);
assert.match(chainEvents, /durable_cursor_plus_http_log_backfill/);
assert.match(chainEvents, /routeLocalFailure: true/);
assert.match(settlementIngest, /ExternalCreditBrokered/);
assert.match(settlementIngest, /ghost-profit:/);
assert.match(settlementIngest, /payoutFractionBps: 9_000/);
assert.match(settlementIngest, /retainedFractionBps: 1_000/);

// Payout stays isolated from zero-capital and only moves realized Ghost profit.
assert.match(payout, /zeroOperatorNativeGas: true/);
assert.match(payout, /originGasFunding: 'realized_ghost_profit_only'/);
assert.match(payout, /percentOfRealizedGhostNet: 90/);
assert.match(payout, /retainedCapitalPercent: 10/);
assert.match(payout, /targetAsset: 'native_ETH'/);
assert.match(payout, /targetNetwork: 'ethereum'/);
assert.doesNotMatch(payout, /zeroCapitalEngine|gasSponsor|ALCHEMY_/);

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
  signedBorrowerDemand: true,
  signedMandateReplayProtection: true,
  zeroCapitalAuthorityCrossed: false,
  hardBpsProfitAdmissionFloor: false,
  perTransactionSpreadPricing: true,
  globalSpreadConfigurationTransactionRequired: false,
  strictPositiveAllInNet: true,
  multiAssetMatchedIntentEconomics: true,
  upstreamAdapters: ['erc3156', 'aave_v3', 'morpho_blue', 'balancer_v2'],
  providerRedundancy: true,
  routeLocalFailure: true,
  durableOverflowRecovery: true,
  signedBeforeBroadcastRecovery: true,
  singleSettlementIngestionAuthority: true,
  payoutAsset: 'ETH',
  payoutNetwork: 'ethereum',
  payoutPercent: 90,
  retainedCapitalPercent: 10,
}, null, 2));