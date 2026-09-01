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
const liquidation = read('server/services/cryptocrawl/execution/flash-liquidation-executor.ts');
const funding = read('server/services/cryptocrawl/execution/funding-position-lifecycle.ts');
const mev = read('server/services/cryptocrawl/execution/mev-backrun-executor.ts');
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
assert(runtime.includes('ensureStablecoinMakerExecutionWiring();'), 'canonical runtime must actually install maker execution wiring');

// Cross-chain: refresh, simulate, submit, then terminal Across destination/refund proof.
assert(across.includes('getAcrossBridgeQuote({'), 'Across execution must refresh the quote immediately before signing');
assert(across.includes('simulationSuccess !== true'), 'Across execution must reject an unsimulated quote');
assert(across.includes('freshExecutionPayload'), 'Across execution must fetch a fresh transaction payload');
assert(across.includes('getAcrossDepositSettlementEvidence({'), 'Across execution must bind provider status to terminal receipt evidence');
assert(across.includes('destinationReceiptVerified'), 'successful bridge settlement must require destination receipt verification');

// Liquidation: exact signed atomic payload, eth_call + estimateGas, receipt proof.
assert(liquidation.includes('provider.call(request'), 'liquidation must exact-simulate the atomic payload');
assert(liquidation.includes('provider.estimateGas(request)'), 'liquidation must verify gas feasibility');
assert(liquidation.includes('deterministicNetProfitUsd <= 0') || liquidation.includes('plan.deterministicNetProfitUsd > 0'), 'liquidation must require strict positive deterministic economics');
assert(liquidation.includes('provider.sendTransaction(plan.signedAtomicTransaction)'), 'liquidation must submit only the exact simulated signed atomic transaction');
assert(liquidation.includes('settlementConfirmed: confirmed'), 'liquidation must expose terminal receipt confirmation');

// Funding: durable open/monitor/close lifecycle and no P&L credit without both legs closed.
assert(funding.includes('cryptocrawler_funding_lifecycles'), 'funding lifecycle must be durably persisted');
assert(funding.includes('openDeltaNeutral'), 'funding lifecycle must open a measured delta-neutral pair');
assert(funding.includes('marginHealthy'), 'funding lifecycle must continuously guard margin health');
assert(funding.includes('closeAndSettle'), 'funding lifecycle must close and settle both legs');
assert(funding.includes('settlement.spotClosed') && funding.includes('settlement.perpClosed'), 'funding terminal authority requires both legs closed');
assert(funding.includes('settlement.realizedNetProfitUsd !== null'), 'funding learning must require measured terminal net P&L');

// MEV: backrun-only, victim first, real relay simulation, same-block ordering proof.
assert(mev.includes('sandwichOrFrontrun: false'), 'MEV completion must remain backrun-only');
assert(mev.includes('[plan.signedVictimTransaction, plan.signedBackrunTransaction]'), 'victim must remain before the backrun transaction');
assert(mev.includes('MultiRelaySubmitter'), 'backrun must use the relay path that performs eth_callBundle simulation');
assert(mev.includes('victimReceipt!.transactionIndex < backrunReceipt.transactionIndex'), 'terminal proof must confirm backrun ordering');

// Rebalancing: adapter-bound live transfers with governance and terminal destination settlement.
assert(rebalance.includes('registerAdapter'), 'rebalancing must have an explicit settlement adapter registry');
assert(rebalance.includes("requireAllowed('SUBMIT_TX'"), 'rebalancing must pass live governance');
assert(rebalance.includes('settlementConfirmed === true && last.successful === true'), 'rebalancing must require terminal successful settlement');
assert(rebalance.includes('REJECT_REBALANCE_ADAPTER_UNAVAILABLE'), 'unsupported transfer routes must fail closed');

// Global law: none of these execution families may replace terminal evidence with prediction.
for (const [name, source] of Object.entries({ across, liquidation, funding, mev, rebalance })) {
  assert(!source.includes('syntheticProfit'), `${name} must not introduce synthetic profit authority`);
}

console.log('[canonical-execution-family-completion] PASS: inventory, maker, cross-chain, liquidation, funding, backrun, and rebalancing invariants are present and fail closed');
