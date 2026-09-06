'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`[liquidation-profit-integrity] missing invariant: ${label}`);
}
function forbidPattern(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`[liquidation-profit-integrity] forbidden regression: ${label}`);
}

const liquidationExecutor = read('server/services/cryptocrawl/execution/aave-liquidation-atomic-executor.ts');
const liquidationDiscovery = read('server/services/cryptocrawl/discovery/liquidation-opportunity-generator.ts');
const topologyAdapter = read('server/services/cryptocrawl/execution/measured-topology-execution-adapter.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');

requirePattern(liquidationExecutor, /getUserConfiguration\(/, 'liquidation compiler consumes the live Aave reserve bitmap');
requirePattern(liquidationExecutor, /getUserReserveData\(/, 'liquidation compiler consumes reserve-level user debt/collateral');
requirePattern(liquidationExecutor, /getReserveConfigurationData\(/, 'liquidation compiler consumes live liquidation bonus/configuration');
requirePattern(liquidationExecutor, /getLiquidationProtocolFee\(/, 'liquidation compiler consumes live liquidation protocol fee');
requirePattern(liquidationExecutor, /getAssetPrice\(/, 'liquidation compiler consumes live Aave oracle values');
requirePattern(liquidationExecutor, /measureAaveV3FlashLoanEconomics\(/, 'liquidation compiler measures Aave flash liquidity and fee');
requirePattern(liquidationExecutor, /purpose:\s*'execution'/, 'collateral unwind requires a firm executable 0x quote');
requirePattern(liquidationExecutor, /liquidationCall/, 'atomic receiver payload contains Aave liquidationCall');
requirePattern(liquidationExecutor, /provider\.call\(/, 'complete liquidation payload is eth_call simulated before admission');
requirePattern(liquidationExecutor, /provider\.estimateGas\(/, 'complete liquidation payload is gas-estimated before admission');
requirePattern(liquidationExecutor, /getLiveSymbolPrices/, 'pretrade gas uses live native USD pricing');
requirePattern(liquidationExecutor, /deterministicNetProfitUsd\s*<=\s*0/, 'non-positive all-in liquidation economics fail closed');
requirePattern(liquidationExecutor, /balanceOf\((?:plan\.)?receiver\)/, 'selected Aave receiver loan-token starting balance is checked');
requirePattern(liquidationExecutor, /AAVE_LIQUIDATION_RECEIVER_DEBT_BALANCE_CHANGED_BEFORE_SUBMISSION/, 'submit-time receiver balance drift fails closed');
requirePattern(liquidationExecutor, /FlashLoanExecuted/, 'terminal receiver profit event is parsed');
requirePattern(liquidationExecutor, /synthetic_evidence:false/, 'liquidation provenance explicitly forbids synthetic evidence');
forbidPattern(liquidationExecutor, /FALLBACK_PRICES|getSymbolPrices\(/, 'liquidation gas may not use static native-price fallback');

// A borrower can expose several debt/collateral combinations. Every structural
// pair is evaluated before choosing the highest positive deterministic all-in net
// plan; no arbitrary pair limit may suppress a better executable liquidation.
requirePattern(liquidationExecutor, /for \(const pair of pairs\)/, 'all structural debt/collateral pairs receive same-cycle hydration');
requirePattern(liquidationExecutor, /if \(!bestPlan \|\| plan\.deterministicNetProfitUsd > bestPlan\.deterministicNetProfitUsd\) bestPlan = plan;/, 'best positive pair is selected after all-pair measurement');
requirePattern(liquidationExecutor, /liquidation_pair_hydration:all_structural_pairs_same_cycle/, 'all-pair hydration provenance is recorded');
requirePattern(liquidationExecutor, /liquidation_pair_selection:highest_measured_positive_all_in_net_profit_usd/, 'all-pair selection authority is explicit');
forbidPattern(liquidationExecutor, /CRYPTOCRAWL_LIQUIDATION_PAIR_HYDRATION_LIMIT/, 'pair route-dropping hydration cap must remain retired');
forbidPattern(liquidationExecutor, /pairs\.slice\(0, pairLimit\)/, 'structural pair candidates must not be sliced out of first-pass hydration');

requirePattern(liquidationDiscovery, /EXACT_EXECUTION_CHAINS.*ethereum.*polygon/s, 'exact liquidation execution remains limited to fully-accounted chains');
requirePattern(liquidationDiscovery, /liquidationHydrationConcurrency\(/, 'provider pressure is bounded with concurrency rather than route omission');
requirePattern(liquidationDiscovery, /runBounded\(prioritized, liquidationHydrationConcurrency\(\)/, 'every liquidatable reviewed position receives same-cycle firm hydration');
forbidPattern(liquidationDiscovery, /CRYPTOCRAWL_LIQUIDATION_FIRM_HYDRATION_PER_CHAIN/, 'per-chain route-dropping hydration cap must remain retired');
forbidPattern(liquidationDiscovery, /\.slice\(0, hydrationLimit\)/, 'liquidation candidates must not be sliced out of first-pass hydration');
requirePattern(liquidationDiscovery, /status:\s*'eligible'/, 'only exact-prepared liquidations can become eligible');
requirePattern(liquidationDiscovery, /missingInformation:\s*\[\]/, 'eligible liquidation has no hidden evidence gaps');
requirePattern(liquidationDiscovery, /required:chain_specific_complete_pretrade_gas_accounting/, 'unreviewed chain gas components remain explicit blockers');
requirePattern(liquidationDiscovery, /required:exact_liquidation_simulation/, 'exact simulation remains explicit minimum execution evidence');

requirePattern(topologyAdapter, /decision\.topology === 'LIQUIDATION'/, 'canonical measured-topology adapter selects admitted liquidations');
requirePattern(topologyAdapter, /FLASH_LOAN_LIQUIDATION/, 'liquidation path is bound to the unified route authority');
requirePattern(topologyAdapter, /zeroCapitalResourceScheduler\.acquireMeasuredAtomic/, 'liquidation uses the canonical distributed zero-capital resource scheduler');
requirePattern(topologyAdapter, /executePreparedAaveLiquidation/, 'canonical adapter performs fresh liquidation execution');
requirePattern(topologyAdapter, /recordCryptaraExecutionEvidence/, 'terminal liquidation evidence enters canonical learning pipeline');
requirePattern(topologyAdapter, /actualGasFromLiquidation/, 'actual receipt gas is reconciled before terminal profitability learning');
requirePattern(scheduler, /decision\.topology === 'LIQUIDATION'/, 'canonical parent scheduler remains the sole liquidation dispatch owner');

console.log('[liquidation-profit-integrity] exact Aave liquidation, all-position/all-pair first-pass hydration, highest measured positive all-in pair selection, fresh executable quote/simulation, receiver balance/profit provenance, actual-gas reconciliation, canonical parent scheduling, and terminal-only learning invariants passed');