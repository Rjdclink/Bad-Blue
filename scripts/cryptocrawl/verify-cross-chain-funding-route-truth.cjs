'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`[route-truth] missing required source: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[route-truth] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[route-truth] forbidden regression: ${description}`);
}

const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const crossChainEconomics = read('server/services/cryptocrawl/discovery/cross-chain-route-economics.ts');
const acrossExecutor = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const fundingPolicy = read('server/services/cryptocrawl/discovery/funding-arbitrage-policy.ts');
const fundingLifecycle = read('server/services/cryptocrawl/execution/funding-position-lifecycle.ts');
const fundingMigration = read('server/migrations/024_cryptocrawler_funding_lifecycle.sql');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const retainedProfit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const inventoryReadiness = read('server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts');

// Across transport alone is not profit. A route may become executable only when
// same-asset closed-value economics are based on guaranteed minimum output, live
// asset value, separately paid origin gas, and no unpriced approval transaction.
requirePattern(crossChain, /getAcrossBridgeReadiness/, 'cross-chain discovery exposes production configuration truth');
requirePattern(crossChain, /evaluateAcrossSameAssetProfit/, 'cross-chain discovery delegates canonical same-asset profit calculation');
requirePattern(crossChain, /const deterministicPositive = economics\?\.executablePositive === true/, 'cross-chain eligibility requires positive canonical route economics');
requirePattern(crossChain, /const approvalGasCanonical = hasFreshQuote && quote\.approvalTransactions === 0/, 'approval-required Across routes stay blocked until approval gas is canonically priced');
requirePattern(crossChain, /const routeExecutable = deterministicPositive[\s\S]{0,240}approvalGasCanonical[\s\S]{0,240}quote!\.minOutputAmount !== null/, 'cross-chain execution requires positive economics, priced gas, and guaranteed output');
requirePattern(crossChain, /status: routeExecutable \? 'eligible' : deterministicPositive \? 'deterministic_positive'/, 'only fully executable positive routes become eligible');
requirePattern(crossChain, /grossProfitUsd: economics\?\.routeGainUsdBeforeOriginGas \?\? null/, 'cross-chain gross profit comes from measured same-asset route gain');
requirePattern(crossChain, /deterministicNetProfitUsd: economics\?\.deterministicNetProfitUsd \?\? null/, 'cross-chain deterministic net comes from canonical route economics');
requirePattern(crossChain, /cross_chain_profit_output_authority:minimum_guaranteed_output/, 'minimum guaranteed output is the cross-chain profit output authority');
requirePattern(crossChain, /measured_approval_gas_usd/, 'unpriced approval gas remains explicit missing evidence');
requirePattern(crossChain, /cross_chain_profit_model:same_asset_closed_value/, 'cross-chain profit model is closed same-asset value');
requirePattern(crossChain, /cross_chain_profit_model:minimum_output_not_expected_output/, 'expected output cannot become canonical cross-chain profit');
requirePattern(crossChain, /cross_chain_profit_model:origin_gas_subtracted_once/, 'origin gas is subtracted exactly once');
requirePattern(crossChain, /cross_chain_profit_model:unpriced_approval_gas_blocks_execution/, 'unpriced approval gas blocks execution');
requirePattern(crossChain, /prepared\.quote\.expiresAt <= Date\.now\(\) \|\| prepared\.quote\.approvalTransactions > 0/, 'prepared route cache cannot retain stale or approval-gas-incomplete routes');
forbidPattern(crossChain, /cross_chain_transport_only:not_profit_opportunity|cross_chain_source_destination_profit_leg/, 'retired transport-only/missing-revenue-leg state cannot replace implemented measured profit truth');

requirePattern(crossChainEconomics, /quote\.minOutputAmount/, 'cross-chain economics require guaranteed minimum output');
requirePattern(crossChainEconomics, /routeGainUsdBeforeOriginGas = \(guaranteedOutputHuman - inputAmountHuman\) \* price/, 'same-asset gain is measured from guaranteed output minus input');
requirePattern(crossChainEconomics, /deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd/, 'origin gas is deducted once from route gain');
requirePattern(crossChainEconomics, /executablePositive: deterministicNetProfitUsd > 0/, 'cross-chain execution requires strict positive deterministic net');
requirePattern(crossChainEconomics, /across_min_output_same_asset_plus_live_usd_price/, 'cross-chain economics identify their measured authority');

requirePattern(acrossExecutor, /getAcrossBridgeQuote\s*\(/, 'Across executor refreshes the route immediately before signing');
requirePattern(acrossExecutor, /freshExecutionPayload\s*\(/, 'Across executor refreshes executable calldata');
requirePattern(acrossExecutor, /freshMinimum\s*<\s*oldMinimum/, 'Across executor applies minimum-output drift protection');
requirePattern(acrossExecutor, /requireAllowed\(\s*'SUBMIT_TX'/, 'Across execution remains governance-gated');
requirePattern(acrossExecutor, /getAcrossDepositSettlementEvidence\s*\(/, 'Across execution polls provider settlement evidence');
requirePattern(acrossExecutor, /destinationReceiptVerified/, 'successful Across fill requires destination receipt verification');
requirePattern(acrossExecutor, /refundReceiptVerified/, 'Across refund requires receipt verification');
requirePattern(acrossExecutor, /ACROSS_TERMINAL_SETTLEMENT_TIMEOUT/, 'unknown terminal settlement fails closed');

// Funding is a carry topology. The durable open/monitor/close state machine now
// exists, but public carry observations remain non-executable until a real venue
// adapter and measured exit/depth/margin/terminal evidence are present.
requirePattern(funding, /getOkxSwapCapability\s*\(/, 'funding monitor hydrates authenticated OKX SWAP capability');
requirePattern(funding, /resolveCexFeeEvidence\(\s*'okx'/, 'funding monitor consumes canonical authenticated spot fees');
requirePattern(funding, /exitBasisReserveBps:\s*null/, 'future exit-basis reserve is not fabricated');
requirePattern(funding, /expectedSlippageBps:\s*null/, 'unmeasured funding lifecycle slippage is not fabricated');
requirePattern(funding, /funding_venue_lifecycle_adapter/, 'missing venue lifecycle adapter stays explicit');
forbidPattern(funding, /persistent_delta_neutral_position_lifecycle/, 'discovery cannot claim the durable funding lifecycle itself is still missing');
requirePattern(funding, /durable_funding_lifecycle:implemented_migration_owned_nonblocking/, 'discovery records implemented lifecycle truth');
requirePattern(funding, /liquidation_margin_and_collateral_monitoring/, 'missing liquidation-safe collateral evidence stays explicit');
requirePattern(funding, /terminal_funding_payment_and_close_settlement/, 'terminal funding and close settlement remains mandatory');
requirePattern(funding, /executableCapability:\s*false/, 'funding observations remain non-executable without complete adapter/economics');
requirePattern(fundingPolicy, /input\.fundingRateLocked\s*&&\s*supportedDirection/, 'deterministic funding P&L requires locked rate and supported direction');
requirePattern(fundingPolicy, /unknown|projected funding|projected profit/i, 'funding policy documents projected-versus-deterministic separation');

requirePattern(fundingMigration, /private\.cryptocrawler_funding_lifecycles/, 'funding lifecycle table is migration-owned');
requirePattern(fundingLifecycle, /advanceOpenLifecycles/, 'funding lifecycle advances durably on later bounded scheduler ticks');
requirePattern(fundingLifecycle, /openDeltaNeutral/, 'funding lifecycle requires measured delta-neutral opening');
requirePattern(fundingLifecycle, /marginHealthy/, 'funding lifecycle requires margin-health observation');
requirePattern(fundingLifecycle, /closeAndSettle/, 'funding lifecycle requires terminal close settlement');
forbidPattern(fundingLifecycle, /CREATE\s+(TABLE|SCHEMA)/i, 'funding runtime cannot own DDL');
forbidPattern(fundingLifecycle, /while\s*\(\s*Date\.now\(\)\s*</, 'funding lifecycle cannot block through the funding window');
requirePattern(router, /funding_lifecycle_adapter_unavailable/, 'unregistered funding venue adapters are blocked at the execution router');

// Confirmed terminal profit follows the current operator treasury law: 90% is a
// durable ETH payout obligation and 10% remains available as retained capital.
requirePattern(retainedProfit, /const PAYOUT_FRACTION = 0\.90/, 'new terminal profits must allocate 90 percent to payout');
requirePattern(retainedProfit, /const RETAINED_FRACTION = 0\.10/, 'new terminal profits must retain 10 percent for system capital');
requirePattern(retainedProfit, /payoutFraction:\s*PAYOUT_FRACTION/, 'durable allocation must use the fixed payout fraction');
requirePattern(retainedProfit, /retainedFraction:\s*RETAINED_FRACTION/, 'durable allocation must use the fixed retained fraction');
requirePattern(retainedProfit, /'ETH','ethereum','QUEUED'/, 'new payout jobs must be ETH on Ethereum');
requirePattern(inventoryReadiness, /automaticProfitPayoutDefault:\s*true/, 'inventory telemetry must reflect automatic fixed payout truth');
requirePattern(inventoryReadiness, /automaticProfitPayoutFraction:\s*0\.90/, 'inventory telemetry must expose the 90 percent payout fraction');
requirePattern(inventoryReadiness, /retainedProfitFraction:\s*0\.10/, 'inventory telemetry must expose the 10 percent retained fraction');
requirePattern(inventoryReadiness, /unreservedRetainedProfitAvailableToStrategies:\s*true/, 'inventory telemetry reflects retained-capital spendability');
forbidPattern(inventoryReadiness, /automaticProfitPayoutRequiresExplicitOptIn:\s*true/, 'stale explicit-opt-in payout telemetry');
forbidPattern(inventoryReadiness, /retainedFortyPercentAvailableToStrategies/, 'stale forty-percent retention telemetry');

// Daily realized-profit execution caps stay retired; Profit Ladder/Stage/inventory/
// liquidity/risk remain the exposure authorities.
requirePattern(canonicalRuntime, /adaptiveProfitCapScope:\s*'retired_no_daily_realized_profit_execution_cap'/, 'runtime telemetry reports daily profit-cap retirement');
requirePattern(canonicalRuntime, /retainedProfitRole:\s*'available_for_redeployment_subject_to_profit_ladder_stage_inventory_liquidity_and_risk'/, 'runtime telemetry reports retained-profit redeployment correctly');
forbidPattern(canonicalRuntime, /persisted_operating_day_terminal_realized_cap_plus_dynamic_notional_and_cycle_budget|new_exposure_only_settlement_hedge_flattening_exempt/, 'stale daily profit-cap authority telemetry');

console.log('[route-truth] guaranteed positive Across same-asset economics, approval-gas fail-closed protection, terminal Across settlement, durable funding lifecycle/adapter gate, fixed 90/10 treasury, retained-capital reuse, and retired profit-cap invariants passed');
