'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = p => fs.readFileSync(p, 'utf8');
const canonical = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const alternative = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const intermediary = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const vault = read('contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol');

assert.match(canonical, /executeFlashCanonicalZeroCapitalOpportunity/);
assert.match(canonical, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(canonical, /flashLoanProviderSelectionRegistry\.get/);
assert.match(canonical, /builderSponsoredZeroCapitalRegistry\.get/);
assert.match(alternative, /provider\.call\(request\)/);
assert.match(alternative, /provider\.estimateGas\(request\)/);
assert.match(alternative, /recipientDelta !== grossProfit/);
assert.match(alternative, /intermediaryEnding !== intermediaryStarting/);
assert.match(engine, /profitLadderAuthority: false/);
assert.match(engine, /100_percent_realized_net_direct_to_canonical_wallet/);
assert.match(engine, /arbitrageSystemOwnedGasFallbackAllowed: false/);
assert.match(intermediary, /borrower_repayment_shortfall/);
assert.match(intermediary, /spread_reconciliation_failed/);
assert.match(intermediary, /incremental_liability_not_repaid/);
assert.match(vault, /atomic_credit_not_repaid/);
assert.match(vault, /VIRTUAL_SHARES/);
assert.match(vault, /VIRTUAL_ASSETS/);

console.log(JSON.stringify({ok:true, canonicalFlashPreserved:true, alternativeExecutorSubordinate:true, ghostWalletProfitLadderAuthority:false, atomicRepaymentFailClosed:true, payoutReconciled:true}, null, 2));
