const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }
function lacks(text, needle, message) { must(!text.includes(needle), message); }

const maker = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
const liquidation = read('server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');

// Every viable maker symbol must receive authenticated fee priming and canonical
// live evaluation in the same cycle. Provider rate limiting remains beneath the
// fee/evaluator authorities; discovery may not create a separate defer class.
has(maker, 'const coinbaseSymbols = viable', 'maker fee priming must cover every viable Coinbase route');
has(maker, 'const krakenSymbols = viable', 'maker fee priming must cover every viable Kraken route');
has(maker, 'const okxSymbols = viable', 'maker fee priming must cover every viable OKX route');
has(maker, 'runBounded(viable, makerLiveEvaluationConcurrency()', 'every viable maker symbol must receive same-cycle canonical live evaluation');
has(maker, 'maker_first_pass:all_viable_symbols_live_evaluated', 'maker first-pass provenance is missing');
has(maker, 'maker_fee_prime:all_viable_symbols_first_pass', 'maker all-route fee priming provenance is missing');
lacks(maker, 'makerFeePrimeBudget', 'maker fee budget must not suppress viable route measurement');
lacks(maker, 'selectMakerFeePrimeTargets', 'maker target selection must not create deferred viable routes');
lacks(maker, 'makerFeePrimeCursor', 'maker rotating fee cursor must remain retired');

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

console.log('[first-pass-route-measurability] PASS: maker and liquidation no longer use discovery budgets to suppress viable first-pass evidence acquisition; provider pressure is bounded by concurrency/rate authorities without dropping routes');
