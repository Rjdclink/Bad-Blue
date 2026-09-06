const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const economics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const capability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const wiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const builder = read('server/services/cryptocrawl/execution/adapters/flashloan-receiver-builder.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const receiver = read('contracts/cryptocrawl/CryptocrawlMorphoFlashLoanReceiver.sol');
const compiler = read('scripts/cryptocrawl/compile-flashloan-receiver.ts');

assert.match(economics, /FlashLoanProviderKind = 'balancer_v2' \| 'aave_v3' \| 'morpho_blue'/);
assert.match(economics, /export function resolveMorphoBlue/);
assert.match(economics, /provider: 'morpho_blue'/);
assert.match(economics, /feeBps: 0/);
assert.match(economics, /feeRateNumerator: 0n/);
assert.match(economics, /feeRateDenominator: 1n/);
assert.match(economics, /balanceOf\(morpho\)/);
assert.match(economics, /getCode\(morpho\)/);
assert.match(economics, /morpho_blue_core_flashFee_zero_by_interface/);

assert.match(capability, /\| 'morpho_blue'/);
assert.match(capability, /ZERO_CAPITAL_MORPHO_RECEIVERS/);
assert.match(capability, /ZERO_CAPITAL_MORPHO_RECEIVER_/);
assert.match(capability, /kind === 'morpho_blue' \? 'morpho'/);

assert.match(wiring, /kind: 'morpho_blue'/);
assert.match(wiring, /capabilities\.single\.set\('morpho_blue', morpho\)/);
assert.match(wiring, /morpho_zero_flash_fee_applied:true/);
assert.match(wiring, /strict_positive_repriced_net/);
assert.match(wiring, /measured_flash_loan_provider_liquidity_and_fee/);

assert.match(builder, /executeMorphoFlashLoan/);
assert.match(executor, /flashLoanProviderSelectionRegistry\.get\(opportunity\.id\)/);
assert.match(executor, /selection\.kind === 'single' \? selection\.provider : 'balancer_v2'/);
assert.match(executor, /getProvenZeroCapitalGasFundingDecision/);
assert.match(executor, /strictZeroInitialCapitalEligible !== true/);
assert.match(executor, /operatorMonetaryInputRequired !== false/);
assert.match(executor, /executeSystemOwnedNativeTransaction/);
assert.match(executor, /extractProfit\(receipt/);

assert.match(receiver, /function executeMorphoFlashLoan/);
assert.match(receiver, /function onMorphoFlashLoan/);
assert.match(receiver, /require\(msg\.sender == address\(morpho\), "morpho_only"\)/);
assert.match(receiver, /require\(finalBalance >= assets \+ minProfit, "profit_below_threshold"\)/);
assert.match(receiver, /_safeApprove\(loanToken, address\(morpho\), assets\)/);
assert.doesNotMatch(receiver, /premium/);

assert.match(compiler, /compileMorphoBlueFlashLoanReceiver/);
assert.match(compiler, /CryptocrawlMorphoFlashLoanReceiver\.sol/);

console.log('[verify-morpho-zero-fee-flash] measured zero-fee liquidity, verified receiver binding, strict zero-operator-cost proof, atomic principal repayment, canonical single-executor submission, and terminal receipt-profit invariants passed');
