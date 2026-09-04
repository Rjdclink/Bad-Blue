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
const acrossExecutor = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const fundingPolicy = read('server/services/cryptocrawl/discovery/funding-arbitrage-policy.ts');
const fundingLifecycle = read('server/services/cryptocrawl/execution/funding-position-lifecycle.ts');
const fundingMigration = read('server/migrations/024_cryptocrawler_funding_lifecycle.sql');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const retainedProfit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const inventoryReadiness = read('server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts');

// Cross-chain transport is implemented, but transport itself cannot be reported as profit.
requirePattern(crossChain, /getAcrossBridgeReadiness/, 'cross-chain discovery exposes production configuration truth');
requirePattern(crossChain, /cross_chain_source_destination_profit_leg/, 'cross-chain discovery identifies the actual missing revenue leg');
requirePattern(crossChain, /cross_chain_transport_only:not_profit_opportunity/, 'bridge-only routes are transport rather than arbitrage');
requirePattern(crossChain, /grossProfitUsd:\s*null/, 'bridge transport cannot invent gross profit');
requirePattern(crossChain, /deterministicNetProfitUsd:\s*null/, 'bridge transport cannot invent deterministic net profit');
requirePattern(crossChain, /executableCapability:\s*false/, 'transport-only cross-chain observations remain non-executable');
forbidPattern(crossChain, /cross_chain_transaction_builder_admission|cross_chain_status_monitor_binding|cross_chain_destination_receipt_after_execution|cross_chain_drift_tolerance|cross_chain_failure_recovery|cross_chain_terminal_settlement/, 'stale missing-information claims for implemented Across lifecycle machinery');

requirePattern(acrossExecutor, /getAcrossBridgeQuote\s*\(/, 'Across executor refreshes the route immediately before signing');
requirePattern(acrossExecutor, /freshExecutionPayload\s*\(/, 'Across executor refreshes executable calldata');
requirePattern(acrossExecutor, /freshExpected\s*<\s*oldMinimum/, 'Across executor applies minimum-output drift protection');
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

// Terminal-confirmed positive profit follows the fixed 90/10 treasury law.
// Payout reservations remain excluded from new-trade spendability while the
// retained 10% stays system-owned and available for profitable redeployment.
requirePattern(retainedProfit, /const PAYOUT_FRACTION = 0\.90;/, 'automatic terminal payout fraction must remain 90%');
requirePattern(retainedProfit, /const RETAINED_FRACTION = 0\.10;/, 'retained system-capital fraction must remain 10%');
requirePattern(retainedProfit, /feedback\.settlement\.terminal !== true/, 'automatic payout allocation requires terminal settlement');
requirePattern(retainedProfit, /feedback\.settlement\.settlementConfirmed !== true/, 'automatic payout allocation requires confirmed settlement');
requirePattern(retainedProfit, /feedback\.success !== true/, 'automatic payout allocation requires successful execution');
requirePattern(retainedProfit, /cryptocrawler_profit_payout_jobs/, 'automatic payout must persist into the durable payout lifecycle');
requirePattern(retainedProfit, /cryptocrawler_retained_exchange_allocations/, 'retained system capital must persist into the durable retained-capital lifecycle');
requirePattern(inventoryReadiness, /automaticProfitPayoutDefault:\s*true/, 'inventory telemetry must report automatic terminal-profit payout as the default');
requirePattern(inventoryReadiness, /automaticProfitPayoutRequiresExplicitOptIn:\s*false/, 'inventory telemetry must not claim a retired payout opt-in gate');
requirePattern(inventoryReadiness, /automaticProfitPayoutRequiresTerminalConfirmedProfit:\s*true/, 'inventory telemetry must report the terminal-confirmed payout gate');
requirePattern(inventoryReadiness, /payoutShareExcludedFromNewTradeSpendability:\s*true/, 'payout-reserved inventory must remain protected from new trades');
requirePattern(inventoryReadiness, /unreservedRetainedProfitAvailableToStrategies:\s*true/, 'inventory telemetry reflects retained-capital spendability');
forbidPattern(inventoryReadiness, /retainedFortyPercentAvailableToStrategies/, 'stale forty-percent retention telemetry');

// Daily realized-profit execution caps stay retired; Profit Ladder/Stage/inventory/
// liquidity/risk remain the exposure authorities.
requirePattern(canonicalRuntime, /adaptiveProfitCapScope:\s*'retired_no_daily_realized_profit_execution_cap'/, 'runtime telemetry reports daily profit-cap retirement');
requirePattern(canonicalRuntime, /retainedProfitRole:\s*'available_for_redeployment_subject_to_profit_ladder_stage_inventory_liquidity_and_risk'/, 'runtime telemetry reports retained-profit redeployment correctly');
forbidPattern(canonicalRuntime, /persisted_operating_day_terminal_realized_cap_plus_dynamic_notional_and_cycle_budget|new_exposure_only_settlement_hedge_flattening_exempt/, 'stale daily profit-cap authority telemetry');

console.log('[route-truth] Across transport-vs-profit, durable funding lifecycle/adapter gate, automatic terminal-confirmed 90/10 treasury, retained-capital protection, and retired profit-cap invariants passed');
