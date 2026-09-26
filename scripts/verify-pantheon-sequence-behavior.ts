import assert from 'node:assert/strict';
import {
  buildPantheonCategoryTargets,
  type PantheonBackgroundCategory,
} from '../server/services/pantheon/PantheonSovereignSourceRegistry';
import { runPantheonBounded } from '../server/services/pantheon/PantheonBoundedScheduler';
import {
  PANTHEON_CATEGORY_CONCURRENCY_LIMIT,
  PANTHEON_URL_CONCURRENCY_PER_CATEGORY,
} from '../server/services/pantheon/PantheonBoundedScheduler';
import { getPantheonReportDurationMs } from '../shared/pantheonReportConfig';

process.env.PANTHEON_FRONTIER_LOCAL_ONLY = '1';
const ORIGINAL_DATABASE_ENV = {
  SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
  DATABASE_URL: process.env.DATABASE_URL,
};
// This verifier exercises pure sequencing/frontier behavior. It must not import
// runtime database/configuration state merely because Railway exposes a DB URL
// during image construction.
delete process.env.SUPABASE_DATABASE_URL;
delete process.env.SUPABASE_DB_URL;
delete process.env.DATABASE_URL;

const {
  categoryProductiveWorkTarget,
  initializePantheonCategoryPlans,
  insertPantheonDiscoveredUrls,
  assessPantheonSourceExecution,
  pantheonUrlWindowBudgetMs,
  PANTHEON_REPORT_CATEGORIES,
  resequencePantheonFrontier,
  sourcePriority,
} = await import('../server/services/pantheon/PantheonCategoryWorkflow');
type PantheonUrlLedgerEntry = import('../server/services/pantheon/PantheonCategoryWorkflow').PantheonUrlLedgerEntry;

assert.equal(PANTHEON_REPORT_CATEGORIES.length, 30);
assert.equal(PANTHEON_CATEGORY_CONCURRENCY_LIMIT, 4, 'categories must execute in bounded parallel waves');
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
    assert.ok(plan.sourcePlan.urls.length <= Math.min(300, target * 2), `${plan.label} initial seed frontier must remain bounded; productive depth is supplied dynamically`);
    assert.equal(new Set(plan.sourcePlan.urls).size, plan.sourcePlan.urls.length);
    // Search-first architecture permits zero static seeds for a category.
    // Runtime discovery and category-gap discovery are authoritative; registry
    // sources are optional standby inputs, not a completion prerequisite.
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
assert.ok(directRegistryTargets.every(target =>
  target.authority !== 'primary' || target.transport !== 'search-provider'
), 'any primary standby target must be a direct, policy-admitted source rather than a search-result page');
assert.ok(directRegistryTargets.some(target => target.authority === 'discovery' && target.subjectScoped),
  'dynamic discovery must remain subject-scoped and available even when no static primary seed exists');

const subjectFirstPlan = initializePantheonCategoryPlans({
  name: 'Jane Example',
  location: 'New York, NY',
  searchDepth: 1,
  budgetMs: getPantheonReportDurationMs(1),
})[0];
assert.ok(!/bing\.com\/search|duckduckgo\.com\/html/.test(subjectFirstPlan.sourcePlan.urls[0] || ''),
  'the persisted standby frontier must retain a direct registry path while runtime search-first discovery leads execution');
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

if (ORIGINAL_DATABASE_ENV.SUPABASE_DATABASE_URL !== undefined) process.env.SUPABASE_DATABASE_URL = ORIGINAL_DATABASE_ENV.SUPABASE_DATABASE_URL;
if (ORIGINAL_DATABASE_ENV.SUPABASE_DB_URL !== undefined) process.env.SUPABASE_DB_URL = ORIGINAL_DATABASE_ENV.SUPABASE_DB_URL;
if (ORIGINAL_DATABASE_ENV.DATABASE_URL !== undefined) process.env.DATABASE_URL = ORIGINAL_DATABASE_ENV.DATABASE_URL;
delete process.env.PANTHEON_FRONTIER_LOCAL_ONLY;
console.log('Pantheon 30-category dynamic depth, bounded standby frontier, priority, and deadline-drain verification passed.');
