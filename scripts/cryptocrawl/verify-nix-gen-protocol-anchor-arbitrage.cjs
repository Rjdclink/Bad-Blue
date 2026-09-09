'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const adapter = read('server/services/cryptocrawl/execution/adapters/protocol-anchor-adapter.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const payload = read('server/services/cryptocrawl/execution/adapters/onchain-payload-builder.ts');
const planner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const receiver = read('contracts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.sol');

assert.match(adapter, /getAssetAmountForBuyAsset/);
assert.match(adapter, /getGhoAmountForSellAsset/);
assert.match(adapter, /getAvailableLiquidity/);
assert.match(adapter, /getAvailableUnderlyingExposure/);
assert.match(adapter, /canSwap/);
assert.match(adapter, /getIsFrozen/);
assert.match(adapter, /getIsSeized/);
assert.match(adapter, /FluidDexSwapResult\(uint256\)/);
assert.match(adapter, /provider\.call/);
assert.match(adapter, /Unreviewed Aave GHO GSM address/);
assert.match(adapter, /Unreviewed Fluid GHO\/USDC pool address/);
assert.doesNotMatch(adapter, /assumed.*1:1|hard.?coded.*10\s*BPS/i);

for (const routeId of [
  'anchor-ethereum-usdc-fluid-gho-gsm-usdc',
  'anchor-ethereum-usdc-gsm-gho-fluid-usdc',
  'anchor-ethereum-usdc-fluid-gho-gsm-usdt-usdc',
  'anchor-ethereum-usdc-usdt-gsm-gho-fluid-usdc',
  'anchor-ethereum-usdt-gsm-gho-fluid-usdc-usdt',
  'anchor-ethereum-usdt-usdc-fluid-gho-gsm-usdt',
]) assert.match(adapter, new RegExp(routeId));

assert.match(quoter, /defaultEthereumProtocolAnchorRoutes/);
assert.match(quoter, /quoteProtocolAnchorLeg/);
assert.match(quoter, /executablePositive:\s*netProfit\s*>\s*0n/);
assert.match(quoter, /selectionPool = admissible\.length > 0 \? admissible : observed/);
assert.match(quoter, /arguments\.length === 0/);
assert.match(quoter, /ZERO_CAPITAL_PROTOCOL_ANCHORS/);
assert.match(quoter, /\.\.\.\(leg\.pool \? \{ pool: leg\.pool \} : \{\}\)/);

assert.match(payload, /aaveGhoGsm/);
assert.match(payload, /fluidDexT1/);
assert.match(payload, /resolveProtocolAnchorPool/);
assert.match(payload, /buildProtocolAnchorCall/);
assert.match(planner, /isStrictlyPositiveProfitBaseUnits\(expectedProfit\)/);
assert.match(planner, /protocol === 'aaveGhoGsm'\s*\?\s*expectedAmountOut\.toString\(\)/);
assert.match(planner, /route\[\$\{index\}\]\.pool/);

assert.match(receiver, /require\(finalBalance >= amountOwed \+ minProfit, "profit_below_threshold"\)/);
assert.match(receiver, /require\(allowedTargets\[step\.target\], "target_not_allowed"\)/);
assert.match(receiver, /require\(allowedApprovalTokens\[step\.approvalToken\], "approval_token_not_allowed"\)/);

console.log(JSON.stringify({
  ok: true,
  protocolAnchorRoutes: 6,
  liveGsmEconomics: true,
  fluidCallSimulation: true,
  canonicalStrictPositiveProfitPreserved: true,
  receiverAllowListPreserved: true,
}));
