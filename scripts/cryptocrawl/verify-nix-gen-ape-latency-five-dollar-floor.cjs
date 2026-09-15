'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const has = (source, needle, message) => assert.ok(source.includes(needle), message);
const before = (source, first, second, message) => {
  const a = source.indexOf(first);
  const b = source.indexOf(second);
  assert.ok(a >= 0, `${message}: missing first marker ${first}`);
  assert.ok(b >= 0, `${message}: missing second marker ${second}`);
  assert.ok(a < b, message);
};
const collectTsFiles = relative => {
  const absolute = path.join(root, relative);
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...collectTsFiles(child));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(child.replaceAll('\\', '/'));
  }
  return files;
};

const floor = read('server/services/cryptocrawl/integration/zero-capital-profit-output-floor.ts');
const stageOne = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const fair = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const v4 = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v4.ts');
const split = read('server/services/cryptocrawl/integration/zero-capital-route-split-rescue.ts');
const merit = read('server/services/cryptocrawl/integration/ape-adaptive-command.ts');
const prices = read('server/services/cryptocrawl/bridge/live-price-mesh.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const barrier = read('server/services/cryptocrawl/integration/zero-capital-dynamic-attempt-barrier-wiring.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const resources = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');

// One explicit monetary output authority. It is Stage-2/execution-only.
has(floor, 'export const ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = 5;', '$5 output floor constant missing');
has(floor, 'needsApeRescueForFiveDollarOutput', 'APE $5 ownership helper missing');
has(floor, 'requiredProfitBaseUnitsForFiveDollarOutput', 'base-unit $5 conversion helper missing');

// Locked Stage 1 must remain exactly its own discovery authority and must not import the $5 floor.
has(stageOne, 'STAGE_ONE_LOCKED_INVARIANT', 'Stage-1 lock marker missing');
has(stageOne, 'STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10', 'Stage-1 locked -10 BPS floor changed');
assert.ok(!stageOne.includes('zero-capital-profit-output-floor'), 'Stage 1 must not import the $5 output floor');
assert.ok(!stageOne.includes('ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD'), 'Stage 1 must not own the $5 output floor');

// APE ownership and finish-line semantics.
has(fair, 'positiveBelowFiveDollarsRemainsApeOwned: true', 'positive-but-under-$5 ownership missing');
has(fair, 'recursiveStopsAtFiveDollarOutputPerCandidate: true', '$5 APE stop condition missing');
has(fair, 'pricePrewarmAwaitedOnHotPath: false', 'price prewarm must remain nonblocking');
has(fair, 'unavailableCompositeConsumesHotPathTime: false', 'unavailable composite must not consume APE hot-path time');
has(v4, 'fiveDollarOutputRequiredBeforeApeStop: true', 'V4 may stop before $5');
has(v4, 'positiveBelowFiveDollarsContinuesRefinement: true', 'V4 must continue refining positive-but-under-$5 candidates');
has(v4, 'clearsFiveDollarOutputFloor(current)', 'V4 $5 current-candidate stop gate missing');

// Price and split latency: resident first, per-symbol singleflight, zero waiting on split price misses.
has(prices, 'symbolRefreshInFlight', 'per-symbol price singleflight missing');
has(prices, 'backgroundNearExpiryRefresh: true', 'resident near-expiry price refresh missing');
has(prices, 'hotPathWaitForResidentHit: false', 'resident price hits must not wait');
has(split, 'fresh_input_price_refresh_pending_zero_wait', 'zero-wait split price fallback missing');
has(split, 'missingPriceWaitsOnHotPath: false', 'route split may wait for price on hot path');

// Merit intelligence must improve speed by being resident/local rather than another network stage.
has(merit, 'candidateAndTacticMeritSeparated: true', 'candidate/tactic merit separation missing');
has(merit, 'promotionHysteresisWithinEvidenceGeneration: true', 'promotion hysteresis missing');
has(merit, 'localLatencyOutlierDeprioritization: true', 'local latency outlier deprioritization missing');
has(merit, 'stickyWinningTacticAffinity: true', 'sticky winning-tactic affinity missing');
has(merit, 'cachedCounterfactualPlanning: true', 'cached counterfactual planning missing');
assert.ok(!merit.includes('fetch(') && !merit.includes('axios') && !merit.includes('supabase'), 'merit controller must not add network/persistence hot-path work');

// Composite must fail in memory if no proven configured receiver exists and only promote >= $5.
has(stack, 'configuredCompositeReceiver(input.chain)', 'composite receiver fail-fast gate missing');
has(stack, 'missingCompositeReceiverFailsBeforeRpc: true', 'composite zero-I/O capability telemetry missing');
has(stack, 'requiredProfitBaseUnitsForFiveDollarOutput', 'composite $5 base-unit target missing');
has(stack, 'if (!clearsFiveDollarOutputFloor(opportunity, measuredAt)) return null;', 'composite may expose an under-$5 measured opportunity');

// Unified routing must keep positive-but-under-$5 ZERO_CAPITAL candidates in reacquisition/APE instead of admission.
has(router, 'ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD', 'unified router does not import the canonical $5 output authority');
has(router, 'deterministicNet >= ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD', 'unified router can admit ZERO_CAPITAL below $5');
has(router, 'reacquire:atomic_minimum_output_profit_not_met', 'under-$5 ZERO_CAPITAL reacquisition reason missing');

// Resource admission must fail in memory before gas decision, database leases, or scarce resource claims.
has(resources, 'clearsFiveDollarOutputFloor', 'resource scheduler $5 gate missing');
before(
  resources,
  'if (!clearsFiveDollarOutputFloor(opportunity)) return null;',
  'const gasDecision = await strictCanonicalGasDecision(opportunity.chain);',
  '$5 resource gate must precede gas-decision I/O',
);

// Pre-broadcast barrier must reject locally before gas-funding/network work.
has(barrier, 'evaluateFiveDollarOutputFloor(opportunity, observedAt)', 'pre-broadcast $5 assertion missing');
before(
  barrier,
  'const outputFloor = evaluateFiveDollarOutputFloor(opportunity, observedAt);',
  'const funding = await context.getGasFundingDecision(opportunity.chain);',
  '$5 pre-broadcast economics must be checked before gas-funding I/O',
);
has(barrier, 'economicFloorCheckedBeforeFundingIo: true', 'barrier latency invariant telemetry missing');

// Scheduler must fail zero-capital candidates before operator reservation/database work.
const dispatchStart = scheduler.indexOf('private async dispatchMeasuredTopologies');
const dispatchEnd = scheduler.indexOf('private maintainLifecycleLanes', dispatchStart);
assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart, 'scheduler measured-topology dispatch body missing');
const dispatchBody = scheduler.slice(dispatchStart, dispatchEnd);
before(
  dispatchBody,
  'clearsFiveDollarOutputFloor(opportunity)',
  'const reservation = await this.reserveOperatorTrade',
  '$5 ZERO_CAPITAL gate must precede operator reservation',
);
has(scheduler, 'zeroCapitalFloorCheckedBeforeOperatorReservation: true', 'scheduler floor-order telemetry missing');

// Sole canonical execution entrypoint reasserts $5 before every flash/alternative/composite path.
has(executor, 'const floor = evaluateFiveDollarOutputFloor(opportunity, startedAt);', 'canonical executor $5 assertion missing');
before(
  executor,
  'const floor = evaluateFiveDollarOutputFloor(opportunity, startedAt);',
  'void observeDailyProfitBudget(opportunity);',
  '$5 execution assertion must precede telemetry/provider/path work',
);
has(executor, 'minimum_output_profit_usd:${ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD}', 'prepared-composite $5 provenance missing');

// The lower-level flash executor intentionally has no duplicate hot-path floor computation.
// Enforce structurally that production code can reach it only through the already-gated canonical executor.
const flashImporters = collectTsFiles('server/services/cryptocrawl')
  .filter(relative => read(relative).includes("zero-capital-flash-canonical-executor.js"));
assert.deepEqual(
  flashImporters,
  ['server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts'],
  'lower-level flash executor gained a caller that can bypass the canonical $5 gate',
);

console.log('[ape-latency-five-dollar-floor] PASS: Stage 1 remains locked; APE keeps sub-$5 candidates; $5 is enforced at unified admission, resource admission, scheduling, pre-broadcast, and the sole canonical execution entrypoint without duplicate hot-path work');
