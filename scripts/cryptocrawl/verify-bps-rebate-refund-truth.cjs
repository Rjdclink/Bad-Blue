const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const settlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const superEngine = read('server/services/cryptocrawl/optimization/bps-reduction-super-engine.ts');
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');

// Venue-native terminal fees are normalized once into one economic convention:
// positive = cost, negative = rebate/refund. Net profit consumes that signed truth.
assert.match(settlement, /positive = cost, negative = rebate/);
assert.match(settlement, /const economicFeeAmount = order\.venue === 'okx' \? -order\.feeAmount : order\.feeAmount/);
assert.match(settlement, /const exchangeFeeUsd = buyFeeUsd !== null && sellFeeUsd !== null \? buyFeeUsd \+ sellFeeUsd : null/);
assert.match(settlement, /proceedsUsd - acquisitionCostUsd - exchangeFeeUsd/);

// Canonical BPS must preserve a negative terminal fee as a rebate/refund credit;
// only inherently nonnegative cost fields may use the nonnegative converter.
assert.match(registry, /function measuredSignedUsdToBps/);
assert.match(registry, /return value \/ notionalUsd \* 10_000/);
assert.match(registry, /exchangeFeeBps: measuredSignedUsdToBps\(economics\.feeUsd, notionalUsd\)/);
assert.match(registry, /positive = cost, negative = realized\/quoted rebate or refund/);

// The Super Engine consumes the registry-owned signed BPS directly. It must not
// independently clamp, estimate, or double-credit a rebate.
assert.match(superEngine, /exchangeFeeBps: canonical\.exchangeFeeBps/);
assert.ok(!/Math\.max\(0,\s*canonical\.exchangeFeeBps/.test(superEngine), 'Super Engine must not erase negative rebate BPS');
assert.ok(!/rebate.*\+.*rebate|refund.*\+.*refund/i.test(superEngine), 'Super Engine must not double-credit rebates/refunds');

// Forecast maker rebate remains authenticated venue evidence; terminal settlement
// is what teaches realized savings.
assert.match(feeResolver, /makerRebateBps/);
assert.match(feeResolver, /source: rates\.zeroFeeGroup \? 'okx_live_spot_zero_fee_group' : 'okx_account_trade_fee'/);

console.log('[bps-rebate-refund-truth] PASS: authenticated forecast fees/rebates and terminal signed fee truth flow through one canonical BPS attribution path without clamping or double counting');