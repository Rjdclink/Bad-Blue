import assert from 'node:assert/strict';
import { QuantiAdaptiveOptimizer } from '../adaptiveOptimizer.js';
import { installQuantiAdaptiveScheduling } from '../adaptiveRuntime.js';
import type { QuantiExecutionMetrics, QuantiExecutionResult, QuantiInteractionInsight, QuantiWorkload } from '../types.js';

function metrics(power: number, latency = 10): QuantiExecutionMetrics {
  return {
    queueLatencyMs: 0, executionMs: latency, validationMs: 0, totalLatencyMs: latency,
    cpuUserMs: 0, cpuSystemMs: 0, cpuTotalMs: 0,
    rssDeltaBytes: 0, heapDeltaBytes: 0,
    usefulWorkUnits: power * latency / 1000,
    usefulThroughputPerSecond: power,
    backend: 'inline',
    resourceBefore: {} as QuantiExecutionMetrics['resourceBefore'],
    resourceAfter: {} as QuantiExecutionMetrics['resourceAfter'],
  };
}

async function verifyCanaryPromotionAndRollback(): Promise<void> {
  const optimizer = new QuantiAdaptiveOptimizer({
    minBaselineSamples: 4, minInteractionSamples: 4, minCandidateSamples: 4,
    maxCanarySamples: 8, canaryEvery: 1, minPowerGain: 0.05,
    rollbackWindow: 4, cooldownSubmissions: 4,
  });
  const kind = 'verify.adaptive';
  for (let i = 0; i < 4; i += 1) optimizer.recordSuccess(kind, 'baseline', metrics(100), `b${i}`);
  const insight: QuantiInteractionInsight = {
    kind, target: 'useful_throughput_per_second',
    features: ['priority', 'queueDepthAtSubmit', 'activeAtSubmit', 'cpuBefore', 'usefulWorkUnits'],
    order: 5, correlation: 0.8, absoluteCorrelation: 0.8, samples: 64,
  };
  for (let i = 0; i < 4; i += 1) {
    const plan = optimizer.plan(kind, [insight]);
    assert.notEqual(plan.strategyId, 'baseline');
    assert.ok(plan.priorityBias > 0 && plan.priorityBias <= 25);
    optimizer.recordSuccess(kind, plan.strategyId, metrics(112, 10), `c${i}`);
  }
  assert.equal(optimizer.getKindStatus(kind).state, 'active');
  assert.equal(optimizer.getKindStatus(kind).promotions, 1);
  for (let i = 0; i < 6 && optimizer.getKindStatus(kind).state === 'active'; i += 1) {
    const plan = optimizer.plan(kind, [insight]);
    assert.notEqual(plan.strategyId, 'baseline');
    optimizer.recordSuccess(kind, plan.strategyId, metrics(70, 14), `r${i}`);
  }
  const rolled = optimizer.getKindStatus(kind);
  assert.equal(rolled.state, 'rolled_back');
  assert.equal(rolled.rollbacks, 1);
  assert.equal(optimizer.plan(kind, [insight]).strategyId, 'baseline');
}

async function verifyRuntimeWrapper(): Promise<void> {
  const seenPriorities: number[] = [];
  let execution = 0;
  const insight: QuantiInteractionInsight = {
    kind: 'verify.runtime', target: 'useful_throughput_per_second',
    features: ['priority', 'queueDepthAtSubmit'], order: 2,
    correlation: 0.8, absoluteCorrelation: 0.8, samples: 64,
  };
  const fake = {
    getInteractionInsights: () => [insight],
    async submit<Input, Result>(workload: QuantiWorkload<Input, Result>): Promise<QuantiExecutionResult<Result>> {
      seenPriorities.push(workload.priority);
      execution += 1;
      return {
        executionId: `e${execution}`, workloadId: workload.id, kind: workload.kind,
        validated: true, result: true as Result,
        metrics: metrics(workload.priority > 50 ? 112 : 100),
      };
    },
  };
  const optimizer = new QuantiAdaptiveOptimizer({
    minBaselineSamples: 4, minInteractionSamples: 4,
    minCandidateSamples: 2, maxCanarySamples: 4, canaryEvery: 1,
  });
  installQuantiAdaptiveScheduling(fake, optimizer);
  installQuantiAdaptiveScheduling(fake, optimizer);
  const workload = (id: string): QuantiWorkload<null, boolean> => ({
    id, kind: 'verify.runtime', lane: 'hot', priority: 50, input: null,
    policy: { timeoutMs: 1000 }, execute: () => true, validate: value => value === true,
  });
  for (let i = 0; i < 4; i += 1) await fake.submit(workload(`b${i}`));
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 2; i += 1) await fake.submit(workload(`c${i}`));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seenPriorities.slice(0, 4), [50, 50, 50, 50]);
  assert.ok(seenPriorities.slice(4).every(value => value > 50));
  assert.equal(optimizer.getKindStatus('verify.runtime').state, 'active');
}

async function verifyWeakEvidenceAndObservationDedup(): Promise<void> {
  const optimizer = new QuantiAdaptiveOptimizer({ minBaselineSamples: 4, minInteractionSamples: 4, canaryEvery: 1 });
  for (let i = 0; i < 8; i += 1) optimizer.recordSuccess('weak', 'baseline', metrics(100, 5), `w${i}`);
  assert.equal(optimizer.plan('weak', []).strategyId, 'baseline');
  assert.equal(optimizer.plan('weak', [{
    kind: 'weak', target: 'useful_throughput_per_second', features: ['priority', 'queueDepthAtSubmit'],
    order: 2, correlation: 0.1, absoluteCorrelation: 0.1, samples: 64,
  }]).strategyId, 'baseline');

  const dedup = new QuantiAdaptiveOptimizer({ minBaselineSamples: 4 });
  let calls = 0;
  const fake = {
    getInteractionInsights: () => [] as QuantiInteractionInsight[],
    async submit<Input, Result>(workload: QuantiWorkload<Input, Result>): Promise<QuantiExecutionResult<Result>> {
      calls += 1;
      return {
        executionId: 'shared-exec', workloadId: workload.id, kind: workload.kind,
        validated: true, result: true as Result, metrics: metrics(100, 5),
      };
    },
  };
  installQuantiAdaptiveScheduling(fake, dedup);
  const workload = (id: string): QuantiWorkload<null, boolean> => ({
    id, kind: 'dedupe-check', lane: 'hot', priority: 1, input: null,
    policy: { timeoutMs: 100 }, execute: () => true, validate: () => true,
  });
  await fake.submit(workload('a'));
  await fake.submit(workload('b'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(dedup.getKindStatus('dedupe-check').baseline.samples, 1);
}

await verifyCanaryPromotionAndRollback();
await verifyRuntimeWrapper();
await verifyWeakEvidenceAndObservationDedup();
console.log('Quanti adaptive scheduling verification passed');
