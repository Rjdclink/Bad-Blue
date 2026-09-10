'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = p => fs.readFileSync(p, 'utf8');
const canonical = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const alternative = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const intermediary = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const vault = read('contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol');
const infrastructure = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-infrastructure-manager.ts');
const ultra = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-ultra-worker.ts');
const ledger = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-work-ledger.ts');
const migration = read('server/migrations/057_cryptocrawler_ghost_wallet_runtime.sql');
const advisory = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-advisory.ts');
const chainEvents = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-chain-events.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const venueUniverse = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-venue-universe.ts');
const runtimeWiring = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

assert.match(canonical, /executeFlashCanonicalZeroCapitalOpportunity/);
assert.match(canonical, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(canonical, /flashLoanProviderSelectionRegistry\.get/);
assert.match(canonical, /builderSponsoredZeroCapitalRegistry\.get/);
assert.match(alternative, /provider\.call\(request\)/);
assert.match(alternative, /provider\.estimateGas\(request\)/);
assert.match(alternative, /recipientDelta !== grossProfit/);
assert.match(alternative, /intermediaryEnding !== intermediaryStarting/);

assert.match(engine, /profitLadderAuthority: false/);
assert.match(engine, /100_percent_realized_net_direct_to_canonical_wallet/);
assert.match(engine, /arbitrageSystemOwnedGasFallbackAllowed: false/);
assert.match(engine, /manualRailwayConfigurationRequired: false/);
assert.doesNotMatch(engine, /setInterval\(/);

assert.match(intermediary, /borrower_repayment_not_exact/);
assert.match(intermediary, /spread_reconciliation_failed/);
assert.match(intermediary, /incremental_liability_not_repaid/);
assert.match(vault, /atomic_credit_not_repaid/);
assert.match(vault, /VIRTUAL_SHARES/);
assert.match(vault, /VIRTUAL_ASSETS/);
assert.match(infrastructure, /CREATE2_DEPLOYER_CODE_HASH/);
assert.match(infrastructure, /sponsorOperatorMonetaryCostProvenZero === true/);
assert.doesNotMatch(infrastructure, /executeSystemOwnedNativeTransaction/);

assert.match(runtimeWiring, /ghostWalletUltraWorker/);
assert.match(runtimeWiring, /install\('ghost_wallet_ultra_worker', \(\) => ghostWalletUltraWorker\.start\(\)\)/);
assert.doesNotMatch(runtimeWiring, /install\('ghost_wallet_engine'/);

assert.match(ultra, /periodicWorkPolling: false/);
assert.match(ultra, /LISTEN cryptocrawler_ghost_wallet_work|LISTEN \$\{LISTEN_CHANNEL\}/);
assert.match(ultra, /startup_backlog/);
assert.match(ultra, /Promise\.allSettled/);
assert.match(ultra, /independent_lanes_parallel_same_signer_chain_serialized/);
assert.match(ultra, /claimedFromStatus === 'SUBMITTED'/);
assert.match(ultra, /markGhostWalletWorkSubmitted/);
assert.match(ultra, /processGhostWalletProfitConversion/);
assert.match(ultra, /assessGhostWalletWithQuantiMonteCarlo/);
assert.doesNotMatch(ultra, /setInterval\(/);

assert.match(ledger, /FOR UPDATE SKIP LOCKED/);
assert.match(ledger, /status IN \('QUEUED','RETRYABLE','SUBMITTED'\)/);
assert.match(ledger, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
assert.match(ledger, /preserveSubmitted/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_work/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_venues/);
assert.match(migration, /private\.cryptocrawler_ghost_wallet_runtime_state/);
assert.match(migration, /pg_notify\('cryptocrawler_ghost_wallet_work'/);
assert.match(migration, /payout_asset text NOT NULL DEFAULT 'ETH'/);
assert.match(migration, /payout_network text NOT NULL DEFAULT 'ethereum'/);

assert.match(chainEvents, /backfillSettlementLogs/);
assert.match(chainEvents, /durable_cursor_plus_http_log_backfill/);
assert.match(chainEvents, /periodicPolling: false/);
assert.match(chainEvents, /successful_broker_settlement/);

assert.match(advisory, /executionAuthority: false/);
assert.match(advisory, /writeAuthority: false/);
assert.match(advisory, /profitLadderAuthority: false/);
assert.match(advisory, /quantiComp\.submit/);
assert.match(advisory, /runProfitabilityMonteCarlo/);
assert.match(advisory, /exact_transaction_simulation_and_atomic_settlement_remain_authoritative/);

assert.match(payout, /resolvePrimaryProfitPayoutAddress/);
assert.match(payout, /resolvePayoutFallbackAddress/);
assert.match(payout, /asset: 'ETH' as const/);
assert.match(payout, /network: 'ethereum' as const/);
assert.match(payout, /arbitrageTreasuryAuthority: false/);
assert.match(payout, /arbitrageProfitSplitAuthority: false/);
assert.match(payout, /destinationChainId: String\(ETHEREUM_CHAIN_ID\)/);
assert.match(payout, /swapTx\?\.simulationSuccess !== true/);

assert.match(venueUniverse, /verified/);
assert.match(venueUniverse, /executionAuthority/);
assert.doesNotMatch(venueUniverse, /MAX_VENUES|venueLimit|maxVenues/);

console.log(JSON.stringify({
  ok: true,
  canonicalFlashPreserved: true,
  alternativeExecutorSubordinate: true,
  ghostWalletProfitLadderAuthority: false,
  atomicRepaymentFailClosed: true,
  payoutReconciled: true,
  payoutAsset: 'ETH',
  payoutNetwork: 'ethereum',
  primaryFallbackIsolation: true,
  noManualRailwayGhostWalletConfiguration: true,
  sponsoredInfrastructureOnly: true,
  eventDrivenUltraWorker: true,
  periodicWorkPolling: false,
  durableOverflowRecovery: true,
  submittedTransactionRecovery: true,
  nonceLaneSerialization: true,
  independentWorkParallelism: true,
  settlementEventBackfill: true,
  quantiCompAuthority: 'advisory_only',
  monteCarloAuthority: 'advisory_only',
  venueUniverseFixedLimit: false,
}, null, 2));
