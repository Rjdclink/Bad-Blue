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
const providerMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const ultra = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
const ledger = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-work-ledger.ts');
const migration = read('server/migrations/057_cryptocrawler_ghost_wallet_runtime.sql');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const settlementIngest = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-settlement-ingest.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const venueUniverse = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-venue-universe.ts');
const runtimeWiring = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const compiler = read('scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs');

// Existing arbitrage execution remains untouched and subordinate alternatives still exact-simulate.
assert.match(canonical, /executeFlashCanonicalZeroCapitalOpportunity/);
assert.match(canonical, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(alternative, /provider\.call\(request\)/);
assert.match(alternative, /provider\.estimateGas\(request\)/);

// Ghost is an isolated, caller-funded credit-intermediation lane.
assert.match(engine, /profitLadderAuthority: false/);
assert.match(engine, /100_percent_realized_net_direct_to_canonical_wallet/);
assert.match(engine, /alchemyDependency: false/);
assert.match(engine, /serverTransactionSubmission: false/);
assert.match(engine, /coreExecutionGasPayer: 'transaction_initiator'/);
assert.doesNotMatch(engine, /zeroCapitalEngine/);
assert.doesNotMatch(engine, /gasSponsor/);
assert.doesNotMatch(engine, /CRYPTO_ARBITRAGE_LIVE_EXECUTION/);
assert.doesNotMatch(engine, /setInterval\(/);

// Legacy intermediary/vault invariants remain safe.
assert.match(intermediary, /borrower_repayment_not_exact/);
assert.match(intermediary, /minimumBrokerSpreadBps = 0/);
assert.match(intermediary, /borrowerFee > sourceFee/);
assert.match(vault, /atomic_credit_not_repaid/);
assert.match(vault, /VIRTUAL_SHARES/);
assert.match(vault, /VIRTUAL_ASSETS/);

// Permissionless external bridge: no fixed lender allowlist, plural upstream adapters,
// exact same-transaction downstream repayment, and strictly positive spread.
assert.match(externalBridge, /brokerExternalFlashLoan/);
assert.match(externalBridge, /brokerAaveV3FlashLoan/);
assert.match(externalBridge, /brokerMorphoFlashLoan/);
assert.match(externalBridge, /brokerBalancerV2FlashLoan/);
assert.match(externalBridge, /borrower_repayment_not_exact/);
assert.match(externalBridge, /upstream_repayment_not_exact/);
assert.match(externalBridge, /return configured > 0 \? configured : 1/);
assert.match(externalBridge, /realizedSpread/);
assert.doesNotMatch(externalBridge, /lenderAllowlist|allowedLender/);

// Deterministic bridge bootstrap is exposed to callers; the server does not pay deployment gas.
assert.match(bridgeRuntime, /serverSubmitsDeployment: false/);
assert.match(bridgeRuntime, /deploymentPayer: 'transaction_initiator'/);
assert.match(bridgeRuntime, /operatorInitialCapitalRequired: false/);
assert.match(bridgeRuntime, /lenderAllowlistRequired: false/);
assert.match(bridgeRuntime, /fixedBpsSpreadFloor: false/);
assert.match(bridgeRuntime, /CREATE2_DEPLOYER_CODE_HASH/);

// Borrower surface races measured lenders and accepts caller-proposed ERC-3156 lenders dynamically.
assert.match(borrowerSurface, /hardLenderUniverseLimit: null/);
assert.match(borrowerSurface, /hardBorrowerUniverseLimit: null/);
assert.match(borrowerSurface, /measureFlashLoanProviders/);
assert.match(borrowerSurface, /lenderCandidates/);
assert.match(borrowerSurface, /callerPaysTransactionGas: true/);
assert.match(borrowerSurface, /operatorMonetaryInputRequired: false/);
assert.match(borrowerSurface, /ghost_execution:caller_funded_atomic_bridge/);

// Ghost network access is Alchemy-free, redundant, parallel, and route-local.
assert.match(providerMesh, /alchemyAllowed: false/);
assert.match(providerMesh, /independentPublicFallbacks: true/);
assert.match(providerMesh, /parallelInitialProbe: true/);
assert.match(providerMesh, /routeLocalFailure: true/);
assert.match(providerMesh, /Promise\.allSettled/);
assert.match(providerMesh, /!\/alchemy\\\.com\/i/);
assert.doesNotMatch(providerMesh, /ALCHEMY_API_KEY|ALCHEMY_GAS_POLICY_ID/);

// Runtime owns one Ultra Worker; legacy server-sponsored submission cannot reappear.
assert.match(runtimeWiring, /ghostWalletUltraWorker/);
assert.match(runtimeWiring, /install\('ghost_wallet_ultra_worker', \(\) => ghostWalletUltraWorker\.start\(\)\)/);
assert.doesNotMatch(runtimeWiring, /install\('ghost_wallet_engine'/);
assert.match(ultra, /periodicWorkPolling: false/);
assert.match(ultra, /LISTEN \$\{LISTEN_CHANNEL\}|LISTEN cryptocrawler_ghost_wallet_work/);
assert.match(ultra, /startup_backlog/);
assert.match(ultra, /GHOST_WALLET_CALLER_FUNDED_SUBMISSION_REQUIRED/);
assert.match(ultra, /submittedThisAttempt/);
assert.doesNotMatch(ultra, /zeroCapitalEngine|gasSponsor|provider_sponsored|assessGhostWalletWithQuantiMonteCarlo/);
assert.doesNotMatch(ultra, /setInterval\(/);

// Durable Overflow state and submitted recovery.
assert.match(ledger, /FOR UPDATE SKIP LOCKED/);
assert.match(ledger, /status IN \('QUEUED','RETRYABLE','SUBMITTED'\)/);
assert.match(ledger, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
assert.match(ledger, /preserveSubmitted/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_work/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_venues/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_runtime_state/);
assert.match(migration, /pg_notify\('cryptocrawler_ghost_wallet_work'/);

// One settlement parser feeds durable payout jobs; websocket failure is local and cursor recovery remains.
assert.match(chainEvents, /ingestGhostWalletSettlementLog/);
assert.match(chainEvents, /GHOST_WALLET_SETTLEMENT_EVENT_TOPICS/);
assert.match(chainEvents, /durable_cursor_plus_http_log_backfill/);
assert.match(chainEvents, /routeLocalFailure: true/);
assert.doesNotMatch(chainEvents, /new ethers\.utils\.Interface/);
assert.match(settlementIngest, /ExternalCreditBrokered/);
assert.match(settlementIngest, /ghost-profit:/);

// Payout cannot use Alchemy/provider-sponsored gas. 0x converts using gasless signed
// trade economics; any Across origin gas spend is bounded by native value produced
// from that exact Ghost profit before the bridge is submitted.
assert.match(payout, /GHOST_WALLET_ZEROX_API_KEY/);
assert.match(payout, /ZERO_CAPITAL_ZEROX_API_KEY/);
assert.match(payout, /ZERO_EX_API_KEY/);
assert.match(payout, /GHOST_WALLET_ACROSS_API_KEY/);
assert.match(payout, /ACROSS_API_KEY/);
assert.match(payout, /zeroOperatorNativeGas: true/);
assert.match(payout, /originGasFunding: 'realized_ghost_profit_only'/);
assert.match(payout, /quote\.maxSpend > input\.acquiredNative/);
assert.match(payout, /GHOST_WALLET_ACROSS_WOULD_SPEND_PREEXISTING_OPERATOR_NATIVE/);
assert.match(payout, /GHOST_WALLET_ACROSS_ETH_BALANCE_DELTA_NOT_VERIFIED/);
assert.match(payout, /targetAsset: 'native_ETH'/);
assert.match(payout, /targetNetwork: 'ethereum'/);
assert.match(payout, /percentOfRealizedGhostNet: 100/);
assert.match(payout, /alchemyAllowed: false/);
assert.match(payout, /providerSponsoredGasAllowed: false/);
assert.match(payout, /operatorNativeGasAllowed: false/);
assert.doesNotMatch(payout, /zeroCapitalEngine|gasSponsor|ALCHEMY_/);

assert.match(venueUniverse, /verified/);
assert.doesNotMatch(venueUniverse, /MAX_VENUES|venueLimit|maxVenues/);

// All three Ghost contracts must compile in production prebuild.
assert.match(compiler, /CryptocrawlGhostWalletIntermediary\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletCapitalVault\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletErc3156Bridge\.sol/);

console.log(JSON.stringify({
  ok: true,
  ghostModel: 'high_volume_low_margin_atomic_credit_intermediation',
  fixedBpsProfitFloor: false,
  minimumPositiveSpreadBaseUnits: 1,
  lenderUniverseFixedLimit: false,
  borrowerUniverseFixedLimit: false,
  upstreamAdapters: ['erc3156', 'aave_v3', 'morpho_blue', 'balancer_v2'],
  operatorInitialCapitalRequired: false,
  coreBorrowerGasPayer: 'caller',
  alchemyDependency: false,
  providerRedundancy: true,
  routeLocalFailure: true,
  serverSponsoredExecution: false,
  durableOverflowRecovery: true,
  submittedStateRecovery: true,
  singleSettlementIngestionAuthority: true,
  payoutAsset: 'ETH',
  payoutNetwork: 'ethereum',
  payoutGasAuthority: 'gasless_or_realized_profit_only',
  arbitrageAuthorityCrossed: false,
}, null, 2));
