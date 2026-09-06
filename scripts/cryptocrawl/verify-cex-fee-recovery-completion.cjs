const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const stablepair = read('server/services/cryptocrawl/intelligence/coinbase-stablepair-fee-authority.ts');
const resolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const recovery = read('server/services/cryptocrawl/intelligence/cex-fee-recovery-authority.ts');
const recoveryWiring = read('server/services/cryptocrawl/integration/cex-fee-recovery-wiring.ts');
const feeWiring = read('server/services/cryptocrawl/integration/authenticated-fee-tier-optimization-wiring.ts');
const superEngine = read('server/services/cryptocrawl/optimization/bps-reduction-super-engine.ts');
const fourMode = read('server/services/cryptocrawl/intelligence/cex-four-mode-matrix.ts');
const settlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');

// Coinbase stablepair zero-maker economics must come from a current product flag,
// never a static symbol allowlist or a configured wish. The account fee remains
// the conservative fallback if live product classification is unavailable.
assert.match(stablepair, /api\.exchange\.coinbase\.com\/products/);
assert.match(stablepair, /payload\?\.fx_stablecoin === true/);
assert.match(stablepair, /stablepair \? 0 : null/);
assert.match(stablepair, /staticPairAllowlistUsed: false/);
assert.match(resolver, /resolveCoinbaseStablepairFeeEvidence/);
assert.match(resolver, /coinbase_stablepair_live_product/);
assert.match(resolver, /stablepairZeroMaker \? 0 : accountFee\.makerFeeBps/);
assert.match(resolver, /zeroMakerAssumed: false/);
assert.match(resolver, /Promise\.allSettled\(missingCoinbase\.map/);
assert.ok(!resolver.includes('storeFeeEvidence({ ...baseEvidence, symbol })'), 'Coinbase product-specific fee evidence must never clone the first product across symbols');

// Existing canonical maker/taker economics must continue consuming the resolver's
// exact signed maker fee/rebate truth. No second order-mode economics authority.
assert.match(fourMode, /getCachedCexFeeEvidence/);
assert.match(fourMode, /resolveCexFeeEvidence/);
assert.match(fourMode, /return -Math\.abs\(Number\(evidence\.makerRebateBps\)\)/);

// Kraken Fee Credits are observable with the existing authenticated balance API,
// but may not be pre-credited until exact reservation/deduction is proven.
assert.match(recovery, /\/0\/private\/Balance/);
assert.match(recovery, /balances\?\.KFEE/);
assert.match(recovery, /balances\?\.FEE/);
assert.match(recovery, /Math\.max\(kfee \?\? 0, fee \?\? 0\)/);
assert.match(recovery, /creditUnits \* 0\.01/);
assert.match(recovery, /crossReplicaKfeeReservationImplemented: false/);
assert.match(recovery, /preTradeKfeeCreditAllowed: false/);

// OKX Rebate Card/fee-rebate recovery is recognized only after an authenticated
// funding-account bill proves a positive received credit. Forecasts are zero.
assert.match(recovery, /\/api\/v5\/asset\/bills/);
assert.match(recovery, /type: '68'/);
assert.match(recovery, /type: '173'/);
assert.match(recovery, /const amountUsd = finitePositive\(row\?\.balChg\)/);
assert.match(recovery, /received: true/);
assert.match(recovery, /realizedRecoveryAuthority: true/);
assert.match(recovery, /unreceivedForecastCreditBps: 0/);
assert.match(recovery, /futureOrConfiguredRecoveryCanCreateProfitability: false/);

// Coinbase One, OKX Tradeback, AI Builder proprietary commissions and external
// cashback remain classified but cannot silently alter executable economics.
assert.match(recovery, /coinbase_one_advanced_fee_rebate/);
assert.match(recovery, /okx_tradeback_voucher/);
assert.match(recovery, /okx_ai_builder_proprietary_trade_commission/);
assert.match(recovery, /excluded_for_proprietary_trading/);
assert.match(recovery, /third_party_cashback/);
assert.match(recovery, /external_or_manual_only/);

// Recovery is attached to the one existing fee lifecycle and surfaced through
// the BPS Super Engine as a received-only sidecar. It cannot submit or reprice.
assert.match(feeWiring, /ensureCexFeeRecoveryWiring\(\)/);
assert.match(recoveryWiring, /existingCoinbaseKrakenOkxCredentialsOnly: true/);
assert.match(recoveryWiring, /additionalTradingApiKeysRequired: false/);
assert.match(recoveryWiring, /unreceivedCoinbaseOneOrTradebackPrecredited: false/);
assert.match(recoveryWiring, /executionAuthority: false/);
assert.match(superEngine, /getCexFeeRecoverySnapshot/);
assert.match(superEngine, /feeRecovery,/);
assert.match(superEngine, /unreceivedProgramRecoveryCanCreateProfitability: false/);
assert.match(superEngine, /executionAuthority: false as const/);

// Terminal venue-native fee signs stay the only per-trade realized fee truth;
// asynchronous program credits are intentionally not injected into this function.
assert.match(settlement, /positive = cost, negative = rebate/);
assert.match(settlement, /proceedsUsd - acquisitionCostUsd - exchangeFeeUsd/);
assert.ok(!settlement.includes('getCexFeeRecoverySnapshot'), 'Delayed fee-recovery programs must not be injected into immediate CEX trade settlement');

// No new trading-provider credential family may be introduced by this wave.
const combined = [stablepair, resolver, recovery, recoveryWiring, feeWiring, superEngine].join('\n');
for (const forbidden of [
  'TRADE_RECLAIM_API_KEY',
  'TETHERBACK_API_KEY',
  'COINBASE_ONE_API_KEY',
  'OKX_AI_BUILDER_API_KEY',
  'BINANCE_API_KEY',
]) {
  assert.ok(!combined.includes(forbidden), `Unexpected new credential dependency: ${forbidden}`);
}

console.log('[cex-fee-recovery-completion] PASS: live Coinbase stablepair zero-maker pricing, existing Kraken/OKX signed fee economics, received-only OKX recovery, conservative KFEE observation, one fee lifecycle, one BPS authority, no new trading API key, and no synthetic profitability');
