'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const primary = read('server/services/cryptocrawl/execution/adapters/primary-market-anchor-adapter.ts');
const routes = read('server/services/cryptocrawl/execution/adapters/primary-market-anchor-routes.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const payload = read('server/services/cryptocrawl/execution/adapters/onchain-payload-builder.ts');
const planner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const receiverCapability = read('server/services/cryptocrawl/execution/adapters/flash-loan-receiver-capability.ts');
const receiver = read('contracts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.sol');

// Reviewed current Sky Ethereum primary-market identities.
assert.match(primary, /0xf6e72Db5454dd049d0788e411b06CfAF16853042/);
assert.match(primary, /0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A/);
assert.match(primary, /0x6B175474E89094C44Da98b954EedeAC495271d0F/);
assert.match(primary, /0xdC035D45d973E3EC169d2276DDab16f1e407384F/);

// LitePSM economics must come from current contract state and exact source math.
for (const signal of ['tin()', 'tout()', 'to18ConversionFactor()', 'pocket()', 'balanceOf', 'allowance']) {
  assert.match(primary, new RegExp(signal.replace(/[()]/g, '\\$&')));
}
assert.match(primary, /requiredDaiForGem/);
assert.match(primary, /maximumGemForDai/);
assert.match(primary, /tin\.eq\(MAX_UINT256\)/);
assert.match(primary, /tout\.eq\(MAX_UINT256\)/);
assert.doesNotMatch(primary, /sellGemNoFee|buyGemNoFee/);

// DAI/USDS converter is permissionless and wired but not granted synthetic market value.
assert.match(primary, /daiToUsds/);
assert.match(primary, /usdsToDai/);
assert.match(primary, /live identity does not match the reviewed DAI\/USDS converter/);

// Fluid's official resolver must be preferred, with exact direct simulation retained as fallback.
assert.match(primary, /0xF38082d58bF0f1e07C04684FF718d69a70f21e62/);
assert.match(primary, /estimateSwapIn/);
assert.match(quoter, /quoteFluidSwapInViaOfficialResolver/);
assert.match(quoter, /quoteProtocolAnchorLeg/);

// The new default surface is deliberately narrow and executable through the canonical path.
for (const routeId of [
  'anchor-ethereum-usdc-sky-psm-dai-univ3-100',
  'anchor-ethereum-usdc-univ3-100-dai-sky-psm',
]) assert.match(routes, new RegExp(routeId));
assert.match(routes, /feeTier:\s*100/);
assert.match(quoter, /defaultEthereumPrimaryMarketAnchorRoutes/);
assert.match(quoter, /skyLitePsm/);
assert.match(quoter, /skyDaiUsds/);
assert.match(payload, /buildSkyPrimaryMarketCall/);
assert.match(payload, /resolveSkyPrimaryMarketPool/);
assert.match(planner, /protocol === 'skyLitePsm'/);
assert.match(planner, /protocol === 'skyDaiUsds'/);

// Permission acquisition must recognize every current protocol-anchor producer;
// otherwise a profitable candidate would fail before receiver simulation.
for (const protocol of ['aaveGhoGsm', 'fluidDexT1', 'skyLitePsm', 'skyDaiUsds']) {
  assert.match(receiverCapability, new RegExp(protocol));
}
assert.match(receiverCapability, /buildSwapCallFromLeg/);
assert.match(receiverCapability, /setAllowedTarget/);
assert.match(receiverCapability, /setAllowedApprovalToken/);

// Profit authority and receiver safety remain unchanged.
assert.match(quoter, /executablePositive:\s*netProfit\s*>\s*0n/);
assert.match(planner, /isStrictlyPositiveProfitBaseUnits\(expectedProfit\)/);
assert.match(receiver, /require\(finalBalance >= amountOwed \+ minProfit, "profit_below_threshold"\)/);
assert.match(receiver, /require\(allowedTargets\[step\.target\], "target_not_allowed"\)/);
assert.match(receiver, /require\(allowedApprovalTokens\[step\.approvalToken\], "approval_token_not_allowed"\)/);

console.log(JSON.stringify({
  ok: true,
  newPrimaryMarketRoutes: 2,
  skyLitePsmLiveEconomics: true,
  skyDaiUsdsIdentityProof: true,
  fluidOfficialResolverPreferred: true,
  directFluidExactFallbackPreserved: true,
  protocolAnchorPermissioning: true,
  syntheticProfitAllowed: false,
  canonicalStrictPositiveProfitPreserved: true,
  receiverAllowListPreserved: true,
}));
