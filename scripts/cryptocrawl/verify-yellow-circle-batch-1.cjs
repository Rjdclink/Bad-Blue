'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const decoder = read('server/services/cryptocrawl/capital-free/pending-swap-route-decoder.ts');
const mempool = read('server/services/cryptocrawl/discovery/mempool-opportunity-generator.ts');
const dexScout = read('server/services/cryptocrawl/discovery/graphless-dex-scout.ts');
const prediction = read('server/services/cryptocrawl/discovery/prediction-market-opportunity-generator.ts');
const predictionWiring = read('server/services/cryptocrawl/integration/prediction-market-discovery-wiring.ts');
const canonical = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const preselection = read('server/services/cryptocrawl/discovery/zero-capital-route-preselection.ts');
const refinement = read('server/services/cryptocrawl/integration/zero-capital-size-refinement-wiring.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const flash = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');

// System 1 — pending-swap route decoding remains evidence-only.
requireText(decoder, 'decodePendingSwapRoute', 'pending swap decoder exported');
requireText(decoder, 'calldata_decode_only', 'decoder provenance identifies calldata-only evidence');
requireText(decoder, 'post_transaction_state:not_simulated', 'decoder does not fabricate post-state');
requireText(decoder, 'execution_authority:false', 'decoder has no execution authority');
requireText(mempool, 'decodePendingSwapRoute(transaction.input)', 'MEV discovery consumes decoded route');
requireText(mempool, "'post_transaction_pool_state'", 'MEV candidate still requires post-state');
requireText(mempool, "'deterministic_backrun_economics'", 'MEV candidate still requires deterministic economics');
requireText(mempool, 'executableCapability: false', 'decoded mempool candidate remains non-executable');

// System 2 — no-key V2-fork discovery broadens RPC scouting only.
requireText(dexScout, 'PAIR_CREATED_TOPIC', 'V2 PairCreated event scanning exists');
requireText(dexScout, 'quickswap_v2', 'Polygon QuickSwap V2 factory is scanned');
requireText(dexScout, 'sushiswap_v2', 'Sushi V2-compatible factory is scanned');
requireText(dexScout, 'provider.getLogs', 'factory discovery uses direct RPC logs');
requireText(dexScout, 'apiKeysRequired: false', 'DEX scout requires no new API key');
requireText(dexScout, 'executionAuthority: false', 'DEX scout cannot authorize execution');

// System 3 — prediction-market discovery is public/no-auth and observation-only.
requireText(prediction, 'https://gamma-api.polymarket.com', 'public market discovery endpoint configured');
requireText(prediction, 'https://clob.polymarket.com', 'public CLOB market-data endpoint configured');
requireText(prediction, 'combinedAsk < 1', 'YES+NO parity condition is explicit');
requireText(prediction, 'grossLockedProfitUsd', 'gross parity economics are measured');
requireText(prediction, 'executableCapability: false', 'prediction candidate cannot execute');
requireText(prediction, 'gross_profit_only', 'prediction economics are not mislabeled as net');
requireText(predictionWiring, 'executionAuthority: false', 'prediction runtime wiring has no execution authority');
requireText(canonical, 'ensurePredictionMarketDiscoveryWiring();', 'prediction discovery is installed in canonical runtime');

// System 4 — quote budget expands only from measured evidence and remains bounded/advisory.
requireText(preselection, 'adaptiveQuoteBudget', 'adaptive quote budget exists');
requireText(preselection, 'ZERO_CAPITAL_ADAPTIVE_QUOTE_BUDGET_MAX', 'adaptive budget has explicit cap');
requireText(preselection, 'measured > 0', 'adaptive expansion requires measured evidence');
requireText(preselection, "process.env.ZERO_CAPITAL_ADAPTIVE_QUOTE_BUDGET === 'false'", 'adaptive expansion has kill switch');
requireText(preselection, "authority: 'quote_budget_advisory_only'", 'quote budget stays advisory');
requireText(preselection, 'executionAuthority: false', 'quote budget cannot execute');
forbidText(preselection, 'executeVerifiedArbitragePlan', 'preselection cannot call execution');

// System 5 — near-break-even size refinement can improve observations without weakening execution truth.
requireText(refinement, 'nearBreakEvenPriorityEnabled: true', 'near-break-even candidates are prioritized for refinement');
requireText(refinement, 'best.netProfit <= opportunity.expectedProfit', 'only strictly measured economic improvement replaces coarse observation');
requireText(refinement, 'negativeObservationExecutionAuthority: false', 'negative refined observations remain non-executable');
requireText(refinement, 'quoteConfiguredZeroCapitalRoute', 'every refinement uses independent direct quote');
requireText(refinement, 'target.isAllowedByCryptara(refined)', 'Cryptara remains after size change');
requireText(flash, 'if (opportunity.expectedProfit <= 0n) return true;', 'provisional negative path reaches provider repricing');
requireText(flash, 'originalCryptaraAdmission(opportunity)', 'positive repriced candidate still uses original Cryptara authority');

// Global invariants preserved.
requireText(quoter, 'grossProfit - allInCost', 'zero-capital all-in economics remain authoritative');
requireText(quoter, 'executablePositive: netProfit > 0n', 'strict positive execution economics remain unchanged');
requireText(canonical, "executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'", 'canonical strict net-positive floor retained');
requireText(canonical, 'ensureStageOneBootstrapAuthority();', 'governance bootstrap authority retained');
requireText(canonical, 'ensureZeroCapitalResourceWiring();', 'resource controls retained');
requireText(canonical, 'ensureAlchemyStandardRpcFirstWiring();', 'Alchemy public-first containment retained');
requireText(canonical, 'paidAlchemyPendingEvidenceExplicitlyEnabled()', 'paid pending stream remains explicit opt-in');
forbidText(canonical, 'Coinbase', 'batch did not introduce Coinbase-specific wiring');

if (failures.length) {
  console.error('[yellow-circle-batch-1] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[yellow-circle-batch-1] PASS — five-system batch preserves strict all-in net-positive execution, Cryptara/governance/resource gates, public-first cost containment, and observation-only status for new evidence surfaces.');
