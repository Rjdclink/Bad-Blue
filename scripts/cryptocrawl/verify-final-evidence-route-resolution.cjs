const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }
function lacks(text, needle, message) { must(!text.includes(needle), message); }

const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const decimals = read('server/services/cryptocrawl/intelligence/erc20-decimals-authority.ts');
const dexDiscovery = read('server/services/cryptocrawl/discovery/dex-opportunity-generator.ts');
const dexExecutor = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const profit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const payouts = read('supabase/functions/cryptocrawler-terminal-sweeper/payouts.ts');
const retained = read('server/services/cryptocrawl/execution/cex-treasury-transfer-worker.ts');

// Missing bridge evidence must be actively reacquired for every currently
// structural route, not manufactured and not skipped by a rotating sample.
has(crossChain, 'acquireRouteQuotes(routes, notionalUsd)', 'cross-chain discovery must reacquire all structural route quotes each cycle');
has(crossChain, 'evidence_reacquisition:all_structural_routes_each_cycle_bounded_concurrency', 'cross-chain reacquisition provenance missing');
lacks(crossChain, 'rotatingQuoteRoutes', 'rotating Across sampling can leave permanent missing-evidence holes');
has(crossChain, "quotes.set(routeKey(route), null)", 'provider failures must remain explicit missing evidence');

// Stablecoin base units are contract facts. DEX discovery and execution must use
// measured ERC20 decimals so 18-decimal BSC assets cannot be treated as 6-decimal.
has(decimals, "token.decimals()", 'ERC20 decimal authority must read the token contract');
has(decimals, "multiProviderRpcManager.execute", 'ERC20 decimal authority must use the canonical RPC mesh');
has(dexDiscovery, 'getMeasuredErc20Decimals', 'DEX discovery must use measured token decimals');
has(dexExecutor, 'getMeasuredErc20Decimals', 'DEX execution must use measured token decimals');
has(dexExecutor, 'inputTokenDecimals: firm.inputTokenDecimals', 'prepared DEX plan must bind measured input-token decimals');
has(dexExecutor, 'usdToBaseUnitsCeil(gasUsd, firm.inputTokenDecimals)', 'DEX gas reserve must be converted with measured input-token decimals');
has(dexExecutor, 'baseUnitsToUsd(receiverProfit, plan.inputTokenDecimals)', 'terminal DEX profit must use measured input-token decimals');
lacks(dexExecutor, 'stableUnits(input.request.notionalUsd)', 'DEX execution must not use the old implicit six-decimal sizing call');

// A missing 0x leg can no longer disappear from the registry, and firm hydration
// is ranked/bounded rather than guarded by a fixed negative-BPS threshold.
has(dexDiscovery, 'missingDexCandidate', 'DEX missing evidence must remain observable/retryable');
has(dexDiscovery, 'firmHydrationBudget()', 'DEX firm hydration must be bounded');
has(dexDiscovery, 'firm_hydration:fixed_negative_bps_gate_removed', 'DEX fixed hydration floor retirement must be explicit');
lacks(dexDiscovery, 'firmHydrationFloorBps', 'fixed negative-BPS firm hydration gate must remain retired');

// Funding private evidence budget must prioritize the supported positive carry
// direction. Exact costs/depth are measured even before the entry window opens so
// projected all-in BPS can remain visible without granting execution authority.
has(funding, 'compareFundingEnrichmentPriority', 'funding enrichment must use explicit value priority');
has(funding, 'positiveSupportedDirection', 'positive supported funding direction must receive first private evidence slots');
has(funding, "observation.fundingRate > 0\n            ? measureOkxFundingExecutionEvidence", 'positive funding routes must measure exact evidence outside the entry-window gate');
lacks(funding, 'observation.fundingRate > 0 && window.eligible\n            ? measureOkxFundingExecutionEvidence', 'entry-window timing must not suppress projected BPS evidence acquisition');
has(funding, 'funding_measured_bps:not_gated_by_entry_window', 'funding measurable-BPS provenance missing');

// Fixed settlement policy is code-complete: terminal positive profit creates the
// 90% ETH obligation and 10% retained allocation; payout code converts/withdraws
// ETH with recipient/finality proof and retained capital has a transfer worker.
has(profit, 'const PAYOUT_FRACTION = 0.90;', 'terminal payout split must remain 90%');
has(profit, 'const RETAINED_FRACTION = 0.10;', 'retained system-capital split must remain 10%');
has(profit, "'ETH','ethereum','QUEUED'", '90% obligation must target ETH on Ethereum');
has(payouts, 'verifyRecipientBoundPayout', 'ETH payout requires recipient-bound confirmation');
has(payouts, "eth_getBlockByNumber', ['finalized'", 'ETH payout must wait for finalized Ethereum evidence');
has(retained, 'cryptocrawler_retained_exchange_allocations', 'retained 10% must have physical placement/recovery worker authority');

console.log('[final-evidence-route-resolution] PASS: bridge/DEX/funding missing evidence is actively reacquired, DEX token precision is measured on-chain, arbitrary firm-hydration suppression is removed, projected funding BPS stays measurable without weakening execution gates, and fixed 90/10 terminal settlement remains fully wired');
