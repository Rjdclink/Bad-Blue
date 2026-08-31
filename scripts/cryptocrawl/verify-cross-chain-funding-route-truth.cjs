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

// The discovery layer may not keep reporting runtime machinery as absent when a
// fail-closed Across executor already refreshes, signs, submits, monitors and
// terminally verifies the bridge. The remaining blocker must be the missing
// arbitrage revenue composition, because transport by itself is not profit.
requirePattern(crossChain, /getAcrossBridgeReadiness/, 'cross-chain discovery exposes production configuration truth');
requirePattern(crossChain, /cross_chain_source_destination_profit_leg/, 'cross-chain discovery identifies the actual missing revenue leg');
requirePattern(crossChain, /cross_chain_transport_only:not_profit_opportunity/, 'bridge-only routes are explicitly classified as transport rather than arbitrage');
requirePattern(crossChain, /grossProfitUsd:\s*null/, 'bridge transport cannot invent gross profit');
requirePattern(crossChain, /deterministicNetProfitUsd:\s*null/, 'bridge transport cannot invent deterministic net profit');
requirePattern(crossChain, /executableCapability:\s*false/, 'transport-only cross-chain observations remain non-executable');
forbidPattern(crossChain, /cross_chain_transaction_builder_admission|cross_chain_status_monitor_binding|cross_chain_destination_receipt_after_execution|cross_chain_drift_tolerance|cross_chain_failure_recovery|cross_chain_terminal_settlement/, 'stale missing-information claims for already implemented Across lifecycle machinery');

requirePattern(acrossExecutor, /getAcrossBridgeQuote\s*\(/, 'Across executor refreshes the route immediately before signing');
requirePattern(acrossExecutor, /freshExecutionPayload\s*\(/, 'Across executor refreshes executable calldata');
requirePattern(acrossExecutor, /freshExpected\s*<\s*oldMinimum/, 'Across executor applies minimum-output drift protection');
requirePattern(acrossExecutor, /requireAllowed\(\s*'SUBMIT_TX'/, 'Across execution remains governance-gated');
requirePattern(acrossExecutor, /getAcrossDepositSettlementEvidence\s*\(/, 'Across execution polls provider settlement evidence');
requirePattern(acrossExecutor, /destinationReceiptVerified/, 'successful Across fill requires destination receipt verification');
requirePattern(acrossExecutor, /refundReceiptVerified/, 'Across refund requires receipt verification');
requirePattern(acrossExecutor, /ACROSS_TERMINAL_SETTLEMENT_TIMEOUT/, 'unknown terminal settlement fails closed');

// Funding remains a carry topology, not an instant spread. Current public signal
// and authenticated OKX fee/account visibility may enrich it, but no code may
// promote it until exit-basis/slippage/depth, liquidation-safe collateral and a
// persistent open->funding->close settlement lifecycle are measured.
requirePattern(funding, /getOkxSwapCapability\s*\(/, 'funding monitor hydrates authenticated OKX SWAP capability');
requirePattern(funding, /resolveCexFeeEvidence\(\s*'okx'/, 'funding monitor consumes canonical authenticated spot fees');
requirePattern(funding, /exitBasisReserveBps:\s*null/, 'future exit-basis reserve is not fabricated');
requirePattern(funding, /expectedSlippageBps:\s*null/, 'unmeasured funding lifecycle slippage is not fabricated');
requirePattern(funding, /persistent_delta_neutral_position_lifecycle/, 'missing persistent delta-neutral lifecycle stays explicit');
requirePattern(funding, /liquidation_margin_and_collateral_monitoring/, 'missing liquidation-safe collateral evidence stays explicit');
requirePattern(funding, /terminal_funding_payment_and_close_settlement/, 'terminal funding and close settlement remains mandatory');
requirePattern(funding, /executableCapability:\s*false/, 'funding observations remain non-executable without the lifecycle');
requirePattern(fundingPolicy, /input\.fundingRateLocked\s*&&\s*supportedDirection/, 'deterministic funding P&L requires locked rate and supported direction');
requirePattern(fundingPolicy, /unknown|projected funding|projected profit/i, 'funding policy documents projected-versus-deterministic separation');

console.log('[route-truth] Across transport-vs-profit and funding carry lifecycle invariants passed');
