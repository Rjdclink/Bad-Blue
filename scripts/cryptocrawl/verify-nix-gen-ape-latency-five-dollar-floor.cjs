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
const merit = read('server/services/cryptocrawl/integration/ape-adaptive-command.ts');
const lease = read('server/services/cryptocrawl/integration/ape-profitable-snapshot-lease.ts');
const prices = read('server/services/cryptocrawl/bridge/live-price-mesh.ts');
const split = read('server/services/cryptocrawl/integration/zero-capital-route-split-rescue.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const barrier = read('server/services/cryptocrawl/integration/zero-capital-dynamic-attempt-barrier-wiring.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const resources = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');

// One canonical ZERO_CAPITAL execution threshold: strictly greater than zero.
has(floor, 'ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = Number.MIN_VALUE', 'strict-positive USD sentinel missing');
has(floor, 'ZERO_CAPITAL_STRICT_POSITIVE_MIN_BASE_UNITS = 1n', 'strict-positive base-unit threshold missing');
has(floor, 'opportunity.expectedProfit >= requiredProfitBaseUnits', 'base-unit strict-positive decision missing');
has(floor, 'export function clearsStrictPositiveOutputThreshold', 'canonical strict-positive predicate missing');
has(floor, 'export function needsApeOptimization', 'threshold-independent APE ownership predicate missing');
has(floor, 'clearsFiveDollarOutputFloor = clearsStrictPositiveOutputThreshold', 'compatibility alias must resolve to strict-positive authority');
has(floor, 'export function requiredProfitBaseUnitsForFiveDollarOutput', 'legacy base-unit helper signature missing');
has(floor, 'return requiredStrictPositiveProfitBaseUnits(opportunity)', 'legacy base-unit helper must resolve to strict-positive authority');
assert.ok(!floor.includes('ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD = 5'), 'hard $5 threshold reintroduced');

// Stage 1 remains locked and does not import Stage-2/execution threshold authority.
has(stageOne, 'STAGE_ONE_LOCKED_INVARIANT', 'Stage-1 lock marker missing');
has(stageOne, 'STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10', 'Stage-1 locked -10 BPS floor changed');
assert.ok(!stageOne.includes('zero-capital-profit-output-floor'), 'Stage 1 must not import output threshold authority');
assert.ok(!stageOne.includes('ape-profitable-snapshot-lease'), 'Stage 1 must remain independent from APE lease state');

// Above-zero is acceptance, never the APE stop signal.
has(fair, 'strictPositiveIsExecutionEligible: true', 'strict-positive execution eligibility telemetry missing');
has(fair, 'strictPositiveStopsApeOptimization: false', 'Fair may stop APE merely at positive profit');
has(fair, 'optimizationStopsOnCandidateLocalMeasuredExhaustionOrDeadline: true', 'candidate-local exhaustion stop authority missing');
has(fair, 'candidateLocalRunToCompletion: true', 'candidate-local run-to-completion missing');
has(fair, 'structuralSiblingBarrierBeforeV4: false', 'cross-candidate structural/V4 barrier remains');
has(fair, 'crossCandidateProfitabilityStop: false', 'ordinary profitability can stop siblings');
has(fair, 'staleGenerationResultsDiscarded', 'stale-generation discard telemetry missing');
has(v4, 'strictPositiveAcceptanceThresholdIsNotApeStop: true', 'V4 still conflates acceptance with stopping');
has(v4, 'candidateLocalRunToCompletion: true', 'V4 candidate-local scheduler missing');
has(v4, 'crossCandidateWinnerStops: 0', 'V4 cross-candidate winner stop remains');
has(v4, 'mapConcurrentCandidateLocal', 'V4 unordered candidate-local concurrency missing');
assert.ok(!v4.includes('passWinnerFound'), 'global pass winner authority reintroduced');
assert.ok(!v4.includes('clearsFiveDollarOutputFloor'), 'V4 must not use an execution threshold as an optimization stop');

// Route split and shared-principal stack also continue after first profitability.
has(split, 'strictPositiveStopsRouteSplitOptimization: false', 'route split stops at strict-positive execution eligibility');
has(split, 'promotedCompositeStopsRemainingSplitSearch: false', 'route split stops after the first promoted composite');
assert.ok(!split.includes("'already_five_dollar_output'"), 'route split still rejects already-positive candidates through the old finish gate');
assert.ok(!split.includes("'resident_five_dollar_output_replaced_split_work'"), 'resident positive improvement still terminates split work');
has(stack, 'requiredStrictPositiveProfitBaseUnits', 'composite must use the canonical strict-positive base-unit authority');
has(stack, 'clearsStrictPositiveOutputThreshold', 'composite must use canonical strict-positive admission');
has(stack, 'firstPositiveStopsVariantSearch: false', 'first profitable composite still stops bounded variant optimization');
has(stack, 'firstPromotionStopsSiblingGroups: false', 'one profitable group still cancels sibling groups');
has(stack, 'bestMeasuredProfitableVariantSelected: true', 'composite does not retain the best bounded measured variant');
assert.ok(!stack.includes('if (settled.result.promoted > 0) return aggregate'), 'composite sibling-group early return reintroduced');

// Candidate identity/generation has one synchronous in-memory authority.
has(merit, 'export function getApeCandidateGeneration', 'candidate generation authority missing');
has(merit, 'export function isCurrentApeCandidateGeneration', 'stale generation guard missing');
has(merit, 'staleGenerationCannotRollBackAuthority: true', 'monotonic generation invariant missing');
has(merit, 'synchronousCandidateStateAuthority: true', 'single synchronous state authority missing');
has(merit, "retirementAuthority: 'candidate_local_measured_tactic_exhaustion_only'", 'retirement still threshold-driven');
has(merit, 'strictPositiveStopsOptimization: false', 'merit authority stops at positive');
assert.ok(!merit.includes('if (clearsFiveDollarOutputFloor(root)) return false'), 'profit threshold still controls retirement');
assert.ok(!merit.includes('fetch(') && !merit.includes('axios') && !merit.includes('supabase'), 'candidate authority added network/persistence latency');

// Best-proven snapshot + shadow freshness lease are resident O(1) decisions.
has(lease, 'bestProfit: ZeroCapitalOpportunity', 'best profitable snapshot pointer missing');
has(lease, 'freshestPositive: ZeroCapitalOpportunity', 'fresh positive shadow pointer missing');
has(lease, 'export function observeApeProfitableSnapshot', 'snapshot observation authority missing');
has(lease, 'export function capApeOptimizationDeadline', 'execute-before-expiry deadline cap missing');
has(lease, "mode: 'dispatch_now'", 'dispatch-now lease state missing');
has(lease, "storageAuthority: 'resident_candidate_local_pointer_only'", 'lease must remain resident pointer state');
has(lease, 'persistenceOnHotPath: false', 'lease added persistence to hot path');
has(lease, 'networkIoOnDecisionPath: false', 'lease added network I/O to decision path');
has(lease, 'staleEvidenceExtended: false', 'lease may not extend stale evidence');
has(lease, 'bestSnapshotOverwriteByWorseAttempt: false', 'worse optimization may overwrite profitable fallback');
has(fair, 'bestProvenSnapshotResident: true', 'Fair does not expose best-proven snapshot behavior');
has(fair, 'shadowExecutionLease: true', 'Fair shadow execution lease missing');
has(fair, 'rollingFreshnessLease: true', 'rolling freshness lease missing');
has(fair, 'executeBeforeExpiry: true', 'execute-before-expiry escape missing');
has(fair, 'profitEscapeCanPreemptRemainingOptimization: true', 'expiry escape cannot preempt optional optimization');
has(fair, 'staleEvidenceExpiryExtended: false', 'Fair may extend stale evidence instead of refreshing it');
has(fair, 'return output;', 'Fair must return the preserved best executable snapshot set');

// Price and route-split latency improvements remain resident/nonblocking.
has(prices, 'symbolRefreshInFlight', 'per-symbol price singleflight missing');
has(prices, 'backgroundNearExpiryRefresh: true', 'resident near-expiry refresh missing');
has(split, 'fresh_input_price_refresh_pending_zero_wait', 'zero-wait split price fallback missing');
has(split, 'missingPriceWaitsOnHotPath: false', 'split price miss can block the hot path');

// Existing execution gates still consume the canonical alias, whose semantics are now > 0.
has(router, 'ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD', 'unified router lost canonical threshold');
has(resources, 'clearsFiveDollarOutputFloor', 'resource scheduler lost canonical threshold alias');
has(barrier, 'evaluateFiveDollarOutputFloor(opportunity, observedAt)', 'pre-broadcast threshold assertion missing');
has(scheduler, 'clearsFiveDollarOutputFloor(opportunity)', 'scheduler threshold assertion missing');
has(executor, 'evaluateFiveDollarOutputFloor(opportunity, startedAt)', 'canonical executor threshold assertion missing');

// Gates remain before scarce/I/O work.
before(resources, 'if (!clearsFiveDollarOutputFloor(opportunity)) return null;', 'const gasDecision = await strictCanonicalGasDecision(opportunity.chain);', 'resource threshold must precede gas decision I/O');
before(barrier, 'const outputFloor = evaluateFiveDollarOutputFloor(opportunity, observedAt);', 'const funding = await context.getGasFundingDecision(opportunity.chain);', 'pre-broadcast economics must precede gas funding I/O');
const dispatchStart = scheduler.indexOf('private async dispatchMeasuredTopologies');
const dispatchEnd = scheduler.indexOf('private maintainLifecycleLanes', dispatchStart);
assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart, 'scheduler measured-topology dispatch body missing');
const dispatchBody = scheduler.slice(dispatchStart, dispatchEnd);
before(dispatchBody, 'clearsFiveDollarOutputFloor(opportunity)', 'const reservation = await this.reserveOperatorTrade', 'ZERO_CAPITAL threshold must precede operator reservation');
before(executor, 'const floor = evaluateFiveDollarOutputFloor(opportunity, startedAt);', 'void observeDailyProfitBudget(opportunity);', 'execution threshold must precede telemetry/provider/path work');

// Lower-level flash execution still has exactly one production caller.
const flashImporters = collectTsFiles('server/services/cryptocrawl')
  .filter(relative => read(relative).includes("zero-capital-flash-canonical-executor.js"));
assert.deepEqual(flashImporters, ['server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts'], 'lower-level flash executor gained a threshold-bypass caller');

console.log('[ape-strict-positive-continuous] PASS: Stage 1 remains locked; strict all-in net > 0 is execution acceptance; APE retains best proven profit, refreshes a shadow generation and releases before expiry while continuing bounded optimization past first profitability');