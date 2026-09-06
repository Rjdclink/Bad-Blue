const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }
function lacks(text, needle, message) { must(!text.includes(needle), message); }

const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const decimals = read('server/services/cryptocrawl/intelligence/erc20-decimals-authority.ts');
const dexDiscovery = read('server/services/cryptocrawl/discovery/dex-opportunity-generator.ts');
const dexExecutor = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');
const zeroCapitalQuoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const profit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const payouts = read('supabase/functions/cryptocrawler-terminal-sweeper/payouts.ts');
const retained = read('server/services/cryptocrawl/execution/cex-treasury-transfer-worker.ts');

// Bridge evidence acquisition covers every structural route in the current cycle;
// no rotating sample may create a permanent missing-information class.
has(crossChain, 'acquireRouteQuotes(routes, notionalUsd)', 'cross-chain discovery must acquire all structural route quotes each cycle');
has(crossChain, 'evidence_reacquisition:all_structural_routes_each_cycle_bounded_concurrency', 'cross-chain all-route acquisition provenance missing');
lacks(crossChain, 'rotatingQuoteRoutes', 'rotating Across sampling can leave evidence holes');
has(crossChain, "quotes.set(routeKey(route), null)", 'provider failures must remain explicit rather than synthetic');

// Stablecoin base units are contract facts. DEX discovery and execution must use
// measured ERC20 decimals so chain-specific token precision cannot be assumed.
has(decimals, 'token.decimals()', 'ERC20 decimal authority must read the token contract');
has(decimals, 'multiProviderRpcManager.execute', 'ERC20 decimal authority must use the canonical RPC mesh');
has(dexDiscovery, 'getMeasuredErc20Decimals', 'DEX discovery must use measured token decimals');
has(dexExecutor, 'getMeasuredErc20Decimals', 'DEX execution must use measured token decimals');
has(dexExecutor, 'inputTokenDecimals: firm.inputTokenDecimals', 'prepared DEX plan must bind measured input-token decimals');
has(dexExecutor, 'usdToBaseUnitsCeil(gasUsd, firm.inputTokenDecimals)', 'DEX gas reserve must use measured input-token decimals');
has(dexExecutor, 'baseUnitsToUsd(receiverProfit, plan.inputTokenDecimals)', 'terminal DEX profit must use measured input-token decimals');
lacks(dexExecutor, 'stableUnits(input.request.notionalUsd)', 'DEX execution must not restore implicit six-decimal sizing');

// Every DEX route with complete indicative quote legs is hydrated in the same
// cycle, and numeric observation BPS survives even when firm execution proof fails.
has(dexDiscovery, 'missingDexCandidate', 'DEX missing evidence must remain explicit');
has(dexDiscovery, 'const hydrationTargets = new Set(indicative.map(item => item.opportunityId))', 'every indicative DEX route must receive same-cycle firm hydration');
has(dexDiscovery, 'firm_hydration:budget_defer_removed', 'DEX budget deferral must stay retired');
has(dexDiscovery, 'observationNetBps', 'DEX must preserve numeric observation BPS before executable hydration');
has(dexDiscovery, 'measureBalancerFlashLoanEconomics', 'DEX observation BPS must include measured flash-provider fee evidence');
has(dexDiscovery, 'dex_observation_bps:indicative_not_execution_authority', 'indicative numeric BPS must not become execution authority');
lacks(dexDiscovery, 'firm_hydration_budget_deferred_this_cycle', 'DEX routes must not be deferred by hydration budget');
lacks(zeroCapitalQuoter, 'if (netProfitBps < discoveryFloorBps) return null', 'negative measured zero-capital routes must not disappear behind an observation floor');
has(zeroCapitalQuoter, "multiProviderRpcManager.execute(\n      chain as RpcSupportedChain,\n      'contract_calls'", 'direct atomic route quotes must use the canonical RPC mesh');

// Funding private evidence is acquired for every discovered OKX instrument on the
// first pass. Entry-window timing can gate submission but cannot gate measurement.
has(funding, 'compareFundingEnrichmentPriority', 'funding enrichment must retain deterministic ordering');
has(funding, 'firstPassPrivateEvidenceForAllOkxRoutes: true', 'funding first-pass all-route evidence invariant missing');
has(funding, 'okxPrivateCapabilityDeferred: 0', 'funding private evidence must not be budget-deferred');
has(funding, 'funding_private_enrichment:all_supported_okx_routes_first_pass', 'funding all-route first-pass provenance missing');
lacks(funding, 'private_funding_evidence_deferred_retry', 'funding budget-deferred retry must remain retired');
has(funding, 'funding_measured_bps:not_gated_by_entry_window', 'funding measurable-BPS provenance missing');

// Optional/redundant/advisory completeness cannot become a shadow execution veto.
has(registry, 'hasMinimumSufficientExecutionEvidence', 'minimum-sufficient execution authority missing');
has(registry, "normalized.startsWith('optional:')", 'optional evidence must be nonblocking');
has(registry, "normalized.startsWith('redundant:')", 'redundant evidence must be nonblocking');
has(registry, "normalized.startsWith('advisory:')", 'advisory evidence must be nonblocking');
has(registry, "normalized.startsWith('required:')", 'required evidence must remain blocking');
has(registry, "normalized.startsWith('critical:')", 'critical evidence must remain blocking');

// Fixed settlement policy is code-complete: terminal positive profit creates the
// 90% ETH obligation and 10% retained allocation; payout code proves recipient and
// Ethereum finality while retained capital has physical placement/recovery authority.
has(profit, 'const PAYOUT_FRACTION = 0.90;', 'terminal payout split must remain 90%');
has(profit, 'const RETAINED_FRACTION = 0.10;', 'retained system-capital split must remain 10%');
has(profit, "'ETH','ethereum','QUEUED'", '90% obligation must target ETH on Ethereum');
has(payouts, 'verifyRecipientBoundPayout', 'ETH payout requires recipient-bound confirmation');
has(payouts, "eth_getBlockByNumber', ['finalized'", 'ETH payout must wait for finalized Ethereum evidence');
has(retained, 'cryptocrawler_retained_exchange_allocations', 'retained 10% must have physical placement/recovery worker authority');

console.log('[final-evidence-route-resolution] PASS: first-pass all-route bridge/DEX/funding evidence, numeric negative-route BPS, minimum-sufficient execution, measured token precision, redundant RPC acquisition, and 90/10 settlement wiring are guarded');
