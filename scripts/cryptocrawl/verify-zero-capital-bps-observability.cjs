'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const quoterPath = path.join(root, 'server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const enginePath = path.join(root, 'server/services/cryptocrawl/core/zero-capital-engine.ts');

const quoter = fs.readFileSync(quoterPath, 'utf8');
const engine = fs.readFileSync(enginePath, 'utf8');

function requireSource(source, fragment, description) {
  if (!source.includes(fragment)) {
    throw new Error(`Missing invariant: ${description}`);
  }
}

requireSource(quoter, 'ZERO_CAPITAL_DISCOVERY_FLOOR_BPS ?? -100', 'default zero-capital observation floor is -100 BPS');
requireSource(quoter, 'Math.max(-500, Math.min(0, Math.trunc(configured)))', 'discovery floor is bounded and cannot become a positive execution threshold');
requireSource(quoter, 'if (netProfitBps < discoveryFloorBps) return null;', 'quotes outside the bounded observation envelope are discarded');
requireSource(quoter, 'executablePositive: netProfit > 0n', 'quote exposes strict executable-positive state');
requireSource(quoter, 'grossProfitBps', 'gross BPS is exposed');
requireSource(quoter, 'allInCostBps', 'all-in cost BPS is exposed');
requireSource(quoter, 'breakEvenBps', 'break-even BPS is exposed');
requireSource(quoter, 'bpsToBreakEven', 'distance-to-break-even BPS is exposed');
requireSource(quoter, 'const selectionPool = admissible.length > 0 ? admissible : observed;', 'positive executable sizing is preferred while near misses remain observable');

requireSource(engine, 'if (opportunity.expectedProfit <= 0n || Date.now() > opportunity.expiresAt) continue;', 'non-positive zero-capital opportunities cannot enter execution queue');
requireSource(engine, 'netProfitBps: opportunity.netProfitBps', 'zero-capital net BPS is recorded into profit telemetry');

console.log('PASS verify-zero-capital-bps-observability');
console.log(JSON.stringify({
  discoveryFloorBps: -100,
  executionFloor: 'strict netProfit > 0',
  bpsTelemetry: ['grossProfitBps', 'allInCostBps', 'breakEvenBps', 'netProfitBps', 'bpsToBreakEven'],
}, null, 2));
