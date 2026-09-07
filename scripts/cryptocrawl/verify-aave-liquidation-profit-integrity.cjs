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

// Current Aave execution authority must come from concrete protocol state, not an
// arbitrary sizing haircut or a successful eth_call simulation.
requirePattern(liquidationExecutor, /const blockTag = await input\.provider\.getBlockNumber\(\)/, 'liquidation compiler binds Aave state to one snapshot block');
requirePattern(liquidationExecutor, /getUserAccountData\(/, 'liquidation compiler consumes current account health and total debt');
requirePattern(liquidationExecutor, /getReservesCount\(/, 'liquidation compiler consumes exact reserve count');
requirePattern(liquidationExecutor, /getReserveAddressById\(/, 'liquidation compiler maps reserve ids without list-index assumptions');
requirePattern(liquidationExecutor, /getUserReserveData\(/, 'liquidation compiler consumes reserve-level user debt and collateral');
requirePattern(liquidationExecutor, /getReserveConfigurationData\(/, 'liquidation compiler consumes reserve liquidation configuration');
requirePattern(liquidationExecutor, /getLiquidationProtocolFee\(/, 'liquidation compiler consumes current liquidation protocol fee');
requirePattern(liquidationExecutor, /getPaused\(/, 'liquidation compiler verifies reserve pause state');
requirePattern(liquidationExecutor, /getLiquidationGracePeriod\(/, 'liquidation compiler verifies liquidation grace period');
requirePattern(liquidationExecutor, /getUserEMode\(/, 'liquidation compiler reads borrower eMode category');
requirePattern(liquidationExecutor, /getEModeCategoryCollateralConfig\(/, 'liquidation compiler reads eMode liquidation bonus');
requirePattern(liquidationExecutor, /getEModeCategoryCollateralBitmap\(/, 'liquidation compiler binds eMode collateral bitmap to exact reserve ids');
requirePattern(liquidationExecutor, /getAssetPrice\(/, 'liquidation compiler consumes live Aave oracle values');
requirePattern(liquidationExecutor, /MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD/, 'Aave 2000 USD reserve threshold is explicit');
requirePattern(liquidationExecutor, /MIN_LEFTOVER_BASE/, 'Aave 1000 USD residual dust threshold is explicit');
requirePattern(liquidationExecutor, /DEFAULT_LIQUIDATION_CLOSE_FACTOR_BPS\s*=\s*5_000/, 'Aave default 50 percent close factor is explicit');
requirePattern(liquidationExecutor, /totalDefaultLiquidatableDebtBase/, 'default close factor is based on total account debt');
requirePattern(liquidationExecutor, /percentMulHalfUp\(/, 'Aave percentage half-up rounding is represented');
requirePattern(liquidationExecutor, /percentDivCeil\(/, 'Aave collateral-bound debt rounding is represented');
requirePattern(liquidationExecutor, /mulDivCeil\(/, 'Aave debt-base dust rounding is represented');
requirePattern(liquidationExecutor, /maximumProtocolValidLiquidation\(/, 'liquidation size is derived from protocol-valid maximum');
requirePattern(liquidationExecutor, /measureAaveV3FlashLoanEconomics\(/, 'liquidation compiler measures current flash liquidity and fee');
requirePattern(liquidationExecutor, /purpose:\s*'execution'/, 'collateral unwind requires a firm executable 0x quote');
requirePattern(liquidationExecutor, /liquidationCall/, 'atomic receiver payload contains Aave liquidationCall');
requirePattern(liquidationExecutor, /provider\.estimateGas\(/, 'complete liquidation payload is gas-estimated before admission');
requirePattern(liquidationExecutor, /getLiveSymbolPrices/, 'pretrade gas uses live native USD pricing');
requirePattern(liquidationExecutor, /deterministicNetProfitUsd\s*<=\s*0/, 'non-positive all-in liquidation economics fail closed');
requirePattern(liquidationExecutor, /simulationVetoAuthority:\s*false/, 'eth_call simulation is explicitly non-authoritative');
requirePattern(liquidationExecutor, /balanceOf\((?:plan\.)?receiver\)/, 'selected Aave receiver loan-token starting balance is checked');
requirePattern(liquidationExecutor, /AAVE_LIQUIDATION_RECEIVER_DEBT_BALANCE_CHANGED_BEFORE_SUBMISSION/, 'submit-time receiver balance drift fails closed');
requirePattern(liquidationExecutor, /FlashLoanExecuted/, 'terminal receiver profit event is parsed');
requirePattern(liquidationExecutor, /synthetic_evidence:false/, 'liquidation provenance explicitly forbids synthetic evidence');
forbidPattern(liquidationExecutor, /FALLBACK_PRICES|getSymbolPrices\(/, 'liquidation gas may not use static native-price fallback');
forbidPattern(liquidationExecutor, /4_900|9_900/, 'arbitrary 49/99 percent close-factor haircut must remain retired');
forbidPattern(liquidationExecutor, /debtToCover\s*=\s*percentMulFloor\(debtToCover,\s*9_950\)/, 'arbitrary debt sizing haircut must remain retired');
forbidPattern(liquidationExecutor, /CRYPTOCRAWL_LIQUIDATION_COLLATERAL_SELL_BPS/, 'arbitrary collateral-sell haircut must remain retired');

// Every structural pair is hydrated before the best positive executable pair is selected.
requirePattern(liquidationExecutor, /for \(const pair of pairs\)/, 'all structural debt/collateral pairs receive same-cycle hydration');
requirePattern(liquidationExecutor, /if \(!bestPlan \|\| plan\.deterministicNetProfitUsd > bestPlan\.deterministicNetProfitUsd\) bestPlan = plan;/, 'highest positive all-in pair is retained');
requirePattern(liquidationExecutor, /liquidation_pair_hydration:all_structural_pairs_same_cycle/, 'all-pair hydration provenance is recorded');
requirePattern(liquidationExecutor, /liquidation_pair_selection:highest_measured_positive_all_in_net_profit_usd/, 'all-pair selection authority is explicit');
forbidPattern(liquidationExecutor, /CRYPTOCRAWL_LIQUIDATION_PAIR_HYDRATION_LIMIT/, 'pair route-dropping hydration cap must remain retired');
forbidPattern(liquidationExecutor, /pairs\.slice\(0, pairLimit\)/, 'structural pairs must not be sliced out of first-pass hydration');

requirePattern(liquidationDiscovery, /EXACT_EXECUTION_CHAINS.*ethereum.*polygon/s, 'exact liquidation execution remains limited to fully-accounted chains');
requirePattern(liquidationDiscovery, /liquidationHydrationConcurrency\(/, 'provider pressure is bounded with concurrency rather than route omission');
requirePattern(liquidationDiscovery, /runBounded\(prioritized, liquidationHydrationConcurrency\(\)/, 'every liquidatable reviewed position receives same-cycle hard-fact hydration');
forbidPattern(liquidationDiscovery, /CRYPTOCRAWL_LIQUIDATION_FIRM_HYDRATION_PER_CHAIN/, 'per-chain route-dropping hydration cap must remain retired');
forbidPattern(liquidationDiscovery, /\.slice\(0, hydrationLimit\)/, 'liquidation candidates must not be sliced out of first-pass hydration');
requirePattern(liquidationDiscovery, /status:\s*'eligible'/, 'only exact-prepared liquidations can become eligible');
requirePattern(liquidationDiscovery, /missingInformation:\s*\[\]/, 'eligible liquidation has no hidden hard-evidence gaps');
requirePattern(liquidationDiscovery, /required:chain_specific_complete_pretrade_gas_accounting/, 'unreviewed chain gas components remain explicit blockers');
requirePattern(liquidationDiscovery, /required:liquidation_close_factor_total_debt_thresholds_and_dust/, 'exact close-factor and dust rules are required evidence');
requirePattern(liquidationDiscovery, /required:liquidation_reserve_pause_grace_and_emode_state/, 'pause/grace/eMode state is required evidence');
requirePattern(liquidationDiscovery, /liquidation_simulation_veto_authority:false/, 'simulation is not a discovery/execution prerequisite');
forbidPattern(liquidationDiscovery, /required:exact_liquidation_simulation/, 'simulation must not reappear as required execution evidence');

requirePattern(topologyAdapter, /decision\.topology === 'LIQUIDATION'/, 'canonical measured-topology adapter selects admitted liquidations');
requirePattern(topologyAdapter, /FLASH_LOAN_LIQUIDATION/, 'liquidation path is bound to the unified route authority');
requirePattern(topologyAdapter, /zeroCapitalResourceScheduler\.acquireMeasuredAtomic/, 'liquidation uses the canonical distributed zero-capital resource scheduler');
requirePattern(topologyAdapter, /executePreparedAaveLiquidation/, 'canonical adapter performs fresh liquidation preparation/execution');
requirePattern(topologyAdapter, /recordCryptaraExecutionEvidence/, 'terminal liquidation evidence enters canonical learning pipeline');
requirePattern(topologyAdapter, /actualGasFromLiquidation/, 'actual receipt gas is reconciled before terminal profitability learning');
requirePattern(scheduler, /decision\.topology === 'LIQUIDATION'/, 'canonical parent scheduler remains the sole liquidation dispatch owner');

console.log('[liquidation-profit-integrity] PASS: same-block Aave protocol facts, exact close-factor/dust/eMode/pause/grace sizing, measured flash/unwind/gas economics, advisory simulation, terminal profit proof and canonical scheduling invariants passed');
