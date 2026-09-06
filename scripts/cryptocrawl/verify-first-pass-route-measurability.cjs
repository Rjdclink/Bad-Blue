const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }
function lacks(text, needle, message) { must(!text.includes(needle), message); }

const maker = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
const makerAdmission = read('server/services/cryptocrawl/runtime/no-bps-maker-admission-wiring.ts');
const liquidation = read('server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');

// Every viable maker symbol must receive authenticated fee priming and canonical
// live evaluation in the same cycle. Historical selector names may remain for
// compatibility, but their former route-dropping semantics are forbidden.
has(maker, 'const feeTargets = selectMakerFeePrimeTargets(viable)', 'maker structural compatibility selector must consume the complete viable set');
has(maker, 'return [...viable];', 'maker compatibility selector must return every viable route');
has(maker, 'const coinbaseSymbols = feeTargets', 'maker fee priming must cover the complete compatibility-selected Coinbase set');
has(maker, 'const krakenSymbols = feeTargets', 'maker fee priming must cover the complete compatibility-selected Kraken set');
has(maker, 'const okxSymbols = feeTargets', 'maker fee priming must cover the complete compatibility-selected OKX set');
has(maker, "primeResult.unresolved.filter(item => item.venue === 'okx')", 'unresolved OKX maker fee evidence must be classified in the same cycle');
has(maker, "!entry.constraints.feeGroupId", 'only ungrouped unresolved OKX products may fan into per-instrument fallback');
has(maker, "resolveCexFeeEvidence('okx', item.symbol, { forceRefresh: true })", 'ungrouped OKX maker fallback must use canonical force-refresh evidence authority');
has(maker, 'runBounded(viable, makerLiveEvaluationConcurrency()', 'every viable maker symbol must receive same-cycle canonical live evaluation');
has(maker, 'maker_first_pass:all_viable_symbols_live_evaluated', 'maker first-pass provenance is missing');
has(maker, 'maker_fee_prime:all_viable_symbols_first_pass', 'maker all-route fee priming provenance is missing');
has(maker, 'maker_fee_redundancy:batch_then_ungrouped_okx_force_refresh', 'maker redundant first-pass fee acquisition provenance is missing');
lacks(maker, '.slice(0, makerFeePrimeBudget())', 'maker compatibility budget must never slice viable routes');

// The verifier wrapper must not reintroduce a second maker omission policy after
// discovery. It may order all governed symbols, but it must evaluate all of them.
has(makerAdmission, 'function makerAdmissionSymbolBudget(): number {', 'historical maker admission budget function must remain visible');
has(makerAdmission, 'return Number.MAX_SAFE_INTEGER;', 'historical maker admission budget must be non-constraining');
has(makerAdmission, 'return [...governedSymbols].sort', 'maker admission selector must preserve every governed route');
has(makerAdmission, 'const makerSymbols = selectMakerAdmissionSymbols(governedSymbols, plans)', 'maker admission must use the non-dropping selector');
has(makerAdmission, 'allGovernedMakerSymbolsEvaluated: makerSymbols.length === governedSymbols.length', 'maker all-governed coverage must be observable');
has(makerAdmission, "privateFeeHydrationPolicy: 'all_governed_symbols_first_pass_ordered_by_measured_recovery_value'", 'maker runtime all-route first-pass policy is missing');
lacks(makerAdmission, '.slice(0, makerAdmissionSymbolBudget())', 'maker admission must not slice governed routes');

// Every liquidatable position on an exact execution chain must receive full
// hydration. Concurrency can bound pressure but cannot slice away positions.
has(liquidation, 'runBounded(prioritized, liquidationHydrationConcurrency()', 'all liquidatable positions must be hydrated in the same cycle');
has(liquidation, 'liquidation_first_pass:full_hydration_same_cycle', 'liquidation first-pass provenance is missing');
has(liquidation, 'required:liquidation_debt_reserve_and_amount', 'liquidation hard execution evidence must be explicitly required');
has(liquidation, 'required:exact_liquidation_simulation', 'exact liquidation simulation must remain a hard execution fact');
lacks(liquidation, 'CRYPTOCRAWL_LIQUIDATION_FIRM_HYDRATION_PER_CHAIN', 'per-chain liquidation hydration cap must remain retired');
lacks(liquidation, '.slice(0, hydrationLimit)', 'liquidation hydration must not slice viable positions');

// Minimum-sufficient execution semantics remain canonical: optional/advisory facts
// cannot veto a trade, while explicit required/critical facts remain blocking.
has(registry, 'hasMinimumSufficientExecutionEvidence', 'minimum-sufficient execution invariant must remain installed');
has(registry, "normalized.startsWith('required:')", 'required execution facts must remain blocking');
has(registry, "normalized.startsWith('optional:')", 'optional facts must remain recognized as nonblocking');
has(registry, "normalized.startsWith('advisory:')", 'advisory facts must remain recognized as nonblocking');

console.log('[first-pass-route-measurability] PASS: maker discovery/admission and liquidation no longer use route-dropping evidence budgets; compatibility selectors are non-constraining, provider pressure remains bounded by canonical rate/concurrency authorities, and minimum-sufficient execution evidence remains enforced');