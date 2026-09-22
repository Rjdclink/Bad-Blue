import assert from 'node:assert/strict';
import {
  getPantheonCrawlerPoolActivity,
  isPantheonCrawlerTimeout,
  normalizePantheonCrawlerSelection,
  normalizePantheonResultLimit,
  runPantheonCrawlerPooled,
} from '../server/services/pantheonCrawlerOrchestrator';

assert.deepEqual(
  normalizePantheonCrawlerSelection(['cerberus', 'startrek', 'cerberus']),
  ['cerberus', 'startrek'],
  'crawler selection must deduplicate without changing source-skill order',
);
assert.throws(
  () => normalizePantheonCrawlerSelection([]),
  /at least one crawler capability/,
  'empty crawler dispatch must fail closed',
);
assert.throws(
  () => normalizePantheonCrawlerSelection(['startrek', 'unknown-crawler']),
  /unknown crawler capability/,
  'unknown crawler dispatch must fail closed',
);

for (const message of ['request timed out', 'deadline expired', 'operation aborted']) {
  assert.equal(isPantheonCrawlerTimeout(new Error(message)), true, `${message} must be a timed-out route`);
}
assert.equal(isPantheonCrawlerTimeout(new Error('HTTP 403')), false);
assert.equal(normalizePantheonResultLimit(), Number.POSITIVE_INFINITY);
assert.equal(normalizePantheonResultLimit(0), 1);
assert.equal(normalizePantheonResultLimit(17.8), 17);
assert.equal(normalizePantheonResultLimit(Number.NaN), 1_000);
assert.equal(normalizePantheonResultLimit(Number.POSITIVE_INFINITY), 1_000);

let active = 0;
let maximumActive = 0;
const ordered = await Promise.all(Array.from({ length: 4 }, (_, index) =>
  runPantheonCrawlerPooled('blizzard', async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return index;
  })
));
assert.deepEqual(ordered, [0, 1, 2, 3]);
assert.equal(maximumActive, 1, 'heavy Blizzard routes must occupy their dedicated pool one at a time');

let releaseLich!: () => void;
const heldLich = runPantheonCrawlerPooled('lich', () => new Promise<void>(resolve => {
  releaseLich = resolve;
}));
await new Promise(resolve => setTimeout(resolve, 0));
const queuedAbort = new AbortController();
const queuedLich = runPantheonCrawlerPooled('lich', async () => undefined, queuedAbort.signal);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(getPantheonCrawlerPoolActivity().lich.queued, 1);
queuedAbort.abort(new Error('fixture deadline'));
await assert.rejects(queuedLich, /aborted while queued/);
releaseLich();
await heldLich;

for (const state of Object.values(getPantheonCrawlerPoolActivity())) {
  assert.equal(state.active, 0, 'crawler pool slots must always be released');
  assert.equal(state.queued, 0, 'crawler pool queues must drain completely');
}

console.log('Pantheon crawler orchestrator pool, routing, timeout, abort, and ordering verification passed.');
