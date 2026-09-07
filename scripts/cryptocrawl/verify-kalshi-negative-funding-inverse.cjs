'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`missing:${label}`);
};
const requirePattern = (source, pattern, label) => {
  if (!pattern.test(source)) throw new Error(`missing:${label}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) throw new Error(`forbidden:${label}`);
};

const evidence = read('server/services/cryptocrawl/execution/kalshi-funding-evidence.ts');
const lifecycle = read('server/services/cryptocrawl/execution/kalshi-funding-lifecycle-adapter.ts');
const hedge = read('server/services/cryptocrawl/execution/kalshi-funding-cex-hedge.ts');
const margin = read('server/services/cryptocrawl/execution/okx-margin-short-authority.ts');
const ownership = read('server/services/cryptocrawl/execution/cex-system-owned-lot-ledger.ts');
const monitor = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const policy = read('server/services/cryptocrawl/discovery/funding-arbitrage-policy.ts');

requireText(policy, "'long_perp_short_spot'", 'policy_inverse_direction');
requireText(policy, 'input.shortSpotCapability', 'policy_requires_short_spot_capability');

requireText(evidence, 'type KalshiFundingDirection', 'evidence_direction_type');
requirePattern(
  evidence,
  /const\s+direction\s*:\s*KalshiFundingDirection\s*=\s*input\.fundingRate\s*>\s*0\s*\?\s*'long_spot_short_perp'\s*:\s*'long_perp_short_spot'/s,
  'evidence_direction_selection',
);
requireText(evidence, "direction === 'long_perp_short_spot'", 'evidence_inverse_branch');
requireText(evidence, 'measureOkxMarginShortEvidence', 'evidence_authenticated_okx_borrow_surface');
requireText(evidence, 'borrowCostUsd', 'evidence_borrow_cost');
requireText(evidence, 'shortSpotCapability', 'evidence_short_spot_capability');
requireText(evidence, "kalshi.funding.fundingRate < 0", 'evidence_inverse_funding_gate');
requireText(evidence, "? ['okx']", 'evidence_inverse_okx_only');

requireText(margin, "tdMode: 'cross'", 'okx_cross_margin_capacity_probe');
requireText(margin, "type: 'auto_borrow'", 'okx_borrow_history');
requireText(margin, "type: 'auto_repay'", 'okx_repay_history');
requireText(margin, 'proveOkxMarginShortSystemOwnedCollateral', 'okx_system_owned_collateral_proof');
requireText(margin, 'collateralProof?.exclusiveSystemOwnedCollateral === true', 'okx_collateral_bound_to_executability');
requireText(margin, 'inverse_entry_base_inventory:must_be_zero_so_sell_requires_borrow', 'okx_base_zero_before_inverse');
requireText(margin, 'nonquote_cross_collateral:must_be_zero_to_prevent_unreserved_exposure', 'okx_nonquote_collateral_zero');
requireText(margin, 'current_liability:must_still_cover_expected_principal', 'okx_borrow_liability_identity');
requireText(margin, 'bounded_restart_window', 'okx_restart_history_recovery');
requireText(margin, 'borrowed_base_ownership:false', 'okx_borrowed_base_not_owned');
requireText(margin, 'personal_capital_fallback:false', 'okx_no_personal_capital');

requireText(hedge, 'tradeMode?: KalshiFundingCexTradeMode', 'hedge_explicit_trade_mode');
requireText(hedge, "tradeMode === 'cross' && input.venue !== 'okx'", 'hedge_cross_okx_only');
requireText(hedge, 'tdMode: tradeMode', 'hedge_cross_mode_submission');
requireText(hedge, 'getExactKalshiFundingCexOrderAssetDeltas', 'hedge_exact_asset_delta_export');

requireText(lifecycle, "supportedDirections: ['long_spot_short_perp', 'long_perp_short_spot']", 'lifecycle_bidirectional_registration');
requireText(lifecycle, "const perpSide: 'bid' | 'ask' = inverse ? 'bid' : 'ask'", 'lifecycle_long_perp_entry');
requireText(lifecycle, "const spotSide: 'buy' | 'sell' = inverse ? 'sell' : 'buy'", 'lifecycle_short_spot_entry');
requireText(lifecycle, "tradeMode: 'cross' as const", 'lifecycle_okx_cross_execution');
requireText(lifecycle, 'proveOkxMarginShortBorrow', 'lifecycle_borrow_proof');
requireText(lifecycle, 'assessOkxMarginShortHealth', 'lifecycle_margin_health');
requireText(lifecycle, 'proveOkxMarginShortRepaid', 'lifecycle_repayment_proof');
requireText(lifecycle, 'KALSHI_FUNDING_INVERSE_TERMINAL_LIABILITY_NONZERO', 'lifecycle_terminal_zero_liability_gate');
requireText(lifecycle, 'applyVerifiedOkxMarginShortSettlement', 'lifecycle_terminal_inverse_ownership');
requireText(lifecycle, 'borrowedBaseOwnership: false', 'lifecycle_borrowed_base_never_owned');
requireText(lifecycle, 'shortSaleProceedsOwnershipBeforeRepayment: false', 'lifecycle_proceeds_encumbered');
requireText(lifecycle, 'position.contracts > 0 : position.contracts < 0', 'lifecycle_directional_margin_health');

requireText(ownership, 'applyVerifiedOkxMarginShortSettlement', 'ownership_inverse_terminal_settlement');
requireText(ownership, "terminalState: 'fully_repaid'", 'ownership_requires_fully_repaid');
requireText(ownership, 'borrowed_base:excluded_from_system_ownership', 'ownership_excludes_borrowed_base');
requireText(ownership, 'short_sale_proceeds:encumbered_until_full_repayment', 'ownership_encumbers_short_proceeds');
requireText(ownership, 'only_terminal_net_quote_delta_promoted_or_debited', 'ownership_terminal_net_quote_only');

requireText(monitor, "observation.venue === 'kalshi_perps' && observation.fundingRate !== 0", 'monitor_enriches_both_directions');
requireText(monitor, 'kalshiEvidence?.shortSpotCapability ?? false', 'monitor_passes_short_capability');
requireText(monitor, 'kalshiEvidence?.borrowCostUsd', 'monitor_passes_borrow_cost');
requireText(monitor, '`funding_direction:${kalshiEvidence.direction}`', 'monitor_persists_direction');

forbidText(evidence, 'if (kalshi.market.fundingRate <= 0)', 'old_positive_only_evidence_gate');
forbidText(evidence, 'if (kalshi.funding.fundingRate <= 0)', 'old_positive_only_authority_gate');
forbidText(lifecycle, 'hydrated.fundingRate <= 0', 'old_positive_only_lifecycle_gate');

console.log(JSON.stringify({
  ok: true,
  authority: 'kalshi_negative_funding_inverse_structural_invariants',
  inverseVenue: 'okx',
  authenticatedBorrowRequired: true,
  exclusiveSystemOwnedCollateralRequired: true,
  borrowedBaseCreatesOwnership: false,
  shortSaleProceedsCreateOwnershipBeforeRepayment: false,
  terminalZeroLiabilityRequired: true,
  boundedRestartHistoryRecovery: true,
  personalCapitalFallback: false,
}));
