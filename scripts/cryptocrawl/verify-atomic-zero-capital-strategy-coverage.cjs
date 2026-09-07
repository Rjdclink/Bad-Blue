const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const coverage = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
const funding = read('server/services/cryptocrawl/execution/okx-funding-lifecycle-adapter.ts');
const kalshiFunding = read('server/services/cryptocrawl/execution/kalshi-funding-lifecycle-adapter.ts');
const fundingCapital = read('server/services/cryptocrawl/execution/funding-capital-reservation.ts');
const kalshiMargin = read('server/services/cryptocrawl/execution/kalshi-system-owned-margin-ledger.ts');
const eventCash = read('server/services/cryptocrawl/execution/kalshi-event-system-owned-cash-ledger.ts');
const eventLifecycle = read('server/services/cryptocrawl/execution/kalshi-event-lifecycle.ts');
const eventMaker = read('server/services/cryptocrawl/execution/kalshi-event-market-maker.ts');
const polymarketCash = read('server/services/cryptocrawl/execution/polymarket-system-owned-cash-ledger.ts');
const crossEvent = read('server/services/cryptocrawl/execution/kalshi-cross-venue-event-lifecycle.ts');
const dataCollection = read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');
const across = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const acrossRecovery = read('server/services/cryptocrawl/execution/across-prebroadcast-durability.ts');
const acrossProvider = read('server/services/cryptocrawl/bridge/across-bridge-provider.ts');
const gasPolicy = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const nativeGasProof = read('server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts');
const nativeGasExecution = read('server/services/cryptocrawl/execution/system-owned-native-transaction.ts');
const liquidation = read('server/services/cryptocrawl/execution/flash-liquidation-executor.ts');
const mev = read('server/services/cryptocrawl/execution/mev-backrun-executor.ts');
const zeroCapital = read('server/services/cryptocrawl/core/zero-capital-engine.ts');

const topologies = [
  'CEX_CEX',
  'DEX_ATOMIC',
  'ZERO_CAPITAL_ATOMIC',
  'CROSS_CHAIN',
  'MEMPOOL_BACKRUN',
  'LIQUIDATION',
  'MAKER_CEX',
  'FUNDING_ARBITRAGE',
  'PREDICTION_EVENT',
];

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

for (const topology of topologies) {
  check(`measured topology exists: ${topology}`, registry.includes(`'${topology}'`));
  check(`coverage policy exists: ${topology}`, coverage.includes(`topology: '${topology}'`));
}

check('coverage includes all canonical measured topology rows', (coverage.match(/topology: '/g) || []).length >= topologies.length);
check('personal principal universally forbidden', coverage.includes('personalPrincipalAllowed: false'));
check('personal gas universally forbidden', coverage.includes('personalGasAllowed: false'));
check('personal collateral universally forbidden', coverage.includes('personalCollateralAllowed: false'));
check('account-wide balances never create ownership', coverage.includes('accountWideBalanceCreatesOwnership: false'));
check('blocked execution remains discovery-only rather than disabling discovery', coverage.includes('discoveryContinuesWhenExecutionBlocked: true'));
check('central admission rejects personal principal', coverage.includes("REJECT_PERSONAL_PRINCIPAL_REQUIRED"));
check('central admission rejects personal gas', coverage.includes("REJECT_PERSONAL_GAS_REQUIRED"));
check('central admission rejects personal collateral', coverage.includes("REJECT_PERSONAL_COLLATERAL_REQUIRED"));
check('central admission rejects unproven principal', coverage.includes("REJECT_PRINCIPAL_PROVENANCE_UNPROVEN"));
check('central admission rejects unproven gas', coverage.includes("REJECT_GAS_PROVENANCE_UNPROVEN"));
check('central admission rejects incomplete all-in economics', coverage.includes("REJECT_ALL_IN_COSTS_INCOMPLETE"));
check('central admission rejects nonpositive deterministic net', coverage.includes("REJECT_NONPOSITIVE_ALL_IN_NET"));
check('prediction directional positive economics require calibrated authority', coverage.includes('calibratedExpectedNetPositive') && coverage.includes('calibratedProbabilityAuthority') && coverage.includes('REJECT_PREDICTION_EVENT_POSITIVE_ECONOMICS_UNPROVEN'));
check('central admission rejects atomicity mismatch', coverage.includes('REJECT_ATOMICITY_MISMATCH'));

check('CEX inventory has durable system-owned lot authority', inventory.includes("SYSTEM_CAPITAL_OWNERSHIP_TABLE = 'cryptocrawler_cex_system_owned_lots'"));
check('CEX account-wide balances are bounded by system-owned spendable lots', inventory.includes('const spendable = Math.min(physicalSpendable, systemOwnedSpendable)'));
check('CEX execution fails closed without durable system ownership', inventory.includes('systemOwnedCapitalRequired: true') && inventory.includes('operatorBalanceAuthorityGranted: false'));

check('funding capital is reserved through the same system-owned CEX lot authority', fundingCapital.includes('cexInventoryLedger.reserve('));
check('funding reserves both margin quote capital and spot-entry quote capital before opening', fundingCapital.includes("purpose: 'margin'") && fundingCapital.includes("purpose: 'spot_entry'"));
check('OKX funding lifecycle settlement records system-owned lot provenance', funding.includes('cex_system_owned_lot_ledger:exact_spot_and_derivative_transforms'));
check('funding is multi-period rather than falsely atomic', coverage.includes("topology: 'FUNDING_ARBITRAGE'") && coverage.includes("atomicity: 'multi_period_non_atomic'"));
check('Kalshi funding requires system-owned margin authority', kalshiFunding.includes('systemOwnedKalshiMarginRequired: true') && kalshiFunding.includes('accountBalanceCreatesOwnership: false'));
check('Kalshi inverse funding requires authenticated borrow and terminal zero liability', kalshiFunding.includes('proveOkxMarginShortBorrow') && kalshiFunding.includes('proveOkxMarginShortRepaid') && kalshiFunding.includes('KALSHI_FUNDING_INVERSE_TERMINAL_LIABILITY_NONZERO') && kalshiFunding.includes('okx_terminal_base_liability_zero'));
check('Kalshi margin account balance remains capacity-only', kalshiMargin.includes('operatorBalancePromoted: false') && kalshiMargin.includes('Math.min(spendableOwnedUsd, authenticatedAvailableUsd'));
check('Kalshi funding policy explicitly keeps borrowed assets liabilities', coverage.includes('borrowed assets remain liabilities') && coverage.includes('repaid before terminal profit ownership'));

check('prediction event is explicitly non-flash venue-coordinated execution', coverage.includes("topology: 'PREDICTION_EVENT'") && coverage.includes("atomicity: 'venue_coordinated_non_atomic'"));
check('Kalshi event cash balance cannot mint ownership', eventCash.includes('predictionBalancePromoted: false') && eventCash.includes('accountBalanceMintsOwnership: false'));
check('Kalshi directional event lifecycle reserves system-owned cash', eventLifecycle.includes('reserveKalshiEventSystemCash') && eventLifecycle.includes('KALSHI_EVENT_SYSTEM_OWNED_CASH_UNAVAILABLE'));
check('Kalshi maker lifecycle reserves the same system-owned event cash', eventMaker.includes('reserveKalshiEventSystemCash'));
check('Polymarket account balance cannot mint ownership or fall back to personal wallet', polymarketCash.includes('accountBalancePromoted: false') && polymarketCash.includes('personalWalletFallback: false'));
check('cross-venue event lifecycle reserves both venue-owned cash authorities', crossEvent.includes('reserveKalshiEventSystemCash') && crossEvent.includes('reservePolymarketSystemCash'));
check('cross-venue event lifecycle never treats personal balance as capital', crossEvent.includes('personalCapitalFallback: false') || crossEvent.includes('accountBalanceMintsOwnership: false'));
check('Kalshi missing evidence enters active reacquisition rather than permanent rejection', dataCollection.includes('requestKalshiEvidenceReacquisition') && dataCollection.includes('fundingRateMonitor.scanOnce()') && dataCollection.includes('refreshKalshiSystemEvidenceNow()') && dataCollection.includes('missingEvidenceIsPermanentVeto: false'));
check('Kalshi data collection has no execution authority', dataCollection.includes('kalshiDataCollectionExecutionAuthority: false') && dataCollection.includes('readOnlyCollection: true'));

check('Across is explicitly asynchronous cross-chain', coverage.includes("topology: 'CROSS_CHAIN'") && coverage.includes("atomicity: 'asynchronous_cross_chain'"));
check('Across executor requires terminal destination settlement evidence', across.includes('destinationReceiptVerified'));
check('Across provider models pending/fill/refund settlement rather than atomic completion', acrossProvider.includes("providerStatus") && acrossProvider.includes('financiallyTerminal'));
check('Across approvals consume only provenance-backed system-owned native gas', across.includes('executeSystemOwnedNativeTransaction({') && across.includes("purpose: 'across_origin_approval'"));
check('Across origin deposit consumes only prepared system-owned native gas', across.includes('executePreparedSystemOwnedNativeTransaction({') && across.includes("purpose: 'across_origin_deposit'"));
check('Across executor has no direct wallet native-gas submission bypass', !across.includes('wallet.sendTransaction('));
check('Across executor has no direct raw-provider principal submission bypass', !across.includes('provider.sendTransaction(signedOriginTx)'));
check('Across recovery reuses exact signed bytes through system-owned gas authority', acrossRecovery.includes('executePreparedSystemOwnedNativeTransaction({') && acrossRecovery.includes("idempotencyKey: `across-origin:${row.depositTxnRef.toLowerCase()}`"));
check('Across recovery has no raw-provider rebroadcast bypass', !acrossRecovery.includes('provider.sendTransaction(raw)'));

check('strict gas policy rejects hosted sponsor without zero-operator-cost proof', gasPolicy.includes('sponsorOperatorMonetaryCostProvenZero') && gasPolicy.includes('configured hosted sponsorship does not prove zero operator monetary cost'));
check('raw native balance is not promoted without system-owned proof', gasPolicy.includes('nativeSystemOwnedProven') && gasPolicy.includes('native balance exists but SELF_FUNDED system ownership is not proven'));
check('durable native gas proof wiring keeps hosted sponsorship unproven', nativeGasProof.includes('sponsorOperatorMonetaryCostProvenZero: false'));
check('durable native gas proof requires system ownership authority', nativeGasProof.includes('getSystemNativeGasAuthority'));
check('prepared exact signed transactions reserve provenance-backed gas before broadcast', nativeGasExecution.includes('executePreparedSystemOwnedNativeTransaction') && nativeGasExecution.includes('reserveSystemNativeGasSpend({') && nativeGasExecution.includes('bindSystemNativeGasSpendSubmission('));
check('prepared gas authority quarantines ambiguous submissions', nativeGasExecution.includes('quarantineSubmittedSystemNativeGasSpend'));

check('zero-capital atomic engine uses external flash-loan route planning', zeroCapital.includes('buildFlashLoanExecutionPlanFromOpportunity'));
check('zero-capital atomic engine requires positive verified receiver profit', zeroCapital.includes('No positive verified FlashLoanExecuted profit was emitted'));
check('zero-capital atomic engine records receipt gas truth', zeroCapital.includes('receipt.gasUsed') && zeroCapital.includes('receipt.effectiveGasPrice'));
check('Kalshi is not falsely injected into the same-transaction flash-loan engine', !zeroCapital.includes('kalshi_perps') && !zeroCapital.includes('PREDICTION_EVENT'));
check('liquidation exact-simulates before submit', liquidation.includes('provider.call(request') && liquidation.includes('provider.estimateGas(request)'));
check('MEV stays backrun-only', mev.includes('sandwichOrFrontrun: false'));
check('MEV has private ordered victim-before-backrun proof', mev.includes('victimReceipt!.transactionIndex < backrunReceipt.transactionIndex'));
check('MEV requires explicit non-personal principal provenance', mev.includes("principalProvenance: Extract<AtomicZeroCapitalAdmissionEvidence['principalProvenance'], 'temporary_external' | 'system_owned'>"));
check('MEV requires explicit non-personal gas provenance', mev.includes("gasProvenance: Extract<AtomicZeroCapitalAdmissionEvidence['gasProvenance'], 'external_zero_operator_cost' | 'system_owned'>"));
check('MEV live boundary consumes universal zero-personal-cost admission', mev.includes('evaluateAtomicZeroCapitalAdmission({') && mev.includes("topology: 'MEMPOOL_BACKRUN'"));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`atomic-zero-capital-strategy-coverage verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[atomic-zero-capital-strategy-coverage] all measured strategy topologies including Kalshi prediction events and bidirectional funding remain under one zero-personal-principal/gas/collateral policy; asynchronous/multi-period Kalshi lanes use provenance-backed system capital and authenticated liabilities rather than false flash atomicity');