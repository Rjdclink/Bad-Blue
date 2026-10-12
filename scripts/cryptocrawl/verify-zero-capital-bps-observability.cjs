'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const quoterPath = path.join(root, 'server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const enginePath = path.join(root, 'server/services/cryptocrawl/core/zero-capital-engine.ts');

const quoter = fs.readFileSync(quoterPath, 'utf8');
const engine = fs.readFileSync(enginePath, 'utf8');
const outputFloor = fs.readFileSync(path.join(root, 'server/services/cryptocrawl/integration/zero-capital-profit-output-floor.ts'), 'utf8');

function requireSource(source, fragment, description) {
  if (!source.includes(fragment)) {
    throw new Error(`Missing invariant: ${description}`);
  }
}

requireSource(quoter, 'ZERO_CAPITAL_DISCOVERY_FLOOR_BPS ?? -100', 'default zero-capital observation floor is -100 BPS');
requireSource(quoter, 'Math.max(-500, Math.min(0, Math.trunc(configured)))', 'discovery floor is bounded and cannot become a positive execution threshold');
// Current discovery preserves measured negative economics for BPS rescue.
if (quoter.includes('if (netProfitBps < discoveryFloorBps) return null;')) {
  throw new Error('Measured negative quotes must remain observable for rescue');
}
requireSource(quoter, 'netProfitBps,', 'signed measured BPS remains observable');
requireSource(quoter, 'executablePositive: netProfit > 0n', 'quote exposes strict executable-positive state');
requireSource(quoter, 'grossProfitBps', 'gross BPS is exposed');
requireSource(quoter, 'allInCostBps', 'all-in cost BPS is exposed');
requireSource(quoter, 'breakEvenBps', 'break-even BPS is exposed');
requireSource(quoter, 'bpsToBreakEven', 'distance-to-break-even BPS is exposed');
requireSource(quoter, 'const selectionPool = positive.length > 0 ? positive : observed;', 'positive executable sizing is preferred while near misses remain observable');

requireSource(outputFloor, 'if (opportunity.expiresAt <= now)', 'expired evidence cannot pass the output threshold');
requireSource(outputFloor, 'ZERO_CAPITAL_STRICT_POSITIVE_MIN_BASE_UNITS = 1n', 'execution profitability remains strictly positive');
requireSource(outputFloor, 'opportunity.expectedProfit >= requiredProfitBaseUnits', 'measured base units determine the output threshold');
requireSource(engine, 'netProfitBps: quote.netProfitBps', 'zero-capital net BPS is propagated from measured quotes');

console.log('PASS verify-zero-capital-bps-observability');
console.log(JSON.stringify({
  discoveryFloorBps: -100,
  executionFloor: 'strict netProfit > 0',
  bpsTelemetry: ['grossProfitBps', 'allInCostBps', 'breakEvenBps', 'netProfitBps', 'bpsToBreakEven'],
}, null, 2));
