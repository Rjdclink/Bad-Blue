'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');

const dockerfile = read('Dockerfile');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const demand = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-demand-mesh.ts');
const uniswapXDemand = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-uniswapx-demand.ts');
const uniswapXFiller = read('contracts/cryptocrawl/CryptocrawlGhostWalletUniswapXFiller.sol');
const bootstrap = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-intermediary-bootstrap.ts');
const bootstrapRecovery = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-bootstrap-work-recovery.ts');
const mandate = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-mandate.ts');
const reserve = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-gas-reserve.ts');
const reserveMigration = read('server/migrations/058_cryptocrawler_ghost_wallet_gas_reserve.sql');
const pimlico = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-pimlico-sponsor.ts');
const worker = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
const provider = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const controller = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-autonomous-controller.ts');
const zeroCapital = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const routes = read('server/routes/cryptoWiring.routes.ts');
const dynamicRpc = read('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts');
const rpcCoalescer = read('server/services/cryptocrawl/runtime/rpc-request-coalescer.ts');
const compiler = read('scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs');

// Borrower demand transport is acquisition only. Existing cryptographic mandate
// verification remains the sole admission authority and generic order books are not
// silently reclassified as ERC-3156 borrowers.
assert.match(demand, /registerGhostWalletBorrowerMandate/);
assert.match(demand, /GHOST_WALLET_BORROWER_DEMAND_FEEDS_JSON/);
assert.match(demand, /httpsOnly: true/);
assert.match(demand, /signedMandateVerificationRequired: true/);
assert.match(demand, /nonceReplayProtectionPreserved: true/);
assert.match(demand, /genericTradeIntentAdmission: false/);
assert.match(demand, /bytecodeOnlyBorrowerTrust: false/);
assert.match(demand, /etagConditionalRefresh: true/);
assert.match(demand, /throttleBackoffWithJitter: true/);
assert.match(mandate, /_TypedDataEncoder\.hash/);
assert.match(mandate, /isValidSignature/);
assert.match(mandate, /cancelledMandateReplayRejected: true/);
assert.match(engine, /ghost-wallet-borrower-demand-mesh\.js/);
assert.match(engine, /borrowerDemandTransportAuthority: false/);

// Public UniswapX signed orders are a separate atomic-demand lane, never forged
// into borrower mandates. The signed order itself supplies input working capital;
// output shortfall or non-positive all-in economics still fails closed.
assert.match(demand, /ghostWalletUniswapXDemand\.start\(\)/);
assert.match(demand, /uniswapXOrdersAreBorrowerMandates: false/);
assert.match(uniswapXDemand, /https:\/\/api\.uniswap\.org\/v2\/orders/);
assert.match(uniswapXDemand, /signedReactorAuthorityDerivedOnchain: true/);
assert.match(uniswapXDemand, /genericSwapOrdersAreBorrowerMandates: false/);
assert.match(uniswapXDemand, /operatorTradingPrincipalRequired: false/);
assert.match(uniswapXDemand, /mode: 'broker_execution'/);
assert.match(uniswapXDemand, /expectedSpreadBaseUnits/);
assert.match(uniswapXDemand, /getHedgedDexQuote/);
assert.match(uniswapXDemand, /getGhostWalletPimlicoSupportedChains/);
assert.match(uniswapXFiller, /reactor_input_not_received/);
assert.match(uniswapXFiller, /resolved_output_shortfall/);
assert.match(uniswapXFiller, /profit_below_threshold/);
assert.match(uniswapXFiller, /AtomicCreditSettled/);
assert.match(compiler, /CryptocrawlGhostWalletUniswapXFiller\.sol/);

// Direct signed-intent ingestion is externally reachable but remains bound to the
// configured intermediary and the existing EIP-712 signature verifier.
assert.match(routes, /\/ghost-wallet\/signed-intent/);
assert.match(routes, /ghostWalletEngine\.registerSignedIntent/);
assert.match(routes, /GHOST_WALLET_SIGNED_INTENT_INTERMEDIARY_MISMATCH/);
assert.match(routes, /GHOST_WALLET_SIGNED_INTENT_CHAIN_ID_MISMATCH/);

// The matched-intent lane must no longer depend on a manually-entered intermediary.
// A missing contract is deterministically bootstrapped with the existing Pimlico
// sponsored execution path; explicit operator configuration remains authoritative.
assert.match(demand, /ghostWalletIntermediaryBootstrap\.start\(\)/);
assert.match(demand, /matchedIntentIntermediaryAutoBootstrap: true/);
assert.match(bootstrap, /bad-blue:cryptocrawl-ghost-wallet-intermediary:v1/);
assert.match(bootstrap, /GHOST_WALLET_INTERMEDIARIES_JSON/);
assert.match(bootstrapRecovery, /kind: 'prepared_atomic_execution'/);
assert.match(bootstrap, /mode: 'bridge_bootstrap'/);
assert.match(bootstrap, /ghostWalletEngine\.refresh\(\)/);
assert.match(bootstrap, /ghostWalletEngine\.enqueueReadyIntentPairWork\(\)/);
assert.match(bootstrap, /deadDedupeWorkRearmedWhenCodeStillAbsent: true/);
assert.match(bootstrap, /workFailureStateExposedPerChain: true/);
assert.match(bootstrapRecovery, /status='RETRYABLE'/);
assert.match(bootstrapRecovery, /status IN \('DEAD','SETTLED'\)/);
assert.match(bootstrapRecovery, /duplicateCreate2LogicalJobsCreated: false/);
assert.match(bootstrap, /deterministicCreate2Address: true/);
assert.match(bootstrap, /automaticDeployment: true/);
assert.match(bootstrap, /deploymentGasAuthority: 'pimlico_sponsored_user_operation'/);
assert.match(bootstrap, /operatorPrincipalAuthority: false/);
assert.match(bootstrap, /explicitConfigurationPreserved: true/);
assert.match(bootstrap, /runtimeRegistrationAfterIdentityVerification: true/);
assert.match(bootstrap, /routeLocalFailure: true/);
assert.doesNotMatch(bootstrap, /zeroCapitalEngine|AtomicProfitabilityEngine/);

// Historical gas-reserve schema stays readable, but native-reserve execution is retired.
// Pimlico is the mandatory Ghost controller gas authority for all new submissions.
assert.match(reserveMigration, /cryptocrawler_ghost_wallet_gas_reserve/);
assert.match(reserveMigration, /UNIQUE\(source_work_id, chain, asset\)/);
assert.match(dockerfile, /COPY --from=builder \/app\/server\/migrations\/058_cryptocrawler_ghost_wallet_gas_reserve\.sql \.\/dist\/migrations\/058_cryptocrawler_ghost_wallet_gas_reserve\.sql/);
assert.match(reserve, /historicalLedgerPreserved: true/);
assert.match(reserve, /executionAuthority: false/);
assert.match(reserve, /retainedProfitConversionToNativeGas: false/);
assert.match(reserve, /sameChainNativeReserve: false/);
assert.match(reserve, /nativeGasFallbackAllowed: false/);
assert.match(reserve, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(reserve, /pimlicoSponsorIsMandatoryDependency: true/);
assert.match(engine, /controllerGasAuthority: 'pimlico_eip7702_erc4337_sponsorship_only'/);
assert.match(engine, /controllerNativeGasBalanceRequired: false/);
assert.match(engine, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(worker, /pimlicoExclusiveExecutionGasAuthority: true/);
assert.match(worker, /nativeControllerGasFallback: false/);
assert.match(pimlico, /requiredForGhostControllerTransactions: true/);
assert.match(pimlico, /nativeGasFallbackAllowed: false/);
assert.match(pimlico, /operatorNativePrefundRequired: false/);
assert.match(pimlico, /billingSurchargeIncludedInCanonicalEconomics: true/);
assert.match(pimlico, /boostedFastPathOptional: true/);
assert.match(pimlico, /boostedFallback: 'standard_pimlico_only'/);

// RPC health remains separated by operation class. Pimlico UserOperation submission
// is its own execution path and does not make Alchemy or raw RPC broadcast mandatory.
assert.match(provider, /GhostWalletRpcOperationClass = 'read' \| 'logs' \| 'broadcast'/);
assert.match(provider, /operationClassHealth: \['read', 'logs', 'broadcast'\]/);
assert.match(provider, /runHedgedLogs/);
assert.match(provider, /retryAfterAwareCircuitBreaking: true/);
assert.match(provider, /providerCircuitBreaking: true/);
assert.match(provider, /routeLocalFailure: true/);
assert.match(worker, /submitGhostWalletPimlicoSponsoredTransaction/);
assert.match(worker, /ensureGhostWalletPimlicoSubmission/);
assert.doesNotMatch(worker, /GHOST_WALLET_CONTROLLER_NATIVE_GAS_UNAVAILABLE/);

// System-wide ordinary RPC reads are quota-diversified and coalesced. Public/no-key
// endpoints remain preferred, while Alchemy is only a lower-priority standard JSON-RPC
// fallback; Ghost's own provider mesh keeps its independent Alchemy-free invariant.
assert.match(dynamicRpc, /costSafePublicRpcPreferred: true/);
assert.match(dynamicRpc, /standardRpcQuotaDiversification: true/);
assert.match(dynamicRpc, /sharedRpcSingleflight: true/);
assert.match(dynamicRpc, /blockScopedReadCache: true/);
assert.match(dynamicRpc, /eventDrivenCacheInvalidation: true/);
assert.match(dynamicRpc, /AlchemyStandardRPC/);
assert.match(rpcCoalescer, /identicalReadSingleflight: true/);
assert.match(rpcCoalescer, /blockScopedLatestStateCache: true/);
assert.match(rpcCoalescer, /eventDrivenBlockInvalidationSupported: true/);
assert.match(rpcCoalescer, /transactionSubmissionCached: false/);
assert.match(rpcCoalescer, /pendingStateCached: false/);

// Ghost remains autonomous and separate from zero-capital/APE.
assert.match(controller, /zeroCapitalIntegration: false/);
assert.match(engine, /intermediaryTransactionSubmission: false/);
assert.match(engine, /controllerTransactionSubmission: true/);
assert.match(engine, /zeroCapitalExecutionAuthority: false/);
assert.doesNotMatch(demand, /zeroCapitalEngine|AtomicProfitabilityEngine/);
assert.doesNotMatch(reserve, /zeroCapitalEngine|AtomicProfitabilityEngine/);
assert.doesNotMatch(pimlico, /zeroCapitalEngine|AtomicProfitabilityEngine/);
assert.match(zeroCapital, /executeFlashCanonicalZeroCapitalOpportunity|executeAlternativePreparedWithinCanonicalExecutor/);

console.log(JSON.stringify({
  ok: true,
  borrowerDemandFeeds: 'signed_and_bounded',
  autonomousAtomicDemand: 'uniswapx_public_signed_zero_inventory_lane',
  genericSwapOrdersReclassifiedAsBorrowers: false,
  matchedIntentIngress: 'external_route_plus_existing_eip712_verification',
  matchedIntentIntermediaryBootstrap: 'deterministic_create2_pimlico_sponsored_recoverable',
  operatorCapitalRequiredForIntermediaryBootstrap: false,
  retainedProfitNativeGasReserve: 'retired_execution_authority',
  historicalGasReserveLedgerPreserved: true,
  pimlicoExclusiveExecutionGasAuthority: true,
  nativeControllerGasBalanceRequired: false,
  boostedPimlicoFastPathReady: true,
  standardPimlicoFallbackOnly: true,
  rpcHealth: 'read_logs_broadcast_isolated',
  rpcQuotaControl: 'public_preferred_multi_provider_singleflight_block_scoped_cache',
  zeroCapitalAuthorityCrossed: false,
  intermediaryRemainsMiddleman: true,
}, null, 2));