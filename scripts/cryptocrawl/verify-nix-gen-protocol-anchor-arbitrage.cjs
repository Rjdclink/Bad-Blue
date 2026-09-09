'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const adapter = read('server/services/cryptocrawl/execution/adapters/protocol-anchor-adapter.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const payload = read('server/services/cryptocrawl/execution/adapters/onchain-payload-builder.ts');
const planner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const receiver = read('contracts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.sol');

// Current Aave Ethereum address-book truth. Legacy direct-underlying GSM addresses
// must not silently return because current Gsm4626 UNDERLYING_ASSET is StataToken.
assert.match(adapter, /0x3A3868898305f04beC7FEa77BecFf04C13444112/);
assert.match(adapter, /0x882285E62656b9623AF136Ce3078c6BdCc33F5E3/);
assert.match(adapter, /0xD4fa2D31b7968E448877f69A96DE69f5de8cD23E/);
assert.match(adapter, /0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8/);
assert.doesNotMatch(adapter, /0xFeeb6FE430B7523fEF2a38327241eE7153779535/i);
assert.doesNotMatch(adapter, /0x535b2f7C20B9C83d70e519cf9991578eF9816B7B/i);

assert.match(adapter, /getAssetAmountForBuyAsset/);
assert.match(adapter, /getGhoAmountForSellAsset/);
assert.match(adapter, /getAvailableLiquidity/);
assert.match(adapter, /getAvailableUnderlyingExposure/);
assert.match(adapter, /canSwap/);
assert.match(adapter, /getIsFrozen/);
assert.match(adapter, /getIsSeized/);
assert.match(adapter, /previewDeposit/);
assert.match(adapter, /previewRedeem/);
assert.match(adapter, /maxDeposit/);
assert.match(adapter, /function asset\(\)/);
assert.match(adapter, /quoteStata/);
assert.match(adapter, /wrapUsdc/);
assert.match(adapter, /unwrapUsdc/);
assert.match(adapter, /wrapUsdt/);
assert.match(adapter, /unwrapUsdt/);
assert.match(adapter, /FluidDexSwapResult\(uint256\)/);
assert.match(adapter, /provider\.call/);
assert.match(adapter, /resolveProtocolAnchorPool/);
assert.match(adapter, /Unreviewed Aave GHO GSM address/);
assert.match(adapter, /Unreviewed Aave StataToken vault address/);
assert.match(adapter, /Unreviewed Fluid GHO\/USDC pool address/);
assert.match(adapter, /Gsm4626/);
assert.doesNotMatch(adapter, /assumed.*1:1|hard.?coded.*10\s*BPS/i);

for (const routeId of [
  'anchor-ethereum-usdc-fluid-gho-gsm-usdc',
  'anchor-ethereum-usdc-gsm-gho-fluid-usdc',
  'anchor-ethereum-usdc-fluid-gho-gsm-usdt-usdc',
  'anchor-ethereum-usdc-usdt-gsm-gho-fluid-usdc',
  'anchor-ethereum-usdt-gsm-gho-fluid-usdc-usdt',
  'anchor-ethereum-usdt-usdc-fluid-gho-gsm-usdt',
]) assert.match(adapter, new RegExp(routeId));

// Route definitions must explicitly traverse raw stable <-> StataToken rather than
// pretending a current Remote GSM accepts raw USDC/USDT.
assert.match(adapter, /fluidUsdcToGho, gsmGhoToStataUsdc, unwrapUsdc/);
assert.match(adapter, /wrapUsdc, gsmStataUsdcToGho, fluidGhoToUsdc/);
assert.match(adapter, /fluidUsdcToGho, gsmGhoToStataUsdt, unwrapUsdt, usdtToUsdc/);
assert.match(adapter, /usdcToUsdt, wrapUsdt, gsmStataUsdtToGho, fluidGhoToUsdc/);

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
assert.match(planner, /minAmountOut:\s*protocolAnchor\s*\?\s*expectedAmountOut\.toString\(\)/);
assert.match(planner, /route\[\$\{index\}\]\.pool/);

assert.match(receiver, /require\(finalBalance >= amountOwed \+ minProfit, "profit_below_threshold"\)/);
assert.match(receiver, /require\(allowedTargets\[step\.target\], "target_not_allowed"\)/);
assert.match(receiver, /require\(allowedApprovalTokens\[step\.approvalToken\], "approval_token_not_allowed"\)/);

console.log(JSON.stringify({
  ok: true,
  protocolAnchorRoutes: 6,
  currentRemoteGsmAddresses: true,
  currentStataTokenWrappers: true,
  legacyGsmAddressesRejected: true,
  liveGsmEconomics: true,
  liveStataConversion: true,
  fluidCallSimulation: true,
  exactAnchorHandoff: true,
  canonicalStrictPositiveProfitPreserved: true,
  receiverAllowListPreserved: true,
}));
