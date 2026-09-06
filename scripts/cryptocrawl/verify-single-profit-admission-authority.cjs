const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const authority = read('server/services/cryptocrawl/governance/profit-admission-authority.ts');
const planner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const europa = read('server/services/cryptocrawl/execution/adapters/europa-dynamic-route-discovery.ts');
const dex = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');
const sizing = read('server/services/cryptocrawl/risk/progressive-position-sizing.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const capitalFreeBarrel = read('server/services/cryptocrawl/capital-free/index.ts');
const optimizationBarrel = read('server/services/cryptocrawl/optimization/index.ts');

// One non-configurable authority: mathematical positivity after complete all-in economics.
assert.match(authority, /rule: 'strictly_positive_verified_all_in_net_profit'/);
assert.match(authority, /minimumProfitUsd: 0/);
assert.match(authority, /minimumProfitBps: 0/);
assert.match(authority, /configurableMagnitudeFloorAllowed: false/);
assert.match(authority, /strategySpecificProfitFloorAllowed: false/);
assert.match(authority, /parsed !== null && parsed > 0/);
assert.match(authority, /return 1n/);
assert.ok(!authority.includes('process.env'), 'profit admission authority must never be environment-configurable');

// Atomic route planning uses exactly one smallest base unit as the integer form of >0.
assert.match(planner, /profit-admission-authority\.js/);
assert.match(planner, /minimumPositiveProfitBaseUnits\(\)\.toString\(\)/);
assert.ok(!planner.includes('ZERO_CAPITAL_MIN_PROFIT_BPS'), 'autonomous planner must not contain a separate profit BPS authority');
assert.ok(!planner.includes('minProfitBps'), 'autonomous planner must not accept a strategy-specific profit-floor option');

// Europa uses the same authority and no local BPS gate.
assert.match(europa, /profit-admission-authority\.js/);
assert.match(europa, /isStrictlyPositiveProfitBaseUnits\(netProfit\)/);
assert.match(europa, /minNetProfitBps: PROFIT_ADMISSION_POLICY\.minimumProfitBps/);
assert.ok(!europa.includes('ZERO_CAPITAL_EUROPA_MIN_PROFIT_BPS'), 'Europa must not expose a separate profit-floor environment variable');
assert.ok(!europa.includes('minimumProfitBps'), 'Europa must not calculate a local minimum-profit BPS');

// 0x atomic execution must not scale minProfit from expected profit or an environment setting.
assert.match(dex, /profit-admission-authority\.js/);
assert.match(dex, /const canonicalMinProfit = BigNumber\.from\(minimumPositiveProfitBaseUnits\(\)\.toString\(\)\)/);
assert.match(dex, /minProfit: canonicalMinProfit/);
assert.match(dex, /isStrictlyPositiveAllInNetProfit\(plan\.deterministicNetProfitUsd\)/);
assert.ok(!dex.includes('ZERO_CAPITAL_MIN_PROFIT_BPS'), '0x atomic execution must not contain a configurable profit magnitude floor');
assert.ok(!dex.includes('deterministicNetBaseUnits.mul(minProfitBps)'), '0x atomic execution must not convert expected profit into a second threshold');

// Shared position sizing consumes the same profitability authority; sizing/risk can cap exposure but not raise the profit floor.
assert.match(sizing, /profit-admission-authority\.js/);
assert.match(sizing, /isStrictlyPositiveAllInNetProfit\(request\.expectedNetProfitUsd\)/);

// The compatibility BPS field is telemetry-only. Executable route economics remain strict netProfit > 0.
assert.match(quoter, /telemetry only; executable eligibility is strict all-in netProfit > 0/);
assert.match(quoter, /executablePositive: netProfit > 0n/);
assert.match(dynamicRoutes, /minNetProfitBps: 0/);
assert.ok(!/netProfitBps\s*[<>]=?\s*route\.minNetProfitBps/.test(quoter), 'deprecated minNetProfitBps telemetry must never gate execution');

// Historical/demo optimizers may remain source history, but cannot re-enter production authority barrels.
for (const token of ['AutonomousOptimizer', 'NexGenProtocolLayer']) {
  assert.ok(!capitalFreeBarrel.includes(token), `${token} must remain outside the production capital-free namespace`);
}
assert.ok(!optimizationBarrel.includes('DivineOptimizationEngine'), 'DivineOptimizationEngine must remain outside the production optimization namespace');

console.log('[single-profit-admission-authority] PASS: one non-configurable >0 all-in-net-profit authority; no live dollar/BPS magnitude floor; atomic minProfit is one smallest base unit; legacy threshold engines remain non-production');
