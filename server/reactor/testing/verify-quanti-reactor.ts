import assert from 'node:assert/strict';
import {
  computationalReactor,
  getHeatMonitor,
  initializeReactor,
  reactorEvents,
  shutdownReactor,
} from '../computationalReactor.js';

function waitForEvent<T>(event: string, predicate: (value: T) => boolean, timeoutMs = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reactorEvents.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      reactorEvents.off(event, listener);
      resolve(value);
    };
    reactorEvents.on(event, listener);
  });
}

await initializeReactor({
  maxConcurrentJobs: 2,
  maxJobsPerHour: 1_000,
  maintenanceWindow: { start: '23:59', end: '00:00' },
});

computationalReactor.registerExecutor('batch_inference', async job => ({
  requestsUsed: 1,
  result: { echo: job.payload.value },
}));

const completion = waitForEvent<any>('job-completed', value => value.job?.type === 'batch_inference');
const completedJobId = await computationalReactor.submitJob('batch_inference', { value: 42 }, 5, { maxRetries: 0 });
const completed = await completion;
assert.equal(completed.job.id, completedJobId);
assert.equal(completed.result.result.echo, 42);
assert.equal(completed.computeAuthority, 'quanti-comp');
assert.equal(computationalReactor.getJob(completedJobId)?.status, 'completed');

const originalRandom = Math.random;
Math.random = () => { throw new Error('Math.random must not be used by Reactor telemetry'); };
try {
  const heat = getHeatMonitor();
  assert.ok(Number.isFinite(heat.cpuUsage));
  assert.ok(Number.isFinite(heat.memoryUsage));
} finally {
  Math.random = originalRandom;
}

const failure = waitForEvent<any>('job-failed', value => value.job?.type === 'osint_sweep');
const unsupportedJobId = await computationalReactor.submitJob('osint_sweep', { target: 'verify' }, 5, { maxRetries: 0 });
const failed = await failure;
assert.equal(failed.job.id, unsupportedJobId);
assert.match(failed.error, /REACTOR_EXECUTOR_UNAVAILABLE/);
assert.equal(failed.authoritativeResult, false);
assert.equal(computationalReactor.getJob(unsupportedJobId)?.status, 'failed');

const monteCarloCompletion = waitForEvent<any>('job-completed', value => value.job?.type === 'monte_carlo');
const monteCarloJobId = await computationalReactor.scheduleMonteCarloRun(
  'verification',
  async parameters => (parameters as { x: number }).x,
  { x: { min: 0, max: 1 } },
);
const monteCarlo = await monteCarloCompletion;
assert.equal(monteCarlo.job.id, monteCarloJobId);
assert.ok(monteCarlo.result.scoreAfter >= monteCarlo.result.scoreBefore);
assert.equal(monteCarlo.result.result.deterministicSequence, 'halton');

const futureJobId = await computationalReactor.submitJob(
  'batch_inference',
  { value: 1 },
  5,
  { scheduledAt: new Date(Date.now() + 10_000), maxRetries: 0 },
);
assert.equal(computationalReactor.cancelJob(futureJobId), true);
assert.equal(computationalReactor.getJob(futureJobId)?.status, 'cancelled');
assert.equal(computationalReactor.getStatus().simulatedComputeAuthoritative, false);

await shutdownReactor();
console.log('Quanti-backed Reactor verification passed');
