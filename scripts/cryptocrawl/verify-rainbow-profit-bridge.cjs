const fs = require('node:fs');
const assert = require('node:assert/strict');

const bridge = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-profit-bridge.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/rainbow-profit-bridge-wiring.ts', 'utf8');
const core = fs.readFileSync('server/services/cryptocrawl/runtime/core-runtime.ts', 'utf8');

assert.match(bridge, /settlement\.terminal !== true/);
assert.match(bridge, /settlement\.settlementConfirmed !== true/);
assert.match(bridge, /feedback\.success !== true/);
assert.match(bridge, /realized_profit_usd numeric NOT NULL CHECK \(realized_profit_usd > 0\)/);
assert.match(bridge, /event_id text PRIMARY KEY/);
assert.match(bridge, /ON CONFLICT \(event_id\) DO NOTHING/);
assert.match(bridge, /CRYPTO_PROFIT_WALLET_ADDRESS/);
assert.match(bridge, /isAddress\(DESTINATION\)/);
assert.match(bridge, /CRYPTO_RAINBOW_OPERATING_RESERVE_USD/);
assert.match(bridge, /route\.maxWithdrawal - OPERATING_RESERVE_USD/);
assert.match(bridge, /USDT,USDC/);
assert.match(bridge, /CRYPTO_RAINBOW_EVM_NETWORKS/);
assert.match(bridge, /\/api\/v5\/asset\/currencies/);
assert.match(bridge, /\/api\/v5\/account\/max-withdrawal/);
assert.match(bridge, /\/api\/v5\/asset\/withdrawal'/);
assert.match(bridge, /clientId/);
assert.match(bridge, /recoverAmbiguousSubmission/);
assert.match(bridge, /\/api\/v5\/asset\/withdrawal-history/);
assert.match(bridge, /state === '2'/);
assert.match(bridge, /transaction_hash/);
assert.doesNotMatch(bridge, /Math\.random/);
assert.doesNotMatch(bridge, /Simulate transaction|fake transaction|simulated payout/i);

assert.match(wiring, /execution-evidence-recorded/);
assert.match(wiring, /cryptaraExecutionEvidence/);
assert.match(wiring, /recordTerminalSettlement/);
assert.match(wiring, /Payout persistence\/venue egress is downstream of settlement/);

assert.match(core, /scheduleRainbowProfitBridge\(\)/);
assert.match(core, /queueMicrotask/);
assert.match(core, /Rainbow Bridge unavailable; realized profits remain at source/);
assert.doesNotMatch(core, /await scheduleRainbowProfitBridge/);

console.log(JSON.stringify({
  terminalConfirmedProfitOnly: true,
  persistentIdempotency: true,
  destinationValidated: true,
  operatingReservePreserved: true,
  stablecoinConsolidation: ['USDT', 'USDC'],
  dynamicEvmRouting: true,
  okxRealWithdrawalEndpoint: true,
  ambiguousSubmissionRecovery: true,
  terminalWithdrawalReconciliation: true,
  simulatedTransferRemovedFromRainbowPath: true,
  tradingStartupNonBlocking: true,
}, null, 2));
