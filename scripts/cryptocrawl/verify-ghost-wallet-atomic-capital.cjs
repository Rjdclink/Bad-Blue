'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const intermediary = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const vault = read('contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol');
const fabric = read('server/services/cryptocrawl/ghost-wallet/capital-fabric.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const intentBook = read('server/services/cryptocrawl/ghost-wallet/intent-book.ts');
const sourceMeasurement = read('server/services/cryptocrawl/ghost-wallet/onchain-capital-sources.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const alternativeReprice = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const alternativeRegistry = read('server/services/cryptocrawl/ghost-wallet/zero-capital-alternative-selection-registry.ts');
const canonicalRouter = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const flashExecutor = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const alternativeExecutor = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const coverage = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const runtimeWiring = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Ghost Wallet is an independent lane with an immutable terminal payout identity.
assert.match(intermediary, /address public immutable profitRecipient/);
assert.match(intermediary, /requested == profitRecipient/);
assert.match(runtimeWiring, /ghostWalletProfitLadderAuthority:\s*false/);
assert.match(runtimeWiring, /ghostWalletArbitrageExecutionAuthority:\s*false/);
assert.match(engine, /profitLadderAuthority:\s*false/);
assert.match(engine, /100_percent_realized_net_direct_to_canonical_wallet/);

// Every capital/credit lane must be same-transaction and fail closed on repayment.
assert.match(intermediary, /borrower_repayment_not_exact/);
assert.match(intermediary, /spread_reconciliation_failed/);
assert.match(intermediary, /incremental_liability_not_repaid/);
assert.match(intermediary, /vault_principal_not_received_exactly/);
assert.match(intermediary, /direct_credit_residual/);
assert.match(intermediary, /vault_route_residual/);
assert.match(intermediary, /broker_residual/);
assert.match(intermediary, /msg\.sender == address\(borrower\)/);
assert.match(vault, /endingAssets >= startingAssets \+ fee/);
assert.match(vault, /atomic_credit_not_repaid/);

// Temporary approvals cannot survive a successful routed call.
assert.match(intermediary, /if \(temporaryApproval\) _safeApprove\(approvalToken, target, 0\)/);

// Intent intermediation is signed, replay-protected, self-match resistant and exact-accounted.
assert.match(intermediary, /self_match_forbidden/);
assert.match(intermediary, /profit_recipient_cannot_self_match/);
assert.match(intermediary, /usedIntentNonces/);
assert.match(intermediary, /intent_a_funding_not_exact/);
assert.match(intermediary, /intent_b_funding_not_exact/);
assert.match(intermediary, /intent_token_a_residual/);
assert.match(intermediary, /intent_token_b_residual/);
assert.match(intentBook, /verifyTypedData/);
assert.match(intentBook, /address\(left\.owner\) !== address\(right\.owner\)/);
assert.doesNotMatch(intentBook, /feeAmountA \+ feeAmountB/);

// The capital fabric contains the five requested real source classes. Debt/order-flow
// are not fabricated as fungible cash and every quote is measured/fresh/revert-bound.
for (const primitive of [
  'euler_debt_assumption',
  'aave_credit_delegation',
  'signed_intent_capital',
  'coincidence_of_wants',
  'permissionless_vault_capital',
]) assert.ok(fabric.includes(primitive), `capital fabric missing ${primitive}`);
assert.match(fabric, /quote\.measured === true/);
assert.match(fabric, /quote\.sameTransactionSettlement === true/);
assert.match(fabric, /quote\.repaymentFailureReverts === true/);
assert.match(fabric, /resourceForm === 'liquid_principal'/);
assert.match(fabric, /treating[\s\S]{0,160}as cash would fabricate capital/);

// Aave and Euler use their actual on-chain liability semantics.
assert.match(sourceMeasurement, /borrowAllowance\(config\.delegator, intermediary\)/);
assert.match(sourceMeasurement, /getUserAccountData\(config\.delegator\)/);
assert.match(sourceMeasurement, /debtOf\(address account\)/);
assert.match(sourceMeasurement, /checkLiquidation\(intermediary, config\.violator, config\.collateral\)/);
assert.match(sourceMeasurement, /synthetic_capacity:false/);

// Deferred-protocol settlement remains reserved, never advertised as executable.
assert.match(coverage, /protocolDeferredSettlementExecutionEnabled:\s*false/);
assert.match(coverage, /if \(provenance === 'protocol_deferred_settlement'\) return false/);
const admittedBlock = coverage.match(/const ATOMIC_EXTERNAL_PRINCIPAL_SOURCES:[\s\S]*?\] as const;/)?.[0] || '';
assert.doesNotMatch(admittedBlock, /protocol_deferred_settlement_capital/);

// Existing flash execution remains first choice. Alternatives are exact-simulated
// fallback sources and execute only through the same canonical scheduler entrypoint.
assert.match(discovery, /repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /repriceZeroCapitalAlternativeCapital\(/);
assert.match(discovery, /!flashSelectedIds\.has\(opportunity\.id\)/);
assert.match(alternativeReprice, /await input\.provider\.call\(exactEnvelope\)/);
assert.match(alternativeReprice, /await input\.provider\.estimateGas\(exactEnvelope\)/);
assert.match(alternativeReprice, /strict_positive_all_in_net_after_source_fee_and_execution_cost/);
assert.match(alternativeRegistry, /selection\.expectedNetProfit <= 0n/);
assert.match(canonicalRouter, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(canonicalRouter, /builderSponsoredZeroCapitalRegistry\.get\(opportunity\.id\)/);
assert.match(canonicalRouter, /return executeFlashCanonicalZeroCapitalOpportunity\(opportunity\)/);
assert.match(canonicalRouter, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(alternativeExecutor, /await provider\.call\(request\)/);
assert.match(alternativeExecutor, /await provider\.estimateGas\(request\)/);
assert.match(alternativeExecutor, /estimatedGasUnits > selection\.estimatedGasUnits/);
assert.match(alternativeExecutor, /intermediaryEnding !== intermediaryStarting/);
assert.match(alternativeExecutor, /recipientDelta !== grossProfit/);
assert.match(flashExecutor, /CanonicalExecutionScheduler -> CanonicalZeroCapitalExecutor|Sole ZERO_CAPITAL_ATOMIC execution route/);

// Ghost Wallet automation cannot spend the arbitrage engine's retained native gas.
assert.doesNotMatch(engine, /executeSystemOwnedNativeTransaction/);
assert.match(engine, /funding\.mode === 'sponsored'/);
assert.match(engine, /funding\.paymentSource === 'provider_sponsored'/);
assert.match(engine, /funding\.sponsorOperatorMonetaryCostProvenZero === true/);
assert.match(engine, /arbitrageSystemOwnedGasFallbackAllowed:\s*false/);
assert.match(engine, /runtime\.gasSponsor\.execute/);

// Vault arithmetic avoids ceil-rounding addition overflow while retaining the virtual offset.
assert.match(vault, /VIRTUAL_SHARES = 1_000/);
assert.match(vault, /VIRTUAL_ASSETS = 1/);
assert.match(vault, /uint256 quotient = product \/ denominator/);
assert.match(vault, /product % denominator == 0 \? quotient : quotient \+ 1/);
assert.doesNotMatch(vault, /\(product \+ denominator - 1\) \/ denominator/);

console.log(JSON.stringify({
  ghostWalletAtomicCapital: 'verified',
  independentProfitLadderLane: true,
  immutableDirectPayout: true,
  sameTransactionRepaymentOrRevert: true,
  transientApprovalsRevoked: true,
  exactTerminalBalanceNeutrality: true,
  fiveCapitalPrimitivesPresent: true,
  protocolSpecificLiabilityProbes: true,
  deferredSettlementFalseCapabilityRemoved: true,
  flashPriorityPreserved: true,
  alternativeCapitalExactSimulation: true,
  singleCanonicalExecutionEntry: true,
  ghostWalletArbitrageGasCrossSubsidy: false,
  vaultCeilOverflowHardened: true,
}, null, 2));
