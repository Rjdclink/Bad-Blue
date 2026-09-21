import assert from 'node:assert/strict';
import {
  categoryProductiveWorkTarget,
  initializePantheonCategoryPlans,
  PANTHEON_REPORT_CATEGORIES,
  sourcePriority,
} from '../server/services/pantheon/PantheonCategoryWorkflow';
import { runPantheonBounded } from '../server/services/pantheon/PantheonBoundedScheduler';

assert.equal(PANTHEON_REPORT_CATEGORIES.length, 30);
const expectedTotals = new Map<number, number>([[1, 1_200], [2, 2_820], [3, 4_500]]);
for (const depth of [1, 2, 3] as const) {
  const target = categoryProductiveWorkTarget(depth);
  assert.equal(target * PANTHEON_REPORT_CATEGORIES.length, expectedTotals.get(depth));
  const plans = initializePantheonCategoryPlans({
    name: 'Jane Example',
    location: 'New York, NY',
    searchDepth: depth,
    budgetMs: depth * 10 * 60_000,
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
assert.ok(sourcePriority('secondary') > sourcePriority('archive'));
assert.ok(sourcePriority('archive') > sourcePriority('discovery'));

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

console.log('Pantheon 30-category depth, substitution-plan, priority, and deadline-drain verification passed.');
