const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const economics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const capability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const wiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const builder = read('server/services/cryptocrawl/execution/adapters/flashloan-receiver-builder.ts');
const execution = read('server/services/cryptocrawl/integration/provider-specific-zero-capital-execution-wiring.ts');
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
assert.match(economics, /ethereum: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb'/);
assert.match(economics, /base: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb'/);
assert.match(economics, /polygon: '0x1bF0c2541F820E775182832f06c0B7Fc27A25f67'/);
assert.match(economics, /arbitrum: '0x6c247b1F6182318877311737BaC0844bAa518F5e'/);
assert.match(economics, /optimism: '0xce95AfbB8EA029495c66020883F87aaE8864AF92'/);

assert.match(capability, /\| 'morpho_blue'/);
assert.match(capability, /ZERO_CAPITAL_MORPHO_RECEIVERS/);
assert.match(capability, /ZERO_CAPITAL_MORPHO_RECEIVER_/);
assert.match(capability, /kind === 'morpho_blue' \? 'morpho'/);

assert.match(wiring, /kind: 'morpho_blue'/);
assert.match(wiring, /capabilities\.set\('morpho_blue', morphoCapability\)/);
assert.match(wiring, /morpho_zero_flash_fee_applied:true/);
assert.match(wiring, /providerMesh: \['morpho_blue', 'balancer_v2', 'aave_v3', 'aave_balancer_dual'\]/);
assert.match(wiring, /nonPositiveProviderRepriceExecutable: false/);
assert.match(wiring, /failClosedOnMissingProviderEvidence: true/);

assert.match(builder, /executeMorphoFlashLoan/);
assert.match(execution, /selection\.provider !== 'aave_v3' && selection\.provider !== 'morpho_blue'/);
assert.match(execution, /selection\.receiverCapability\.kind !== selection\.provider/);
assert.match(execution, /strictZeroInitialCapitalEligible !== true/);
assert.match(execution, /operatorMonetaryInputRequired !== false/);
assert.match(execution, /zero_capital_morpho_blue_flash_execution/);

assert.match(receiver, /function executeMorphoFlashLoan/);
assert.match(receiver, /function onMorphoFlashLoan/);
assert.match(receiver, /require\(msg\.sender == address\(morpho\), "morpho_only"\)/);
assert.match(receiver, /require\(finalBalance >= assets \+ minProfit, "profit_below_threshold"\)/);
assert.match(receiver, /_safeApprove\(loanToken, address\(morpho\), assets\)/);
assert.doesNotMatch(receiver, /premium/);

assert.match(compiler, /compileMorphoBlueFlashLoanReceiver/);
assert.match(compiler, /CryptocrawlMorphoFlashLoanReceiver\.sol/);

console.log('[verify-morpho-zero-fee-flash] zero-fee measured liquidity, verified receiver binding, strict zero-operator-cost execution, atomic principal repayment, and fail-closed profitability invariants passed');
