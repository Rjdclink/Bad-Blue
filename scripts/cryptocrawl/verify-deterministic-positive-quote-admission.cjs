'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts', 'utf8');

// Exact all-in arithmetic remains the profitability truth.
assert.match(source, /const allInCost = flashLoanFee \+ gasCost \+ relayFee/);
assert.match(source, /const netProfit = grossProfit - allInCost/);
assert.match(source, /executablePositive: netProfit > 0n/);
assert.match(source, /const positive = observed\.filter\(quote => quote\.netProfit > 0n\)/);
assert.match(source, /const selectionPool = positive\.length > 0 \? positive : observed/);

// Heuristic position sizing/slippage/liquidity/volatility scoring may not erase
// a fresh deterministic-positive route before canonical provider/resource and
// pre-broadcast validation stages get a chance to prove execution capability.
assert.doesNotMatch(source, /calculateProgressivePositionSize/);
assert.doesNotMatch(source, /executionSizeApproved/);
assert.doesNotMatch(source, /positive\.filter\(quote =>/);
assert.doesNotMatch(source, /stageManager\.canExecuteTrades\(\)/);
assert.doesNotMatch(source, /quoteExpectedSlippageBps/);
assert.doesNotMatch(source, /quoteLiquidityConfidence/);

// Negative routes remain measurable for distance-to-break-even telemetry but are
// never mislabeled executable-positive.
assert.match(source, /bpsToBreakEven: netProfitBps >= 0 \? 0 : Math\.abs\(netProfitBps\)/);
assert.match(source, /positive\.length > 0 \? positive : observed/);

console.log('[deterministic-positive-quote-admission] PASS: exact positive all-in quotes cannot be vetoed by heuristic sizing; negative routes remain measurable only');
