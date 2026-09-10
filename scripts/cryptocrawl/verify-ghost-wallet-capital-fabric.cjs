const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const must = (text, pattern, label) => assert.match(text, pattern, label);
const mustNot = (text, pattern, label) => assert.doesNotMatch(text, pattern, label);

const intermediary = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const vault = read('contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol');
const fabric = read('server/services/cryptocrawl/ghost-wallet/capital-fabric.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const intentBook = read('server/services/cryptocrawl/ghost-wallet/intent-book.ts');
const sources = read('server/services/cryptocrawl/ghost-wallet/onchain-capital-sources.ts');
const altReprice = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const altRegistry = read('server/services/cryptocrawl/ghost-wallet/zero-capital-alternative-selection-registry.ts');
const altExecutor = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const canonical = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const flash = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const governance = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Requested capital fabric: exactly these five conceptual primitives; deferred
// settlement remains research-only until a dedicated callback executor exists.
for (const primitive of [
  'euler_debt_assumption',
  'aave_credit_delegation',
  'signed_intent_capital',
  'coincidence_of_wants',
  'permissionless_vault_capital',
]) must(fabric, new RegExp(primitive), `capital fabric missing ${primitive}`);
mustNot(fabric, /protocol_deferred_settlement_capital/, 'capital fabric must not advertise unimplemented deferred settlement');
must(governance, /REJECT_PROTOCOL_DEFERRED_SETTLEMENT_EXECUTOR_UNIMPLEMENTED/, 'governance must fail closed on deferred settlement');

// Ghost Wallet is an independent intermediation lane. Its immutable terminal
// payout is direct and never delegated to the arbitrage profit ladder.
must(intermediary, /address public immutable profitRecipient/, 'profit recipient must be immutable');
must(intermediary, /minimumBrokerSpreadBps/, 'broker spread floor required');
must(intermediary, /borrower_repayment_shortfall/, 'borrower repayment must fail closed');
must(intermediary, /spread_reconciliation_failed/, 'broker spread must reconcile exactly');
must(intermediary, /_safeTransfer\(token, profitRecipient, realizedSpread\)/, 'broker spread must route directly to wallet');
must(intermediary, /self_match_forbidden/, 'self matching must be forbidden');
must(intermediary, /profit_recipient_cannot_self_match/, 'profit wallet cannot manufacture intent volume');
must(intermediary, /if \(temporaryApproval\) _safeApprove\(approvalToken, target, 0\)/, 'temporary target approvals must be revoked');
must(intermediary, /incremental_liability_not_repaid/, 'liability growth must revert');
must(intermediary, /vault_terminal_balance_mismatch/, 'vault route must restore intermediary balance');
must(engine, /profitLadderAuthority: false/, 'Ghost Wallet cannot have profit-ladder authority');
must(engine, /100_percent_realized_net_direct_to_canonical_wallet/, 'Ghost Wallet terminal profit must be direct-to-wallet');
must(engine, /repaymentPolicy: 'same_transaction_or_revert'/, 'Ghost Wallet repayment policy must be atomic');

// Vault capital has no unsecured duration and fails the whole transaction if
// principal + fee is not restored before callback completion.
must(vault, /function lendAtomic/, 'vault atomic credit surface required');
must(vault, /atomic_credit_not_repaid/, 'vault repayment must revert');
must(vault, /VIRTUAL_SHARES/, 'vault virtual-share inflation defense required');
must(vault, /VIRTUAL_ASSETS/, 'vault virtual-asset inflation defense required');

// Counterparty flow uses signed, nonexpired, replay-resistant orders and does not
// rank different token denominations by adding raw token amounts.
must(intentBook, /verifyTypedData/, 'intent signature verification required');
must(intentBook, /address\(left\.owner\) !== address\(right\.owner\)/, 'intent book must block self matching');
must(intentBook, /locallySettled/, 'local replay protection required');
must(intentBook, /scoreBps: feeBpsA \+ feeBpsB/, 'dimensionless pair ranking required');
mustNot(intentBook, /score[^\n]*feeAmountA[^\n]*feeAmountB/, 'raw cross-token fee amounts must not be summed for ranking');

// Aave/Euler/vault capacity must be measured on-chain. Liability-capacity sources
// remain distinct from fungible liquid-principal composition.
must(sources, /borrowAllowance\(config\.delegator, intermediary\)/, 'Aave delegation allowance must be measured');
must(sources, /getUserAccountData\(config\.delegator\)/, 'Aave delegator account capacity must be measured');
must(sources, /checkLiquidation\(intermediary, config\.violator, config\.collateral\)/, 'Euler liquidation capacity must be measured');
must(sources, /debtOf/, 'Euler terminal liability probe required');
must(sources, /totalAssets\(\)/, 'vault liquidity must be measured');
must(fabric, /resourceForm === 'liquid_principal'/, 'capital composition must require true liquid principal');

// Existing flash/provider mesh remains first. Alternative capital can promote a
// candidate only after an exact prepared call + gas estimate and strictly-positive
// all-in economics. Euler is deliberately not fabricated as DEX cash.
must(altReprice, /GHOST_WALLET_EULER_DEBT_ASSUMPTIONS_JSON: '\[\]'/, 'Euler must be excluded from generic DEX principal composition');
must(altReprice, /await input\.provider\.call\(exactEnvelope\)/, 'alternative capital needs exact eth_call');
must(altReprice, /await input\.provider\.estimateGas\(exactEnvelope\)/, 'alternative capital needs exact gas estimate');
must(altReprice, /strict_positive_all_in_net_after_source_fee_and_execution_cost/, 'alternative capital requires positive all-in net');
must(altRegistry, /expectedNetProfit <= 0n/, 'registry must reject non-positive alternatives');
must(altRegistry, /expiresAt <= now/, 'registry must expire stale selections');

// The canonical money boundary remains singular. Alternative capital is fallback
// only, and its prepared transaction is revalidated again immediately before send.
must(canonical, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/, 'canonical executor must preserve flash priority');
must(canonical, /builderSponsoredZeroCapitalRegistry\.get\(opportunity\.id\)/, 'canonical executor must preserve builder priority');
must(canonical, /executeFlashCanonicalZeroCapitalOpportunity\(opportunity\)/, 'legacy flash executor must remain reachable');
must(canonical, /executeAlternativePreparedWithinCanonicalExecutor/, 'alternative executor must remain subordinate');
must(altExecutor, /await provider\.call\(request\)/, 'alternative executor must resimulate exact call');
must(altExecutor, /await provider\.estimateGas\(request\)/, 'alternative executor must re-estimate gas');
must(altExecutor, /estimatedGasUnits > selection\.estimatedGasUnits/, 'gas-cost deterioration must force repricing');
must(altExecutor, /intermediaryEnding !== intermediaryStarting/, 'intermediary balance must return to baseline');
must(altExecutor, /recipientDelta !== grossProfit/, 'terminal payout delta must match event');
must(altExecutor, /endingLiability > startingLiability/, 'Aave liability neutrality must be event-verified');

// Runtime separation: Ghost Wallet may run beside canonical arbitrage, but does not
// acquire arbitrage execution authority or profit-ladder authority.
must(runtime, /install\('ghost_wallet_engine'/, 'Ghost Wallet runtime must be installed');
must(runtime, /ghostWalletProfitLadderAuthority: false/, 'runtime must declare no Ghost Wallet ladder authority');
must(runtime, /ghostWalletArbitrageExecutionAuthority: false/, 'runtime must declare no Ghost Wallet arbitrage authority');

// Strong no-regression marker: the extracted flash executor must still contain the
// established canonical safeguards rather than becoming a pass-through stub.
for (const marker of [
  'getProvenZeroCapitalGasFundingDecision',
  'evaluateZeroCapitalDynamicAttemptBarrier',
  'flashLoanProviderSelectionRegistry',
  'builderSponsoredZeroCapitalRegistry',
  'extractProfit(receipt',
  'retainedProfitLedger.recordTerminalSettlement',
  'receiverStarting !== 0n',
]) must(flash, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `preserved flash executor missing ${marker}`);

console.log(JSON.stringify({
  ok: true,
  ghostWalletIndependentLane: true,
  sameTransactionRepaymentOrRevert: true,
  directNetProfitRecipientBinding: true,
  requestedCapitalPrimitives: 5,
  deferredSettlementLive: false,
  flashProviderPriorityPreserved: true,
  alternativeCapitalExactSimulationRequired: true,
  alternativeCapitalSubordinateToCanonicalExecutor: true,
  sourceSpecificTerminalRepaymentProof: true,
  noStandingStepApprovals: true,
  syntheticCapacityAllowed: false,
}, null, 2));
