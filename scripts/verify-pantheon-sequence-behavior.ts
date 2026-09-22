import assert from 'node:assert/strict';
import {
  buildPantheonCategoryTargets,
  type PantheonBackgroundCategory,
} from '../server/services/pantheon/PantheonSovereignSourceRegistry';
import {
  categoryProductiveWorkTarget,
  initializePantheonCategoryPlans,
  insertPantheonDiscoveredUrls,
  assessPantheonSourceExecution,
  pantheonUrlWindowBudgetMs,
  PANTHEON_REPORT_CATEGORIES,
  resequencePantheonFrontier,
  sourcePriority,
  type PantheonUrlLedgerEntry,
} from '../server/services/pantheon/PantheonCategoryWorkflow';
import { runPantheonBounded } from '../server/services/pantheon/PantheonBoundedScheduler';
import {
  PANTHEON_CATEGORY_CONCURRENCY_LIMIT,
  PANTHEON_URL_CONCURRENCY_PER_CATEGORY,
} from '../server/services/pantheon/PantheonBoundedScheduler';
import { getPantheonReportDurationMs } from '../shared/pantheonReportConfig';

assert.equal(PANTHEON_REPORT_CATEGORIES.length, 30);
assert.equal(PANTHEON_CATEGORY_CONCURRENCY_LIMIT, 1, 'categories must execute and persist strictly one at a time');
assert.equal(PANTHEON_URL_CONCURRENCY_PER_CATEGORY, 8, 'URL work must use the bounded global throughput window');
const expectedTotals = new Map<number, number>([[1, 1_200], [2, 2_820], [3, 4_500]]);
for (const depth of [1, 2, 3] as const) {
  const target = categoryProductiveWorkTarget(depth);
  assert.equal(target * PANTHEON_REPORT_CATEGORIES.length, expectedTotals.get(depth));
  const plans = initializePantheonCategoryPlans({
    name: 'Jane Example',
    location: 'New York, NY',
    searchDepth: depth,
    budgetMs: getPantheonReportDurationMs(depth),
  });
  assert.equal(plans.length, 30);
  for (const plan of plans) {
    assert.ok(plan.sourcePlan.urls.length >= target, `${plan.label} lacks the selected depth`);
    assert.equal(new Set(plan.sourcePlan.urls).size, plan.sourcePlan.urls.length);
    assert.equal(plan.state, 'pending');
    assert.equal(plan.phase, 'PENDING');
  }
}

assert.ok(sourcePriority('primary') > sourcePriority('secondary'));
assert.ok(sourcePriority('secondary') > sourcePriority('discovery'));
assert.ok(sourcePriority('secondary') > sourcePriority('archive'));

const directRegistryTargets = buildPantheonCategoryTargets(
  'courts' as PantheonBackgroundCategory,
  'Jane Example',
  'New York, NY',
  24,
);
assert.ok(directRegistryTargets.some(target => target.authority === 'primary' && target.transport !== 'search-provider'),
  'each category must include direct, policy-admitted registry sources');
assert.ok(directRegistryTargets.some(target => target.authority === 'discovery' && target.subjectScoped),
  'discovery must remain a subject-scoped fallback rather than the only frontier');

const subjectFirstPlan = initializePantheonCategoryPlans({
  name: 'Jane Example',
  location: 'New York, NY',
  searchDepth: 1,
  budgetMs: getPantheonReportDurationMs(1),
})[0];
assert.ok(!/bing\.com\/search|duckduckgo\.com\/html/.test(subjectFirstPlan.sourcePlan.urls[0] || ''),
  'a direct registry source must lead the category frontier');
assert.ok(
  subjectFirstPlan.sourcePlan.urls.some(url => !/bing\.com\/search|duckduckgo\.com\/html/.test(url)),
  'the persisted frontier must contain an independent direct-source path',
);

const sourceOutcomeAt = new Date().toISOString();
assert.deepEqual(
  assessPantheonSourceExecution('https://records.example.gov/person/jane-example', [{
    crawler: 'startrek',
    capabilityClass: 'primary',
    status: 'failed',
    evidenceCount: 0,
    attempts: 1,
    targets: 1,
    error: 'circuit_open',
    sourceOutcomes: [{
      sourceUrl: 'https://records.example.gov/person/jane-example',
      status: 'failed',
      retrievedAt: sourceOutcomeAt,
      durationMs: 12,
      error: 'circuit_open',
    }],
  }]),
  { status: 'failed', httpStatus: 0, failureReason: 'circuit_open' },
  'a non-throwing crawler failure must remain failed in frontier telemetry',
);
assert.deepEqual(
  assessPantheonSourceExecution('https://records.example.gov/person/jane-example', [{
    crawler: 'startrek',
    capabilityClass: 'primary',
    status: 'completed_no_evidence',
    evidenceCount: 0,
    attempts: 1,
    targets: 1,
    sourceOutcomes: [{
      sourceUrl: 'https://records.example.gov/person/jane-example',
      status: 'completed_no_evidence',
      retrievedAt: sourceOutcomeAt,
      durationMs: 12,
    }],
  }]),
  { status: 'completed_no_evidence', httpStatus: 200 },
  'a clean no-evidence retrieval must remain distinct from failed retrieval work',
);

const frontier = ['seed-a', 'seed-b', 'seed-c'];
assert.deepEqual(insertPantheonDiscoveredUrls(frontier, 1, ['child-a', 'child-b']), ['child-a', 'child-b']);
assert.deepEqual(frontier, ['seed-a', 'child-a', 'child-b', 'seed-b', 'seed-c']);
assert.deepEqual(insertPantheonDiscoveredUrls(frontier, 3, ['child-a', 'child-c']), ['child-c']);
assert.deepEqual(frontier, ['seed-a', 'child-a', 'child-b', 'child-c', 'seed-b', 'seed-c']);

const resumedLedger = [
  { url: 'done-a', frontierOrder: 0 },
  { url: 'pending-a', frontierOrder: 4 },
  { url: 'child-a', frontierOrder: 6 },
  { url: 'pending-b', frontierOrder: 5 },
] as PantheonUrlLedgerEntry[];
resequencePantheonFrontier(resumedLedger, ['pending-a', 'child-a', 'pending-b']);
assert.deepEqual(
  resumedLedger.map(entry => [entry.url, entry.frontierOrder]),
  [['done-a', 0], ['pending-a', 1], ['child-a', 2], ['pending-b', 3]],
  'resume must preserve a unique completed prefix before the remaining ordered frontier',
);

const aborted = new AbortController();
aborted.abort(new Error('fixture deadline'));
const outcomes = await runPantheonBounded(
  Array.from({ length: 30 }, (_, index) => index),
  4,
  async index => ({ index, state: aborted.signal.aborted ? 'partial' : 'completed' }),
  aborted.signal,
  true,
);
assert.equal(outcomes.length, 30);
assert.ok(outcomes.every((outcome, index) => outcome.index === index && outcome.state === 'partial'));

const completionOrder: number[] = [];
const orderedResults = await runPantheonBounded([0, 1, 2, 3], 4, async index => {
  await new Promise(resolve => setTimeout(resolve, (4 - index) * 2));
  completionOrder.push(index);
  return index;
});
assert.notDeepEqual(completionOrder, [0, 1, 2, 3], 'fixture must complete out of order');
assert.deepEqual(orderedResults, [0, 1, 2, 3], 'bounded URL results must commit in frontier order');

assert.equal(pantheonUrlWindowBudgetMs({
  categoryDeadlineAt: 10_000,
  remainingProductiveWork: 16,
  concurrency: 8,
  now: 0,
}), 5_000, 'remaining category time must be shared across required URL windows');

console.log('Pantheon 30-category depth, substitution-plan, priority, and deadline-drain verification passed.');
