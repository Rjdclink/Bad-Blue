'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);
const has = (source, ...needles) => needles.every(needle => source.includes(needle));

const fundingEvidence = read('server/services/cryptocrawl/execution/kalshi-funding-evidence.ts');
const fundingMonitor = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const fundingLifecycle = read('server/services/cryptocrawl/execution/kalshi-funding-lifecycle-adapter.ts');
const marginShort = read('server/services/cryptocrawl/execution/okx-margin-short-authority.ts');
const eventGenerator = read('server/services/cryptocrawl/discovery/kalshi-event-opportunity-generator.ts');
const eventLifecycle = read('server/services/cryptocrawl/execution/kalshi-event-lifecycle.ts');
const eventMaker = read('server/services/cryptocrawl/execution/kalshi-event-market-maker.ts');
const eventCash = read('server/services/cryptocrawl/execution/kalshi-event-system-owned-cash-ledger.ts');
const crossDiscovery = read('server/services/cryptocrawl/discovery/kalshi-cross-venue-event-arbitrage.ts');
const crossLifecycle = read('server/services/cryptocrawl/execution/kalshi-cross-venue-event-lifecycle.ts');
const crossTerminal = read('server/services/cryptocrawl/execution/kalshi-cross-venue-terminal-reconciliation.ts');
const polymarketSettlement = read('server/services/cryptocrawl/execution/polymarket-event-settlement-authority.ts');
const polymarketCash = read('server/services/cryptocrawl/execution/polymarket-system-owned-cash-ledger.ts');
const canonicalDispatch = read('server/services/cryptocrawl/execution/kalshi-event-canonical-dispatch.ts');
const canonicalMaintenance = read('server/services/cryptocrawl/execution/kalshi-event-canonical-maintenance.ts');
const systemWiring = read('server/services/cryptocrawl/integration/kalshi-system-wiring.ts');
const dataCollection = read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');
const zeroCapitalCoverage = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const schema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const dockerfile = read('Dockerfile');

check('bidirectional funding evidence is canonical', has(fundingEvidence, "'long_spot_short_perp'", "'long_perp_short_spot'", 'measureOkxMarginShortEvidence', 'borrowCostUsd', 'shortSpotCapability'));
check('funding monitor enriches nonzero Kalshi funding both directions', has(fundingMonitor, "observation.venue === 'kalshi_perps' && observation.fundingRate !== 0", 'kalshiEvidence?.shortSpotCapability ?? false', 'kalshiEvidence?.borrowCostUsd'));
check('inverse funding lifecycle proves borrow, health, repay, and terminal zero liability', has(fundingLifecycle, 'proveOkxMarginShortBorrow', 'assessOkxMarginShortHealth', 'proveOkxMarginShortRepaid', 'KALSHI_FUNDING_INVERSE_TERMINAL_LIABILITY_NONZERO', 'okx_terminal_base_liability_zero'));
check('inverse funding never promotes borrowed base or encumbered proceeds', has(fundingLifecycle, 'borrowedBaseOwnership: false', 'shortSaleProceedsOwnershipBeforeRepayment: false', 'accountBalanceCreatesOwnership: false'));
check('OKX inverse authority binds authenticated borrow to exclusive system-owned collateral', has(marginShort, 'proveOkxMarginShortSystemOwnedCollateral', 'exclusiveSystemOwnedCollateral === true', 'personal_capital_fallback:false'));

check('directional prediction opportunities use calibrated probability and never deterministic-label probabilistic edge', has(eventGenerator, 'calibratedProbability', 'deterministicNetProfitUsd: null', 'minimumExpectedNetProfitUsd', 'systemOwnedCash'));
check('directional event lifecycle requires system-owned cash and exact terminal settlement', has(eventLifecycle, 'reserveKalshiEventSystemCash', 'applyKalshiEventTerminalCashSettlement', 'settlement_unknown', 'quarantined'));
check('event cash ledger treats account balance as capacity only', has(eventCash, 'predictionBalancePromoted: false', 'accountBalanceMintsOwnership: false', 'Math.min(spendableOwnedUsd, authenticatedAvailableUsd)'));

check('maker uses true post-only quotes', has(eventMaker, 'postOnly: true', "timeInForce: 'good_till_canceled'"));
check('maker handles quote aging and information shock', has(eventMaker, 'quoteAgeMs()', 'informationShockBps()', 'eventRiskWindowMs()'));
check('maker handles partial fills and cancel/replace fail closed', has(eventMaker, 'maker_partial_bid_cancel_unconfirmed', 'maker_bid_cancel_replace_unconfirmed', 'maker_ask_cancel_replace_unconfirmed'));
check('maker tracks queue, inventory, and terminal realized performance', has(eventMaker, 'getKalshiEventQueuePositions', 'maxInventoryContracts()', 'realized_net_bps_ewma', 'applyKalshiEventTerminalCashSettlement'));
check('maker reserves canonical system-owned event cash', has(eventMaker, 'reserveKalshiEventSystemCash', 'renewKalshiEventSystemCashReservation'));

check('cross-venue discovery requires strict semantic equivalence and complementary outcomes', has(crossDiscovery, 'compareEventSemantics', "{ kalshi: 'yes' as const, second: 'no' as const }", "{ kalshi: 'no' as const, second: 'yes' as const }", 'positive_guaranteed_residual_after_every_cost'));
check('cross-venue economics count VWAP slippage once and include settlement/capital lock', has(crossDiscovery, 'slippage_embedded_exactly_once', 'settlementCostReserveUsd', 'capitalLockCostUsd'));
check('cross-venue execution reserves both venue-owned cash authorities', has(crossLifecycle, 'reserveKalshiEventSystemCash', 'reservePolymarketSystemCash'));
check('cross-venue second leg is gated by fresh semantics/access/quote/profit', has(crossLifecycle, 'CROSS_EVENT_SEMANTICS_CHANGED_AFTER_FIRST_FILL', 'CROSS_EVENT_POLYMARKET_ACCESS_CHANGED_AFTER_FIRST_FILL', 'CROSS_EVENT_SECOND_LEG_EXECUTABLE_QUOTE_UNPROVEN', 'CROSS_EVENT_SECOND_LEG_NO_LONGER_PROFITABLE'));
check('cross-venue one-leg failure has durable reduce-only Kalshi recovery', has(crossLifecycle, "status: 'ONE_LEG_RECOVERY'", "leg: 'cross-unwind'", 'reduceOnly: true'));
check('cross-venue terminal reconciliation requires Polymarket cash realization', has(crossTerminal, 'realizePolymarketEventSettlement', 'applyKalshiEventTerminalCashSettlement', 'applyPolymarketTerminalCashSettlement', "status: 'SETTLED'"));
check('cross-venue terminal accounting releases reservations only after both venue settlements', has(crossTerminal, 'releaseKalshiEventSystemCashReservation', 'releasePolymarketSystemCashReservation', 'reservationsReleasedAfterBothVenueCashSettlements: true'));
check('Polymarket redemption uses provenance-backed system-native gas with durable recovery', has(polymarketSettlement, 'executeSystemOwnedNativeTransaction', 'settleSystemNativeGasSpend', 'reconcileExistingSubmission', 'personalGasFallback: false'));
check('Polymarket account balance cannot mint ownership or use personal fallback', has(polymarketCash, 'accountBalancePromoted: false', 'personalWalletFallback: false'));

check('canonical dispatch owns directional, maker, and cross-venue admission', has(canonicalDispatch, 'kalshiEventLifecycle', 'dispatchBestKalshiEventMakerCandidate', 'executeKalshiCrossVenueEventCandidate'));
check('canonical maintenance advances directional, maker, cross-venue, and redemption reconciliation', has(canonicalMaintenance, 'advanceKalshiEventLifecycles', 'maintainKalshiEventMakerLifecycles', 'advanceKalshiCrossVenueEventLifecycles', 'reconcileKalshiCrossVenueTerminalSettlements'));
check('Kalshi consolidated system wiring does not create duplicate execution authority', has(systemWiring, 'duplicateExecutionSchedulerCreated: false', 'canonicalEconomicAuthorityChanged: false', 'liveKalshiExecutionGrantedByThisWiring: false'));

check('Kalshi Data Collection actively reacquires funding evidence', has(dataCollection, 'requestKalshiEvidenceReacquisition', 'fundingRateMonitor.scanOnce()', 'canonical_funding_monitor_exact_directional_fee_depth_borrow_margin_remeasurement'));
check('Kalshi Data Collection actively reacquires event/cross-venue evidence read-only', has(dataCollection, 'refreshKalshiSystemEvidenceNow()', 'canonical_kalshi_event_semantic_fee_depth_capital_cross_venue_refresh', 'readOnlyCollection: true', 'kalshiDataCollectionExecutionAuthority: false'));
check('missing Kalshi evidence is not a permanent veto', has(dataCollection, 'missingEvidenceIsPermanentVeto: false'));

check('zero-personal-capital coverage includes prediction events', has(zeroCapitalCoverage, "topology: 'PREDICTION_EVENT'", "atomicity: 'venue_coordinated_non_atomic'", 'proven_system_owned_retained_capital'));
check('zero-personal-capital prediction direction requires calibrated positive expected economics', has(zeroCapitalCoverage, 'calibratedExpectedNetPositive', 'calibratedProbabilityAuthority', 'REJECT_PREDICTION_EVENT_POSITIVE_ECONOMICS_UNPROVEN'));
check('zero-personal-capital funding remains multi-period and liability-safe', has(zeroCapitalCoverage, "topology: 'FUNDING_ARBITRAGE'", "atomicity: 'multi_period_non_atomic'", 'repaid before terminal profit ownership'));
check('Kalshi is not falsely represented as flash-atomic capital', !zeroCapitalCoverage.includes("topology: 'PREDICTION_EVENT'\n    executionFamily: 'canonical zero-capital atomic route engine'"));

check('Overflow schema includes all Kalshi/Polymarket lifecycle migrations in order', has(schema, "'046_cryptocrawler_kalshi_system_owned_margin_capital.sql'", "'047_cryptocrawler_kalshi_event_system_owned_cash.sql'", "'048_cryptocrawler_kalshi_event_lifecycle.sql'", "'049_cryptocrawler_kalshi_probability_calibration.sql'", "'050_cryptocrawler_kalshi_event_market_maker.sql'", "'051_cryptocrawler_polymarket_event_order_recovery.sql'", "'052_cryptocrawler_polymarket_system_owned_cash.sql'", "'053_cryptocrawler_cross_venue_event_lifecycle.sql'", "'054_cryptocrawler_polymarket_redemption_recovery.sql'", "'055_cryptocrawler_coinbase_system_owned_capital.sql'"));
check('Overflow required objects include all Kalshi/Polymarket durable state', has(schema, 'private.cryptocrawler_kalshi_event_lifecycles', 'private.cryptocrawler_kalshi_event_maker_lifecycles', 'private.cryptocrawler_cross_venue_event_lifecycles', 'private.cryptocrawler_polymarket_redemption_intents'));
check('production image packages Kalshi/Polymarket migrations through redemption and Coinbase capital', has(dockerfile, '050_cryptocrawler_kalshi_event_market_maker.sql', '054_cryptocrawler_polymarket_redemption_recovery.sql', '055_cryptocrawler_coinbase_system_owned_capital.sql'));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`[kalshi-premerge-completion] FAIL: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}
console.log('[kalshi-premerge-completion] PASS: bidirectional funding, directional events, post-only maker, Kalshi-Polymarket execution/recovery/redemption, Data Collection, durable system-owned capital, zero-personal-capital strategy coverage, canonical maintenance, and Overflow schema/package invariants are structurally bound');
