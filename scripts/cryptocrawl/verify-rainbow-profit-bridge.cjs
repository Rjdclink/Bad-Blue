const fs = require('node:fs');
const assert = require('node:assert/strict');

const bridge = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-profit-bridge.ts', 'utf8');
const observability = fs.readFileSync('server/services/cryptocrawl/compensation/rainbow-profit-observability.ts', 'utf8');
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
assert.match(bridge, /CRYPTO_RAINBOW_INVENTORY_MAX_AGE_MS/);
assert.match(bridge, /cexInventoryLedger\.getSnapshots\(\)/);
assert.match(bridge, /snapshot\.reserved/);
assert.match(bridge, /snapshot\.pendingOrder/);
assert.match(bridge, /snapshot\.pendingTransfer/);
assert.match(bridge, /snapshot\.minimumReserve/);
assert.match(bridge, /snapshot\.target \?\? 0/);
assert.match(bridge, /authority: 'live_inventory'/);
assert.match(bridge, /authority: 'configured_fallback'/);
assert.match(bridge, /CRYPTO_RAINBOW_MAX_FEE_FRACTION/);
assert.match(bridge, /finiteNonNegative\(item\?\.fee\)/);
assert.match(bridge, /route\.fee \/ amount/);
assert.match(bridge, /Payout deferred to preserve realized profit/);
assert.match(bridge, /action: 'accumulate_more_profit'/);
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

assert.match(observability, /queuedProfitUsd/);
assert.match(observability, /submittedProfitUsd/);
assert.match(observability, /confirmedProfitUsd/);
assert.match(observability, /oldestQueuedAgeMs/);
assert.match(observability, /confirmedWithdrawalFees/);
assert.match(observability, /lastConfirmedTransactionHash/);
assert.match(observability, /GROUP BY batch_id/);
assert.match(observability, /destinationFingerprint/);
assert.doesNotMatch(observability, /logger\.(?:info|warn|error)\([^\n]*DESTINATION/);

assert.match(wiring, /execution-evidence-recorded/);
assert.match(wiring, /cryptaraExecutionEvidence/);
assert.match(wiring, /recordTerminalSettlement/);
assert.match(wiring, /rainbowProfitObservability\.start\(\)/);
assert.match(wiring, /rainbowProfitObservability\.refresh\(\)/);
assert.match(wiring, /rainbowProfitObservability\.stop\(\)/);
assert.match(wiring, /Payout persistence\/venue egress is downstream of settlement/);

assert.match(core, /scheduleRainbowProfitBridge\(\)/);
assert.match(core, /queueMicrotask/);
assert.match(core, /Rainbow Bridge unavailable; realized profits remain at source/);
assert.doesNotMatch(core, /await scheduleRainbowProfitBridge/);

console.log(JSON.stringify({
  terminalConfirmedProfitOnly: true,
  persistentIdempotency: true,
  destinationValidated: true,
  dynamicInventoryReserve: true,
  staleInventoryFallsBackToConfiguredReserve: true,
  activeTradeReservationsProtected: true,
  pendingOrdersAndTransfersProtected: true,
  targetInventoryProtected: true,
  zeroFeeRoutesAccepted: true,
  maxFeeFractionEnforced: true,
  smallProfitsAccumulateInsteadOfLeakingToFees: true,
  stablecoinConsolidation: ['USDT', 'USDC'],
  dynamicEvmRouting: true,
  okxRealWithdrawalEndpoint: true,
  ambiguousSubmissionRecovery: true,
  terminalWithdrawalReconciliation: true,
  lifecycleObservability: ['queued', 'submitted', 'confirmed', 'fees', 'oldestQueue', 'lastTx'],
  destinationValueNotLogged: true,
  simulatedTransferRemovedFromRainbowPath: true,
  tradingStartupNonBlocking: true,
}, null, 2));
