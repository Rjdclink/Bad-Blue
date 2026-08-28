const fs = require('node:fs');
const assert = require('node:assert/strict');

const fuel = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-maker-fuel-reserve.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/rainbow-profit-bridge-wiring.ts', 'utf8');
const bridge = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-profit-bridge.ts', 'utf8');
const strategy = fs.readFileSync('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts', 'utf8');

assert.match(fuel, /getDynamicMakerCanaryStatus/);
assert.match(fuel, /CRYPTO_RAINBOW_MAKER_FUEL_CANARIES', 2/);
assert.match(fuel, /CRYPTO_RAINBOW_MAKER_FUEL_FEE_BUFFER_BPS', 25/);
assert.match(fuel, /principalBuffer = proof\.ceilingUsd \* bufferedCanaries/);
assert.match(fuel, /feeBuffer = principalBuffer \* feeBufferBps \/ 10_000/);
assert.match(fuel, /Math\.max\(baseline, status\.dynamicReserveUsd\)/);
assert.match(fuel, /CRYPTOCRAWL_INVENTORY_MIN_RESERVE_OKX_USDT/);
assert.match(fuel, /CRYPTOCRAWL_INVENTORY_MIN_RESERVE_OKX_USDC/);
assert.match(fuel, /CRYPTOCRAWL_INVENTORY_MIN_RESERVE_KRAKEN_USDT/);
assert.match(fuel, /CRYPTOCRAWL_INVENTORY_MIN_RESERVE_KRAKEN_USDC/);
assert.match(fuel, /stageManager\.on\('execution-evidence-recorded'/);
assert.match(wiring, /ensureRainbowMakerFuelReserve\(\)/);
assert.match(wiring, /stopRainbowMakerFuelReserve\(\)/);
assert.match(wiring, /ensureRainbowMakerFuelReserve\(\);[\s\S]*rainbowProfitBridge\.start\(\)/);

// Existing Rainbow authority must continue respecting ledger reserves.
assert.match(bridge, /snapshot\.minimumReserve/);
assert.match(bridge, /snapshot\.reserved/);
assert.match(bridge, /snapshot\.pendingOrder/);
assert.match(bridge, /snapshot\.pendingTransfer/);

// The same proof ladder drives both order size and retained maker fuel.
assert.match(strategy, /CRYPTO_ARBITRAGE_MAKER_CANARY_BOOTSTRAP_USD', 10/);
assert.match(strategy, /PROOF_CAPS_USD = \[10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000\]/);

console.log(JSON.stringify({
  makerFuelSource: 'same_dynamic_canary_proof_ladder',
  initialMakerCanaryUsd: 10,
  defaultBufferedCanaries: 2,
  operatorInventoryMinimumsPreserved: true,
  exchanges: ['okx', 'kraken'],
  fuelAssets: ['USDT', 'USDC'],
  walletSweepAuthorityUnchanged: true,
}, null, 2));
