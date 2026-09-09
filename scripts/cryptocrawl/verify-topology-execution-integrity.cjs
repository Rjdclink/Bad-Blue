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
const backrunCompiler = read('server/services/cryptocrawl/execution/exact-post-victim-backrun-compiler.ts');
const mempoolCapability = read('server/services/cryptocrawl/discovery/mempool-capability-registry.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const rebalance = read('server/services/cryptocrawl/execution/inventory-rebalance-executor.ts');

assert(inventory.includes('reconcilePairBalances(plan)'), 'inventory execution must reconcile authenticated balances');
assert(inventory.includes('arbitrageVerifier.evaluateOnce({'), 'inventory resize must use a fresh canonical requote');
assert(inventory.includes('isStrictlyPositiveAllInNetProfit(refreshed.netProfitUsd)'), 'resized CEX plan must remain strictly positive after measured costs through canonical profit admission');
assert(inventory.includes('REJECT_BALANCE_UNVERIFIED'), 'unverified inventory must fail closed');

assert(makerDiscovery.includes('evaluateMakerRecoveryCandidate({'), 'maker discovery must ask the canonical measured maker evaluator');
assert(makerDiscovery.includes("status: 'eligible'"), 'fully measured maker plans must be representable as eligible');
assert(makerDiscovery.includes('executableCapability: true'), 'fully measured maker plan must expose execution capability');
assert(makerDiscovery.includes("'post_only:true'"), 'maker promotion must preserve post-only semantics');
assert(makerDiscovery.includes("'taker_fallback:false'"), 'maker promotion must forbid implicit taker fallback');
assert(makerRuntime.includes('createPostOnlyMakerAdapters(plan)'), 'maker live execution must use post-only adapters');
assert(runtime.includes("install('stablecoin_maker_execution', () => ensureStablecoinMakerExecutionWiring())"), 'canonical runtime must install maker execution wiring through an isolated component');
assert(runtime.includes('runtimeComponentIsolationGlobalShutdownAuthority: false'), 'maker wiring failure must not own global runtime shutdown');

// Across provider simulation is advisory. Fresh route identity, guaranteed output,
// actual approval gas, positive post-approval economics, signer/chain identity,
// durable origin submission and terminal destination/refund evidence stay hard.
assert(across.includes('freshExecutionPayload'), 'Across execution must fetch a fresh transaction payload');
assert(across.includes('simulationVetoAuthority: false'), 'Across simulation must be advisory only');
assert(across.includes('REJECT_ACROSS_MINIMUM_OUTPUT_WORSENED'), 'Across must reject worse guaranteed output');
assert(across.includes('liveApprovalGasUsd'), 'Across must price actual approval gas');
assert(across.includes('postApprovalEconomicsPositive'), 'Across must re-prove positive economics after approvals');
assert(across.includes('armPreparedAcrossOriginTransaction'), 'Across signed origin transaction must be durable before broadcast');
assert(across.includes('getAcrossDepositSettlementEvidence({'), 'Across execution must bind provider status to terminal receipt evidence');
assert(across.includes('destinationReceiptVerified'), 'successful bridge settlement must require destination receipt verification');
assert(!across.includes("quote.simulationSuccess !== true"), 'Across input quote simulation must not be an execution veto');

// Aave liquidation authority is current protocol state and measured economics,
// while eth_call remains advisory telemetry.
assert(liquidation.includes('getUserAccountData'), 'liquidation must re-read Aave account health and total debt');
assert(liquidation.includes('getReservesCount'), 'liquidation must bind exact reserve count');
assert(liquidation.includes('getReserveAddressById'), 'liquidation must resolve stable reserve ids');
assert(liquidation.includes('getUserReserveData'), 'liquidation must inspect reserve-level debt/collateral');
assert(liquidation.includes('getUserEMode'), 'liquidation must bind eMode state');
assert(liquidation.includes('getPaused'), 'liquidation must bind reserve pause state');
assert(liquidation.includes('getLiquidationGracePeriod'), 'liquidation must bind liquidation grace period');
assert(liquidation.includes('MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD'), 'liquidation must implement current Aave reserve-value close-factor threshold');
assert(liquidation.includes('MIN_LEFTOVER_BASE'), 'liquidation must implement current Aave residual dust threshold');
assert(liquidation.includes('measureAaveV3FlashLoanEconomics'), 'liquidation must measure current flash-loan economics');
assert(liquidation.includes("purpose: 'execution'"), 'liquidation unwind must use a firm execution quote');
assert(liquidation.includes('provider.estimateGas('), 'liquidation must measure gas feasibility');
assert(liquidation.includes('simulationVetoAuthority: false'), 'liquidation eth_call must not own veto authority');
assert(liquidation.includes('deterministicNetProfitUsd'), 'liquidation must calculate deterministic all-in economics');
assert(liquidation.includes('settlementConfirmed: true'), 'liquidation must expose terminal confirmed receipt outcomes');
assert(!liquidation.includes('CRYPTOCRAWL_LIQUIDATION_COLLATERAL_SELL_BPS'), 'liquidation must not reintroduce an arbitrary collateral haircut');

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

assert(mev.includes('sandwichOrFrontrun: false'), 'MEV execution must remain backrun-only');
assert(mev.includes('signedBackrunTransaction'), 'MEV executor must accept exact signed backrun bytes');
assert(mev.includes('MultiRelaySubmitter'), 'backrun must use relay submission authority');
assert(mev.includes('transactionIndex'), 'terminal proof must confirm same-block victim-before-backrun ordering');
assert(mempoolCapability.includes('transactionChainBinding'), 'mempool capability must report exact per-transaction chain binding');
assert(mempoolCapability.includes('executableBackrunEvidence: false'), 'pending-feed capability alone must never become executable backrun evidence');
assert(backrunCompiler.includes('exact_post_victim_backrun_compiler:passed'), 'canonical compiler must stamp exact post-victim authority only after compilation succeeds');
assert(backrunCompiler.includes('exact_victim_first_eth_callBundle_simulation:passed'), 'canonical compiler must require exact victim-first private-bundle simulation');
assert(backrunCompiler.includes('no_frontrun_or_sandwich'), 'canonical compiler must remain backrun-only');
assert(router.includes("case 'MEMPOOL_BACKRUN':"), 'router must explicitly handle backrun topology');
assert(router.includes('exact_post_victim_backrun_evidence_unavailable'), 'router must fail closed when exact compiler evidence is absent');
assert(router.includes("candidate.provenance.includes('exact_post_victim_backrun_compiler:passed')"), 'router must require compiler provenance before MEV admission');
assert(router.includes("candidate.provenance.includes('sandwichOrFrontrun:false')"), 'router must require explicit no-front-run/no-sandwich provenance');

assert(rebalance.includes('registerAdapter'), 'rebalancing must have an explicit settlement adapter registry');
assert(rebalance.includes("requireAllowed('SUBMIT_TX'"), 'rebalancing must pass live governance');
assert(rebalance.includes('settlementConfirmed === true && last.successful === true'), 'rebalancing must require terminal successful settlement');
assert(rebalance.includes('REJECT_REBALANCE_ADAPTER_UNAVAILABLE'), 'unsupported transfer routes must fail closed');

for (const [name, source] of Object.entries({ across, liquidation, funding, mev, backrunCompiler, rebalance })) {
  assert(!source.includes('syntheticProfit'), `${name} must not introduce synthetic profit authority`);
}

console.log('[topology-execution-integrity] PASS: inventory, maker, cross-chain, exact Aave liquidation, funding, exact victim-first MEV and rebalancing retain hard execution/settlement truth while simulation remains advisory except where exact private-bundle state is itself the required pre-inclusion evidence');
