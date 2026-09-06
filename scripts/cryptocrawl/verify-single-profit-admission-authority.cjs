const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const authority = read('server/services/cryptocrawl/governance/profit-admission-authority.ts');
const planner = read('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts');
const europa = read('server/services/cryptocrawl/execution/adapters/europa-dynamic-route-discovery.ts');
const dex = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');
const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const sizing = read('server/services/cryptocrawl/risk/progressive-position-sizing.ts');
const adaptive = read('server/services/cryptocrawl/runtime/adaptive-profit-operations-wiring.ts');
const inventory = read('server/services/cryptocrawl/integration/inventory-constrained-cex-execution-wiring.ts');
const positiveCapture = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');
const liveCycle = read('server/services/cryptocrawl/testing/run-arbitrage-live-cycles.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const zeroCapitalEngine = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const cryptara = read('server/services/cryptara/index.ts');
const envExample = read('.env.example');
const envRailwayExample = read('.env.railway.example');
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

// Canonical CEX verifier cannot accept a caller-provided profit floor.
assert.match(verifier, /profit-admission-authority\.js/);
assert.match(verifier, /isStrictlyPositiveAllInNetProfit\(plan\.netProfitUsd\)/);
assert.ok(!verifier.includes('minNetProfitUsd'), 'CEX verifier must not expose a second dollar-profit threshold');
assert.ok(!verifier.includes('CRYPTO_ARBITRAGE_MIN_NET_PROFIT_USD'), 'CEX verifier must not expose an environment profit floor');

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
assert.equal((europa.match(/minimumProfitBps/g) || []).length, 1, 'Europa may reference the canonical minimum-profit BPS telemetry exactly once');

// 0x atomic execution must not scale minProfit from expected profit or an environment setting.
assert.match(dex, /profit-admission-authority\.js/);
assert.match(dex, /const canonicalMinProfit = BigNumber\.from\(minimumPositiveProfitBaseUnits\(\)\.toString\(\)\)/);
assert.match(dex, /minProfit: canonicalMinProfit/);
assert.match(dex, /isStrictlyPositiveAllInNetProfit\(plan\.deterministicNetProfitUsd\)/);
assert.ok(!dex.includes('ZERO_CAPITAL_MIN_PROFIT_BPS'), '0x atomic execution must not contain a configurable profit magnitude floor');
assert.ok(!dex.includes('deterministicNetBaseUnits.mul(minProfitBps)'), '0x atomic execution must not convert expected profit into a second threshold');

// Shared position sizing and runtime CEX wrappers consume the same profitability authority.
for (const [name, source] of [
  ['position sizing', sizing],
  ['adaptive operations', adaptive],
  ['inventory constrained CEX', inventory],
]) {
  assert.match(source, /profit-admission-authority\.js/, `${name} must import canonical profit admission`);
  assert.match(source, /isStrictlyPositiveAllInNetProfit/, `${name} must consume canonical positive-profit predicate`);
  assert.ok(!source.includes('minNetProfitUsd'), `${name} must not pass or own a local minimum-profit amount`);
}

// The former positive-profit runtime patch may still compose route recovery, but
// it may not override verifier admission or Cryptara minimum-profit policy.
assert.match(positiveCapture, /profit-admission-authority\.js/);
assert.match(positiveCapture, /profitAdmissionRuntimeOverride: false/);
assert.match(positiveCapture, /cryptaraMinimumProfitOverride: false/);
assert.ok(!positiveCapture.includes('verifier.verifyOnce = async'), 'runtime wiring must not replace canonical verifier profit admission');
assert.ok(!positiveCapture.includes('minimumNetProfitUsd: 0'), 'runtime wiring must not patch a second minimum-profit policy');

// Cryptara may retain zero-valued advisory compatibility telemetry, but execution
// is forbidden from consuming that field as an admission condition or threshold.
assert.match(cryptara, /minimumNetProfitUsd: 0/);
assert.ok(!/directive\.minimumNetProfitUsd\s*[<>]=?/.test(zeroCapitalEngine), 'zero-capital execution must never gate on Cryptara advisory minimum-profit telemetry');
assert.ok(!/minimumNetProfitUsd\s*[<>]=?/.test(positiveCapture), 'runtime composition must never gate on Cryptara advisory minimum-profit telemetry');

// Quotes-only live-cycle tooling follows the same rule and cannot introduce a test-only floor.
assert.match(liveCycle, /isStrictlyPositiveAllInNetProfit\(plan\.netProfitUsd\)/);
assert.ok(!liveCycle.includes('CRYPTO_ARBITRAGE_MIN_NET_PROFIT_USD'), 'live-cycle harness must not advertise a separate profit floor');
assert.ok(!liveCycle.includes('minNetProfitUsd'), 'live-cycle harness must not calculate a separate profit floor');

// Deployment configuration cannot resurrect retired strategy-local profit floors.
for (const [name, source] of [['.env.example', envExample], ['.env.railway.example', envRailwayExample]]) {
  for (const forbidden of [
    'ZERO_CAPITAL_MIN_PROFIT_BPS',
    'ZERO_CAPITAL_EUROPA_MIN_PROFIT_BPS',
    'CRYPTO_ARBITRAGE_MIN_NET_PROFIT_USD',
  ]) {
    assert.ok(!source.includes(forbidden), `${name} must not expose retired profit-floor variable ${forbidden}`);
  }
  assert.match(source, /Profit admission is non-configurable: complete measured all-in net profit must be > 0\./);
}

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

console.log('[single-profit-admission-authority] PASS: one non-configurable >0 all-in-net-profit authority; no live dollar/BPS magnitude floor; no runtime profit patch; deployment templates cannot resurrect retired floors; advisory compatibility telemetry has no execution authority; atomic minProfit is one smallest base unit; legacy threshold engines remain non-production');
