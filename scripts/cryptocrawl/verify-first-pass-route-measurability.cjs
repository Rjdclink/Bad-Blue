const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }
function lacks(text, needle, message) { must(!text.includes(needle), message); }

const maker = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
const makerAdmission = read('server/services/cryptocrawl/runtime/no-bps-maker-admission-wiring.ts');
const liquidation = read('server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts');
const liquidationExecutor = read('server/services/cryptocrawl/execution/aave-liquidation-atomic-executor.ts');
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

// Every liquidatable position on an exact execution chain must receive full hard-
// fact hydration. eth_call simulation is advisory only and cannot be required for
// submission; current protocol/oracle/size/flash/unwind/gas evidence is required.
has(liquidation, 'runBounded(prioritized, liquidationHydrationConcurrency()', 'all liquidatable positions must be hydrated in the same cycle');
has(liquidation, 'liquidation_first_pass:full_hydration_same_cycle', 'liquidation first-pass provenance is missing');
has(liquidation, 'required:liquidation_debt_reserve_and_amount', 'liquidation debt reserve/amount evidence must be explicitly required');
has(liquidation, 'required:liquidation_collateral_reserve_and_amount', 'liquidation collateral reserve/amount evidence must be explicitly required');
has(liquidation, 'required:liquidation_bonus_and_protocol_fee', 'liquidation bonus/protocol-fee evidence must be explicitly required');
has(liquidation, 'required:liquidation_close_factor_total_debt_thresholds_and_dust', 'liquidation close-factor and dust evidence must be explicitly required');
has(liquidation, 'required:liquidation_reserve_pause_grace_and_emode_state', 'liquidation pause/grace/eMode evidence must be explicitly required');
has(liquidation, 'required:liquidation_oracle_values', 'liquidation oracle evidence must be explicitly required');
has(liquidation, 'required:measured_flash_loan_provider_liquidity_and_fee', 'liquidation flash-liquidity/fee evidence must be explicitly required');
has(liquidation, 'required:liquidation_collateral_unwind_quote', 'liquidation unwind evidence must be explicitly required');
has(liquidation, 'required:liquidation_gas_cost', 'liquidation gas evidence must be explicitly required');
has(liquidation, 'liquidation_eth_call_simulation_execution_authority:false', 'liquidation simulation must remain non-authoritative');
has(liquidation, 'liquidation_simulation_veto_authority:false', 'eligible liquidation simulation must remain non-vetoing');
lacks(liquidation, 'required:exact_liquidation_simulation', 'simulation must not become required liquidation execution evidence');
lacks(liquidation, 'CRYPTOCRAWL_LIQUIDATION_FIRM_HYDRATION_PER_CHAIN', 'per-chain liquidation hydration cap must remain retired');
lacks(liquidation, '.slice(0, hydrationLimit)', 'liquidation hydration must not slice viable positions');

// Position-level coverage is insufficient if a borrower has several valid debt /
// collateral combinations. Every structural pair must be measured before the best
// positive all-in plan is selected; no hidden pair limit may starve a viable route.
has(liquidationExecutor, 'for (const pair of pairs)', 'liquidation compiler must hydrate every structural debt/collateral pair');
has(liquidationExecutor, 'liquidation_pair_hydration:all_structural_pairs_same_cycle', 'all-pair liquidation hydration provenance is missing');
has(liquidationExecutor, 'liquidation_pair_selection:highest_measured_positive_all_in_net_profit_usd', 'liquidation pair selection must use the highest measured positive all-in net plan');
has(liquidationExecutor, 'if (!bestPlan || plan.deterministicNetProfitUsd > bestPlan.deterministicNetProfitUsd) bestPlan = plan;', 'liquidation compiler must compare all positive prepared plans');
lacks(liquidationExecutor, 'CRYPTOCRAWL_LIQUIDATION_PAIR_HYDRATION_LIMIT', 'liquidation pair hydration limit must remain retired');
lacks(liquidationExecutor, 'pairs.slice(0, pairLimit)', 'liquidation pair hydration must not slice structural pairs');

// Required/critical execution evidence remains blocking. Optional/redundant/
// advisory evidence remains observable but cannot become an execution veto.
has(registry, "normalized.startsWith('required:')", 'required execution evidence must remain blocking');
has(registry, "normalized.startsWith('critical:')", 'critical execution evidence must remain blocking');
has(registry, "normalized.startsWith('optional:')", 'optional evidence must remain nonblocking');
has(registry, "normalized.startsWith('redundant:')", 'redundant evidence must remain nonblocking');
has(registry, "normalized.startsWith('advisory:')", 'advisory evidence must remain nonblocking');
has(registry, 'executionBlockingMissingInformation(candidate)', 'execution consumers must receive the actual blocking evidence gaps');

console.log('[first-pass-route-measurability] PASS: maker and liquidation routes receive same-cycle required evidence hydration without route-dropping budgets; liquidation simulation is advisory-only; required/critical execution evidence remains authoritative');
