const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const must = (source, pattern, message) => {
  if (!pattern.test(source)) throw new Error(`[verify-ghost-wallet-capital-fabric] ${message}`);
};
const forbid = (source, pattern, message) => {
  if (pattern.test(source)) throw new Error(`[verify-ghost-wallet-capital-fabric] ${message}`);
};

const contract = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const runtime = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const capitalRegistry = read('server/services/cryptocrawl/optimization/external-capital-capability-registry.ts');
const capitalFabric = read('server/services/cryptocrawl/optimization/zero-capital-capital-fabric.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const compiler = read('scripts/cryptocrawl/compile-flashloan-receiver.ts');

// Ghost Wallet: atomic borrower settlement and immediate profit routing.
must(contract, /CALLBACK_SUCCESS\s*=\s*keccak256\("ERC3156FlashBorrower\.onFlashLoan"\)/, 'ERC-3156 callback identity must be fixed');
must(contract, /_safeTransferFrom\(token, address\(receiver\), address\(this\), amount \+ fee\)/, 'principal plus fee must be pulled before success');
must(contract, /if \(afterRepayment < startingBalance \+ fee\) revert RepaymentFailed\(\)/, 'balance-backed intermediation must fail closed on incomplete repayment');
must(contract, /uint256 debtBefore = IGhostWalletERC20\(source\.variableDebtToken\)\.balanceOf\(delegator\)/, 'delegated-credit debt must be measured before draw');
must(contract, /uint256 debtAfter = IGhostWalletERC20\(source\.variableDebtToken\)\.balanceOf\(delegator\)/, 'delegated-credit debt must be measured after repayment');
must(contract, /if \(debtAfter > debtBefore\) revert ResidualDebtDetected\(\)/, 'delegated-credit lane must revert on residual debt increase');
must(contract, /_safeTransfer\(asset, profitRecipient, realizedSurplus\)/, 'delegated-credit realized surplus must route immediately to profitRecipient');
must(contract, /_safeTransfer\(token, profitRecipient, realizedSurplus\)/, 'balance-backed realized surplus must route immediately to profitRecipient');
must(contract, /modifier nonReentrant\(\)/, 'intermediation entrypoints must be reentrancy guarded');

// The server observer cannot become a second execution authority or exchange/profit-ladder lane.
must(runtime, /profitLadderAuthority:\s*false/, 'Ghost Wallet must explicitly reject Profit Ladder authority');
must(runtime, /exchangeScheduleAuthority:\s*false/, 'Ghost Wallet must explicitly reject exchange schedule authority');
must(runtime, /exchangeDailyLimitsApplicableToPureOnchainLane:\s*false/, 'pure on-chain Ghost Wallet lane must remain separate from exchange daily limits');
must(runtime, /same_transaction_realized_surplus_to_primary_wallet/, 'Ghost Wallet payout policy must be direct same-transaction surplus routing');
must(runtime, /resolvePrimaryProfitPayoutAddress/, 'Ghost Wallet observer must verify the canonical primary payout wallet');
must(runtime, /executionAuthority:\s*false/, 'off-chain observer must not gain transaction submission authority');
forbid(runtime, /profitLadder\./, 'Ghost Wallet runtime must not call Profit Ladder');
forbid(runtime, /coinbase|kraken|okx/i, 'Ghost Wallet runtime must not depend on centralized exchange execution');

// All five requested additional capital classes are explicit and cannot fabricate readiness.
for (const mechanism of [
  'euler_debt_assumption',
  'aave_credit_delegation',
  'signed_intent_principal',
  'multilateral_netting',
  'erc4626_strategy_vault',
]) {
  must(capitalRegistry, new RegExp(`mechanism: '${mechanism}'`), `${mechanism} must be represented in the measured capital registry`);
}
must(capitalRegistry, /mechanism:\s*'protocol_native_transient_credit'/, 'protocol-native transient settlement should remain available as an additional measured class');
must(capitalRegistry, /requiresApiKey:\s*false/g, 'no-key capital classes must state their API-key independence');
must(capitalRegistry, /requiresSignup:\s*false/g, 'no-signup capital classes must state their account independence');
must(capitalRegistry, /if \(value\.executionReady && !value\.delegatedCanonicalAuthority\)/, 'execution-ready external capital must delegate to a canonical authority');
must(capitalRegistry, /executionReady:\s*false/, 'research classifications must seed fail-closed rather than fabricate live capacity');

// Composition may reduce/supply principal but never move capital itself.
must(capitalFabric, /'debt_assumption'/, 'capital fabric must include debt-assumption offsets');
must(capitalFabric, /'delegated_credit'/, 'capital fabric must include delegated credit');
must(capitalFabric, /'intent_principal'/, 'capital fabric must include signed-intent principal');
must(capitalFabric, /'netting_capacity'/, 'capital fabric must include multilateral netting');
must(capitalFabric, /'vault_credit'/, 'capital fabric must include external vault credit');
must(capitalFabric, /executionAuthority:\s*false/, 'capital fabric must remain advisory');
must(capitalFabric, /capitalMovementAuthority:\s*false/, 'capital fabric must not move capital itself');
must(capitalFabric, /remaining === 0n && allocations\.length > 0 && withinCost/, 'capital fabric may declare executable only after exact measured coverage and cost checks');

// Canonical runtime installs only the observer. It does not install a Ghost Wallet trade scheduler.
must(canonicalRuntime, /ensureGhostWalletEngineWiring/, 'canonical runtime must install Ghost Wallet observability');
must(canonicalRuntime, /install\('ghost_wallet_intermediation_observer'/, 'Ghost Wallet must be isolated as its own runtime component');
forbid(canonicalRuntime, /ghost_wallet.*canonicalExecutionScheduler/i, 'Ghost Wallet observer must not be wired into the arbitrage scheduler');

// Pinned Solidity compilation path includes the new contract.
must(compiler, /CryptocrawlGhostWalletIntermediary\.sol/, 'Ghost Wallet contract must be included in the pinned Solidity compiler path');
must(compiler, /compileGhostWalletIntermediary/, 'Ghost Wallet compiler entrypoint must exist');

console.log('[verify-ghost-wallet-capital-fabric] atomic repayment, direct payout, lane isolation, five-source capital fabric, fail-closed evidence and compiler wiring passed');
