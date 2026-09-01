const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const inventory = read('server/services/cryptocrawl/integration/inventory-constrained-cex-execution-wiring.ts');
const makerDiscovery = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
const makerRuntime = read('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const across = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const liquidation = read('server/services/cryptocrawl/execution/aave-liquidation-atomic-executor.ts');
const funding = read('server/services/cryptocrawl/execution/funding-position-lifecycle.ts');
const fundingMigration = read('server/migrations/024_cryptocrawler_funding_lifecycle.sql');
const mev = read('server/services/cryptocrawl/execution/mev-backrun-executor.ts');
const mempoolCapability = read('server/services/cryptocrawl/discovery/mempool-capability-registry.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const rebalance = read('server/services/cryptocrawl/execution/inventory-rebalance-executor.ts');

// Inventory-constrained CEX: authenticated balances + exact resized requote.
assert(inventory.includes('reconcilePairBalances(plan)'), 'inventory execution must reconcile authenticated balances');
assert(inventory.includes('arbitrageVerifier.evaluateOnce({'), 'inventory resize must use a fresh canonical requote');
assert(inventory.includes('refreshed.netProfitUsd <= 0'), 'resized CEX plan must remain strictly positive after measured costs');
assert(inventory.includes('REJECT_BALANCE_UNVERIFIED'), 'unverified inventory must fail closed');

// Maker: live authority can come only from the existing measured post-only evaluator.
assert(makerDiscovery.includes('evaluateMakerRecoveryCandidate({'), 'maker discovery must ask the canonical measured maker evaluator');
assert(makerDiscovery.includes("status: 'eligible'"), 'fully measured maker plans must be representable as eligible');
assert(makerDiscovery.includes('executableCapability: true'), 'fully measured maker plan must expose execution capability');
assert(makerDiscovery.includes("'post_only:true'"), 'maker promotion must preserve post-only semantics');
assert(makerDiscovery.includes("'taker_fallback:false'"), 'maker promotion must forbid implicit taker fallback');
assert(makerRuntime.includes('createPostOnlyMakerAdapters(plan)'), 'maker live execution must use post-only adapters');
assert(runtime.includes('ensureStablecoinMakerExecutionWiring();'), 'canonical runtime must install maker execution wiring');

// Cross-chain: refresh, simulate, submit, then terminal Across destination/refund proof.
assert(across.includes('getAcrossBridgeQuote({'), 'Across execution must refresh the quote immediately before signing');
assert(across.includes('simulationSuccess !== true'), 'Across execution must reject an unsimulated quote');
assert(across.includes('freshExecutionPayload'), 'Across execution must fetch a fresh transaction payload');
assert(across.includes('getAcrossDepositSettlementEvidence({'), 'Across execution must bind provider status to terminal receipt evidence');
assert(across.includes('destinationReceiptVerified'), 'successful bridge settlement must require destination receipt verification');

// Liquidation: exact measured Aave state, full atomic simulation, positive all-in economics and terminal receipt proof.
assert(liquidation.includes('getUserAccountData'), 'liquidation must re-read Aave account health');
assert(liquidation.includes('getUserReserveData'), 'liquidation must inspect reserve-level debt/collateral');
assert(liquidation.includes('measureAaveV3FlashLoanEconomics'), 'liquidation must measure current flash-loan economics');
assert(liquidation.includes("purpose: 'execution'"), 'liquidation unwind must use a firm execution quote');
assert(liquidation.includes('provider.call('), 'liquidation must exact-simulate the receiver payload');
assert(liquidation.includes('provider.estimateGas('), 'liquidation must measure gas feasibility');
assert(liquidation.includes('deterministicNetProfitUsd'), 'liquidation must calculate deterministic all-in economics');
assert(liquidation.includes('settlementConfirmed: true'), 'liquidation must expose terminal confirmed receipt outcomes');

// Funding: migration-owned durable state machine; never block the canonical scheduler for a funding window.
assert(fundingMigration.includes('private.cryptocrawler_funding_lifecycles'), 'funding lifecycle schema must be migration-owned');
assert(funding.includes("const TABLE = 'private.cryptocrawler_funding_lifecycles'"), 'funding runtime must use the migration-owned lifecycle table');
assert(!funding.includes('CREATE TABLE'), 'funding runtime must not own DDL');
assert(!funding.includes('CREATE SCHEMA'), 'funding runtime must not own schema DDL');
assert(funding.includes('openDeltaNeutral'), 'funding lifecycle must open a measured delta-neutral pair');
assert(funding.includes('advanceOpenLifecycles'), 'funding lifecycle must advance open positions on bounded later ticks');
assert(!funding.includes('while (Date.now() <'), 'funding lifecycle must not sleep/block through the funding window');
assert(funding.includes('marginHealthy'), 'funding lifecycle must guard margin health');
assert(funding.includes('closeAndSettle'), 'funding lifecycle must close and settle both legs');
assert(funding.includes('settlement.spotClosed') && funding.includes('settlement.perpClosed'), 'funding terminal authority requires both legs closed');
assert(funding.includes('settlement.realizedNetProfitUsd !== null'), 'funding learning must require measured terminal net P&L');
assert(router.includes('funding_lifecycle_adapter_unavailable'), 'router must fail closed when no funding venue lifecycle adapter is registered');

// MEV: strict executor exists, but routing must remain unavailable until an exact post-victim compiler exists.
assert(mev.includes('sandwichOrFrontrun: false'), 'MEV execution must remain backrun-only');
assert(mev.includes('signedBackrunTransaction'), 'MEV executor must accept exact signed backrun bytes');
assert(mev.includes('MultiRelaySubmitter'), 'backrun must use relay simulation/submission authority');
assert(mev.includes('transactionIndex'), 'terminal proof must confirm same-block victim-before-backrun ordering');
assert(mempoolCapability.includes('transactionChainBinding'), 'mempool capability must report exact per-transaction chain binding');
assert(mempoolCapability.includes('executableBackrunEvidence: false'), 'pending-feed capability alone must never become executable backrun evidence');
assert(router.includes("case 'MEMPOOL_BACKRUN':"), 'router must explicitly handle backrun topology');
assert(router.includes('exact_post_victim_backrun_compiler_unavailable'), 'router must fail closed until the canonical backrun compiler exists');

// Rebalancing: adapter-bound live transfers with governance and terminal destination settlement.
assert(rebalance.includes('registerAdapter'), 'rebalancing must have an explicit settlement adapter registry');
assert(rebalance.includes("requireAllowed('SUBMIT_TX'"), 'rebalancing must pass live governance');
assert(rebalance.includes('settlementConfirmed === true && last.successful === true'), 'rebalancing must require terminal successful settlement');
assert(rebalance.includes('REJECT_REBALANCE_ADAPTER_UNAVAILABLE'), 'unsupported transfer routes must fail closed');

for (const [name, source] of Object.entries({ across, liquidation, funding, mev, rebalance })) {
  assert(!source.includes('syntheticProfit'), `${name} must not introduce synthetic profit authority`);
}

console.log('[topology-execution-integrity] PASS: inventory, maker, cross-chain, liquidation, funding, MEV fail-closed compiler boundary, and rebalancing invariants are preserved');
