const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const authority = read('server/services/cryptocrawl/intelligence/okx-account-fee-authority.ts');
const resolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const rpi = read('server/services/cryptocrawl/intelligence/okx-rpi-capability.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const feeSurface = read('server/services/cryptocrawl/optimization/fee-surface-hyperdynamic-strategy-engine.ts');

assert.match(authority, /Sole semantic authority for authenticated OKX account fee reads/);
assert.match(authority, /const feeCache = new Map/);
assert.match(authority, /const feeInFlight = new Map/);
assert.match(authority, /if \(existing\)[\s\S]*coalescedCount \+= 1/);
assert.match(authority, /exactly one of groupId, instId, or instFamily/);
assert.match(authority, /expectedGroupId/);
assert.match(authority, /lane: 'trade_fee'/);

// Current OKX product identity owns promotional zero-fee truth. Group 11 is the
// documented live Spot-zero group; no stablecoin symbol list or generic stablecoin
// group may manufacture a zero rate. The account fee API remains authoritative for
// every other group.
assert.match(authority, /OKX_SPOT_ZERO_FEE_GROUP_ID = '11'/);
assert.match(authority, /expected === OKX_SPOT_ZERO_FEE_GROUP_ID && selectedGroupId === OKX_SPOT_ZERO_FEE_GROUP_ID/);
assert.match(authority, /taker: zeroFeeGroup \? 0 : selected\.taker/);
assert.match(authority, /maker: zeroFeeGroup \? 0 : selected\.maker/);
assert.match(authority, /source: zeroFeeGroup \? 'okx_live_spot_zero_fee_group' : 'okx_authenticated_account_fee'/);
assert.ok(!authority.includes("OKX_SPOT_ZERO_FEE_GROUP_ID = '17'"), 'ordinary OKX stablecoin group 17 must never be assumed zero-fee');
assert.ok(!authority.match(/USDCUSDT|USDC-USDT|DAIUSDT|PYUSDUSDT|USDGUSDT/), 'zero-fee authority must not hard-code promotional symbol lists');

// A measured zero fee is valid evidence, not missing information. Preserve it
// through the generic CEX fee surface so TT/MT/TM/MM can consume exact 0 BPS.
assert.match(resolver, /rates\.maker !== null && rates\.maker <= 0 \? Math\.max\(0, -rates\.maker \* 10_000\) : null/);
assert.match(resolver, /source: rates\.zeroFeeGroup \? 'okx_live_spot_zero_fee_group' : 'okx_account_trade_fee'/);
assert.match(resolver, /zeroFeeGroup: result\.zeroFeeGroup/);

for (const [name, source] of [
  ['CEX fee resolver', resolver],
  ['RPI capability', rpi],
  ['funding monitor', funding],
]) {
  assert.match(source, /resolveOkxAccountFeeRates/);
  assert.ok(
    !source.includes('/api/v5/account/trade-fee'),
    `${name} must not bypass the semantic OKX account-fee authority`,
  );
}

// No fee-reduction component may turn referral abuse, self-crossing, or wash
// trading into an economic tactic. Legitimate maker rebates remain measured from
// authenticated venue fee evidence only.
for (const source of [authority, resolver, feeSurface]) {
  assert.ok(!/SELF_REFERRAL|SELF_TRADE_REBATE|WASH_TRADE_REBATE|REFERRAL_REBATE_STACK/i.test(source), 'self-referral/wash-trade rebate logic is prohibited');
}

assert.match(funding, /OKX_SWAP_CAPABILITY_PROBE_BUDGET/);
assert.match(funding, /Math\.abs\(right\.fundingRate\) - Math\.abs\(left\.fundingRate\)/);
assert.match(funding, /\.slice\(0, OKX_SWAP_CAPABILITY_PROBE_BUDGET\)/);
assert.match(funding, /Private OKX SWAP enrichment deferred by the bounded discovery budget/);
assert.match(funding, /execution remains fail-closed/);
assert.match(funding, /publicDiscoveryBlockedByPrivateEnrichment: false/);
assert.match(funding, /const accountContext = await getOkxSwapAccountContext\(\)/);
assert.match(funding, /instrument\?\.groupId/);

console.log('[okx-account-fee-authority] shared semantic caching, live Spot-zero group truth, exact zero-BPS maker preservation, no promotional symbol assumptions, prohibited referral/wash rebate tactics, and bounded funding enrichment verified');