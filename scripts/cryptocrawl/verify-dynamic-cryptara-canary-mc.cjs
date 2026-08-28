const fs = require('node:fs');
const assert = require('node:assert/strict');

const controller = fs.readFileSync('server/services/cryptocrawl/execution/cryptara-dynamic-canary-controller.ts', 'utf8');
const maker = fs.readFileSync('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts', 'utf8');
const policy = fs.readFileSync('server/services/cryptocrawl/validation/monte-carlo-policy.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts', 'utf8');
const execution = fs.readFileSync('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts', 'utf8');

// Capital sizing must be continuous and evidence-driven, not a fixed tier table.
assert.match(controller, /CRYPTO_ARBITRAGE_MAKER_CANARY_BOOTSTRAP_USD', 1/);
assert.match(controller, /CRYPTO_ARBITRAGE_MAKER_CANARY_MAX_USD', 1_000_000/);
assert.match(controller, /Math\.exp\(Math\.log\(Math\.max\(1, input\.maximumMultiplier\)\) \* quality\)/);
assert.match(controller, /settlementConfirmed === true/);
assert.match(controller, /realizedProfitUsd/);
assert.match(controller, /drawdownPenalty/);
assert.doesNotMatch(maker, /PROOF_CAPS_USD/);
assert.match(maker, /getCryptaraDynamicMakerCanaryDecision/);
assert.match(maker, /canaryConfidenceScore/);
assert.match(maker, /takerFallbackAllowed: false/);

// Monte Carlo iteration depth is computed per opportunity from uncertainty,
// edge proximity, capital size, freshness, calibration and topology risk.
assert.match(policy, /adaptiveSimulationDepth/);
assert.match(policy, /boundaryPressure/);
assert.match(policy, /capitalPressure/);
assert.match(policy, /calibrationDeficit/);
assert.match(policy, /ttlPressure/);
assert.match(policy, /dynamicMin/);
assert.match(policy, /dynamicTarget/);
assert.match(policy, /dynamicMax/);
assert.match(policy, /dynamicBatch/);
assert.match(policy, /shouldEscalateMonteCarlo/);

// Existing maker execution guarantees remain unchanged.
assert.match(execution, /createPostOnlyMakerAdapters/);
assert.match(execution, /takerFallbackAllowed: false/);
assert.match(wiring, /cryptaraMonteCarloRequired: true/);
assert.match(wiring, /monteCarloDepth: 'opportunity_adaptive_early_stop'/);

console.log(JSON.stringify({
  makerCanary: '$1-to-$1M continuous evidence-driven ceiling',
  cryptaraCapitalController: true,
  monteCarloDepth: 'dynamic per opportunity',
  earlyStopping: true,
  postOnly: true,
  takerFallback: false,
  fixedSizingTiersRemoved: true,
}, null, 2));
