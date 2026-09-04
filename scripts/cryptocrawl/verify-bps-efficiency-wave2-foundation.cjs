const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const health = read('server/services/cryptocrawl/intelligence/cex-order-control-health.ts');
const maker = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');
const calibration = read('server/services/cryptocrawl/intelligence/maker-terminal-calibration.ts');
const resilience = read('server/services/cryptocrawl/intelligence/liquidity-resilience.ts');
const queueJump = read('server/services/cryptocrawl/intelligence/maker-tick-queue-optimizer.ts');
const matrix = read('server/services/cryptocrawl/intelligence/cex-four-mode-matrix.ts');

function must(source, text, label) {
  assert.ok(source.includes(text), `missing invariant: ${label}`);
}
function forbid(source, text, label) {
  assert.ok(!source.includes(text), `forbidden regression: ${label}`);
}

must(health, 'outsideGatewayP95Ms', 'client-minus-gateway residual latency telemetry');
must(health, 'submitP95Ms', 'operation-specific submit p95 telemetry');
must(health, 'economicBpsAuthority: false', 'order-control telemetry cannot fabricate BPS');
must(health, 'It is intentionally NOT labeled matching-', 'latency decomposition does not mislabel residual as engine latency');

must(maker, 'recordMakerTerminalCalibration', 'terminal maker outcomes feed calibration');
must(maker, 'rpiPxRound: true', 'OKX RPI spacing race uses safe outward exchange normalization');
must(maker, 'OKX_RPI_REJECT_FEE_WORSENED', 'RPI fee worsening still fails closed');
must(maker, 'There is no silent downgrade', 'RPI never silently downgrades to different planned economics');

must(calibration, 'terminalOrderIds', 'terminal calibration is deduplicated by order id');
must(calibration, 'sampleCount < 3', 'cold calibration cannot immediately distort maker probabilities');
must(calibration, "authority: 'realized_terminal_maker_calibration_only'", 'calibration authority is terminal evidence only');
must(calibration, 'executionAuthority: false', 'calibration does not own execution');
must(calibration, 'economicBpsAuthority: false', 'calibration does not own canonical BPS');

must(resilience, 'refillRatePerSecondEwma', 'measured refill resilience');
must(resilience, 'depletionRatePerSecondEwma', 'measured depletion resilience');
must(resilience, "authority: 'measured_liquidity_resilience_advisory_only'", 'resilience is advisory only');

must(queueJump, 'one_tick_non_marketable_queue_jump_available', 'queue jump remains non-marketable');
must(queueJump, 'expectedQueueValueBps', 'queue-jump value is exposed for ranking');
must(queueJump, 'economicBpsAuthority: false', 'queue-jump estimate cannot become canonical BPS directly');

must(matrix, 'calibrateMakerFillProbability', 'four-mode matrix consumes terminal calibration');
must(matrix, 'observeLiquidityResilience', 'four-mode matrix consumes replenishment resilience');
must(matrix, 'evaluateMakerTickQueueJump', 'four-mode matrix consumes tick/queue valuation');
must(matrix, 'netAfterExchangeFeesBps = grossSpreadBps - combinedFeeBps', 'canonical observed fee gap remains measured spread minus authenticated fees');
must(matrix, 'executionAuthority: false', 'enhanced matrix remains advisory');
forbid(matrix, 'netAfterExchangeFeesBps = grossSpreadBps - combinedFeeBps + makerQueueJumpValueBps', 'queue estimate injected into measured BPS');

console.log('[bps-efficiency-wave2-foundation] PASS: realized maker calibration, measured liquidity resilience, non-marketable queue-jump ranking, RPI outward spacing normalization, and decomposed order-control telemetry are wired without creating BPS or execution authority');
